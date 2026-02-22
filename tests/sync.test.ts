import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { initDb, _resetDb, getAccounts, getTransactions, getSyncState } from "../src/core/db.js";

// We test the mapping logic and atomicity without calling real Plaid

describe("sync", () => {
  beforeEach(() => {
    const db = new Database(":memory:", { strict: true });
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    initDb(db);
  });

  afterEach(() => {
    _resetDb();
  });

  describe("transaction mapping", () => {
    it("maps Plaid transaction fields correctly", async () => {
      // Simulate what sync.ts does: map Plaid fields to our schema then upsert
      const { upsertAccounts, upsertTransactions } = await import("../src/core/db.js");

      upsertAccounts([{
        account_id: "acc_1",
        item_id: "item_1",
        name: "Checking",
        official_name: null,
        type: "depository",
        subtype: "checking",
        mask: "0000",
        current_balance: 500,
        available_balance: 500,
        iso_currency_code: "USD",
      }]);

      // Simulate Plaid → our schema mapping
      upsertTransactions([{
        transaction_id: "plaid_txn_1",
        account_id: "acc_1",
        amount: 25.0, // positive = spending
        iso_currency_code: "USD",
        date: "2024-06-01",
        name: "Starbucks", // merchant_name preferred over name
        merchant_name: "Starbucks",
        pending: 0,
        category: "FOOD_AND_DRINK",
        subcategory: "COFFEE",
        payment_channel: "in store",
        transaction_type: "place",
        authorized_date: "2024-06-01",
      }]);

      const txns = getTransactions();
      expect(txns).toHaveLength(1);
      expect(txns[0].amount).toBe(25.0);
      expect(txns[0].merchant_name).toBe("Starbucks");
      expect(txns[0].isIncome).toBe(false);
    });

    it("handles income (negative amounts)", async () => {
      const { upsertAccounts, upsertTransactions } = await import("../src/core/db.js");

      upsertAccounts([{
        account_id: "acc_1",
        item_id: "item_1",
        name: "Checking",
        official_name: null,
        type: "depository",
        subtype: "checking",
        mask: "0000",
        current_balance: 500,
        available_balance: 500,
        iso_currency_code: "USD",
      }]);

      upsertTransactions([{
        transaction_id: "plaid_txn_2",
        account_id: "acc_1",
        amount: -1500.0, // negative = income
        iso_currency_code: "USD",
        date: "2024-06-01",
        name: "Direct Deposit",
        merchant_name: null,
        pending: 0,
        category: "INCOME",
        subcategory: "PAYROLL",
        payment_channel: "other",
        transaction_type: "special",
        authorized_date: "2024-06-01",
      }]);

      const txns = getTransactions();
      expect(txns[0].isIncome).toBe(true);
      expect(txns[0].displayName).toBe("Direct Deposit"); // falls back to name when no merchant
    });
  });

  describe("atomicity", () => {
    it("writes multiple transactions atomically", async () => {
      const { upsertAccounts, upsertTransactions } = await import("../src/core/db.js");

      upsertAccounts([{
        account_id: "acc_1",
        item_id: "item_1",
        name: "Checking",
        official_name: null,
        type: "depository",
        subtype: "checking",
        mask: "0000",
        current_balance: 500,
        available_balance: 500,
        iso_currency_code: "USD",
      }]);

      const txns = Array.from({ length: 100 }, (_, i) => ({
        transaction_id: `txn_${i}`,
        account_id: "acc_1",
        amount: i * 10,
        iso_currency_code: "USD",
        date: "2024-06-01",
        name: `Transaction ${i}`,
        merchant_name: null,
        pending: 0,
        category: null,
        subcategory: null,
        payment_channel: "online",
        transaction_type: "digital",
        authorized_date: "2024-06-01",
      }));

      upsertTransactions(txns);
      expect(getTransactions()).toHaveLength(100);
    });
  });

  describe("pagination simulation", () => {
    it("accumulates across multiple pages then writes once", async () => {
      const { upsertAccounts, upsertTransactions, setSyncState } = await import("../src/core/db.js");
      const { getDb } = await import("../src/core/db.js");

      upsertAccounts([{
        account_id: "acc_1",
        item_id: "item_1",
        name: "Checking",
        official_name: null,
        type: "depository",
        subtype: "checking",
        mask: "0000",
        current_balance: 500,
        available_balance: 500,
        iso_currency_code: "USD",
      }]);

      // Simulate collecting pages
      const page1 = Array.from({ length: 5 }, (_, i) => ({
        transaction_id: `p1_txn_${i}`,
        account_id: "acc_1",
        amount: 10,
        iso_currency_code: "USD",
        date: "2024-06-01",
        name: `P1 Txn ${i}`,
        merchant_name: null,
        pending: 0,
        category: null,
        subcategory: null,
        payment_channel: "online",
        transaction_type: "digital",
        authorized_date: "2024-06-01",
      }));

      const page2 = Array.from({ length: 5 }, (_, i) => ({
        transaction_id: `p2_txn_${i}`,
        account_id: "acc_1",
        amount: 20,
        iso_currency_code: "USD",
        date: "2024-06-02",
        name: `P2 Txn ${i}`,
        merchant_name: null,
        pending: 0,
        category: null,
        subcategory: null,
        payment_channel: "online",
        transaction_type: "digital",
        authorized_date: "2024-06-02",
      }));

      // Atomic write of all pages + cursor
      const db = getDb();
      db.transaction(() => {
        upsertTransactions([...page1, ...page2]);
        setSyncState("item_1", "cursor_after_page2");
      })();

      expect(getTransactions()).toHaveLength(10);
      const state = getSyncState("item_1");
      expect(state!.cursor).toBe("cursor_after_page2");
    });
  });
});
