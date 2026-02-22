import type { Transaction as PlaidTransaction } from "plaid";
import { getPlaidClient } from "./plaid.js";
import {
  getDb,
  upsertAccounts,
  upsertTransactions,
  removeTransactions,
  getSyncState,
  setSyncState,
} from "./db.js";
import { getDecryptedAccessTokens } from "./config.js";
import type { SyncResponse } from "../types/index.js";
import { SyncError } from "../types/index.js";

function mapPlaidTransaction(t: PlaidTransaction) {
  const pfc = (t as unknown as Record<string, unknown>).personal_finance_category as
    | { primary?: string; detailed?: string }
    | null
    | undefined;

  return {
    transaction_id: t.transaction_id,
    account_id: t.account_id,
    // Plaid: positive = money out, negative = money in
    // We keep the same convention: positive = spending, negative = income
    amount: t.amount,
    iso_currency_code: t.iso_currency_code,
    date: t.date,
    name: t.merchant_name || t.name,
    merchant_name: t.merchant_name ?? null,
    pending: t.pending ? 1 : 0,
    category: pfc?.primary ?? (t.category?.[0] || null),
    subcategory: pfc?.detailed ?? (t.category?.[1] || null),
    payment_channel: t.payment_channel as string,
    transaction_type: (t.transaction_type as string) ?? null,
    authorized_date: t.authorized_date,
  };
}

export async function syncItem(
  accessToken: string,
  itemId: string
): Promise<SyncResponse> {
  const plaid = await getPlaidClient();
  const state = getSyncState(itemId);
  let cursor = state?.cursor || "";

  const allAdded: PlaidTransaction[] = [];
  const allModified: PlaidTransaction[] = [];
  const allRemoved: string[] = [];
  let hasMore = true;

  try {
    while (hasMore) {
      const response = await plaid.transactionsSync({
        access_token: accessToken,
        cursor: cursor || undefined,
      });
      const data = response.data;

      allAdded.push(...data.added);
      allModified.push(...data.modified);
      allRemoved.push(
        ...data.removed
          .map((r) => r.transaction_id)
          .filter((id): id is string => id != null)
      );

      hasMore = data.has_more;
      cursor = data.next_cursor;

      // Upsert accounts from each page
      if (data.accounts.length > 0) {
        upsertAccounts(
          data.accounts.map((a) => ({
            account_id: a.account_id,
            item_id: itemId,
            name: a.name,
            official_name: a.official_name,
            type: a.type as string,
            subtype: (a.subtype as string) ?? null,
            mask: a.mask,
            current_balance: a.balances.current,
            available_balance: a.balances.available,
            iso_currency_code: a.balances.iso_currency_code,
          }))
        );
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new SyncError(`Sync failed for item ${itemId}: ${msg}`);
  }

  // Atomic write: all transactions + cursor in one transaction
  const db = getDb();
  db.transaction(() => {
    if (allAdded.length > 0) {
      upsertTransactions(allAdded.map(mapPlaidTransaction));
    }
    if (allModified.length > 0) {
      upsertTransactions(allModified.map(mapPlaidTransaction));
    }
    if (allRemoved.length > 0) {
      removeTransactions(allRemoved);
    }
    setSyncState(itemId, cursor);
  })();

  return {
    added: allAdded.length,
    modified: allModified.length,
    removed: allRemoved.length,
    cursor,
    has_more: false,
  };
}

export async function syncAll(): Promise<SyncResponse> {
  const items = await getDecryptedAccessTokens();
  if (items.length === 0) {
    throw new SyncError("No linked accounts. Run `cashflow link` first.");
  }

  let totalAdded = 0;
  let totalModified = 0;
  let totalRemoved = 0;
  let lastCursor = "";

  for (const item of items) {
    const result = await syncItem(item.accessToken, item.itemId);
    totalAdded += result.added;
    totalModified += result.modified;
    totalRemoved += result.removed;
    lastCursor = result.cursor;
  }

  return {
    added: totalAdded,
    modified: totalModified,
    removed: totalRemoved,
    cursor: lastCursor,
    has_more: false,
  };
}
