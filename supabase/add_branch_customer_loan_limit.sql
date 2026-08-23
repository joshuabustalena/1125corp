/*
  Per-branch default credit limit for new customers, editable by an
  Administrator in Settings.

  Replaces a hard-coded rule in app/(app)/customers/page.tsx that matched on
  the branch NAME:

      if (branch.name.toLowerCase().includes('dinalupihan')) return 20000;
      return 30000;

  That meant opening a new branch required a code change, and renaming a
  branch would silently move its customers onto the wrong default.

  A deliberately NEW column rather than the existing branches.max_loan_limit:
  that one is dead (nothing in the application reads or writes it), it
  defaults to 80000, and its name doesn't say whether it caps the branch's
  total lending or one customer's credit. Leaving it untouched avoids
  inheriting a stale 80000 into a field that decides customer credit.

  Run once in the Supabase SQL Editor. Safe to re-run.
*/

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS default_customer_loan_limit numeric(12,2) DEFAULT 30000;

-- Backfill preserves exactly what the hard-coded rule produced today, so
-- turning this on changes nobody's limit until an admin edits it: 20,000 for
-- Dinalupihan, the 30,000 company default everywhere else.
UPDATE branches
SET default_customer_loan_limit = CASE
  WHEN lower(name) LIKE '%dinalupihan%' THEN 20000
  ELSE 30000
END
WHERE default_customer_loan_limit IS NULL
   OR default_customer_loan_limit = 30000 AND lower(name) LIKE '%dinalupihan%';

-- Never null: a missing limit would fall back to 0 in the UI and block every
-- new customer at that branch.
ALTER TABLE branches
  ALTER COLUMN default_customer_loan_limit SET DEFAULT 30000;

UPDATE branches SET default_customer_loan_limit = 30000 WHERE default_customer_loan_limit IS NULL;

ALTER TABLE branches
  ALTER COLUMN default_customer_loan_limit SET NOT NULL;
