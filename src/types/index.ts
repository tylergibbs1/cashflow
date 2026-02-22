// ── DB Row Types ──

export class Account {
  account_id!: string;
  item_id!: string;
  name!: string;
  official_name!: string | null;
  type!: string;
  subtype!: string | null;
  mask!: string | null;
  current_balance!: number | null;
  available_balance!: number | null;
  iso_currency_code!: string | null;
  updated_at!: string;
}

export class Transaction {
  transaction_id!: string;
  account_id!: string;
  amount!: number;
  iso_currency_code!: string | null;
  date!: string;
  name!: string;
  merchant_name!: string | null;
  pending!: number; // SQLite boolean (0/1)
  category!: string | null;
  subcategory!: string | null;
  payment_channel!: string | null;
  transaction_type!: string | null;
  authorized_date!: string | null;
  tag!: string | null;

  get isIncome(): boolean {
    return this.amount < 0;
  }

  get displayName(): string {
    return this.merchant_name || this.name;
  }

  get isPending(): boolean {
    return this.pending === 1;
  }
}

export class TagRule {
  id!: number;
  pattern!: string;
  tag!: string;
  priority!: number;
  created_at!: string;
}

export interface SyncState {
  item_id: string;
  cursor: string;
  last_synced_at: string;
}

// ── Config Types ──

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  salt: string;
}

export interface PlaidItemConfig {
  access_token: EncryptedPayload;
  item_id: string;
  institution_name: string | null;
  added_at: string;
}

export interface AppConfig {
  plaid_client_id: EncryptedPayload;
  plaid_secret: EncryptedPayload;
  plaid_env: string;
  items: PlaidItemConfig[];
}

// ── Response Types ──

export interface AccountResponse {
  account_id: string;
  name: string;
  official_name: string | null;
  type: string;
  subtype: string | null;
  mask: string | null;
  current_balance: number | null;
  available_balance: number | null;
  iso_currency_code: string | null;
}

export interface TransactionResponse {
  transaction_id: string;
  account_id: string;
  amount: number;
  date: string;
  name: string;
  merchant_name: string | null;
  pending: boolean;
  category: string | null;
  subcategory: string | null;
  payment_channel: string | null;
  tag: string | null;
}

export interface AccountsResponse {
  accounts: AccountResponse[];
}

export interface TransactionsResponse {
  transactions: TransactionResponse[];
  count: number;
}

export interface SyncResponse {
  added: number;
  modified: number;
  removed: number;
  cursor: string;
  has_more: boolean;
}

export interface SearchResponse {
  transactions: TransactionResponse[];
  count: number;
  query: string;
}

export interface GrepResponse {
  transactions: TransactionResponse[];
  count: number;
  pattern: string;
}

export interface TagRulesResponse {
  rules: { id: number; pattern: string; tag: string; priority: number }[];
  count: number;
}

export interface TagSummary {
  tag: string;
  count: number;
  total: number;
}

export interface SplitResponse {
  categories: TagSummary[];
  total: number;
}

export interface BudgetStatus {
  tag: string;
  monthly_limit: number;
  alert_threshold: number;
  spent: number;
  remaining: number;
  percent_used: number;
  over_budget: boolean;
}

export interface BudgetsResponse {
  budgets: BudgetStatus[];
  month: string;
}

export interface MonthlyBurn {
  month: string;
  total: number;
}

export interface BurnReport {
  months: MonthlyBurn[];
  trend: "increasing" | "decreasing" | "stable";
}

export interface BurnResponse {
  burn: BurnReport;
}

export interface MonthlyNet {
  month: string;
  income: number;
  expenses: number;
  net: number;
}

export interface NetReport {
  months: MonthlyNet[];
}

export interface NetResponse {
  net: NetReport;
}

export interface SnapshotResponse {
  accounts: AccountResponse[];
  total_balance: number;
  recent_transactions: TransactionResponse[];
  budgets: BudgetStatus[];
  alerts: BudgetStatus[];
  burn: BurnReport;
  runway_months: number | null;
  synced_at: string;
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// ── Filter Types ──

export interface TransactionFilters {
  from?: string;
  to?: string;
  min?: number;
  max?: number;
  account?: string;
  pending?: boolean;
  tag?: string;
  limit?: number;
}

// ── Custom Errors ──

export class ConfigError extends Error {
  code = "CONFIG_ERROR" as const;
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export class PlaidApiError extends Error {
  code = "PLAID_ERROR" as const;
  plaidCode?: string;
  constructor(message: string, plaidCode?: string) {
    super(message);
    this.name = "PlaidApiError";
    this.plaidCode = plaidCode;
  }
}

export class SyncError extends Error {
  code = "SYNC_ERROR" as const;
  constructor(message: string) {
    super(message);
    this.name = "SyncError";
  }
}

// ── Exit Codes ──

export const EXIT_SUCCESS = 0;
export const EXIT_ERROR = 1;
export const EXIT_NO_RESULTS = 2;
export const EXIT_PLAID_ERROR = 3;
export const EXIT_CONFIG_ERROR = 4;
