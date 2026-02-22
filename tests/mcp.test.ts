import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initDb, _resetDb, upsertAccounts, upsertTransactions } from "../src/core/db.js";
import { searchTransactions, grepTransactions } from "../src/core/search.js";
import { addTagRule, applyTagRules } from "../src/core/tags.js";
import { setBudget, getBudgetStatuses } from "../src/core/budgets.js";
import { getSnapshot } from "../src/core/reports.js";
import { formatSnapshotConcise, formatSnapshotDetailed } from "../src/core/format.js";

// MCP tests validate the dispatch logic by testing the underlying functions
// that the MCP server calls, plus format output.

const testAccount = {
  account_id: "acc_1",
  item_id: "item_1",
  name: "Checking",
  official_name: null,
  type: "depository",
  subtype: "checking",
  mask: "1234",
  current_balance: 5000,
  available_balance: 4500,
  iso_currency_code: "USD",
};

const baseTxn = {
  account_id: "acc_1",
  iso_currency_code: "USD",
  pending: 0,
  subcategory: null,
  payment_channel: "online",
  transaction_type: "place",
  authorized_date: null,
};

function createTestDb(): Database {
  const db = new Database(":memory:", { strict: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

describe("mcp dispatch logic", () => {
  beforeEach(() => {
    const db = createTestDb();
    initDb(db);
    upsertAccounts([testAccount]);
  });

  afterEach(() => {
    _resetDb();
  });

  it("cashflow_snapshot concise format", () => {
    const snapshot = getSnapshot();
    const text = formatSnapshotConcise(snapshot);
    expect(text).toContain("Balance:");
    expect(typeof text).toBe("string");
  });

  it("cashflow_snapshot detailed format", () => {
    const snapshot = getSnapshot();
    const text = formatSnapshotDetailed(snapshot);
    expect(text).toContain("Financial Snapshot");
    expect(text.split("\n").length).toBeGreaterThan(3);
  });

  it("cashflow_query with search", () => {
    upsertTransactions([
      { ...baseTxn, transaction_id: "txn_1", name: "Starbucks Coffee", merchant_name: "Starbucks", category: "FOOD", date: "2024-06-15", amount: 5 },
    ]);
    const results = searchTransactions("Starbucks");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("cashflow_query with grep", () => {
    upsertTransactions([
      { ...baseTxn, transaction_id: "txn_1", name: "Amazon Purchase", merchant_name: "Amazon", category: "SHOPPING", date: "2024-06-15", amount: 50 },
    ]);
    const results = grepTransactions("amazon", {});
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("cashflow_configure add_tag_rule", () => {
    const id = addTagRule("starbucks", "coffee", 0);
    expect(id).toBeGreaterThan(0);
  });

  it("cashflow_configure apply_tag_rules", () => {
    upsertTransactions([
      { ...baseTxn, transaction_id: "txn_1", name: "Starbucks", merchant_name: "Starbucks", category: "FOOD", date: "2024-06-15", amount: 5 },
    ]);
    addTagRule("starbucks", "coffee");
    const count = applyTagRules();
    expect(count).toBe(1);
  });

  it("cashflow_configure set_budget and list_budgets", () => {
    setBudget("food", 500, 0.9);
    const statuses = getBudgetStatuses("2024-06");
    expect(statuses).toHaveLength(1);
    expect(statuses[0].tag).toBe("food");
  });

  it("cashflow_query with invalid grep pattern returns error", () => {
    expect(() => grepTransactions("[invalid", {})).toThrow();
  });
});
