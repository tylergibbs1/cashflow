#!/usr/bin/env bun

import { Command } from "commander";
import { createInterface } from "readline/promises";
import { initDb, getAccounts, getTransactions } from "./core/db.js";
import {
  encrypt,
  saveConfig,
  loadConfig,
  isConfigured,
} from "./core/config.js";
import { runLinkFlow, getPlaidClient } from "./core/plaid.js";
import { syncAll } from "./core/sync.js";
import {
  writeJson,
  writeError,
  writePretty,
  exitSuccess,
  exitNoResults,
  exitPlaidError,
  exitConfigError,
  exitError,
} from "./core/output.js";
import type {
  AppConfig,
  AccountsResponse,
  TransactionsResponse,
  AccountResponse,
  TransactionResponse,
  ErrorResponse,
} from "./types/index.js";
import {
  ConfigError,
  PlaidApiError,
  SyncError,
} from "./types/index.js";

const program = new Command();

program
  .name("cashflow")
  .description("Agent-first personal finance CLI")
  .version("0.1.0");

program.option("--pretty", "Human-readable table output instead of JSON");

// ── link ──

program
  .command("link")
  .description("Link a bank account via Plaid")
  .action(async () => {
    const pretty = program.opts().pretty;
    try {
      let config = loadConfig();

      // First run: prompt for Plaid credentials
      if (!config) {
        const rl = createInterface({
          input: process.stdin,
          output: process.stderr,
        });

        process.stderr.write("First-time setup — enter your Plaid credentials\n");
        const clientId = await rl.question("Plaid Client ID: ");
        const secret = await rl.question("Plaid Secret: ");
        const env =
          (await rl.question("Plaid Environment [sandbox]: ")) || "sandbox";
        rl.close();

        config = {
          plaid_client_id: await encrypt(clientId),
          plaid_secret: await encrypt(secret),
          plaid_env: env,
          items: [],
        };
        saveConfig(config);
      }

      // Run Plaid Link flow
      const result = await runLinkFlow() as {
        accessToken: string;
        itemId: string;
        institutionName?: string;
      };

      // Save encrypted access token
      config.items.push({
        access_token: await encrypt(result.accessToken),
        item_id: result.itemId,
        institution_name: result.institutionName || null,
        added_at: new Date().toISOString(),
      });
      saveConfig(config);

      // Init DB and sync initial accounts
      initDb();
      const syncResult = await syncAll();

      const accounts = getAccounts().map(toAccountResponse);
      const output = { accounts };

      if (pretty) {
        writePretty(output, "link");
      } else {
        writeJson(output);
      }
      exitSuccess();
    } catch (err) {
      handleError(err, pretty);
    }
  });

// ── sync ──

program
  .command("sync")
  .description("Sync transactions from linked accounts")
  .action(async () => {
    const pretty = program.opts().pretty;
    try {
      requireConfigured();
      initDb();
      const result = await syncAll();

      if (pretty) {
        writePretty(result, "sync");
      } else {
        writeJson(result);
      }
      exitSuccess();
    } catch (err) {
      handleError(err, pretty);
    }
  });

// ── ls ──

