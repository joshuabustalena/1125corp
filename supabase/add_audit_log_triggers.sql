/*
  Makes the Audit Logs page (app/(app)/audit-logs/page.tsx) actually work.
  The table, its RLS, and the whole UI already existed — nothing anywhere in
  the app ever wrote a row into it. This attaches one generic trigger to
  every real business table so every insert/update/delete gets logged
  automatically, regardless of whether it came through a plain
  .insert()/.update()/.delete() call or an RPC (apply_loan_payment,
  edit_loan_payment, delete_loan_payment, etc.) — those run entirely inside
  Postgres and would be invisible to any client-side interception, so a
  database trigger is the only way to get genuine full coverage without
  hand-editing dozens of app files (and risking missing one).

  Two things this trigger CANNOT see, by nature — handled separately in the
  app instead (lib/audit-log.ts): login/logout (not a table mutation at
  all), and IP address (a DB trigger only sees the database connection, not
  the original HTTP request's source IP — ip_address stays NULL here; the
  UI already renders a blank IP as "—").

  Run once in the Supabase SQL Editor. Safe to re-run (idempotent) — the
  DO block below drops each trigger before recreating it.
*/

CREATE OR REPLACE FUNCTION log_audit_trail()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_action text;
  v_entity_id uuid;
  v_details jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'create';
    v_entity_id := NEW.id;
    v_details := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'edit';
    v_entity_id := NEW.id;
    v_details := jsonb_build_object('before', to_jsonb(OLD), 'after', to_jsonb(NEW));
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'delete';
    v_entity_id := OLD.id;
    v_details := to_jsonb(OLD);
  END IF;

  INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), v_action, TG_TABLE_NAME, v_entity_id, v_details);

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Every real business table except:
--   - audit_logs itself (would recurse)
--   - notifications, push_subscriptions, loan_payment_applications — pure
--     system plumbing (auto-generated notification spam and an internal
--     payment-idempotency table), not business events worth an audit trail.
-- A loop instead of 40 hand-typed CREATE TRIGGER statements — with this
-- many tables, that's less error-prone than copy-pasting and risking a
-- silently-missed table.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'roles', 'branches', 'profiles', 'areas', 'collectors', 'customers',
    'customer_documents', 'loan_types', 'loans', 'cash_vouchers', 'collateral',
    'receipts', 'payments', 'penalties', 'employees', 'employee_documents',
    'attendance', 'leave_requests', 'collector_attendance', 'payroll',
    'employee_loans', 'employee_special_loans', 'cash_flow', 'expenses',
    'chart_of_accounts', 'journal_entries', 'journal_entry_lines',
    'shareholders', 'remittances', 'cash_counts', 'loan_receivables',
    'settings', 'holidays', 'credit_limit_requests', 'gas_vouchers',
    'general_cash_vouchers', 'payroll_vouchers', 'thirteenth_month_vouchers',
    'sms_broadcasts'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_trail ON %I;', tbl);
    EXECUTE format(
      'CREATE TRIGGER audit_trail AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION log_audit_trail();',
      tbl
    );
  END LOOP;
END $$;
