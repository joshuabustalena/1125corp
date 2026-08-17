/*
  Lets Journal Entries be filtered per branch, with a default "All
  Branches" view. Nullable on purpose — an entry with no single branch
  (e.g. the 13th Month Voucher, which can span every branch at once, or a
  manual entry someone chooses not to tag) stays company-wide/shared,
  same model as chart_of_accounts.branch_id.

  This does NOT backfill existing entries — there's no reliable way to
  infer which branch an already-posted entry belongs to after the fact
  (unlike chart_of_accounts, there's no name suffix to match against), so
  every journal entry posted before this migration shows up as "Shared" in
  the branch filter. Only newly-posted entries (loan disbursement, payroll
  voucher, cash/gas vouchers, remittance, and manual entries going forward)
  get tagged automatically.

  Run once in the Supabase SQL Editor. Safe to re-run (idempotent).
*/
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id);
