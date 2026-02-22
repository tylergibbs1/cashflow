import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initDb, _resetDb, upsertAccounts, upsertTransactions } from "../src/core/db.js";
import { searchTransactions, grepTransactions } from "../src/core/search.js";
import { ConfigError } from "../src/types/index.js";

const testAccount = {
  account_id: "acc_1",
  item_id: "item_1",
  name: "Checking",
  official_name: "Premium Checking",
  type: "depository",
  subtype: "checking",
  mask: "1234",
  current_balance: 1000,
  available_balance: 900,
  iso_currency_code: "USD",
};

const baseTxn = {
  account_id: "acc_1",
  amount: 10,
  iso_currency_code: "USD",
  date: "2024-06-15",
  pending: 0,
  subcategory: null,
  payment_channel: "online",
  transaction_type: "place",
  authorized_date: "2024-06-15",
};

function createTestDb(): Database {
  const db = new Database(":memory:", { strict: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

describe("search", () => {
  beforeEach(() => {
    const db = createTestDb();
    initDb(db);
    upsertAccounts([testAccount]);
    upsertTransactions([
      { ...baseTxn, transaction_id: "txn_1", name: "Starbucks Coffee", merchant_name: "Starbucks", category: "FOOD_AND_DRINK" },
      { ...baseTxn, transaction_id: "txn_2", name: "Amazon Purchase", merchant_name: "Amazon", category: "SHOPPING", amount: 50 },
      { ...baseTxn, transaction_id: "txn_3", name: "Uber Ride", merchant_name: "Uber", category: "TRANSPORTATION", amount: 25 },
      { ...baseTxn, transaction_id: "txn_4", name: "Coffee Bean & Tea", merchant_name: "Coffee Bean", category: "FOOD_AND_DRINK", amount: 8 },
      { ...baseTxn, transaction_id: "txn_5", name: "Shell Gas Station", merchant_name: "Shell", category: "TRANSPORTATION", amount: 40 },
    ]);
  });

  afterEach(() => {
    _resetDb();
  });

  describe("searchTransactions (FTS5)", () => {
    it("finds transactions by merchant name", () => {
      const results = searchTransactions("Starbucks");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some((t) => t.merchant_name === "Starbucks")).toBe(true);
    });

    it("finds transactions by category", () => {
      const results = searchTransactions("FOOD_AND_DRINK");
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it("finds transactions by name", () => {
      const results = searchTransactions("Coffee");
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it("returns empty for no matches", () => {
      const results = searchTransactions("nonexistent12345");
      expect(results).toHaveLength(0);
    });

    it("returns empty for empty query", () => {
      const results = searchTransactions("");
      expect(results).toHaveLength(0);
    });

    it("respects limit parameter", () => {
      const results = searchTransactions("Coffee", 1);
      expect(results).toHaveLength(1);
    });

    it("handles multi-word OR search", () => {
      const results = searchTransactions("Starbucks Amazon");
      expect(results.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("grepTransactions (regex)", () => {
    it("matches transactions by regex pattern", () => {
      const results = grepTransactions("starbucks", {});
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].merchant_name).toBe("Starbucks");
    });

    it("matches with OR pattern", () => {
      const results = grepTransactions("starbucks|amazon", {});
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it("is case insensitive", () => {
      const results = grepTransactions("UBER", {});
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it("returns empty for no matches", () => {
      const results = grepTransactions("zzz_no_match", {});
      expect(results).toHaveLength(0);
    });

    it("throws ConfigError for invalid regex", () => {
      expect(() => grepTransactions("[invalid", {})).toThrow(ConfigError);
    });
  });
});
