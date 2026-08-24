/*
  Stops an account from granting itself page access.

  The hole
  --------
  profiles_update allows:

      USING (auth.uid() = id OR is_admin())

  i.e. every signed-in user may update THEIR OWN profile row — which is
  correct for a phone number or avatar, but became dangerous the moment
  permissions_override started living on that row. Any authenticated user
  could call:

      supabase.from('profiles')
        .update({ permissions_override: ['settings', 'accounting', ...] })
        .eq('id', <their own id>)

  and hand themselves every tab in the sidebar. The Employees page being
  Administrator-only does not help: this bypasses the UI entirely.

  The guard
  ---------
  A trigger, not a policy: RLS policies apply per ROW, and this needs to
  apply per COLUMN — everything else on the row must stay self-editable.

  auth.uid() IS NULL is permitted so the service-role account-creation route
  (app/api/employees/create-account) keeps working. That path already holds
  the service key, which bypasses RLS outright, so the trigger is not what
  was protecting it.

  Run once in the Supabase SQL Editor. Safe to re-run.
*/

CREATE OR REPLACE FUNCTION guard_permissions_override()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.permissions_override IS DISTINCT FROM OLD.permissions_override
     AND auth.uid() IS NOT NULL
     AND NOT is_admin() THEN
    RAISE EXCEPTION 'Only an Administrator may change page access';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_permissions_override ON profiles;
CREATE TRIGGER trg_guard_permissions_override
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION guard_permissions_override();
