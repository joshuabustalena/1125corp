/*
  Caches the collector's own loan picker list locally so the Post
  Collection dialog on app/(app)/payments/page.tsx still has something to
  search/select from if loadLoans() can't reach the network at all — e.g.
  opening the Payments page fresh with zero signal from the very start of
  the day, not just losing signal after it was already open. See
  public/sw.js for the other half of this: the page itself opening offline
  at all, once it's been opened online at least once before.

  Deliberately narrow: only ever the exact rows this device's own
  loadLoans() already scoped and fetched (already filtered to this
  collector/branch by that query's own filters) — this file never fetches
  anything on its own, so it opens no new access surface.

  The cached list can go stale between visits (a payment posted from
  another device, a loan approved for renewal since the last cache) — an
  accepted, documented tradeoff: stale-but-usable beats an empty picker.
  It only ever feeds the PICKER UI, never a number trusted for the real
  transaction — the actual payment (apply_loan_payment RPC) still re-reads
  the real, live balance server-side at post time regardless of what this
  cache says, same as it already does for the offline payment queue.
*/

const CACHE_KEY = 'cached_loans_v1';

export function getCachedLoans(): any[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function cacheLoans(loans: any[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(loans));
  } catch {
    // Best-effort — a full/blocked localStorage just means no offline
    // fallback list next time, not a broken page now.
  }
}
