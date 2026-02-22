import chalk from "chalk";
import type {
  AccountsResponse,
  TransactionsResponse,
  SyncResponse,
  ErrorResponse,
  AccountResponse,
  TransactionResponse,
  SearchResponse,
  GrepResponse,
  TagRulesResponse,
  SplitResponse,
  BudgetsResponse,
  BudgetStatus,
  BurnResponse,
  NetResponse,
  SnapshotResponse,
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

type PrettyCommand =
  | "accounts"
  | "ls"
  | "sync"
  | "link"
  | "search"
  | "grep"
  | "tags"
  | "tag"
  | "split"
  | "budget"
  | "budgets"
  | "burn"
  | "net"
  | "snapshot";

export function writePretty(data: unknown, command: PrettyCommand): void {
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
    case "search":
      prettySearch(data as SearchResponse);
      break;
    case "grep":
      prettyGrep(data as GrepResponse);
      break;
    case "tags":
      prettyTagRules(data as TagRulesResponse);
      break;
    case "tag":
      prettyTagResult(data as { id: number; pattern: string; tag: string; priority: number });
      break;
    case "split":
      prettySplit(data as SplitResponse);
      break;
    case "budget":
    case "budgets":
      prettyBudgets(data as BudgetsResponse);
      break;
    case "burn":
      prettyBurn(data as BurnResponse);
      break;
    case "net":
      prettyNet(data as NetResponse);
      break;
    case "snapshot":
      prettySnapshot(data as SnapshotResponse);
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
    const category = pad(t.tag || t.category || "", 16);
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

function prettySearch(data: SearchResponse): void {
  if (data.transactions.length === 0) {
    console.log(chalk.dim(`No results for "${data.query}".`));
    return;
  }
  console.log(chalk.bold(`Search: "${data.query}" (${data.count} results)\n`));
  printTransactionTable(data.transactions);
}

function prettyGrep(data: GrepResponse): void {
  if (data.transactions.length === 0) {
    console.log(chalk.dim(`No matches for /${data.pattern}/.`));
    return;
  }
  console.log(chalk.bold(`Grep: /${data.pattern}/ (${data.count} matches)\n`));
  printTransactionTable(data.transactions);
}

function prettyTagRules(data: TagRulesResponse): void {
  if (data.rules.length === 0) {
    console.log(chalk.dim("No tag rules defined."));
    return;
  }

  const header = [
    pad("ID", 6),
    pad("Pattern", 30),
    pad("Tag", 20),
    pad("Priority", 10),
  ].join("");

  console.log(chalk.bold(header));
  console.log(chalk.dim("─".repeat(66)));

  for (const r of data.rules) {
    console.log(
      `${pad(String(r.id), 6)}${pad(r.pattern, 30)}${pad(r.tag, 20)}${pad(String(r.priority), 10)}`
    );
  }
  console.log(chalk.dim(`\n${data.count} rule(s)`));
}

function prettyTagResult(data: { id: number; pattern: string; tag: string; priority: number }): void {
  console.log(chalk.green(`Rule #${data.id} created: /${data.pattern}/ → ${data.tag} (priority: ${data.priority})`));
}

function prettySplit(data: SplitResponse): void {
  if (data.categories.length === 0) {
    console.log(chalk.dim("No spending data."));
    return;
  }

  const header = [pad("Category", 25), pad("Count", 8), pad("Total", 14)].join("");
  console.log(chalk.bold(header));
  console.log(chalk.dim("─".repeat(47)));

  for (const c of data.categories) {
    console.log(
      `${pad(c.tag, 25)}${pad(String(c.count), 8)}${pad(formatCurrency(c.total, null), 14)}`
    );
  }
  console.log(chalk.dim(`\nTotal: ${formatCurrency(data.total, null)}`));
}

function prettyBudgets(data: BudgetsResponse): void {
  if (data.budgets.length === 0) {
    console.log(chalk.dim("No budgets set."));
    return;
  }

  console.log(chalk.bold(`Budgets for ${data.month}\n`));

  for (const b of data.budgets) {
    const pct = Math.round(b.percent_used * 100);
    const barWidth = 30;
    const filled = Math.min(barWidth, Math.round(b.percent_used * barWidth));
    const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
    const color = b.over_budget ? chalk.red : b.percent_used >= b.alert_threshold ? chalk.yellow : chalk.green;

    console.log(`  ${chalk.bold(b.tag)}`);
    console.log(`  ${color(bar)} ${pct}%`);
    console.log(
      `  ${formatCurrency(b.spent, null)} / ${formatCurrency(b.monthly_limit, null)}  (${formatCurrency(b.remaining, null)} remaining)`
    );
    console.log();
  }
}

function prettyBurn(data: BurnResponse): void {
  if (data.burn.months.length === 0) {
    console.log(chalk.dim("No spending data."));
    return;
  }

  const header = [pad("Month", 12), pad("Spending", 14)].join("");
  console.log(chalk.bold(header));
  console.log(chalk.dim("─".repeat(26)));

  for (const m of data.burn.months) {
    console.log(`${pad(m.month, 12)}${pad(formatCurrency(m.total, null), 14)}`);
  }

  const trendColor =
    data.burn.trend === "increasing" ? chalk.red :
    data.burn.trend === "decreasing" ? chalk.green :
    chalk.dim;
  console.log(`\nTrend: ${trendColor(data.burn.trend)}`);
}

function prettyNet(data: NetResponse): void {
  if (data.net.months.length === 0) {
    console.log(chalk.dim("No data."));
    return;
  }

  const header = [
    pad("Month", 12),
    pad("Income", 14),
    pad("Expenses", 14),
    pad("Net", 14),
  ].join("");

  console.log(chalk.bold(header));
  console.log(chalk.dim("─".repeat(54)));

  for (const m of data.net.months) {
    const netColor = m.net >= 0 ? chalk.green : chalk.red;
    console.log(
      `${pad(m.month, 12)}${chalk.green(pad(formatCurrency(m.income, null), 14))}${chalk.red(pad(formatCurrency(m.expenses, null), 14))}${netColor(pad(formatCurrency(m.net, null), 14))}`
    );
  }
}

function prettySnapshot(data: SnapshotResponse): void {
  console.log(chalk.bold("Financial Snapshot\n"));

  // Accounts
  console.log(chalk.bold("Accounts"));
  for (const a of data.accounts) {
    console.log(`  ${a.name}: ${formatCurrency(a.current_balance, a.iso_currency_code)}`);
  }
  console.log(chalk.bold(`  Total: ${formatCurrency(data.total_balance, null)}`));

  // Runway
  if (data.runway_months !== null) {
    console.log(`\n  Runway: ${chalk.cyan(String(data.runway_months))} months`);
  }

  // Burn trend
  console.log(`  Burn trend: ${data.burn.trend}`);

  // Alerts
  if (data.alerts.length > 0) {
    console.log(chalk.bold.yellow("\nBudget Alerts"));
    for (const a of data.alerts) {
      const pct = Math.round(a.percent_used * 100);
      const msg = a.over_budget ? chalk.red(`OVER (${pct}%)`) : chalk.yellow(`${pct}%`);
      console.log(`  ${a.tag}: ${msg}`);
    }
  }

  console.log(chalk.dim(`\nLast synced: ${data.synced_at}`));
}

function printTransactionTable(transactions: TransactionResponse[]): void {
  const header = [
    pad("Date", 12),
    pad("Name", 30),
    pad("Amount", 14),
    pad("Tag", 16),
  ].join("");

  console.log(chalk.bold(header));
  console.log(chalk.dim("─".repeat(72)));

  for (const t of transactions) {
    const date = pad(t.date, 12);
    const name = pad(t.merchant_name || t.name, 30);
    const amount = t.amount >= 0
      ? chalk.red(pad(formatCurrency(t.amount, null), 14))
      : chalk.green(pad(formatCurrency(t.amount, null), 14));
    const tag = pad(t.tag || t.category || "", 16);
    console.log(`${date}${name}${amount}${tag}`);
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
