/*
  Broadcast SMS — lets an Administrator compose a message and send it via
  Semaphore (semaphore.co) to every customer, or a filtered subset (by
  branch/area/status), that has a phone number on file. This table is just
  the audit log of each broadcast that was sent (not one row per recipient
  — Semaphore's own dashboard has full per-number delivery status), so
  Admin can see what was sent, when, by whom, and to how many people.
  Run once in the Supabase SQL Editor. Safe to re-run (idempotent).
*/
CREATE TABLE IF NOT EXISTS sms_broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message text NOT NULL,
  filter_summary text,
  recipient_count integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  sent_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sms_broadcasts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sms_broadcasts_select ON sms_broadcasts;
CREATE POLICY sms_broadcasts_select ON sms_broadcasts FOR SELECT USING (is_admin());

DROP POLICY IF EXISTS sms_broadcasts_insert ON sms_broadcasts;
CREATE POLICY sms_broadcasts_insert ON sms_broadcasts FOR INSERT WITH CHECK (is_admin());

-- The actual send always goes through the /api/sms/broadcast route using the
-- service role key (so the Semaphore API key never reaches the browser), so
-- this insert policy only matters for the rare case of a direct client-side
-- write — the route itself bypasses RLS via the service role.
