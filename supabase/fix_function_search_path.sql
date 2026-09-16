/*
  Fixes Supabase Security Advisor's "Function Search Path Mutable" warning
  (63 functions flagged as of Sep 16, 2026 — including apply_loan_payment,
  is_admin, current_role_name, enforce_loan_status_change, and others core
  to this app's money/permission logic).

  What the warning means: a function with no search_path pinned resolves
  unqualified names (a bare `profiles` instead of `public.profiles`) using
  whatever search_path the CALLER happens to have at that moment, not a
  fixed one. For a SECURITY DEFINER function (several of these are — is_admin
  and current_role_name in particular, since RLS policies need them to read
  profiles/roles regardless of the calling user's own row access) that's a
  known privilege-escalation pattern: a caller could in principle create
  their own same-named object earlier in their own search_path and trick
  the function into resolving to it instead of the real one.

  This is a WARNING, not an active incident — nothing here is known to have
  been exploited. It's a hardening pass, not an emergency fix.

  Fix: pin every public-schema function's search_path to `public, extensions`
  — `public` for this app's own tables, `extensions` because Supabase
  installs extensions like pgcrypto there rather than into public (see
  add_audit_log_retention.sql/add_notifications_retention.sql's `WITH SCHEMA
  extensions`), so anything calling gen_random_uuid() or similar without
  schema-qualifying it still resolves correctly. This only sets function
  CONFIG (like a default GUC setting scoped to that function) — it does not
  redefine any function's body/logic, so there is no behavior change beyond
  fixing exactly this name-resolution question.

  Safe to re-run: only touches functions that don't already have a
  search_path set, so running this twice does nothing the second time.
*/

DO $$
DECLARE
  r RECORD;
  fixed_count INT := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS func_signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f' -- ordinary functions only, not aggregates/procedures/window fns
      AND NOT EXISTS (
        SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS cfg
        WHERE cfg LIKE 'search_path=%'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions', r.func_signature);
    fixed_count := fixed_count + 1;
  END LOOP;

  RAISE NOTICE 'Pinned search_path on % function(s).', fixed_count;
END $$;

-- Verification: should return 0 rows once the fix above has run.
SELECT p.oid::regprocedure AS still_unpinned
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind = 'f'
  AND NOT EXISTS (
    SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS cfg
    WHERE cfg LIKE 'search_path=%'
  );
