import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { Account, Transaction } from "../types/index.js";
import type { SyncState, TransactionFilters } from "../types/index.js";

const DATA_DIR = join(
  process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"),
  "cashflow"
);
const DB_PATH = join(DATA_DIR, "cashflow.db");

let db: Database | null = null;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS accounts (
    account_id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL,
    name TEXT NOT NULL,
    official_name TEXT,
    type TEXT NOT NULL,
    subtype TEXT,
    mask TEXT,
    current_balance REAL,
    available_balance REAL,
    iso_currency_code TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS transactions (
    transaction_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(account_id),
    amount REAL NOT NULL,
    iso_currency_code TEXT,
    date TEXT NOT NULL,
    name TEXT NOT NULL,
    merchant_name TEXT,
    pending INTEGER NOT NULL DEFAULT 0,
    category TEXT,
    subcategory TEXT,
    payment_channel TEXT,
    transaction_type TEXT,
    authorized_date TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
  CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
  CREATE INDEX IF NOT EXISTS idx_transactions_amount ON transactions(amount);

  CREATE TABLE IF NOT EXISTS sync_state (
    item_id TEXT PRIMARY KEY,
    cursor TEXT NOT NULL DEFAULT '',
    last_synced_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tag_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern TEXT NOT NULL,
    tag TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tag TEXT NOT NULL,
    monthly_limit REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS transactions_fts USING fts5(
    transaction_id UNINDEXED,
    name,
    merchant_name,
    category,
    content=transactions,
    content_rowid=rowid
  );

  CREATE TRIGGER IF NOT EXISTS transactions_ai AFTER INSERT ON transactions BEGIN
    INSERT INTO transactions_fts(rowid, transaction_id, name, merchant_name, category)
    VALUES (new.rowid, new.transaction_id, new.name, new.merchant_name, new.category);
  END;

  CREATE TRIGGER IF NOT EXISTS transactions_ad AFTER DELETE ON transactions BEGIN
    INSERT INTO transactions_fts(transactions_fts, rowid, transaction_id, name, merchant_name, category)
    VALUES ('delete', old.rowid, old.transaction_id, old.name, old.merchant_name, old.category);
  END;

  CREATE TRIGGER IF NOT EXISTS transactions_au AFTER UPDATE ON transactions BEGIN
    INSERT INTO transactions_fts(transactions_fts, rowid, transaction_id, name, merchant_name, category)
    VALUES ('delete', old.rowid, old.transaction_id, old.name, old.merchant_name, old.category);
    INSERT INTO transactions_fts(rowid, transaction_id, name, merchant_name, category)
    VALUES (new.rowid, new.transaction_id, new.name, new.merchant_name, new.category);
  END;
`;

export function initDb(database?: Database): Database {
  if (database) {
    db = database;
  } else if (!db) {
    mkdirSync(DATA_DIR, { recursive: true });
    db = new Database(DB_PATH, { strict: true });
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
  }
  db!.exec(SCHEMA);

  return db!;
}

export function getDb(): Database {
  if (!db) return initDb();
  return db;
}

// ── Accounts ──

export function upsertAccounts(
  accounts: Array<{
    account_id: string;
    item_id: string;
    name: string;
    official_name: string | null;
    type: string;
    subtype: string | null;
    mask: string | null;
    current_balance: number | null;
    available_balance: number | null;
    iso_currency_code: string | null;
  }>
): void {
  const stmt = getDb().prepare(`
    INSERT INTO accounts (account_id, item_id, name, official_name, type, subtype, mask, current_balance, available_balance, iso_currency_code, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, datetime('now'))
    ON CONFLICT(account_id) DO UPDATE SET
      name = excluded.name,
      official_name = excluded.official_name,
      type = excluded.type,
      subtype = excluded.subtype,
      mask = excluded.mask,
      current_balance = excluded.current_balance,
      available_balance = excluded.available_balance,
      iso_currency_code = excluded.iso_currency_code,
      updated_at = excluded.updated_at
  `);

  const upsertAll = getDb().transaction(() => {
    for (const a of accounts) {
      stmt.run(
        a.account_id,
        a.item_id,
        a.name,
        a.official_name,
        a.type,
        a.subtype,
        a.mask,
        a.current_balance,
        a.available_balance,
        a.iso_currency_code
      );
    }
  });

  upsertAll();
}

export function getAccounts(): Account[] {
  return getDb().query("SELECT * FROM accounts ORDER BY name").as(Account).all();
}

// ── Transactions ──

export function upsertTransactions(
  transactions: Array<{
    transaction_id: string;
    account_id: string;
    amount: number;
    iso_currency_code: string | null;
    date: string;
    name: string;
    merchant_name: string | null;
    pending: number;
    category: string | null;
    subcategory: string | null;
    payment_channel: string | null;
    transaction_type: string | null;
    authorized_date: string | null;
  }>
): void {
  const stmt = getDb().prepare(`
    INSERT INTO transactions (transaction_id, account_id, amount, iso_currency_code, date, name, merchant_name, pending, category, subcategory, payment_channel, transaction_type, authorized_date)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
    ON CONFLICT(transaction_id) DO UPDATE SET
      account_id = excluded.account_id,
      amount = excluded.amount,
      iso_currency_code = excluded.iso_currency_code,
      date = excluded.date,
      name = excluded.name,
      merchant_name = excluded.merchant_name,
      pending = excluded.pending,
      category = excluded.category,
      subcategory = excluded.subcategory,
      payment_channel = excluded.payment_channel,
      transaction_type = excluded.transaction_type,
      authorized_date = excluded.authorized_date
  `);

  const upsertAll = getDb().transaction(() => {
    for (const t of transactions) {
      stmt.run(
        t.transaction_id,
        t.account_id,
        t.amount,
        t.iso_currency_code,
        t.date,
        t.name,
        t.merchant_name,
        t.pending,
        t.category,
        t.subcategory,
        t.payment_channel,
        t.transaction_type,
        t.authorized_date
      );
    }
  });

  upsertAll();
}

export function removeTransactions(transactionIds: string[]): void {
  if (transactionIds.length === 0) return;
  const stmt = getDb().prepare(
    `DELETE FROM transactions WHERE transaction_id = ?`
  );
  const removeAll = getDb().transaction(() => {
    for (const id of transactionIds) {
      stmt.run(id);
    }
  });
  removeAll();
}

export function getTransactions(filters: TransactionFilters = {}): Transaction[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters.from) {
    conditions.push("date >= ?");
    params.push(filters.from);
  }
  if (filters.to) {
    conditions.push("date <= ?");
    params.push(filters.to);
  }
  if (filters.min !== undefined) {
    conditions.push("amount >= ?");
    params.push(filters.min);
  }
  if (filters.max !== undefined) {
    conditions.push("amount <= ?");
    params.push(filters.max);
  }
  if (filters.account) {
    conditions.push("account_id = ?");
    params.push(filters.account);
  }
  if (filters.pending !== undefined) {
    conditions.push("pending = ?");
    params.push(filters.pending ? 1 : 0);
  }
  if (filters.tag) {
    conditions.push("category = ?");
    params.push(filters.tag);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filters.limit ? `LIMIT ${filters.limit}` : "";
  const sql = `SELECT * FROM transactions ${where} ORDER BY date DESC ${limit}`;

  return getDb().query(sql).as(Transaction).all(...params);
}

// ── Sync State ──

export function getSyncState(itemId: string): SyncState | null {
  return (
    getDb()
      .query("SELECT * FROM sync_state WHERE item_id = ?")
      .get(itemId) as SyncState | null
  );
}

export function setSyncState(itemId: string, cursor: string): void {
  getDb()
    .prepare(
      `INSERT INTO sync_state (item_id, cursor, last_synced_at)
       VALUES (?1, ?2, datetime('now'))
       ON CONFLICT(item_id) DO UPDATE SET cursor = excluded.cursor, last_synced_at = excluded.last_synced_at`
    )
    .run(itemId, cursor);
}

// ── Test helpers ──

export function _setDb(database: Database): void {
  db = database;
}

export function _resetDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
