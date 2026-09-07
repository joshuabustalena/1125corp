/*
  Auto-deletes notifications rows older than 6 days, same rolling-window
  retention as audit_logs (see add_audit_log_retention.sql) — the
  Notifications page otherwise grows unbounded, one row per loan
  approve/disburse/pending/etc. notification ever sent.

  Based on created_at, not sent_at — sent_at is null for anything still
  'pending' or that failed to send, and those shouldn't survive forever
  just because they were never actually sent.

  Uses the same pg_cron job scheduler as the audit_logs job. If pg_cron
  isn't enabled on this project yet: Supabase Dashboard → Database →
  Extensions → search "pg_cron" → Enable. The CREATE EXTENSION line below
  also attempts it directly.

  Run once in the Supabase SQL Editor. Safe to re-run (idempotent) — the
  DO block below drops the job before recreating it.
*/

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notifications_retention') THEN
    PERFORM cron.unschedule('notifications_retention');
  END IF;
END $$;

SELECT cron.schedule(
  'notifications_retention',
  '0 0 * * *',  -- every day at midnight UTC
  $$ DELETE FROM notifications WHERE created_at < now() - interval '6 days'; $$
);

-- Confirmation: shows the job so you can see it's actually scheduled.
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'notifications_retention';
