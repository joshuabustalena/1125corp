// The client tracks each cash location separately (Accounting dashboard and
// the main Dashboard both show them broken out) rather than as one lumped
// "Total Cash" figure. Account names in the live Chart of Accounts vary per
// branch ("Cash in Vault - Balanga", "Cash in Bank BPI - Dinalupihan", …),
// so each bucket is matched by the distinguishing keyword in the name rather
// than by a fixed account code, which isn't stable across branches.
export const CASH_BUCKETS: { key: string; label: string; match: (name: string) => boolean }[] = [
  // "Cash on Hand" (the legacy company-wide account 1000, still the fallback
  // target for expense postings) is the same thing as the vault — see the
  // Cash Vouchers page, which calls it 'Cash on Hand a.k.a. "Cash in Vault"'.
  { key: 'vault', label: 'Cash in Vault', match: n => n.includes('vault') || n.includes('on hand') },
  { key: 'gcash', label: 'Cash in Bank (GCash)', match: n => n.includes('gcash') },
  { key: 'bpi', label: 'Cash in Bank (BPI)', match: n => n.includes('bpi') },
  { key: 'producers', label: 'Cash in Bank (Producers)', match: n => n.includes('producer') },
  { key: 'reserve', label: 'Cash Reserve Funds', match: n => n.includes('reserve') },
  { key: 'petty', label: 'Petty Cash', match: n => n.includes('petty') },
];

// "Cash Short/Over" is named like a cash account and is even typed as an
// asset in the live Chart of Accounts, but it is a VARIANCE account — the
// running record of till discrepancies, not money anyone can spend. Counting
// it as cash quietly skews the reported position (the live Balanga account
// carries a -1,720 balance), so it is filtered out before any cash total is
// computed. account_type can't be used to tell them apart: every one of
// these accounts is stored as 'asset'.
export function isSpendableCashAccount(name: string): boolean {
  const n = (name ?? '').toLowerCase();
  if (!n.includes('cash')) return false;
  if (n.includes('short') || n.includes('over')) return false;
  return true;
}

export function cashBucketFor(name: string): string {
  const n = (name ?? '').toLowerCase();
  return CASH_BUCKETS.find(b => b.match(n))?.key ?? 'other';
}
