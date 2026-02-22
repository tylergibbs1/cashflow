import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initDb, _resetDb, upsertAccounts, upsertTransactions } from "../src/core/db.js";
import { setBudget, getBudgets, deleteBudget, getBudgetStatuses, checkAlerts } from "../src/core/budgets.js";

const testAccount = {
  account_id: "acc_1",
  item_id: "item_1",
  name: "Checking",
  official_name: null,
  type: "depository",
  subtype: "checking",
  mask: "1234",
  current_balance: 1000,
  available_balance: 900,
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

// Get current month as YYYY-MM
function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

describe("budgets", () => {
  beforeEach(() => {
    const db = createTestDb();
    initDb(db);
    upsertAccounts([testAccount]);
  });

  afterEach(() => {
    _resetDb();
  });

  describe("CRUD", () => {
    it("sets and retrieves a budget", () => {
      setBudget("food", 500);
      const budgets = getBudgets();
      expect(budgets).toHaveLength(1);
      expect(budgets[0].tag).toBe("food");
      expect(budgets[0].monthly_limit).toBe(500);
      expect(budgets[0].alert_threshold).toBe(0.9);
    });

    it("upserts budget on same tag", () => {
      setBudget("food", 500);
      setBudget("food", 600, 0.8);
      const budgets = getBudgets();
      expect(budgets).toHaveLength(1);
      expect(budgets[0].monthly_limit).toBe(600);
      expect(budgets[0].alert_threshold).toBe(0.8);
    });

    it("deletes a budget", () => {
      setBudget("food", 500);
      expect(deleteBudget("food")).toBe(true);
      expect(getBudgets()).toHaveLength(0);
    });

    it("returns false when deleting nonexistent budget", () => {
      expect(deleteBudget("nonexistent")).toBe(false);
    });
  });

  describe("status computation", () => {
    it("computes budget status with spending", () => {
      const month = currentMonth();
      const today = `${month}-15`;
      upsertTransactions([
        { ...baseTxn, transaction_id: "txn_1", name: "Coffee", merchant_name: "Starbucks", category: "food", date: today, amount: 200 },
        { ...baseTxn, transaction_id: "txn_2", name: "Lunch", merchant_name: "Restaurant", category: "food", date: today, amount: 100 },
      ]);

      setBudget("food", 500);
      const statuses = getBudgetStatuses(month);
      expect(statuses).toHaveLength(1);
      expect(statuses[0].spent).toBe(300);
      expect(statuses[0].remaining).toBe(200);
      expect(statuses[0].percent_used).toBeCloseTo(0.6, 1);
      expect(statuses[0].over_budget).toBe(false);
    });

    it("detects over-budget", () => {
      const month = currentMonth();
      const today = `${month}-15`;
      upsertTransactions([
        { ...baseTxn, transaction_id: "txn_1", name: "Big Purchase", merchant_name: "Store", category: "food", date: today, amount: 600 },
      ]);

      setBudget("food", 500);
      const statuses = getBudgetStatuses(month);
      expect(statuses[0].over_budget).toBe(true);
      expect(statuses[0].remaining).toBe(0);
    });

    it("returns zero spent when no transactions in month", () => {
      setBudget("food", 500);
      const statuses = getBudgetStatuses("2020-01");
      expect(statuses[0].spent).toBe(0);
      expect(statuses[0].remaining).toBe(500);
    });
  });

  describe("alerts", () => {
    it("returns budgets above alert threshold", () => {
      const month = currentMonth();
      const today = `${month}-15`;
      upsertTransactions([
        { ...baseTxn, transaction_id: "txn_1", name: "Food", merchant_name: null, category: "food", date: today, amount: 460 },
        { ...baseTxn, transaction_id: "txn_2", name: "Fun", merchant_name: null, category: "entertainment", date: today, amount: 10 },
      ]);

      setBudget("food", 500, 0.9);
      setBudget("entertainment", 200, 0.9);

      const alerts = checkAlerts(month);
      // food: 460/500 = 0.92 >= 0.9 → alert
      // entertainment: 10/200 = 0.05 < 0.9 → no alert
      expect(alerts).toHaveLength(1);
      expect(alerts[0].tag).toBe("food");
    });

    it("returns empty when no alerts", () => {
      setBudget("food", 500);
      const alerts = checkAlerts("2020-01");
      expect(alerts).toHaveLength(0);
    });
  });
});
