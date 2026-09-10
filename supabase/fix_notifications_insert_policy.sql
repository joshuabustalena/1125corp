/*
  Fixes the second bug found alongside the missing created_at index (Sep
  10, 2026): "new row violates row-level security policy for table
  notifications" (Postgres 42501), firing repeatedly from
  checkDueDateAlerts() (lib/due-date-alerts.ts) — it runs on every page
  load that touches the topbar/dashboard, tries to INSERT any new
  upcoming-due/overdue alerts, and every one of those inserts was being
  rejected by RLS.

  supabase/table_policies.sql already SPECIFIES the correct policy —
  notif_insert ... WITH CHECK (true), open to any signed-in user — but
  whatever is actually live on this project is evidently stricter than
  that (either that file was run before this section existed, or something
  else overrode it since). Re-asserting it here directly, as its own small
  file, removes the guesswork about what state the live database is
  actually in.

  Each failed insert attempt was also extra load on a database already
  struggling with the un-indexed notifications query (see
  add_notifications_created_at_index.sql) — every checkDueDateAlerts() call
  was burning a query on an insert that was guaranteed to fail. Fixing
  this stops that wasted load too.

  Safe to re-run.
*/

DROP POLICY IF EXISTS "notif_insert" ON notifications;
CREATE POLICY "notif_insert" ON notifications FOR INSERT TO authenticated WITH CHECK (true);
