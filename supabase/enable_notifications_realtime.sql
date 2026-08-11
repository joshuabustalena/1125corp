/*
  Lets the topbar's notification bell update live (new item appears, badge
  count goes up) the instant a row is inserted into `notifications`,
  without the user needing to refresh the page. By default a table isn't
  broadcast over Supabase Realtime until it's added to the
  `supabase_realtime` publication — this does that for `notifications`.
  Run once in the Supabase SQL Editor. Safe to re-run.
*/
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
  END IF;
END $$;
