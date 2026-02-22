import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initDb, _resetDb, upsertAccounts, upsertTransactions, getTransactions } from "../src/core/db.js";
import { addTagRule, getTagRules, deleteTagRule, applyTagRules, getSpendingByTag } from "../src/core/tags.js";
import { ConfigError } from "../src/types/index.js";

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

describe("tags", () => {
  beforeEach(() => {
    const db = createTestDb();
    initDb(db);
    upsertAccounts([testAccount]);
  });

  afterEach(() => {
    _resetDb();
  });

  describe("tag rule CRUD", () => {
    it("adds a tag rule and returns its id", () => {
      const id = addTagRule("starbucks", "coffee");
      expect(id).toBeGreaterThan(0);
    });

    it("lists tag rules ordered by priority desc", () => {
      addTagRule("starbucks", "coffee", 10);
      addTagRule("uber", "transport", 20);
      addTagRule("amazon", "shopping", 5);

      const rules = getTagRules();
      expect(rules).toHaveLength(3);
      expect(rules[0].tag).toBe("transport"); // priority 20
      expect(rules[1].tag).toBe("coffee"); // priority 10
      expect(rules[2].tag).toBe("shopping"); // priority 5
    });

    it("deletes a tag rule", () => {
      const id = addTagRule("starbucks", "coffee");
      expect(deleteTagRule(id)).toBe(true);
      expect(getTagRules()).toHaveLength(0);
    });

    it("returns false when deleting nonexistent rule", () => {
      expect(deleteTagRule(9999)).toBe(false);
    });

    it("throws ConfigError for invalid regex pattern", () => {
      expect(() => addTagRule("[invalid", "bad")).toThrow(ConfigError);
    });

    it("accepts valid regex patterns", () => {
      const id = addTagRule("star(bucks|wars)", "star-stuff");
      expect(id).toBeGreaterThan(0);
    });
  });

  describe("applyTagRules", () => {
    it("tags untagged transactions matching rules", () => {
      upsertTransactions([
        { ...baseTxn, transaction_id: "txn_1", name: "Starbucks Coffee", merchant_name: "Starbucks", category: "FOOD", amount: 5 },
        { ...baseTxn, transaction_id: "txn_2", name: "Uber Ride", merchant_name: "Uber", category: "TRANSPORT", amount: 15 },
      ]);

      addTagRule("starbucks", "coffee");
      addTagRule("uber", "rides");

      const count = applyTagRules();
      expect(count).toBe(2);

      const txns = getTransactions();
      const coffee = txns.find((t) => t.transaction_id === "txn_1");
      expect(coffee!.tag).toBe("coffee");
      const rides = txns.find((t) => t.transaction_id === "txn_2");
      expect(rides!.tag).toBe("rides");
    });

    it("uses highest priority rule on conflict", () => {
      upsertTransactions([
        { ...baseTxn, transaction_id: "txn_1", name: "Starbucks Coffee", merchant_name: "Starbucks", category: "FOOD", amount: 5 },
      ]);

      addTagRule("starbucks", "generic-food", 1);
      addTagRule("starbucks", "coffee", 10);

      applyTagRules();
      const txn = getTransactions()[0];
      expect(txn.tag).toBe("coffee");
    });

    it("skips already-tagged transactions", () => {
      upsertTransactions([
        { ...baseTxn, transaction_id: "txn_1", name: "Starbucks", merchant_name: "Starbucks", category: "FOOD", amount: 5 },
      ]);

      addTagRule("starbucks", "coffee");
      applyTagRules();

      // Add another rule and re-apply — should not re-tag
      addTagRule("starbucks", "overwrite", 100);
      const count = applyTagRules();
      expect(count).toBe(0);

      const txn = getTransactions()[0];
      expect(txn.tag).toBe("coffee"); // still original
    });

    it("returns 0 when no rules exist", () => {
      upsertTransactions([
        { ...baseTxn, transaction_id: "txn_1", name: "Test", merchant_name: null, category: null, amount: 10 },
      ]);
      expect(applyTagRules()).toBe(0);
    });

    it("returns 0 when no untagged transactions exist", () => {
      addTagRule("test", "tag");
      expect(applyTagRules()).toBe(0);
    });
  });

  describe("getSpendingByTag", () => {
    it("groups spending by tag/category", () => {
      upsertTransactions([
        { ...baseTxn, transaction_id: "txn_1", name: "Coffee 1", merchant_name: "Starbucks", category: "FOOD", amount: 5 },
        { ...baseTxn, transaction_id: "txn_2", name: "Coffee 2", merchant_name: "Peets", category: "FOOD", amount: 4 },
        { ...baseTxn, transaction_id: "txn_3", name: "Uber", merchant_name: "Uber", category: "TRANSPORT", amount: 20 },
        { ...baseTxn, transaction_id: "txn_4", name: "Salary", merchant_name: null, category: "INCOME", amount: -3000 },
      ]);

      const split = getSpendingByTag();
      // Should only include spending (amount > 0)
      expect(split.length).toBeGreaterThanOrEqual(2);
      const food = split.find((s) => s.tag === "FOOD");
      expect(food).toBeDefined();
      expect(food!.total).toBe(9);
      expect(food!.count).toBe(2);
    });
  });
});
