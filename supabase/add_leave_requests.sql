/*
  Employee leave request system — run this once in the Supabase SQL Editor.

  Requires current_role_name() and is_admin() to already exist (created by
  fix_loan_role_permissions.sql). Run that one first if you haven't.

  Balance = settings.paid_leaves_annual minus employees.paid_leaves_used —
  both already existed in the schema before this, just unused until now.
  Approving a request in the UI adds its `days` onto paid_leaves_used.

  Safe to re-run any time (idempotent).
*/

CREATE TABLE IF NOT EXISTS leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE,
  leave_type text DEFAULT 'vacation',
  start_date date NOT NULL,
  end_date date NOT NULL,
  days int NOT NULL,
  reason text,
  status text DEFAULT 'pending',
  approved_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION enforce_leave_request_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('approved', 'rejected')
     AND NOT is_admin()
     AND current_role_name() IS DISTINCT FROM 'Branch Manager' THEN
    RAISE EXCEPTION 'Only a Branch Manager or Administrator can approve or reject leave requests';
  END IF;
  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS "leave_requests_select" ON leave_requests;
CREATE POLICY "leave_requests_select" ON leave_requests FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "leave_requests_insert" ON leave_requests;
CREATE POLICY "leave_requests_insert" ON leave_requests FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "leave_requests_update" ON leave_requests;
CREATE POLICY "leave_requests_update" ON leave_requests FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "leave_requests_delete" ON leave_requests;
CREATE POLICY "leave_requests_delete" ON leave_requests FOR DELETE TO authenticated USING (is_admin());

DROP TRIGGER IF EXISTS leave_requests_status_change_guard ON leave_requests;
CREATE TRIGGER leave_requests_status_change_guard
BEFORE UPDATE ON leave_requests
FOR EACH ROW EXECUTE FUNCTION enforce_leave_request_status_change();
