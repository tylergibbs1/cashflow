import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initDb, _resetDb, upsertAccounts, upsertTransactions, setSyncState } from "../src/core/db.js";
import { getBurnReport, getNetReport, getSnapshot } from "../src/core/reports.js";

const testAccount = {
  account_id: "acc_1",
  item_id: "item_1",
  name: "Checking",
  official_name: "Premium Checking",
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

// Generate a date string N months ago from current month
function monthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-15`;
}

describe("reports", () => {
  beforeEach(() => {
    const db = createTestDb();
    initDb(db);
    upsertAccounts([testAccount]);
  });

  afterEach(() => {
    _resetDb();
  });

  describe("burn report", () => {
    it("groups spending by month", () => {
      upsertTransactions([
        { ...baseTxn, transaction_id: "txn_1", name: "A", merchant_name: null, category: null, date: monthsAgo(1), amount: 100 },
        { ...baseTxn, transaction_id: "txn_2", name: "B", merchant_name: null, category: null, date: monthsAgo(1), amount: 200 },
        { ...baseTxn, transaction_id: "txn_3", name: "C", merchant_name: null, category: null, date: monthsAgo(2), amount: 150 },
      ]);

      const report = getBurnReport(6);
      expect(report.months.length).toBeGreaterThanOrEqual(2);
    });

    it("excludes income from burn", () => {
      upsertTransactions([
        { ...baseTxn, transaction_id: "txn_1", name: "Spend", merchant_name: null, category: null, date: monthsAgo(1), amount: 100 },
        { ...baseTxn, transaction_id: "txn_2", name: "Income", merchant_name: null, category: null, date: monthsAgo(1), amount: -5000 },
      ]);

      const report = getBurnReport(6);
      // Should only see the 100 spending, not the -5000 income
      const totalBurn = report.months.reduce((s, m) => s + m.total, 0);
      expect(totalBurn).toBe(100);
    });

    it("returns stable trend for insufficient data", () => {
      upsertTransactions([
        { ...baseTxn, transaction_id: "txn_1", name: "A", merchant_name: null, category: null, date: monthsAgo(1), amount: 100 },
      ]);
      const report = getBurnReport(6);
      expect(report.trend).toBe("stable");
    });

    it("detects increasing trend", () => {
      upsertTransactions([
        { ...baseTxn, transaction_id: "txn_1", name: "A", merchant_name: null, category: null, date: monthsAgo(3), amount: 100 },
        { ...baseTxn, transaction_id: "txn_2", name: "B", merchant_name: null, category: null, date: monthsAgo(2), amount: 200 },
        { ...baseTxn, transaction_id: "txn_3", name: "C", merchant_name: null, category: null, date: monthsAgo(1), amount: 400 },
      ]);
      const report = getBurnReport(6);
      expect(report.trend).toBe("increasing");
    });

    it("detects decreasing trend", () => {
      upsertTransactions([
        { ...baseTxn, transaction_id: "txn_1", name: "A", merchant_name: null, category: null, date: monthsAgo(3), amount: 400 },
        { ...baseTxn, transaction_id: "txn_2", name: "B", merchant_name: null, category: null, date: monthsAgo(2), amount: 200 },
        { ...baseTxn, transaction_id: "txn_3", name: "C", merchant_name: null, category: null, date: monthsAgo(1), amount: 100 },
      ]);
      const report = getBurnReport(6);
      expect(report.trend).toBe("decreasing");
    });
  });

  describe("net report", () => {
    it("splits income and expenses by month", () => {
      upsertTransactions([
        { ...baseTxn, transaction_id: "txn_1", name: "Salary", merchant_name: null, category: null, date: monthsAgo(1), amount: -5000 },
        { ...baseTxn, transaction_id: "txn_2", name: "Rent", merchant_name: null, category: null, date: monthsAgo(1), amount: 2000 },
        { ...baseTxn, transaction_id: "txn_3", name: "Food", merchant_name: null, category: null, date: monthsAgo(1), amount: 500 },
      ]);

      const report = getNetReport(6);
      expect(report.months.length).toBeGreaterThanOrEqual(1);
      const m = report.months[report.months.length - 1];
      expect(m.income).toBe(5000);
      expect(m.expenses).toBe(2500);
      expect(m.net).toBe(2500);
    });

    it("returns empty for no data", () => {
      const report = getNetReport(6);
      expect(report.months).toHaveLength(0);
    });
  });

  describe("snapshot", () => {
    it("aggregates all financial data", () => {
      setSyncState("item_1", "cursor_1");
      upsertTransactions([
        { ...baseTxn, transaction_id: "txn_1", name: "Coffee", merchant_name: "Starbucks", category: "FOOD", date: monthsAgo(0), amount: 5 },
      ]);

      const snapshot = getSnapshot();
      expect(snapshot.accounts).toHaveLength(1);
      expect(snapshot.total_balance).toBe(5000);
      expect(snapshot.recent_transactions.length).toBeGreaterThanOrEqual(1);
      expect(snapshot.synced_at).toBeTruthy();
    });

    it("computes runway from burn", () => {
      upsertTransactions([
        { ...baseTxn, transaction_id: "txn_1", name: "A", merchant_name: null, category: null, date: monthsAgo(1), amount: 1000 },
        { ...baseTxn, transaction_id: "txn_2", name: "B", merchant_name: null, category: null, date: monthsAgo(2), amount: 1000 },
      ]);

      const snapshot = getSnapshot();
      // balance=5000, avg burn=1000/mo → runway≈5
      expect(snapshot.runway_months).not.toBeNull();
      expect(snapshot.runway_months!).toBeCloseTo(5, 0);
    });
  });
});
