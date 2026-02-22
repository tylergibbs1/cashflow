#!/usr/bin/env bun

import { Command } from "commander";
import { createInterface } from "readline/promises";
import {
  initDb,
  getAccounts,
  getTransactions,
  getAccountByIdOrMask,
  removeAccountsByItem,
  removeTransactionsByAccount,
  removeSyncState,
} from "./core/db.js";
import {
  encrypt,
  saveConfig,
  loadConfig,
  isConfigured,
  removeItem,
} from "./core/config.js";
import { runLinkFlow } from "./core/plaid.js";
import { syncAll } from "./core/sync.js";
import { searchTransactions, grepTransactions } from "./core/search.js";
import { addTagRule, getTagRules, getSpendingByTag } from "./core/tags.js";
import { setBudget, getBudgetStatuses, deleteBudget } from "./core/budgets.js";
import { getBurnReport, getNetReport, getSnapshot } from "./core/reports.js";
import { exportCsv, exportJson } from "./core/export.js";
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
  SearchResponse,
  GrepResponse,
  TagRulesResponse,
  SplitResponse,
  BudgetsResponse,
  BurnResponse,
  NetResponse,
  SnapshotResponse,
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
  .version("1.0.0");

program.option("--pretty", "Human-readable table output instead of JSON");

// ── link ──

