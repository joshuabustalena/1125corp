/*
  Loan role enforcement fix — run this once in the Supabase SQL Editor.

  Final rules:
    - Collector: can request (insert) loans. Cannot approve/decline/renew.
    - Branch Manager: can approve/decline/renew loans (status changes).
    - Cashier: view-only. Cannot insert or update loans at all.
    - Administrator: full access, always.

  This mirrors supabase/table_policies.sql and the loans section of
  supabase/migrations/20260710234014_create_core_schema.sql — safe to
  re-run any time (idempotent).
*/

CREATE OR REPLACE FUNCTION current_role_name()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT r.name FROM profiles p
  JOIN roles r ON p.role_id = r.id
  WHERE p.id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION enforce_loan_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('active', 'declined', 'renewed')
     AND NOT is_admin()
     AND current_role_name() IS DISTINCT FROM 'Branch Manager' THEN
    RAISE EXCEPTION 'Only a Branch Manager or Administrator can approve, decline, or renew loans';
  END IF;
  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS "loans_insert" ON loans;
CREATE POLICY "loans_insert" ON loans FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR current_role_name() IN ('Collector', 'Branch Manager'));

DROP POLICY IF EXISTS "loans_update" ON loans;
CREATE POLICY "loans_update" ON loans FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (is_admin() OR current_role_name() IN ('Collector', 'Branch Manager'));

DROP TRIGGER IF EXISTS loans_status_change_guard ON loans;
CREATE TRIGGER loans_status_change_guard
BEFORE UPDATE ON loans
FOR EACH ROW EXECUTE FUNCTION enforce_loan_status_change();
