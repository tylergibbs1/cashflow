import { describe, it, expect } from "bun:test";
import {
  formatSnapshotConcise,
  formatSnapshotDetailed,
  formatTransactionsConcise,
  formatTransactionsDetailed,
  formatConfigResult,
} from "../src/core/format.js";
import type { SnapshotResponse, TransactionResponse } from "../src/types/index.js";

const mockSnapshot: SnapshotResponse = {
  accounts: [
    { account_id: "acc_1", name: "Checking", official_name: null, type: "depository", subtype: "checking", mask: "1234", current_balance: 5000, available_balance: 4500, iso_currency_code: "USD" },
  ],
  total_balance: 5000,
  recent_transactions: [
    { transaction_id: "txn_1", account_id: "acc_1", amount: 42.5, date: "2024-06-15", name: "Coffee", merchant_name: "Starbucks", pending: false, category: "FOOD", subcategory: null, payment_channel: "in store", tag: "coffee" },
  ],
  budgets: [
    { tag: "food", monthly_limit: 500, alert_threshold: 0.9, spent: 300, remaining: 200, percent_used: 0.6, over_budget: false },
  ],
  alerts: [],
  burn: { months: [{ month: "2024-05", total: 1000 }, { month: "2024-06", total: 1100 }], trend: "stable" },
  runway_months: 4.5,
  synced_at: "2024-06-15T12:00:00Z",
};

const mockTransactions: TransactionResponse[] = [
  { transaction_id: "txn_1", account_id: "acc_1", amount: 42.5, date: "2024-06-15", name: "Coffee", merchant_name: "Starbucks", pending: false, category: "FOOD", subcategory: null, payment_channel: "in store", tag: "coffee" },
  { transaction_id: "txn_2", account_id: "acc_1", amount: -5000, date: "2024-06-01", name: "Salary", merchant_name: null, pending: false, category: "INCOME", subcategory: null, payment_channel: "online", tag: null },
];

describe("format", () => {
  describe("formatSnapshotConcise", () => {
    it("returns a single-line summary", () => {
      const result = formatSnapshotConcise(mockSnapshot);
      expect(result).toContain("Balance: $5000.00");
      expect(result).toContain("Runway: 4.5mo");
      expect(result).toContain("Burn trend: stable");
      expect(result).not.toContain("\n");
    });

    it("includes alerts when present", () => {
      const withAlerts = {
        ...mockSnapshot,
        alerts: [{ tag: "food", monthly_limit: 500, alert_threshold: 0.9, spent: 460, remaining: 40, percent_used: 0.92, over_budget: false }],
      };
      const result = formatSnapshotConcise(withAlerts);
      expect(result).toContain("Alerts: food");
    });
  });

  describe("formatSnapshotDetailed", () => {
    it("returns multi-line detailed report", () => {
      const result = formatSnapshotDetailed(mockSnapshot);
      expect(result).toContain("Financial Snapshot");
      expect(result).toContain("Checking: $5000.00");
      expect(result).toContain("Runway: 4.5 months");
      expect(result).toContain("food: $300.00/$500.00");
    });

    it("includes recent transactions", () => {
      const result = formatSnapshotDetailed(mockSnapshot);
      expect(result).toContain("Starbucks");
    });
  });

  describe("formatTransactionsConcise", () => {
    it("formats transactions in short form", () => {
      const result = formatTransactionsConcise(mockTransactions);
      expect(result).toContain("Starbucks");
      expect(result).toContain("$42.50");
    });

    it("returns message for empty list", () => {
      const result = formatTransactionsConcise([]);
      expect(result).toBe("No transactions found.");
    });
  });

  describe("formatTransactionsDetailed", () => {
    it("formats transactions with columns", () => {
      const result = formatTransactionsDetailed(mockTransactions);
      expect(result).toContain("2 transactions:");
      expect(result).toContain("Starbucks");
      expect(result).toContain("Salary");
    });
  });

  describe("formatConfigResult", () => {
    it("formats action and result", () => {
      const result = formatConfigResult("add_tag_rule", { id: 1, pattern: "starbucks", tag: "coffee" });
      expect(result).toContain("add_tag_rule");
      expect(result).toContain("starbucks");
    });
  });
});
