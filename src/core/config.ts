import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir, hostname, userInfo } from "os";
import type { AppConfig, EncryptedPayload } from "../types/index.js";
import { ConfigError } from "../types/index.js";

const CONFIG_DIR = join(
  process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
  "cashflow"
);
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

function getKeyMaterial(): string {
  return `${hostname()}:${userInfo().username}:cashflow`;
}

async function deriveKey(
  salt: Uint8Array
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(getKeyMaterial()),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encrypt(plaintext: string): Promise<EncryptedPayload> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(salt);
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded
  );
  return {
    ciphertext: Buffer.from(ciphertext).toString("base64"),
    iv: Buffer.from(iv).toString("base64"),
    salt: Buffer.from(salt).toString("base64"),
  };
}

export async function decrypt(payload: EncryptedPayload): Promise<string> {
  const salt = new Uint8Array(Buffer.from(payload.salt, "base64"));
  const iv = new Uint8Array(Buffer.from(payload.iv, "base64"));
  const ciphertext = Buffer.from(payload.ciphertext, "base64");
  const key = await deriveKey(salt);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );
  return new TextDecoder().decode(decrypted);
}

export function loadConfig(): AppConfig | null {
  if (!existsSync(CONFIG_PATH)) return null;
  const raw = readFileSync(CONFIG_PATH, "utf-8");
  return JSON.parse(raw) as AppConfig;
}

export function saveConfig(config: AppConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

export function isConfigured(): boolean {
  return loadConfig() !== null;
}

export async function getDecryptedAccessTokens(): Promise<
  { accessToken: string; itemId: string }[]
> {
  const config = loadConfig();
  if (!config) throw new ConfigError("Not configured. Run `cashflow link` first.");
  return Promise.all(
    config.items.map(async (item) => ({
      accessToken: await decrypt(item.access_token),
      itemId: item.item_id,
    }))
  );
}

export async function getDecryptedPlaidCredentials(): Promise<{
  clientId: string;
  secret: string;
  env: string;
}> {
  const config = loadConfig();
  if (!config)
    throw new ConfigError("Not configured. Run `cashflow link` first.");
  return {
    clientId: await decrypt(config.plaid_client_id),
    secret: await decrypt(config.plaid_secret),
    env: config.plaid_env,
  };
}

// For testing
export const _paths = { CONFIG_DIR, CONFIG_PATH };
