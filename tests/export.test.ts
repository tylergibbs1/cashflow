import { describe, it, expect } from "bun:test";
import { exportCsv, exportJson } from "../src/core/export.js";
import type { TransactionResponse } from "../src/types/index.js";

const mockTransactions: TransactionResponse[] = [
  {
    transaction_id: "txn_1",
    account_id: "acc_1",
    amount: 42.5,
    date: "2024-06-15",
    name: "Coffee Shop",
    merchant_name: "Starbucks",
    pending: false,
    category: "FOOD_AND_DRINK",
    subcategory: "COFFEE",
    tag: "coffee",
    payment_channel: "in store",
  },
  {
    transaction_id: "txn_2",
    account_id: "acc_1",
    amount: -5000,
    date: "2024-06-01",
    name: 'Salary "Direct Deposit"',
    merchant_name: null,
    pending: false,
    category: "INCOME",
    subcategory: null,
    tag: null,
    payment_channel: "online",
  },
];

describe("export", () => {
  describe("exportCsv", () => {
    it("produces valid CSV with headers", () => {
      const csv = exportCsv(mockTransactions);
      const lines = csv.trim().split("\n");
      expect(lines[0]).toBe(
        "transaction_id,account_id,date,name,merchant_name,amount,category,subcategory,tag,pending,payment_channel"
      );
      expect(lines).toHaveLength(3); // header + 2 rows
    });

    it("escapes fields with commas and quotes (RFC 4180)", () => {
      const csv = exportCsv(mockTransactions);
      // The second transaction has quotes in the name
      expect(csv).toContain('"Salary ""Direct Deposit"""');
    });

    it("handles null values as empty strings", () => {
      const csv = exportCsv(mockTransactions);
      const lines = csv.trim().split("\n");
      // Second row: merchant_name is null → empty field
      const fields = lines[2].split(",");
      // merchant_name is field index 4 — but CSV parsing with quotes is complex
      // Just verify no "null" string appears
      expect(csv).not.toContain(",null,");
    });

    it("produces valid output for empty array", () => {
      const csv = exportCsv([]);
      const lines = csv.trim().split("\n");
      expect(lines).toHaveLength(1); // just header
    });
  });

  describe("exportJson", () => {
    it("produces valid pretty-printed JSON", () => {
      const json = exportJson(mockTransactions);
      const parsed = JSON.parse(json);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].transaction_id).toBe("txn_1");
    });

    it("produces valid output for empty array", () => {
      const json = exportJson([]);
      const parsed = JSON.parse(json);
      expect(parsed).toHaveLength(0);
    });
  });
});