program
  .command("link")
  .description("Link a bank account via Plaid")
  .action(async () => {
    const pretty = program.opts().pretty;
    try {
      let config = loadConfig();

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

      const result = await runLinkFlow() as {
        accessToken: string;
        itemId: string;
        institutionName?: string;
      };

      config.items.push({
        access_token: await encrypt(result.accessToken),
        item_id: result.itemId,
        institution_name: result.institutionName || null,
        added_at: new Date().toISOString(),
      });
      saveConfig(config);

      initDb();
      await syncAll();

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

      validateDateOpt(opts.from, "--from");
      validateDateOpt(opts.to, "--to");

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
        if (pretty) writePretty(response, "ls");
        else writeJson(response);
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
        if (pretty) writePretty(response, "accounts");
        else writeJson(response);
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

// ── search ──

program
  .command("search <query>")
  .description("Full-text search transactions (BM25 ranked)")
  .option("--limit <n>", "Limit number of results", parseInt, 50)
  .action(async (query, opts) => {
    const pretty = program.opts().pretty;
    try {
      requireConfigured();
      initDb();

      const transactions = searchTransactions(query, opts.limit);
      const response: SearchResponse = {
        transactions: transactions.map(toTransactionResponse),
        count: transactions.length,
        query,
      };

      if (transactions.length === 0) {
        if (pretty) writePretty(response, "search");
        else writeJson(response);
        exitNoResults();
      }

      if (pretty) {
        writePretty(response, "search");
      } else {
        writeJson(response);
      }
      exitSuccess();
    } catch (err) {
      handleError(err, pretty);
    }
  });

// ── grep ──

program
  .command("grep <pattern>")
  .description("Regex search on merchant/transaction names")
  .option("--from <date>", "Start date (YYYY-MM-DD)")
  .option("--to <date>", "End date (YYYY-MM-DD)")
  .option("--limit <n>", "Limit number of results", parseInt)
  .action(async (pattern, opts) => {
    const pretty = program.opts().pretty;
    try {
      requireConfigured();
      initDb();

      validateDateOpt(opts.from, "--from");
      validateDateOpt(opts.to, "--to");

      const transactions = grepTransactions(pattern, {
        from: opts.from,
        to: opts.to,
        limit: opts.limit,
      });
      const response: GrepResponse = {
        transactions: transactions.map(toTransactionResponse),
        count: transactions.length,
        pattern,
      };

      if (transactions.length === 0) {
        if (pretty) writePretty(response, "grep");
        else writeJson(response);
        exitNoResults();
      }

      if (pretty) {
        writePretty(response, "grep");
      } else {
        writeJson(response);
      }
      exitSuccess();
    } catch (err) {
      handleError(err, pretty);
    }
  });

// ── tag ──

program
  .command("tag <pattern> <tag>")
  .description("Add a tag rule (regex pattern → tag)")
  .option("--priority <n>", "Rule priority (higher = checked first)", parseInt, 0)
  .action(async (pattern, tag, opts) => {
    const pretty = program.opts().pretty;
    try {
      requireConfigured();
      initDb();

      const id = addTagRule(pattern, tag, opts.priority);
      const response = { id, pattern, tag, priority: opts.priority };

      if (pretty) {
        writePretty(response, "tag");
      } else {
        writeJson(response);
      }
      exitSuccess();
    } catch (err) {
      handleError(err, pretty);
    }
  });

// ── tags ──

program
  .command("tags")
  .description("List all tag rules")
  .action(async () => {
    const pretty = program.opts().pretty;
    try {
      requireConfigured();
      initDb();

      const rules = getTagRules();
      const response: TagRulesResponse = {
        rules: rules.map((r) => ({
          id: r.id,
          pattern: r.pattern,
          tag: r.tag,
          priority: r.priority,
        })),
        count: rules.length,
      };

      if (rules.length === 0) {
        if (pretty) writePretty(response, "tags");
        else writeJson(response);
        exitNoResults();
      }

      if (pretty) {
        writePretty(response, "tags");
      } else {
        writeJson(response);
      }
      exitSuccess();
    } catch (err) {
      handleError(err, pretty);
    }
  });

// ── split ──

program
  .command("split")
  .description("Show spending breakdown by tag/category")
  .option("--from <date>", "Start date (YYYY-MM-DD)")
  .option("--to <date>", "End date (YYYY-MM-DD)")
  .action(async (opts) => {
    const pretty = program.opts().pretty;
    try {
      requireConfigured();
      initDb();

      validateDateOpt(opts.from, "--from");
      validateDateOpt(opts.to, "--to");

      const categories = getSpendingByTag({ from: opts.from, to: opts.to });
      const total = categories.reduce((s, c) => s + c.total, 0);
      const response: SplitResponse = {
        categories,
        total: Math.round(total * 100) / 100,
      };

      if (categories.length === 0) {
        if (pretty) writePretty(response, "split");
        else writeJson(response);
        exitNoResults();
      }

      if (pretty) {
        writePretty(response, "split");
      } else {
        writeJson(response);
      }
      exitSuccess();
    } catch (err) {
      handleError(err, pretty);
    }
  });

// ── budget ──

program
  .command("budget [tag] [limit]")
  .description("Set or show budgets")
  .option("--alert <threshold>", "Alert threshold (0-1)", parseFloat, 0.9)
  .option("--month <YYYY-MM>", "Month to show status for")
  .option("--delete", "Delete the budget for the given tag")
  .action(async (tag, limit, opts) => {
    const pretty = program.opts().pretty;
    try {
      requireConfigured();
      initDb();

      // Delete mode
      if (opts.delete && tag) {
        const deleted = deleteBudget(tag);
        const response = { deleted, tag };
        writeJson(response);
        exitSuccess();
      }

      // Set budget
      if (tag && limit) {
        setBudget(tag, parseFloat(limit), opts.alert);
        const response = { tag, monthly_limit: parseFloat(limit), alert_threshold: opts.alert };
        if (pretty) {
          writePretty(response, "tag");
        } else {
          writeJson(response);
        }
        exitSuccess();
      }

      // Show budgets
      const budgets = getBudgetStatuses(opts.month);
      const month = opts.month || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
      const response: BudgetsResponse = { budgets, month };

      if (budgets.length === 0) {
        if (pretty) writePretty(response, "budgets");
        else writeJson(response);
        exitNoResults();
      }

      if (pretty) {
        writePretty(response, "budgets");
      } else {
        writeJson(response);
      }
      exitSuccess();
    } catch (err) {
      handleError(err, pretty);
    }
  });

// ── burn ──

program
  .command("burn")
  .description("Show monthly spending burn rate")
  .option("--months <n>", "Number of months", parseInt, 6)
  .action(async (opts) => {
    const pretty = program.opts().pretty;
    try {
      requireConfigured();
      initDb();

      const burn = getBurnReport(opts.months);
      const response: BurnResponse = { burn };

      if (burn.months.length === 0) {
        if (pretty) writePretty(response, "burn");
        else writeJson(response);
        exitNoResults();
      }

      if (pretty) {
        writePretty(response, "burn");
      } else {
        writeJson(response);
      }
      exitSuccess();
    } catch (err) {
      handleError(err, pretty);
    }
  });

// ── net ──

program
  .command("net")
  .description("Show income vs expenses by month")
  .option("--months <n>", "Number of months", parseInt, 6)
  .action(async (opts) => {
    const pretty = program.opts().pretty;
    try {
      requireConfigured();
      initDb();

      const net = getNetReport(opts.months);
      const response: NetResponse = { net };

      if (net.months.length === 0) {
        if (pretty) writePretty(response, "net");
        else writeJson(response);
        exitNoResults();
      }

      if (pretty) {
        writePretty(response, "net");
      } else {
        writeJson(response);
      }
      exitSuccess();
    } catch (err) {
      handleError(err, pretty);
    }
  });

// ── snapshot ──

program
  .command("snapshot")
  .description("Comprehensive financial summary")
  .action(async () => {
    const pretty = program.opts().pretty;
    try {
      requireConfigured();
      initDb();

      const response = getSnapshot();

      if (pretty) {
        writePretty(response, "snapshot");
      } else {
        writeJson(response);
      }
      exitSuccess();
    } catch (err) {
      handleError(err, pretty);
    }
  });

// ── export ──

program
  .command("export")
  .description("Export transactions to CSV or JSON")
  .option("--format <type>", "Output format: csv or json", "csv")
  .option("--from <date>", "Start date (YYYY-MM-DD)")
  .option("--to <date>", "End date (YYYY-MM-DD)")
  .option("--tag <category>", "Filter by tag/category")
  .action(async (opts) => {
    const pretty = program.opts().pretty;
    try {
      requireConfigured();
      initDb();

      validateDateOpt(opts.from, "--from");
      validateDateOpt(opts.to, "--to");

      const transactions = getTransactions({
        from: opts.from,
        to: opts.to,
        tag: opts.tag,
      }).map(toTransactionResponse);

      if (transactions.length === 0) {
        writeJson({ transactions: [], count: 0 });
        exitNoResults();
      }

      if (opts.format === "json") {
        process.stdout.write(exportJson(transactions));
      } else {
        process.stdout.write(exportCsv(transactions));
      }
      exitSuccess();
    } catch (err) {
      handleError(err, pretty);
    }
  });

// ── unlink ──

program
  .command("unlink <identifier>")
  .description("Remove a linked account and its data")
  .action(async (identifier) => {
    const pretty = program.opts().pretty;
    try {
      requireConfigured();
      initDb();

      // Find the account
      const account = getAccountByIdOrMask(identifier);
      if (!account) {
        throw new ConfigError(`Account not found: "${identifier}"`);
      }

      const itemId = account.item_id;

      // Cascading removal: transactions first (FK constraint), then accounts
      const allAccounts = getAccounts().filter((a) => a.item_id === itemId);
      const accountIds = allAccounts.map((a) => a.account_id);
      const txnCount = removeTransactionsByAccount(accountIds);
      removeAccountsByItem(itemId);
      removeSyncState(itemId);
      removeItem(itemId);

      const response = {
        removed: {
          item_id: itemId,
          accounts: accountIds.length,
          transactions: txnCount,
        },
      };

      writeJson(response);
      exitSuccess();
    } catch (err) {
      handleError(err, pretty);
    }
  });

// ── mcp ──

program
  .command("mcp")
  .description("Start MCP server for AI agent integration")
  .action(async () => {
    try {
      const { startMcpServer } = await import("./mcp.js");
      await startMcpServer();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      writeError({ error: { code: "MCP_ERROR", message: msg } });
      exitError();
    }
  });

// ── Helpers ──

function requireConfigured(): void {
  if (!isConfigured()) {
    throw new ConfigError("Not configured. Run `cashflow link` first.");
  }
}

function validateDateOpt(value: string | undefined, flag: string): void {
  if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ConfigError(`Invalid ${flag} date "${value}". Use YYYY-MM-DD format.`);
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
  pending: number | boolean;
  category: string | null;
  subcategory: string | null;
  payment_channel: string | null;
  tag?: string | null;
}): TransactionResponse {
  return {
    transaction_id: t.transaction_id,
    account_id: t.account_id,
    amount: t.amount,
    date: t.date,
    name: t.name,
    merchant_name: t.merchant_name,
    pending: typeof t.pending === "boolean" ? t.pending : t.pending === 1,
    category: t.category,
    subcategory: t.subcategory,
    payment_channel: t.payment_channel,
    tag: t.tag ?? null,
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
