import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { initDb, getTransactions, searchFts } from "./core/db.js";
import { searchTransactions, grepTransactions } from "./core/search.js";
import { addTagRule, getTagRules, deleteTagRule, applyTagRules } from "./core/tags.js";
import { setBudget, getBudgets, deleteBudget, getBudgetStatuses } from "./core/budgets.js";
import { getSnapshot } from "./core/reports.js";
import { syncAll } from "./core/sync.js";
import {
  formatSnapshotConcise,
  formatSnapshotDetailed,
  formatTransactionsConcise,
  formatTransactionsDetailed,
  formatConfigResult,
} from "./core/format.js";

export async function startMcpServer(): Promise<void> {
  initDb();

  const server = new McpServer({
    name: "cashflow",
    version: "1.0.0",
  });

  // ── cashflow_snapshot ──
  server.tool(
    "cashflow_snapshot",
    "Get a financial snapshot with accounts, balances, budgets, burn rate, and alerts",
    {
      detail: z.enum(["concise", "detailed"]).default("concise").describe("Level of detail"),
    },
    async ({ detail }) => {
      try {
        const snapshot = getSnapshot();
        const text = detail === "detailed"
          ? formatSnapshotDetailed(snapshot)
          : formatSnapshotConcise(snapshot);
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  // ── cashflow_query ──
  server.tool(
    "cashflow_query",
    "Search or list transactions. Use q for FTS search, grep for regex, or filters for listing.",
    {
      q: z.string().optional().describe("FTS5 search query"),
      grep: z.string().optional().describe("Regex pattern to match merchant/name"),
      from: z.string().optional().describe("Start date YYYY-MM-DD"),
      to: z.string().optional().describe("End date YYYY-MM-DD"),
      tag: z.string().optional().describe("Filter by tag/category"),
      limit: z.number().optional().default(20).describe("Max results"),
      detail: z.enum(["concise", "detailed"]).default("concise").describe("Level of detail"),
    },
    async ({ q, grep, from, to, tag, limit, detail }) => {
      try {
        let transactions;
        if (q) {
          transactions = searchTransactions(q, limit);
        } else if (grep) {
          transactions = grepTransactions(grep, { from, to, tag, limit });
        } else {
          transactions = getTransactions({ from, to, tag, limit });
        }

        const mapped = transactions.map((t) => ({
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
          tag: t.tag,
        }));

        const text = detail === "detailed"
          ? formatTransactionsDetailed(mapped)
          : formatTransactionsConcise(mapped);
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  // ── cashflow_configure ──
  server.tool(
    "cashflow_configure",
    "Configure tag rules, budgets, and alerts",
    {
      action: z.enum([
        "add_tag_rule",
        "list_tag_rules",
        "delete_tag_rule",
        "apply_tag_rules",
        "set_budget",
        "list_budgets",
        "delete_budget",
      ]).describe("Configuration action"),
      pattern: z.string().optional().describe("Regex pattern (for tag rules)"),
      tag: z.string().optional().describe("Tag name"),
      priority: z.number().optional().describe("Rule priority"),
      limit: z.number().optional().describe("Budget monthly limit"),
      alert_threshold: z.number().optional().describe("Budget alert threshold (0-1)"),
      rule_id: z.number().optional().describe("Tag rule ID (for delete)"),
      month: z.string().optional().describe("Month YYYY-MM (for budgets)"),
    },
    async ({ action, pattern, tag, priority, limit, alert_threshold, rule_id, month }) => {
      try {
        let result: Record<string, unknown>;

        switch (action) {
          case "add_tag_rule":
            if (!pattern || !tag) throw new Error("pattern and tag required");
            const id = addTagRule(pattern, tag, priority ?? 0);
            result = { id, pattern, tag, priority: priority ?? 0 };
            break;
          case "list_tag_rules":
            result = { rules: getTagRules() };
            break;
          case "delete_tag_rule":
            if (rule_id === undefined) throw new Error("rule_id required");
            result = { deleted: deleteTagRule(rule_id) };
            break;
          case "apply_tag_rules":
            result = { tagged: applyTagRules() };
            break;
          case "set_budget":
            if (!tag || limit === undefined) throw new Error("tag and limit required");
            setBudget(tag, limit, alert_threshold ?? 0.9);
            result = { tag, limit, alert_threshold: alert_threshold ?? 0.9 };
            break;
          case "list_budgets":
            result = { budgets: getBudgetStatuses(month) };
            break;
          case "delete_budget":
            if (!tag) throw new Error("tag required");
            result = { deleted: deleteBudget(tag) };
            break;
          default:
            throw new Error(`Unknown action: ${action}`);
        }

        const text = formatConfigResult(action, result);
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  // ── cashflow_sync ──
  server.tool(
    "cashflow_sync",
    "Sync transactions from all linked bank accounts",
    {},
    async () => {
      try {
        const result = await syncAll();
        const text = `Synced: +${result.added} added, ~${result.modified} modified, -${result.removed} removed`;
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
