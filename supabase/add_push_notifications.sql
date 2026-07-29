/*
  Web Push notifications — run once in the Supabase SQL Editor.
  Safe to re-run (idempotent).

  push_subscriptions stores one row per device/browser a user has enabled
  push on (a user can have several — phone + desktop, etc). `endpoint` is
  unique per browser push service registration, so re-subscribing the same
  device just updates its keys instead of creating a duplicate row.

  RLS: a user can only see/create/delete their OWN subscriptions. Sending
  pushes happens server-side (app/api/push/send) via the service-role key,
  which bypasses RLS entirely — this table's RLS only protects the
  subscribe/unsubscribe endpoints the browser calls directly.
*/

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  endpoint text UNIQUE NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_subscriptions_select" ON push_subscriptions;
CREATE POLICY "push_subscriptions_select" ON push_subscriptions FOR SELECT TO authenticated
  USING (profile_id = auth.uid());
DROP POLICY IF EXISTS "push_subscriptions_insert" ON push_subscriptions;
CREATE POLICY "push_subscriptions_insert" ON push_subscriptions FOR INSERT TO authenticated
  WITH CHECK (profile_id = auth.uid());
DROP POLICY IF EXISTS "push_subscriptions_update" ON push_subscriptions;
CREATE POLICY "push_subscriptions_update" ON push_subscriptions FOR UPDATE TO authenticated
  USING (profile_id = auth.uid()) WITH CHECK (profile_id = auth.uid());
DROP POLICY IF EXISTS "push_subscriptions_delete" ON push_subscriptions;
CREATE POLICY "push_subscriptions_delete" ON push_subscriptions FOR DELETE TO authenticated
  USING (profile_id = auth.uid());
