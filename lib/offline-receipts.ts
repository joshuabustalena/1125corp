import type { PaymentReceiptData } from '@/components/payment-receipt-dialog';

/*
  Best-effort local cache so a collector can still reprint any receipt
  they've already seen on this device — a payment posted online, or one
  that came from lib/offline-payment-queue.ts (still pending sync, or
  already confirmed). Every receipt shown here gets cached the moment it's
  displayed, so it's already on the device before signal ever drops.
*/

const STORAGE_KEY = 'receipt_cache_v1';
const MAX_STORED = 50;

export interface CachedReceipt extends PaymentReceiptData {
  cachedAt: string;
}

export function cacheReceiptForOffline(receipt: PaymentReceiptData) {
  if (typeof window === 'undefined') return;
  try {
    const existing = getStoredReceipts();
    // Same OR number = the same receipt reopened again — replace it
    // in-place (moves to the front) instead of storing a duplicate.
    const filtered = existing.filter(r => r.orNumber !== receipt.orNumber);
    const updated: CachedReceipt[] = [{ ...receipt, cachedAt: new Date().toISOString() }, ...filtered].slice(0, MAX_STORED);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // localStorage can throw (quota exceeded, private/incognito mode) —
    // this is a best-effort convenience cache, never let it break the
    // actual receipt flow.
  }
}

export function getStoredReceipts(): CachedReceipt[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function clearStoredReceipts() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // no-op
  }
}
