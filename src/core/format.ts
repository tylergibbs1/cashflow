import type {
  SnapshotResponse,
  TransactionResponse,
  BudgetStatus,
} from "../types/index.js";

export function formatSnapshotConcise(snapshot: SnapshotResponse): string {
  const lines: string[] = [];
  lines.push(`Balance: $${snapshot.total_balance.toFixed(2)}`);
  if (snapshot.runway_months !== null) {
    lines.push(`Runway: ${snapshot.runway_months}mo`);
  }
  lines.push(`Burn trend: ${snapshot.burn.trend}`);
  if (snapshot.alerts.length > 0) {
    lines.push(`Alerts: ${snapshot.alerts.map((a) => a.tag).join(", ")}`);
  }
  lines.push(`Accounts: ${snapshot.accounts.length}`);
  return lines.join(" | ");
}

export function formatSnapshotDetailed(snapshot: SnapshotResponse): string {
  const lines: string[] = [];
  lines.push("=== Financial Snapshot ===");
  lines.push("");

  lines.push("Accounts:");
  for (const a of snapshot.accounts) {
    lines.push(`  ${a.name}: $${(a.current_balance || 0).toFixed(2)}`);
  }
  lines.push(`  Total: $${snapshot.total_balance.toFixed(2)}`);
  lines.push("");

  if (snapshot.runway_months !== null) {
    lines.push(`Runway: ${snapshot.runway_months} months`);
  }
  lines.push(`Burn trend: ${snapshot.burn.trend}`);
  lines.push("");

  if (snapshot.burn.months.length > 0) {
    lines.push("Monthly spending:");
    for (const m of snapshot.burn.months.slice(-3)) {
      lines.push(`  ${m.month}: $${m.total.toFixed(2)}`);
    }
    lines.push("");
  }

  if (snapshot.budgets.length > 0) {
    lines.push("Budgets:");
    for (const b of snapshot.budgets) {
      const pct = Math.round(b.percent_used * 100);
      const status = b.over_budget ? "OVER" : `${pct}%`;
      lines.push(`  ${b.tag}: $${b.spent.toFixed(2)}/$${b.monthly_limit.toFixed(2)} (${status})`);
    }
    lines.push("");
  }

  if (snapshot.alerts.length > 0) {
    lines.push("Budget alerts:");
    for (const a of snapshot.alerts) {
      lines.push(`  ${a.tag}: ${Math.round(a.percent_used * 100)}% used`);
    }
    lines.push("");
  }

  if (snapshot.recent_transactions.length > 0) {
    lines.push("Recent transactions:");
    for (const t of snapshot.recent_transactions.slice(0, 5)) {
      const sign = t.amount >= 0 ? "-" : "+";
      lines.push(`  ${t.date} ${t.merchant_name || t.name} ${sign}$${Math.abs(t.amount).toFixed(2)}`);
    }
  }

  lines.push(`\nSynced: ${snapshot.synced_at}`);
  return lines.join("\n");
}

export function formatTransactionsConcise(txns: TransactionResponse[]): string {
  if (txns.length === 0) return "No transactions found.";
  const lines = txns.slice(0, 10).map((t) => {
    const sign = t.amount >= 0 ? "-" : "+";
    return `${t.date} ${(t.merchant_name || t.name).slice(0, 20)} ${sign}$${Math.abs(t.amount).toFixed(2)}`;
  });
  if (txns.length > 10) lines.push(`...and ${txns.length - 10} more`);
  return lines.join("\n");
}

export function formatTransactionsDetailed(txns: TransactionResponse[]): string {
  if (txns.length === 0) return "No transactions found.";
  const lines = txns.map((t) => {
    const sign = t.amount >= 0 ? "-" : "+";
    const tag = t.tag || t.category || "";
    return `${t.date} | ${(t.merchant_name || t.name).padEnd(25)} | ${sign}$${Math.abs(t.amount).toFixed(2).padStart(8)} | ${tag}`;
  });
  return `${txns.length} transactions:\n` + lines.join("\n");
}

export function formatConfigResult(
  action: string,
  result: Record<string, unknown>
): string {
  return `${action}: ${JSON.stringify(result)}`;
}
