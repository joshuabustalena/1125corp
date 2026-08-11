/*
  Lets any signed-in user delete notifications (one at a time, or "Delete
  All" on the Notifications page) — not just an Administrator. The
  `notifications` table's SELECT/INSERT policies are already wide open
  (`USING (true)`/`WITH CHECK (true)`); all real scoping (which broadcasts
  a given role/branch/person actually sees) happens client-side in
  loadNotifications(), so this matches that same posture instead of being
  the one locked-down operation on an otherwise-open table.
  Run once in the Supabase SQL Editor. Safe to re-run.
*/
DROP POLICY IF EXISTS "notif_delete" ON notifications;
CREATE POLICY "notif_delete" ON notifications FOR DELETE TO authenticated USING (true);
