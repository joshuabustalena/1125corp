/*
  Stores the customer's agreed daily payment amount on each loan, so the
  payment calendar and daily-collection figures read the amount the loan
  was created with instead of always recomputing total_payable / term_days.
  When null, the system falls back to that even split. Run once in the
  Supabase SQL Editor.
*/
ALTER TABLE loans ADD COLUMN IF NOT EXISTS daily_payment numeric(12,2);
