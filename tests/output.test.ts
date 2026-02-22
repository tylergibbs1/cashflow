import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { writeJson, writeError, writePretty } from "../src/core/output.js";
import type {
  ErrorResponse,
  AccountsResponse,
  TransactionsResponse,
  SyncResponse,
} from "../src/types/index.js";

describe("output", () => {
  let stdoutData: string[];
  let stderrData: string[];
  let stdoutSpy: ReturnType<typeof spyOn>;
  let stderrSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    stdoutData = [];
    stderrData = [];
    stdoutSpy = spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
      stdoutData.push(String(chunk));
      return true;
    });
    stderrSpy = spyOn(process.stderr, "write").mockImplementation((chunk: any) => {
      stderrData.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  describe("writeJson", () => {
    it("writes JSON to stdout with trailing newline", () => {
      writeJson({ test: true });
      expect(stdoutData.join("")).toBe('{"test":true}\n');
    });

    it("outputs valid parseable JSON", () => {
      const data = { accounts: [{ id: "acc_1", balance: 100.5 }] };
      writeJson(data);
      const parsed = JSON.parse(stdoutData.join("").trim());
      expect(parsed).toEqual(data);
    });

    it("handles empty arrays", () => {
      writeJson({ transactions: [], count: 0 });
      const parsed = JSON.parse(stdoutData.join("").trim());
      expect(parsed.transactions).toEqual([]);
      expect(parsed.count).toBe(0);
    });
  });

  describe("writeError", () => {
    it("writes error JSON to stderr", () => {
      const error: ErrorResponse = {
        error: { code: "CONFIG_ERROR", message: "Not configured" },
      };
      writeError(error);
      const output = stderrData.join("");
      const parsed = JSON.parse(output.trim());
      expect(parsed.error.code).toBe("CONFIG_ERROR");
      expect(parsed.error.message).toBe("Not configured");
    });

    it("includes details when present", () => {
      const error: ErrorResponse = {
        error: {
          code: "PLAID_ERROR",
          message: "API failure",
          details: { plaid_code: "INVALID_CREDENTIALS" },
        },
      };
      writeError(error);
      const parsed = JSON.parse(stderrData.join("").trim());
      expect(parsed.error.details.plaid_code).toBe("INVALID_CREDENTIALS");
    });
  });

  describe("writePretty", () => {
    it("renders accounts table without throwing", () => {
      const data: AccountsResponse = {
        accounts: [
          {
            account_id: "acc_1",
            name: "Checking",
            official_name: "Premium Checking",
            type: "depository",
            subtype: "checking",
            mask: "1234",
            current_balance: 1000.5,
            available_balance: 900,
            iso_currency_code: "USD",
          },
        ],
      };
      expect(() => writePretty(data, "accounts")).not.toThrow();
    });

    it("renders transactions table without throwing", () => {
      const data: TransactionsResponse = {
        transactions: [
          {
            transaction_id: "txn_1",
            account_id: "acc_1",
            amount: 42.5,
            date: "2024-06-15",
            name: "Coffee",
            merchant_name: "Starbucks",
            pending: false,
            category: "FOOD",
            subcategory: "COFFEE",
            payment_channel: "in store",
          },
        ],
        count: 1,
      };
      expect(() => writePretty(data, "ls")).not.toThrow();
    });

    it("renders sync result without throwing", () => {
      const data: SyncResponse = {
        added: 10,
        modified: 2,
        removed: 1,
        cursor: "abc123",
        has_more: false,
      };
      expect(() => writePretty(data, "sync")).not.toThrow();
    });

    it("handles empty accounts gracefully", () => {
      const data: AccountsResponse = { accounts: [] };
      expect(() => writePretty(data, "accounts")).not.toThrow();
    });

    it("handles empty transactions gracefully", () => {
      const data: TransactionsResponse = { transactions: [], count: 0 };
      expect(() => writePretty(data, "ls")).not.toThrow();
    });
  });
});
