import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  Products,
  CountryCode,
} from "plaid";
import { getDecryptedPlaidCredentials } from "./config.js";
import { PlaidApiError } from "../types/index.js";

let client: PlaidApi | null = null;

export async function getPlaidClient(): Promise<PlaidApi> {
  if (client) return client;
  const creds = await getDecryptedPlaidCredentials();
  const config = new Configuration({
    basePath: PlaidEnvironments[creds.env] || PlaidEnvironments.sandbox,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": creds.clientId,
        "PLAID-SECRET": creds.secret,
        "Plaid-Version": "2020-09-14",
      },
    },
  });
  client = new PlaidApi(config);
  return client;
}

export async function createLinkToken(): Promise<string> {
  const plaid = await getPlaidClient();
  try {
    const response = await plaid.linkTokenCreate({
      user: { client_user_id: "cashflow-cli" },
      client_name: "cashflow",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: "en",
    });
    return response.data.link_token;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new PlaidApiError(`Failed to create link token: ${msg}`);
  }
}

export async function exchangePublicToken(
  publicToken: string
): Promise<{ accessToken: string; itemId: string }> {
  const plaid = await getPlaidClient();
  try {
    const response = await plaid.itemPublicTokenExchange({
      public_token: publicToken,
    });
    return {
      accessToken: response.data.access_token,
      itemId: response.data.item_id,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new PlaidApiError(`Failed to exchange public token: ${msg}`);
  }
}

export async function runLinkFlow(): Promise<{
  accessToken: string;
  itemId: string;
}> {
  const linkToken = await createLinkToken();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.stop();
      reject(new PlaidApiError("Link flow timed out after 5 minutes"));
    }, 5 * 60 * 1000);

    const html = `<!DOCTYPE html>
<html>
<head>
  <title>cashflow — Link Account</title>
  <script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script>
  <style>
    body { font-family: system-ui; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0a0a0a; color: #fafafa; }
    .container { text-align: center; }
    h1 { font-size: 1.5rem; font-weight: 500; }
    p { color: #888; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>cashflow</h1>
    <p>Connecting to your bank...</p>
    <p id="status"></p>
  </div>
  <script>
    const handler = Plaid.create({
      token: '${linkToken}',
      onSuccess: async (public_token, metadata) => {
        document.getElementById('status').textContent = 'Linked! You can close this window.';
        await fetch('/callback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ public_token, institution: metadata.institution })
        });
      },
      onExit: (err) => {
        if (err) {
          document.getElementById('status').textContent = 'Error: ' + err.display_message;
          fetch('/callback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: err.display_message || 'Link exited with error' })
          });
        } else {
          document.getElementById('status').textContent = 'Cancelled. You can close this window.';
          fetch('/callback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'User cancelled' })
          });
        }
      },
    });
    handler.open();
  </script>
</body>
</html>`;

    let port = 28571;
    const maxRetries = 10;
    let server: ReturnType<typeof Bun.serve>;

    function tryServe(attempt: number): void {
      try {
        server = Bun.serve({
          port: port + attempt,
          fetch: async (req) => {
            const url = new URL(req.url);
            if (req.method === "POST" && url.pathname === "/callback") {
              const body = await req.json() as { public_token?: string; institution?: { name: string }; error?: string };
              server.stop();
              clearTimeout(timeout);

              if (body.error) {
                reject(new PlaidApiError(body.error));
                return new Response("ok");
              }

              try {
                const result = await exchangePublicToken(body.public_token!);
                resolve({
                  ...result,
                  ...({ institutionName: body.institution?.name || null } as Record<string, unknown>),
                });
              } catch (err) {
                reject(err);
              }
              return new Response("ok");
            }
            return new Response(html, {
              headers: { "Content-Type": "text/html" },
            });
          },
        });

        const actualPort = port + attempt;
        const url = `http://localhost:${actualPort}`;

        // Open browser
        const platform = process.platform;
        if (platform === "darwin") {
          Bun.spawn(["open", url]);
        } else if (platform === "linux") {
          Bun.spawn(["xdg-open", url]);
        } else {
          Bun.spawn(["cmd", "/c", "start", url]);
        }

        process.stderr.write(
          `Opened browser for Plaid Link at ${url}\n`
        );
      } catch {
        if (attempt < maxRetries) {
          tryServe(attempt + 1);
        } else {
          clearTimeout(timeout);
          reject(new PlaidApiError("Could not find an available port for Link flow"));
        }
      }
    }

    tryServe(0);
  });
}

// Reset for testing
export function _resetClient(): void {
  client = null;
}
