import {
  insertTagRule,
  getTagRules as dbGetTagRules,
  deleteTagRule as dbDeleteTagRule,
  getUntaggedTransactions,
  updateTransactionTag,
  getSpendingByTag as dbGetSpendingByTag,
  getDb,
} from "./db.js";
import { ConfigError } from "../types/index.js";
import type { TagRule, TransactionFilters, TagSummary } from "../types/index.js";

export function addTagRule(pattern: string, tag: string, priority: number = 0): number {
  // Validate regex
  try {
    new RegExp(pattern, "i");
  } catch {
    throw new ConfigError(`Invalid regex pattern: "${pattern}"`);
  }
  return insertTagRule(pattern, tag, priority);
}

export function getTagRules(): TagRule[] {
  return dbGetTagRules();
}

export function deleteTagRule(id: number): boolean {
  return dbDeleteTagRule(id);
}

export function applyTagRules(): number {
  const rules = dbGetTagRules();
  if (rules.length === 0) return 0;

  const untagged = getUntaggedTransactions();
  if (untagged.length === 0) return 0;

  // Pre-compile regexes
  const compiled = rules.map((r) => ({
    regex: new RegExp(r.pattern, "i"),
    tag: r.tag,
  }));

  let tagged = 0;
  const db = getDb();
  db.transaction(() => {
    for (const txn of untagged) {
      const haystack = [txn.merchant_name, txn.name].filter(Boolean).join(" ");
      for (const rule of compiled) {
        if (rule.regex.test(haystack)) {
          updateTransactionTag(txn.transaction_id, rule.tag);
          tagged++;
          break; // highest priority first, stop on first match
        }
      }
    }
  })();

  return tagged;
}

export function getSpendingByTag(filters: TransactionFilters = {}): TagSummary[] {
  const rows = dbGetSpendingByTag(filters);
  return rows.map((r) => ({
    tag: r.tag,
    count: r.count,
    total: Math.round(r.total * 100) / 100,
  }));
}
