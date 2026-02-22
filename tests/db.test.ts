import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import {
  initDb,
  _setDb,
  _resetDb,
  upsertAccounts,
  upsertTransactions,
  removeTransactions,
  getAccounts,
  getTransactions,
  getSyncState,
  setSyncState,
} from "../src/core/db.js";
import { Account, Transaction } from "../src/types/index.js";

function createTestDb(): Database {
  const db = new Database(":memory:", { strict: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

const testAccount = {
  account_id: "acc_1",
  item_id: "item_1",
  name: "Checking",
  official_name: "Premium Checking",
  type: "depository",
  subtype: "checking",
  mask: "1234",
  current_balance: 1000.5,
  available_balance: 900.0,
  iso_currency_code: "USD",
};

const testTransaction = {
  transaction_id: "txn_1",
  account_id: "acc_1",
  amount: 42.5,
  iso_currency_code: "USD",
  date: "2024-06-15",
  name: "Coffee Shop",
  merchant_name: "Starbucks",
  pending: 0,
  category: "FOOD_AND_DRINK",
  subcategory: "COFFEE",
  payment_channel: "in store",
  transaction_type: "place",
  authorized_date: "2024-06-15",
};

describe("db", () => {
  beforeEach(() => {
    const db = createTestDb();
    initDb(db);
  });

  afterEach(() => {
    _resetDb();
  });

  describe("schema", () => {
    it("sets WAL mode (in-memory returns 'memory')", () => {
      const db = createTestDb();
      initDb(db);
      const result = db.query("PRAGMA journal_mode").get() as { journal_mode: string };
      // In-memory DBs report "memory" even after WAL pragma; real file DBs use WAL
      expect(["wal", "memory"]).toContain(result.journal_mode);
    });

    it("creates all required tables", () => {
      const db = createTestDb();
      initDb(db);
      const tables = db
        .query(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
        .all() as { name: string }[];
      const names = tables.map((t) => t.name);
      expect(names).toContain("accounts");
      expect(names).toContain("transactions");
      expect(names).toContain("sync_state");
      expect(names).toContain("tag_rules");
      expect(names).toContain("budgets");
    });

    it("creates FTS5 virtual table", () => {
      const db = createTestDb();
      initDb(db);
      const tables = db
        .query(
          "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%fts%'"
        )
        .all() as { name: string }[];
      expect(tables.length).toBeGreaterThan(0);
    });
  });

  describe("accounts", () => {
    it("inserts and retrieves accounts", () => {
      upsertAccounts([testAccount]);
      const accounts = getAccounts();
      expect(accounts).toHaveLength(1);
      expect(accounts[0]).toBeInstanceOf(Account);
      expect(accounts[0].account_id).toBe("acc_1");
      expect(accounts[0].name).toBe("Checking");
      expect(accounts[0].current_balance).toBe(1000.5);
    });

    it("upserts on conflict", () => {
      upsertAccounts([testAccount]);
      upsertAccounts([{ ...testAccount, current_balance: 2000.0 }]);
      const accounts = getAccounts();
      expect(accounts).toHaveLength(1);
      expect(accounts[0].current_balance).toBe(2000.0);
    });
  });

  describe("transactions", () => {
    beforeEach(() => {
      upsertAccounts([testAccount]);
    });

    it("inserts and retrieves transactions", () => {
      upsertTransactions([testTransaction]);
      const txns = getTransactions();
      expect(txns).toHaveLength(1);
      expect(txns[0]).toBeInstanceOf(Transaction);
      expect(txns[0].transaction_id).toBe("txn_1");
      expect(txns[0].amount).toBe(42.5);
      expect(txns[0].merchant_name).toBe("Starbucks");
    });

    it("maps computed properties via .as()", () => {
      upsertTransactions([testTransaction]);
      const txn = getTransactions()[0];
      expect(txn.isIncome).toBe(false);
      expect(txn.displayName).toBe("Starbucks");
      expect(txn.isPending).toBe(false);
    });

    it("detects income transactions", () => {
      upsertTransactions([{ ...testTransaction, amount: -500 }]);
      const txn = getTransactions()[0];
      expect(txn.isIncome).toBe(true);
    });

    it("upserts on conflict", () => {
      upsertTransactions([testTransaction]);
      upsertTransactions([{ ...testTransaction, amount: 99.99 }]);
      const txns = getTransactions();
      expect(txns).toHaveLength(1);
      expect(txns[0].amount).toBe(99.99);
    });

    it("removes transactions", () => {
      upsertTransactions([testTransaction]);
      removeTransactions(["txn_1"]);
      expect(getTransactions()).toHaveLength(0);
    });

    it("handles empty remove gracefully", () => {
      removeTransactions([]);
      expect(getTransactions()).toHaveLength(0);
    });
  });

  describe("filters", () => {
    beforeEach(() => {
      upsertAccounts([testAccount]);
      upsertTransactions([
        { ...testTransaction, transaction_id: "txn_1", date: "2024-01-15", amount: 10 },
        { ...testTransaction, transaction_id: "txn_2", date: "2024-06-15", amount: 50 },
        { ...testTransaction, transaction_id: "txn_3", date: "2024-12-15", amount: 100, pending: 1 },
      ]);
    });

    it("filters by date range", () => {
      const txns = getTransactions({ from: "2024-03-01", to: "2024-09-01" });
      expect(txns).toHaveLength(1);
      expect(txns[0].transaction_id).toBe("txn_2");
    });

    it("filters by min/max amount", () => {
      const txns = getTransactions({ min: 20, max: 80 });
      expect(txns).toHaveLength(1);
      expect(txns[0].amount).toBe(50);
    });

    it("filters by account", () => {
      const txns = getTransactions({ account: "acc_1" });
      expect(txns).toHaveLength(3);
    });

    it("filters by pending", () => {
      const txns = getTransactions({ pending: true });
      expect(txns).toHaveLength(1);
      expect(txns[0].transaction_id).toBe("txn_3");
    });

    it("filters by tag/category", () => {
      const txns = getTransactions({ tag: "FOOD_AND_DRINK" });
      expect(txns).toHaveLength(3);
    });

    it("applies limit", () => {
      const txns = getTransactions({ limit: 2 });
      expect(txns).toHaveLength(2);
    });

    it("orders by date descending", () => {
      const txns = getTransactions();
      expect(txns[0].date).toBe("2024-12-15");
      expect(txns[2].date).toBe("2024-01-15");
    });
  });

  describe("sync state", () => {
    it("returns null for unknown item", () => {
      expect(getSyncState("unknown")).toBeNull();
    });

    it("sets and gets sync state", () => {
      setSyncState("item_1", "cursor_abc");
      const state = getSyncState("item_1");
      expect(state).not.toBeNull();
      expect(state!.cursor).toBe("cursor_abc");
      expect(state!.item_id).toBe("item_1");
    });

    it("upserts sync state on conflict", () => {
      setSyncState("item_1", "cursor_1");
      setSyncState("item_1", "cursor_2");
      const state = getSyncState("item_1");
      expect(state!.cursor).toBe("cursor_2");
    });
  });
});
