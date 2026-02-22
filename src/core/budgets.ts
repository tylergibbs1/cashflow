import {
  upsertBudget as dbUpsertBudget,
  getBudgets as dbGetBudgets,
  deleteBudget as dbDeleteBudget,
  getSpendingByTagForMonth,
} from "./db.js";
import type { BudgetStatus } from "../types/index.js";

export function setBudget(tag: string, limit: number, alertThreshold: number = 0.9): void {
  dbUpsertBudget(tag, limit, alertThreshold);
}

export function getBudgets(): { id: number; tag: string; monthly_limit: number; alert_threshold: number }[] {
  return dbGetBudgets();
}

export function deleteBudget(tag: string): boolean {
  return dbDeleteBudget(tag);
}

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function getBudgetStatuses(month?: string): BudgetStatus[] {
  const m = month || getCurrentMonth();
  const budgets = dbGetBudgets();
  if (budgets.length === 0) return [];

  const spending = getSpendingByTagForMonth(m);
  const spendingMap = new Map(spending.map((s) => [s.tag, s.total]));

  return budgets.map((b) => {
    const spent = spendingMap.get(b.tag) || 0;
    const remaining = Math.max(0, b.monthly_limit - spent);
    const percentUsed = b.monthly_limit > 0 ? spent / b.monthly_limit : 0;
    return {
      tag: b.tag,
      monthly_limit: b.monthly_limit,
      alert_threshold: b.alert_threshold,
      spent: Math.round(spent * 100) / 100,
      remaining: Math.round(remaining * 100) / 100,
      percent_used: Math.round(percentUsed * 1000) / 1000,
      over_budget: spent > b.monthly_limit,
    };
  });
}

export function checkAlerts(month?: string): BudgetStatus[] {
  const statuses = getBudgetStatuses(month);
  return statuses.filter((s) => s.percent_used >= s.alert_threshold);
}
