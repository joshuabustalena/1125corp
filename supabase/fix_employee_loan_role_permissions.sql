/*
  Employee loan approval enforcement — run this once in the Supabase SQL Editor.

  Requires current_role_name() to already exist (created by
  fix_loan_role_permissions.sql). Run that one first if you haven't.

  Rule: only Branch Manager or Administrator can approve/reject an
  employee loan (status -> active/rejected). Anyone with page access can
  still submit an application (status stays 'pending').

  Safe to re-run any time (idempotent).
*/

CREATE OR REPLACE FUNCTION enforce_employee_loan_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('active', 'rejected')
     AND NOT is_admin()
     AND current_role_name() IS DISTINCT FROM 'Branch Manager' THEN
    RAISE EXCEPTION 'Only a Branch Manager or Administrator can approve or reject employee loans';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS emp_loans_status_change_guard ON employee_loans;
CREATE TRIGGER emp_loans_status_change_guard
BEFORE UPDATE ON employee_loans
FOR EACH ROW EXECUTE FUNCTION enforce_employee_loan_status_change();
