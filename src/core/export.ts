import type { TransactionResponse } from "../types/index.js";

const CSV_HEADERS = [
  "transaction_id",
  "account_id",
  "date",
  "name",
  "merchant_name",
  "amount",
  "category",
  "subcategory",
  "tag",
  "pending",
  "payment_channel",
];

function escapeCsv(value: string | null | boolean | number): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportCsv(transactions: TransactionResponse[]): string {
  const lines: string[] = [CSV_HEADERS.join(",")];

  for (const t of transactions) {
    const row = [
      t.transaction_id,
      t.account_id,
      t.date,
      t.name,
      t.merchant_name,
      t.amount,
      t.category,
      t.subcategory,
      t.tag,
      t.pending,
      t.payment_channel,
    ].map(escapeCsv);
    lines.push(row.join(","));
  }

  return lines.join("\n") + "\n";
}

export function exportJson(transactions: TransactionResponse[]): string {
  return JSON.stringify(transactions, null, 2) + "\n";
}
