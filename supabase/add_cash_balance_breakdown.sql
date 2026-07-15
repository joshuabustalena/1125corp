/*
  Breaks the Daily Cash Count's "Counted Amount" into Vault / Bank / Petty
  Cash Fund — run this once in the Supabase SQL Editor.

  counted_amount stays as a column (now computed as the sum of the three
  new ones) so the existing variance calculation keeps working unchanged.

  Safe to re-run any time (idempotent).
*/

ALTER TABLE cash_counts ADD COLUMN IF NOT EXISTS vault_amount numeric(12,2) DEFAULT 0;
ALTER TABLE cash_counts ADD COLUMN IF NOT EXISTS bank_amount numeric(12,2) DEFAULT 0;
ALTER TABLE cash_counts ADD COLUMN IF NOT EXISTS petty_cash_amount numeric(12,2) DEFAULT 0;
