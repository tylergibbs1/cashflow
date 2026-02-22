import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import {
  initDb,
  _resetDb,
  upsertAccounts,
  upsertTransactions,
  setSyncState,
  getAccounts,
  getTransactions,
  getSyncState,
  getAccountByIdOrMask,
  removeAccountsByItem,
  removeTransactionsByAccount,
  removeSyncState,
} from "../src/core/db.js";

const testAccount1 = {
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

const testAccount2 = {
  account_id: "acc_2",
  item_id: "item_1",
  name: "Savings",
  official_name: null,
  type: "depository",
  subtype: "savings",
  mask: "5678",
  current_balance: 5000,
  available_balance: 5000,
  iso_currency_code: "USD",
};

const baseTxn = {
  iso_currency_code: "USD",
  date: "2024-06-15",
  pending: 0,
  category: "FOOD",
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

describe("unlink", () => {
  beforeEach(() => {
    const db = createTestDb();
    initDb(db);
    upsertAccounts([testAccount1, testAccount2]);
    upsertTransactions([
      { ...baseTxn, transaction_id: "txn_1", account_id: "acc_1", name: "Coffee", merchant_name: "Starbucks", amount: 5 },
      { ...baseTxn, transaction_id: "txn_2", account_id: "acc_1", name: "Lunch", merchant_name: "Restaurant", amount: 15 },
      { ...baseTxn, transaction_id: "txn_3", account_id: "acc_2", name: "Transfer", merchant_name: null, amount: -100 },
    ]);
    setSyncState("item_1", "cursor_abc");
  });

  afterEach(() => {
    _resetDb();
  });

  it("finds account by id", () => {
    const acc = getAccountByIdOrMask("acc_1");
    expect(acc).not.toBeNull();
    expect(acc!.account_id).toBe("acc_1");
  });

  it("finds account by mask", () => {
    const acc = getAccountByIdOrMask("1234");
    expect(acc).not.toBeNull();
    expect(acc!.account_id).toBe("acc_1");
  });

  it("removes all accounts for an item (after transactions removed)", () => {
    removeTransactionsByAccount(["acc_1", "acc_2"]);
    const ids = removeAccountsByItem("item_1");
    expect(ids).toHaveLength(2);
    expect(getAccounts()).toHaveLength(0);
  });

  it("removes transactions by account ids", () => {
    const count = removeTransactionsByAccount(["acc_1", "acc_2"]);
    expect(count).toBe(3);
    expect(getTransactions()).toHaveLength(0);
  });

  it("cascading removal removes everything", () => {
    // Must remove transactions before accounts (FK constraint)
    const accountIds = ["acc_1", "acc_2"];
    removeTransactionsByAccount(accountIds);
    removeAccountsByItem("item_1");
    removeSyncState("item_1");

    expect(getAccounts()).toHaveLength(0);
    expect(getTransactions()).toHaveLength(0);
    expect(getSyncState("item_1")).toBeNull();
  });
});