program
  .command("ls")
  .description("List transactions")
  .option("--from <date>", "Start date (YYYY-MM-DD)")
  .option("--to <date>", "End date (YYYY-MM-DD)")
  .option("--min <amount>", "Minimum amount", parseFloat)
  .option("--max <amount>", "Maximum amount", parseFloat)
  .option("--account <id>", "Filter by account ID")
  .option("--tag <category>", "Filter by category/tag")
  .option("--pending", "Show only pending transactions")
  .option("--limit <n>", "Limit number of results", parseInt)
  .action(async (opts) => {
    const pretty = program.opts().pretty;
    try {
      requireConfigured();
      initDb();

      // Validate date formats
      if (opts.from && !/^\d{4}-\d{2}-\d{2}$/.test(opts.from)) {
        throw new ConfigError(
          `Invalid --from date "${opts.from}". Use YYYY-MM-DD format.`
        );
      }
      if (opts.to && !/^\d{4}-\d{2}-\d{2}$/.test(opts.to)) {
        throw new ConfigError(
          `Invalid --to date "${opts.to}". Use YYYY-MM-DD format.`
        );
      }

      const transactions = getTransactions({
        from: opts.from,
        to: opts.to,
        min: opts.min,
        max: opts.max,
        account: opts.account,
        tag: opts.tag,
        pending: opts.pending ? true : undefined,
        limit: opts.limit,
      });

      const response: TransactionsResponse = {
        transactions: transactions.map(toTransactionResponse),
        count: transactions.length,
      };

      if (transactions.length === 0) {
        if (pretty) {
          writePretty(response, "ls");
        } else {
          writeJson(response);
        }
        exitNoResults();
      }

      if (pretty) {
        writePretty(response, "ls");
      } else {
        writeJson(response);
      }
      exitSuccess();
    } catch (err) {
      handleError(err, pretty);
    }
  });

// ── accounts ──

program
  .command("accounts")
  .description("Show connected accounts and balances")
  .action(async () => {
    const pretty = program.opts().pretty;
    try {
      requireConfigured();
      initDb();

      const accounts = getAccounts();
      const response: AccountsResponse = {
        accounts: accounts.map(toAccountResponse),
      };

      if (accounts.length === 0) {
        if (pretty) {
          writePretty(response, "accounts");
        } else {
          writeJson(response);
        }
        exitNoResults();
      }

      if (pretty) {
        writePretty(response, "accounts");
      } else {
        writeJson(response);
      }
      exitSuccess();
    } catch (err) {
      handleError(err, pretty);
    }
  });

// ── Helpers ──

function requireConfigured(): void {
  if (!isConfigured()) {
    throw new ConfigError("Not configured. Run `cashflow link` first.");
  }
}

function toAccountResponse(a: {
  account_id: string;
  name: string;
  official_name: string | null;
  type: string;
  subtype: string | null;
  mask: string | null;
  current_balance: number | null;
  available_balance: number | null;
  iso_currency_code: string | null;
}): AccountResponse {
  return {
    account_id: a.account_id,
    name: a.name,
    official_name: a.official_name,
    type: a.type,
    subtype: a.subtype,
    mask: a.mask,
    current_balance: a.current_balance,
    available_balance: a.available_balance,
    iso_currency_code: a.iso_currency_code,
  };
}

function toTransactionResponse(t: {
  transaction_id: string;
  account_id: string;
  amount: number;
  date: string;
  name: string;
  merchant_name: string | null;
  pending: number;
  category: string | null;
  subcategory: string | null;
  payment_channel: string | null;
}): TransactionResponse {
  return {
    transaction_id: t.transaction_id,
    account_id: t.account_id,
    amount: t.amount,
    date: t.date,
    name: t.name,
    merchant_name: t.merchant_name,
    pending: t.pending === 1,
    category: t.category,
    subcategory: t.subcategory,
    payment_channel: t.payment_channel,
  };
}

function handleError(err: unknown, pretty: boolean): never {
  let errorResponse: ErrorResponse;

  if (err instanceof ConfigError) {
    errorResponse = {
      error: { code: err.code, message: err.message },
    };
    writeError(errorResponse);
    exitConfigError();
  } else if (err instanceof PlaidApiError) {
    errorResponse = {
      error: {
        code: err.code,
        message: err.message,
        details: err.plaidCode ? { plaid_code: err.plaidCode } : undefined,
      },
    };
    writeError(errorResponse);
    exitPlaidError();
  } else if (err instanceof SyncError) {
    errorResponse = {
      error: { code: err.code, message: err.message },
    };
    writeError(errorResponse);
    exitError();
  } else {
    const msg = err instanceof Error ? err.message : String(err);
    errorResponse = {
      error: { code: "UNKNOWN_ERROR", message: msg },
    };
    writeError(errorResponse);
    exitError();
  }
}

program.parse();
