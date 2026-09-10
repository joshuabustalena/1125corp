/*
  Root cause of the Sep 10, 2026 "stuck on loading" reports (Postgres error
  57014, "canceling statement due to statement timeout"): the notifications
  table was created without an index on created_at — its sibling tables
  (audit_logs, cash_flow, expenses) all got one in the same migration,
  notifications never did.

  Every logged-in user's topbar bell runs
    SELECT * FROM notifications ORDER BY created_at DESC LIMIT 10-30
  on mount AND again every time ANY notification is inserted anywhere in
  the system (components/layout/topbar.tsx's realtime subscription listens
  to every INSERT on this table, unfiltered, then re-fetches). Without an
  index on created_at, each of those re-fetches is a full sort of the whole
  table — and since one insert burst (e.g. due-date alerts firing for many
  loans at once) fans out to EVERY active session simultaneously, that's a
  thundering herd of expensive full-table sorts hitting Postgres at once.
  That's consistent with what we saw: intermittent (not constant) bursts of
  57014s, cascading into Auth's own DB queries getting starved of capacity
  too (the 500/504 "dial tcp"/"context canceled" errors on /auth/v1/token
  reported the same day) — not a separate, unrelated Supabase outage.

  This index turns that ORDER BY + LIMIT into a cheap index scan instead of
  a full-table sort, for every caller (topbar, /notifications, and the
  retention cron job's own DELETE ... WHERE created_at < ...).

  Safe to re-run.
*/

CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
