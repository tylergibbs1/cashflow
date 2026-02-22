import {
  getMonthlySpending,
  getMonthlyNet,
  getAccounts,
  getTransactions,
  getLastSyncTime,
} from "./db.js";
import { getBudgetStatuses, checkAlerts } from "./budgets.js";
import type {
  BurnReport,
  MonthlyBurn,
  NetReport,
  MonthlyNet,
  SnapshotResponse,
  AccountResponse,
  TransactionResponse,
} from "../types/index.js";

export function getBurnReport(months: number = 6): BurnReport {
  const rows = getMonthlySpending(months);
  const monthlyBurn: MonthlyBurn[] = rows.map((r) => ({
    month: r.month,
    total: Math.round(r.total * 100) / 100,
  }));

  return {
    months: monthlyBurn,
    trend: computeTrend(monthlyBurn),
  };
}

function computeTrend(months: MonthlyBurn[]): "increasing" | "decreasing" | "stable" {
  if (months.length < 3) return "stable";
  // Use last 3 months
  const recent = months.slice(-3);
  const diffs = [];
  for (let i = 1; i < recent.length; i++) {
    diffs.push(recent[i].total - recent[i - 1].total);
  }
  const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  // 5% threshold of the average spend
  const avgSpend = recent.reduce((a, b) => a + b.total, 0) / recent.length;
  const threshold = avgSpend * 0.05;

  if (avgDiff > threshold) return "increasing";
  if (avgDiff < -threshold) return "decreasing";
  return "stable";
}

export function getNetReport(months: number = 6): NetReport {
  const rows = getMonthlyNet(months);
  const monthlyNet: MonthlyNet[] = rows.map((r) => ({
    month: r.month,
    income: Math.round(r.income * 100) / 100,
    expenses: Math.round(r.expenses * 100) / 100,
    net: Math.round((r.income - r.expenses) * 100) / 100,
  }));

  return { months: monthlyNet };
}

export function getSnapshot(): SnapshotResponse {
  const accounts = getAccounts();
  const totalBalance = accounts.reduce((sum, a) => sum + (a.current_balance || 0), 0);

  const recentTxns = getTransactions({ limit: 10 });
  const budgets = getBudgetStatuses();
  const alerts = checkAlerts();
  const burn = getBurnReport(6);
  const syncedAt = getLastSyncTime() || new Date().toISOString();

  // Runway: total balance / avg monthly burn
  let runwayMonths: number | null = null;
  if (burn.months.length > 0) {
    const avgBurn = burn.months.reduce((s, m) => s + m.total, 0) / burn.months.length;
    if (avgBurn > 0) {
      runwayMonths = Math.round((totalBalance / avgBurn) * 10) / 10;
    }
  }

  return {
    accounts: accounts.map(toAccountResponse),
    total_balance: Math.round(totalBalance * 100) / 100,
    recent_transactions: recentTxns.map(toTransactionResponse),
    budgets,
    alerts,
    burn,
    runway_months: runwayMonths,
    synced_at: syncedAt,
  };
}

function toAccountResponse(a: {
  account_id: string;
  name: string;
  official_name: string | null;
  type: string;
  subtype: string | null;
  mask: string | null;
  current_balance: number | null;
  available_balance: number | null;
  iso_currency_code: string | null;
}): AccountResponse {
  return {
    account_id: a.account_id,
    name: a.name,
    official_name: a.official_name,
    type: a.type,
    subtype: a.subtype,
    mask: a.mask,
    current_balance: a.current_balance,
    available_balance: a.available_balance,
    iso_currency_code: a.iso_currency_code,
  };
}

function toTransactionResponse(t: {
  transaction_id: string;
  account_id: string;
  amount: number;
  date: string;
  name: string;
  merchant_name: string | null;
  pending: number;
  category: string | null;
  subcategory: string | null;
  payment_channel: string | null;
  tag: string | null;
}): TransactionResponse {
  return {
    transaction_id: t.transaction_id,
    account_id: t.account_id,
    amount: t.amount,
    date: t.date,
    name: t.name,
    merchant_name: t.merchant_name,
    pending: t.pending === 1,
    category: t.category,
    subcategory: t.subcategory,
    payment_channel: t.payment_channel,
    tag: t.tag,
  };
}
