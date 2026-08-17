/*
  Each branch now has its own Chart of Accounts (e.g. "Loans Receivable -
  Balanga" vs "Loans Receivable - Dinalupihan", each its own account/code) —
  this adds the branch_id this app needs to actually scope Chart of
  Accounts / Journal Entries by branch, matching how the client's
  bookkeeping team has already been naming these accounts.

  branch_id is nullable on purpose: an account with no branch (e.g.
  "Investor's Capital", "Miscellaneous Income", "Cash on Hand") is treated
  as company-wide/shared — visible to every branch, not owned by one.

  Non-destructive: this does NOT delete or rename any existing account. It
  only tags the ones that already have a "- <Branch Name>" suffix with the
  matching branch, based on whatever branches currently exist in the
  `branches` table — so it automatically covers a newly added branch too,
  not just Balanga/Dinalupihan specifically. Accounts that don't match any
  branch name stay untagged (shared), which you can always fix individually
  later in the Chart of Accounts page.

  Run once in the Supabase SQL Editor. Safe to re-run (idempotent — only
  fills in branch_id where it's still null).
*/
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id);

-- Matches "<anything> - Balanga" against a branch named "Balanga Branch" (or
-- just "Balanga") by comparing against the branch's first word — same
-- convention the client's account names already use.
UPDATE chart_of_accounts coa
SET branch_id = b.id
FROM branches b
WHERE coa.branch_id IS NULL
  AND coa.name ILIKE '%- ' || split_part(b.name, ' ', 1) || '%';
