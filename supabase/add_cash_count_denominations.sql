/*
  Replaces the old lump-sum Vault/Bank/Petty Cash entry with the company's
  actual paper Cash Count Sheet process: count each bill/coin denomination
  by quantity for both "Cash in Vault" and "Petty Cash Fund" (PCF), plus the
  handful of manually-written figures already on that paper form (Short/
  over, Beginning/Ending Balance, Release, Expenses, etc.) and the two
  signatories. Denominations are stored as jsonb ({"1000": 91, "500": 18,
  ..., "coin_20": 216, ...}) since the set of denominations is fixed and
  small — no need for a separate line-items table.

  Existing vault_amount / bank_amount / petty_cash_amount / counted_amount /
  expected_amount / variance columns are left in place untouched (old
  history keeps working); new entries populate both the new columns and
  vault_amount/petty_cash_amount/counted_amount/variance so the existing
  "Expected Cash" / "Variance" stat cards at the top of the page keep
  working unchanged.

  Run once in the SQL Editor. Safe to re-run (idempotent).
*/

ALTER TABLE cash_counts ADD COLUMN IF NOT EXISTS vault_denominations jsonb;
ALTER TABLE cash_counts ADD COLUMN IF NOT EXISTS vault_total numeric(12,2) DEFAULT 0;
ALTER TABLE cash_counts ADD COLUMN IF NOT EXISTS pcf_denominations jsonb;
ALTER TABLE cash_counts ADD COLUMN IF NOT EXISTS pcf_total numeric(12,2) DEFAULT 0;
ALTER TABLE cash_counts ADD COLUMN IF NOT EXISTS short_over_vault numeric(12,2) DEFAULT 0;
ALTER TABLE cash_counts ADD COLUMN IF NOT EXISTS short_over_pcf numeric(12,2) DEFAULT 0;
ALTER TABLE cash_counts ADD COLUMN IF NOT EXISTS total_collections numeric(12,2) DEFAULT 0;
ALTER TABLE cash_counts ADD COLUMN IF NOT EXISTS beginning_balance numeric(12,2) DEFAULT 0;
ALTER TABLE cash_counts ADD COLUMN IF NOT EXISTS ending_balance numeric(12,2) DEFAULT 0;
ALTER TABLE cash_counts ADD COLUMN IF NOT EXISTS release_amount numeric(12,2) DEFAULT 0;
ALTER TABLE cash_counts ADD COLUMN IF NOT EXISTS total_expenses numeric(12,2) DEFAULT 0;
ALTER TABLE cash_counts ADD COLUMN IF NOT EXISTS cash_release numeric(12,2) DEFAULT 0;
ALTER TABLE cash_counts ADD COLUMN IF NOT EXISTS collection_release numeric(12,2) DEFAULT 0;
ALTER TABLE cash_counts ADD COLUMN IF NOT EXISTS cashier_name text;
ALTER TABLE cash_counts ADD COLUMN IF NOT EXISTS branch_manager_name text;
