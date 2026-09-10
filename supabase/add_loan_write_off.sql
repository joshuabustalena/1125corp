/*
  Write-Off — Kat/Sir Ardee's Sep 2026 request (tracker item 69): a loan
  whose customer died, went missing, got sued, etc. needs to come off the
  books as a normal receivable without literally deleting it.

  loans.status becomes 'written_off'. That alone is enough to exclude it
  from every existing "active loans" query across the app (Dashboard,
  Overdue by Area, the Payments loan picker, Reports) — they all already
  filter on status IN ('active','overdue') or = 'active'. app/(app)/loans
  additionally hard-excludes it regardless of the status filter picked,
  since a written-off loan's home is the new /write-off tab, not the main
  Loans list.

  New columns: who wrote it off, when, and why — shown on the Write-Off tab
  and in the audit log entry.

  Miscellaneous Income (4040, shared/company-wide — same convention as the
  other revenue accounts 4000/4010/4020/4030, none of which are branch-
  split either): any payment recorded against an already-written-off loan
  posts here instead of Loans Receivable, since it's no longer counted as
  a receivable at all. See app/(app)/write-off/[id]/page.tsx.

  Safe to re-run.
*/

ALTER TABLE loans ADD COLUMN IF NOT EXISTS written_off_at timestamptz;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS written_off_by uuid REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS written_off_reason text;

INSERT INTO chart_of_accounts (code, name, account_type) VALUES
  ('4040', 'Miscellaneous Income', 'revenue')
ON CONFLICT (code) DO NOTHING;
