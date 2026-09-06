/*
  Auto-deletes audit_logs rows older than 6 days, so the table never grows
  unbounded now that the log_audit_trail() trigger (add_audit_log_triggers.sql)
  writes a row for every insert/update/delete across the app.

  "6 days" per the client's own example: data from Monday is gone by Sunday
  (Monday + 6 days = Sunday) — i.e. anything older than 6 days is deleted,
  a rolling window, not a fixed weekly wipe.

  Uses pg_cron (Supabase's built-in job scheduler) to run the cleanup once a
  day at midnight UTC. If pg_cron isn't enabled on this project yet, enable
  it first: Supabase Dashboard → Database → Extensions → search "pg_cron" →
  Enable. The CREATE EXTENSION line below also attempts it directly, which
  works on most Supabase projects without needing the dashboard at all.

  Run once in the Supabase SQL Editor. Safe to re-run (idempotent) — the
  DO block below drops the job before recreating it, so this never ends up
  with two competing schedules.
*/

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'audit_logs_retention') THEN
    PERFORM cron.unschedule('audit_logs_retention');
  END IF;
END $$;

SELECT cron.schedule(
  'audit_logs_retention',
  '0 0 * * *',  -- every day at midnight UTC
  $$ DELETE FROM audit_logs WHERE created_at < now() - interval '6 days'; $$
);

-- Confirmation: shows the job so you can see it's actually scheduled.
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'audit_logs_retention';
