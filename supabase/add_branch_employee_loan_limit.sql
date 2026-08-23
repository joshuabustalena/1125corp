/*
  Per-branch maximum employee loan, editable by an Administrator in
  Settings > Loan. Companion to add_branch_customer_loan_limit.sql.

  What this replaces
  ------------------
  Two separate things were in play before, and only one of them did anything:

    1. settings.max_employee_loan (15000) — shown in Settings, saved to the
       database, and read by NOTHING. It never capped a single loan.
    2. A hard-coded rule in app/(app)/employee-loans/page.tsx:
           position === 'Branch Manager' ? 20000 : 15000
       This was the limit that actually applied.

  The branch column below becomes the real, editable base limit. The Branch
  Manager allowance is preserved rather than silently dropped — see
  maxLoanAmount() in employee-loans/page.tsx for exactly how the two combine.

  Kept as a separate file from the customer-limit migration so re-running it
  can never touch a customer limit an admin has already tuned.

  Run once in the Supabase SQL Editor. Safe to re-run.
*/

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS default_employee_loan_limit numeric(12,2) DEFAULT 15000;

-- 15,000 matches what the old hard-coded rule gave every non-manager, so
-- applying this changes nobody's cap until an admin edits it.
UPDATE branches SET default_employee_loan_limit = 15000 WHERE default_employee_loan_limit IS NULL;

ALTER TABLE branches
  ALTER COLUMN default_employee_loan_limit SET DEFAULT 15000;

ALTER TABLE branches
  ALTER COLUMN default_employee_loan_limit SET NOT NULL;
