import { searchFts, getTransactions } from "./db.js";
import { ConfigError } from "../types/index.js";
import type { Transaction, TransactionFilters } from "../types/index.js";

export function searchTransactions(query: string, limit: number = 50): Transaction[] {
  if (!query.trim()) return [];
  return searchFts(query, limit);
}

export function grepTransactions(
  pattern: string,
  filters: TransactionFilters = {}
): Transaction[] {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "i");
  } catch {
    throw new ConfigError(`Invalid regex pattern: "${pattern}"`);
  }

  const transactions = getTransactions(filters);
  return transactions.filter((t) => {
    const haystack = [t.merchant_name, t.name].filter(Boolean).join(" ");
    return regex.test(haystack);
  });
}
