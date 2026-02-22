import chalk from "chalk";
import type {
  AccountsResponse,
  TransactionsResponse,
  SyncResponse,
  ErrorResponse,
  AccountResponse,
  TransactionResponse,
} from "../types/index.js";
import {
  EXIT_SUCCESS,
  EXIT_NO_RESULTS,
  EXIT_ERROR,
  EXIT_PLAID_ERROR,
  EXIT_CONFIG_ERROR,
} from "../types/index.js";

export function writeJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data) + "\n");
}

export function writeError(error: ErrorResponse): void {
  process.stderr.write(JSON.stringify(error) + "\n");
}

export function writePretty(
  data: unknown,
  command: "accounts" | "ls" | "sync" | "link"
): void {
  switch (command) {
    case "accounts":
      prettyAccounts(data as AccountsResponse);
      break;
    case "ls":
      prettyTransactions(data as TransactionsResponse);
      break;
    case "sync":
      prettySyncResult(data as SyncResponse);
      break;
    case "link":
      prettyLinkResult(data as { accounts: AccountResponse[] });
      break;
  }
}

function prettyAccounts(data: AccountsResponse): void {
  if (data.accounts.length === 0) {
    console.log(chalk.dim("No accounts found."));
    return;
  }

  const header = [
    pad("Account", 30),
    pad("Type", 12),
    pad("Balance", 14),
    pad("Available", 14),
    pad("Mask", 6),
  ].join("");

  console.log(chalk.bold(header));
  console.log(chalk.dim("─".repeat(76)));

  for (const a of data.accounts) {
    const name = pad(a.official_name || a.name, 30);
    const type = pad(`${a.type}/${a.subtype || ""}`, 12);
    const balance = pad(formatCurrency(a.current_balance, a.iso_currency_code), 14);
    const available = pad(
      formatCurrency(a.available_balance, a.iso_currency_code),
      14
    );
    const mask = pad(a.mask || "", 6);
    console.log(`${name}${type}${balance}${available}${mask}`);
  }
}

function prettyTransactions(data: TransactionsResponse): void {
  if (data.transactions.length === 0) {
    console.log(chalk.dim("No transactions found."));
    return;
  }

  const header = [
    pad("Date", 12),
    pad("Name", 30),
    pad("Amount", 14),
    pad("Category", 16),
    pad("Pending", 8),
  ].join("");

  console.log(chalk.bold(header));
  console.log(chalk.dim("─".repeat(80)));

  for (const t of data.transactions) {
    const date = pad(t.date, 12);
    const name = pad(t.merchant_name || t.name, 30);
    const amount = t.amount >= 0
      ? chalk.red(pad(formatCurrency(t.amount, null), 14))
      : chalk.green(pad(formatCurrency(t.amount, null), 14));
    const category = pad(t.category || "", 16);
    const pending = t.pending ? chalk.yellow(pad("pending", 8)) : pad("", 8);
    console.log(`${date}${name}${amount}${category}${pending}`);
  }

  console.log(chalk.dim(`\n${data.count} transaction(s)`));
}

function prettySyncResult(data: SyncResponse): void {
  console.log(chalk.bold("Sync complete"));
  console.log(`  Added:    ${chalk.green(String(data.added))}`);
  console.log(`  Modified: ${chalk.yellow(String(data.modified))}`);
  console.log(`  Removed:  ${chalk.red(String(data.removed))}`);
}

function prettyLinkResult(data: { accounts: AccountResponse[] }): void {
  console.log(chalk.bold.green("Account linked successfully!"));
  console.log(`  ${data.accounts.length} account(s) connected\n`);
  for (const a of data.accounts) {
    console.log(
      `  ${chalk.bold(a.name)} (${a.type}/${a.subtype || ""}) ••${a.mask || ""}`
    );
  }
}

function formatCurrency(amount: number | null, currency: string | null): string {
  if (amount === null) return "—";
  const symbol = currency === "USD" || !currency ? "$" : currency + " ";
  return `${symbol}${amount.toFixed(2)}`;
}

function pad(str: string, len: number): string {
  if (str.length >= len) return str.slice(0, len - 1) + " ";
  return str + " ".repeat(len - str.length);
}

// Exit code helpers
export function exitSuccess(): never {
  process.exit(EXIT_SUCCESS);
}

export function exitNoResults(): never {
  process.exit(EXIT_NO_RESULTS);
}

export function exitError(): never {
  process.exit(EXIT_ERROR);
}

export function exitPlaidError(): never {
  process.exit(EXIT_PLAID_ERROR);
}

export function exitConfigError(): never {
  process.exit(EXIT_CONFIG_ERROR);
}
