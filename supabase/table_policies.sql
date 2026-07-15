/*
  All table RLS policies, extracted from the schema migration
  (supabase/migrations/20260710234014_create_core_schema.sql) into one
  standalone reference file.

  Safe to re-run any time: every ALTER TABLE ... ENABLE ROW LEVEL SECURITY
  is idempotent, and every policy is dropped before being recreated.

  Pattern used throughout:
    - SELECT: open to any authenticated (logged-in) user
    - INSERT/UPDATE: open to any authenticated user for day-to-day
      operational tables (customers, loans, payments, etc.), restricted
      to is_admin() for structural/config tables (branches, employees,
      roles, settings, holidays, loan_types, areas, collectors)
    - DELETE: always restricted to is_admin()

  Note: RLS only recognizes a REAL Supabase Auth session (a valid JWT).
  The frontend's dev-bypass mode (NEXT_PUBLIC_DEV_BYPASS_AUTH) fakes a
  logged-in UI locally but does not produce a real JWT, so is_admin()
  (and even the base "authenticated" role check) will still reject
  writes until you log in for real.
*/

-- ============ ENABLE RLS ============
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE collectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE penalties ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE collector_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_flow ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_receivables ENABLE ROW LEVEL SECURITY;
ALTER TABLE chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entry_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE shareholders ENABLE ROW LEVEL SECURITY;
ALTER TABLE remittances ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;

-- Helper: check if current user is admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
    JOIN roles r ON p.role_id = r.id
    WHERE p.id = auth.uid() AND r.name = 'Administrator'
  );
$$;

-- ROLES
DROP POLICY IF EXISTS "roles_select" ON roles;
CREATE POLICY "roles_select" ON roles FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "roles_insert" ON roles;
CREATE POLICY "roles_insert" ON roles FOR INSERT TO authenticated WITH CHECK (is_admin());
DROP POLICY IF EXISTS "roles_update" ON roles;
CREATE POLICY "roles_update" ON roles FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "roles_delete" ON roles;
CREATE POLICY "roles_delete" ON roles FOR DELETE TO authenticated USING (is_admin());

-- PROFILES
DROP POLICY IF EXISTS "profiles_select" ON profiles;
CREATE POLICY "profiles_select" ON profiles FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "profiles_insert" ON profiles;
CREATE POLICY "profiles_insert" ON profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id OR is_admin());
DROP POLICY IF EXISTS "profiles_update" ON profiles;
CREATE POLICY "profiles_update" ON profiles FOR UPDATE TO authenticated USING (auth.uid() = id OR is_admin()) WITH CHECK (auth.uid() = id OR is_admin());
DROP POLICY IF EXISTS "profiles_delete" ON profiles;
CREATE POLICY "profiles_delete" ON profiles FOR DELETE TO authenticated USING (is_admin());

-- BRANCHES
DROP POLICY IF EXISTS "branches_select" ON branches;
CREATE POLICY "branches_select" ON branches FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "branches_insert" ON branches;
CREATE POLICY "branches_insert" ON branches FOR INSERT TO authenticated WITH CHECK (is_admin());
DROP POLICY IF EXISTS "branches_update" ON branches;
CREATE POLICY "branches_update" ON branches FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "branches_delete" ON branches;
CREATE POLICY "branches_delete" ON branches FOR DELETE TO authenticated USING (is_admin());

-- AREAS
DROP POLICY IF EXISTS "areas_select" ON areas;
CREATE POLICY "areas_select" ON areas FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "areas_insert" ON areas;
CREATE POLICY "areas_insert" ON areas FOR INSERT TO authenticated WITH CHECK (is_admin());
DROP POLICY IF EXISTS "areas_update" ON areas;
CREATE POLICY "areas_update" ON areas FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "areas_delete" ON areas;
CREATE POLICY "areas_delete" ON areas FOR DELETE TO authenticated USING (is_admin());

-- COLLECTORS
DROP POLICY IF EXISTS "collectors_select" ON collectors;
CREATE POLICY "collectors_select" ON collectors FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "collectors_insert" ON collectors;
CREATE POLICY "collectors_insert" ON collectors FOR INSERT TO authenticated WITH CHECK (is_admin());
DROP POLICY IF EXISTS "collectors_update" ON collectors;
CREATE POLICY "collectors_update" ON collectors FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "collectors_delete" ON collectors;
CREATE POLICY "collectors_delete" ON collectors FOR DELETE TO authenticated USING (is_admin());

-- CUSTOMERS
DROP POLICY IF EXISTS "customers_select" ON customers;
CREATE POLICY "customers_select" ON customers FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "customers_insert" ON customers;
CREATE POLICY "customers_insert" ON customers FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR current_role_name() = 'Cashier');
DROP POLICY IF EXISTS "customers_update" ON customers;
CREATE POLICY "customers_update" ON customers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "customers_delete" ON customers;
CREATE POLICY "customers_delete" ON customers FOR DELETE TO authenticated USING (is_admin());

-- CUSTOMER_DOCUMENTS
DROP POLICY IF EXISTS "customer_docs_select" ON customer_documents;
CREATE POLICY "customer_docs_select" ON customer_documents FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "customer_docs_insert" ON customer_documents;
CREATE POLICY "customer_docs_insert" ON customer_documents FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "customer_docs_update" ON customer_documents;
CREATE POLICY "customer_docs_update" ON customer_documents FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "customer_docs_delete" ON customer_documents;
CREATE POLICY "customer_docs_delete" ON customer_documents FOR DELETE TO authenticated USING (is_admin());

-- LOAN_TYPES
DROP POLICY IF EXISTS "loan_types_select" ON loan_types;
CREATE POLICY "loan_types_select" ON loan_types FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "loan_types_insert" ON loan_types;
CREATE POLICY "loan_types_insert" ON loan_types FOR INSERT TO authenticated WITH CHECK (is_admin());
DROP POLICY IF EXISTS "loan_types_update" ON loan_types;
CREATE POLICY "loan_types_update" ON loan_types FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "loan_types_delete" ON loan_types;
CREATE POLICY "loan_types_delete" ON loan_types FOR DELETE TO authenticated USING (is_admin());

-- LOANS
-- Helper: current user's role name (Branch Field Collector requests loans,
-- Branch Manager approves/declines them, Cashier disburses approved ones,
-- Administrator can do everything)
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

-- Blocks status changes from anyone but the role responsible for that
-- transition, even if they can otherwise insert/update a loan row (e.g.
-- Branch Field Collector reapplying): approve/decline -> Branch Manager/Admin;
-- disburse (active)/renew -> Cashier/Admin.
CREATE OR REPLACE FUNCTION enforce_loan_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('approved', 'declined')
       AND NOT is_admin()
       AND current_role_name() IS DISTINCT FROM 'Branch Manager' THEN
      RAISE EXCEPTION 'Only a Branch Manager or Administrator can approve or decline loans';
    END IF;
    IF NEW.status IN ('active', 'renewed')
       AND NOT is_admin()
       AND current_role_name() IS DISTINCT FROM 'Cashier' THEN
      RAISE EXCEPTION 'Only a Cashier or Administrator can disburse or renew loans';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS "loans_select" ON loans;
CREATE POLICY "loans_select" ON loans FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "loans_insert" ON loans;
CREATE POLICY "loans_insert" ON loans FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR current_role_name() IN ('Branch Field Collector', 'Branch Manager'));
DROP POLICY IF EXISTS "loans_update" ON loans;
CREATE POLICY "loans_update" ON loans FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (is_admin() OR current_role_name() IN ('Branch Field Collector', 'Branch Manager', 'Cashier'));
DROP POLICY IF EXISTS "loans_delete" ON loans;
CREATE POLICY "loans_delete" ON loans FOR DELETE TO authenticated USING (is_admin());

DROP TRIGGER IF EXISTS loans_status_change_guard ON loans;
CREATE TRIGGER loans_status_change_guard
BEFORE UPDATE ON loans
FOR EACH ROW EXECUTE FUNCTION enforce_loan_status_change();

-- CASH VOUCHERS
ALTER TABLE cash_vouchers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cash_vouchers_select" ON cash_vouchers;
CREATE POLICY "cash_vouchers_select" ON cash_vouchers FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "cash_vouchers_insert" ON cash_vouchers;
CREATE POLICY "cash_vouchers_insert" ON cash_vouchers FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR current_role_name() = 'Cashier');
DROP POLICY IF EXISTS "cash_vouchers_update" ON cash_vouchers;
CREATE POLICY "cash_vouchers_update" ON cash_vouchers FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "cash_vouchers_delete" ON cash_vouchers;
CREATE POLICY "cash_vouchers_delete" ON cash_vouchers FOR DELETE TO authenticated USING (is_admin());

-- COLLATERAL
ALTER TABLE collateral ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "collateral_select" ON collateral;
CREATE POLICY "collateral_select" ON collateral FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "collateral_insert" ON collateral;
CREATE POLICY "collateral_insert" ON collateral FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR current_role_name() = 'Cashier');
DROP POLICY IF EXISTS "collateral_update" ON collateral;
CREATE POLICY "collateral_update" ON collateral FOR UPDATE TO authenticated
  USING (is_admin() OR current_role_name() = 'Cashier')
  WITH CHECK (is_admin() OR current_role_name() = 'Cashier');
DROP POLICY IF EXISTS "collateral_delete" ON collateral;
CREATE POLICY "collateral_delete" ON collateral FOR DELETE TO authenticated USING (is_admin());

-- PAYMENTS
DROP POLICY IF EXISTS "payments_select" ON payments;
CREATE POLICY "payments_select" ON payments FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "payments_insert" ON payments;
CREATE POLICY "payments_insert" ON payments FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "payments_update" ON payments;
CREATE POLICY "payments_update" ON payments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "payments_delete" ON payments;
CREATE POLICY "payments_delete" ON payments FOR DELETE TO authenticated USING (is_admin());

-- RECEIPTS
DROP POLICY IF EXISTS "receipts_select" ON receipts;
CREATE POLICY "receipts_select" ON receipts FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "receipts_insert" ON receipts;
CREATE POLICY "receipts_insert" ON receipts FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "receipts_update" ON receipts;
CREATE POLICY "receipts_update" ON receipts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "receipts_delete" ON receipts;
CREATE POLICY "receipts_delete" ON receipts FOR DELETE TO authenticated USING (is_admin());

-- PENALTIES
DROP POLICY IF EXISTS "penalties_select" ON penalties;
CREATE POLICY "penalties_select" ON penalties FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "penalties_insert" ON penalties;
CREATE POLICY "penalties_insert" ON penalties FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "penalties_update" ON penalties;
CREATE POLICY "penalties_update" ON penalties FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "penalties_delete" ON penalties;
CREATE POLICY "penalties_delete" ON penalties FOR DELETE TO authenticated USING (is_admin());

-- EMPLOYEES
DROP POLICY IF EXISTS "employees_select" ON employees;
CREATE POLICY "employees_select" ON employees FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "employees_insert" ON employees;
CREATE POLICY "employees_insert" ON employees FOR INSERT TO authenticated WITH CHECK (is_admin());
DROP POLICY IF EXISTS "employees_update" ON employees;
CREATE POLICY "employees_update" ON employees FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "employees_delete" ON employees;
CREATE POLICY "employees_delete" ON employees FOR DELETE TO authenticated USING (is_admin());

-- EMPLOYEE_DOCUMENTS
DROP POLICY IF EXISTS "emp_docs_select" ON employee_documents;
CREATE POLICY "emp_docs_select" ON employee_documents FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "emp_docs_insert" ON employee_documents;
CREATE POLICY "emp_docs_insert" ON employee_documents FOR INSERT TO authenticated WITH CHECK (is_admin());
DROP POLICY IF EXISTS "emp_docs_update" ON employee_documents;
CREATE POLICY "emp_docs_update" ON employee_documents FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "emp_docs_delete" ON employee_documents;
CREATE POLICY "emp_docs_delete" ON employee_documents FOR DELETE TO authenticated USING (is_admin());

-- ATTENDANCE
DROP POLICY IF EXISTS "attendance_select" ON attendance;
CREATE POLICY "attendance_select" ON attendance FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "attendance_insert" ON attendance;
CREATE POLICY "attendance_insert" ON attendance FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "attendance_update" ON attendance;
CREATE POLICY "attendance_update" ON attendance FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "attendance_delete" ON attendance;
CREATE POLICY "attendance_delete" ON attendance FOR DELETE TO authenticated USING (is_admin());

-- COLLECTOR_ATTENDANCE
DROP POLICY IF EXISTS "coll_att_select" ON collector_attendance;
CREATE POLICY "coll_att_select" ON collector_attendance FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "coll_att_insert" ON collector_attendance;
CREATE POLICY "coll_att_insert" ON collector_attendance FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "coll_att_update" ON collector_attendance;
CREATE POLICY "coll_att_update" ON collector_attendance FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "coll_att_delete" ON collector_attendance;
CREATE POLICY "coll_att_delete" ON collector_attendance FOR DELETE TO authenticated USING (is_admin());

-- PAYROLL
DROP POLICY IF EXISTS "payroll_select" ON payroll;
CREATE POLICY "payroll_select" ON payroll FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "payroll_insert" ON payroll;
CREATE POLICY "payroll_insert" ON payroll FOR INSERT TO authenticated WITH CHECK (is_admin());
DROP POLICY IF EXISTS "payroll_update" ON payroll;
CREATE POLICY "payroll_update" ON payroll FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "payroll_delete" ON payroll;
CREATE POLICY "payroll_delete" ON payroll FOR DELETE TO authenticated USING (is_admin());

-- EMPLOYEE_LOANS
-- Blocks approve/reject status changes from anyone but Branch Manager/Administrator.
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

DROP POLICY IF EXISTS "emp_loans_select" ON employee_loans;
CREATE POLICY "emp_loans_select" ON employee_loans FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "emp_loans_insert" ON employee_loans;
CREATE POLICY "emp_loans_insert" ON employee_loans FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "emp_loans_update" ON employee_loans;
CREATE POLICY "emp_loans_update" ON employee_loans FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "emp_loans_delete" ON employee_loans;
CREATE POLICY "emp_loans_delete" ON employee_loans FOR DELETE TO authenticated USING (is_admin());

DROP TRIGGER IF EXISTS emp_loans_status_change_guard ON employee_loans;
CREATE TRIGGER emp_loans_status_change_guard
BEFORE UPDATE ON employee_loans
FOR EACH ROW EXECUTE FUNCTION enforce_employee_loan_status_change();

-- LEAVE_REQUESTS
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

-- CASH_FLOW
DROP POLICY IF EXISTS "cash_flow_select" ON cash_flow;
CREATE POLICY "cash_flow_select" ON cash_flow FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "cash_flow_insert" ON cash_flow;
CREATE POLICY "cash_flow_insert" ON cash_flow FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "cash_flow_update" ON cash_flow;
CREATE POLICY "cash_flow_update" ON cash_flow FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "cash_flow_delete" ON cash_flow;
CREATE POLICY "cash_flow_delete" ON cash_flow FOR DELETE TO authenticated USING (is_admin());

-- EXPENSES
DROP POLICY IF EXISTS "expenses_select" ON expenses;
CREATE POLICY "expenses_select" ON expenses FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "expenses_insert" ON expenses;
CREATE POLICY "expenses_insert" ON expenses FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "expenses_update" ON expenses;
CREATE POLICY "expenses_update" ON expenses FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "expenses_delete" ON expenses;
CREATE POLICY "expenses_delete" ON expenses FOR DELETE TO authenticated USING (is_admin());

-- LOAN_RECEIVABLES
DROP POLICY IF EXISTS "receivables_select" ON loan_receivables;
CREATE POLICY "receivables_select" ON loan_receivables FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "receivables_insert" ON loan_receivables;
CREATE POLICY "receivables_insert" ON loan_receivables FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "receivables_update" ON loan_receivables;
CREATE POLICY "receivables_update" ON loan_receivables FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "receivables_delete" ON loan_receivables;
CREATE POLICY "receivables_delete" ON loan_receivables FOR DELETE TO authenticated USING (is_admin());

-- CHART_OF_ACCOUNTS (structural — admin-managed, everyone can read to label entries)
DROP POLICY IF EXISTS "coa_select" ON chart_of_accounts;
CREATE POLICY "coa_select" ON chart_of_accounts FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "coa_insert" ON chart_of_accounts;
CREATE POLICY "coa_insert" ON chart_of_accounts FOR INSERT TO authenticated WITH CHECK (is_admin());
DROP POLICY IF EXISTS "coa_update" ON chart_of_accounts;
CREATE POLICY "coa_update" ON chart_of_accounts FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "coa_delete" ON chart_of_accounts;
CREATE POLICY "coa_delete" ON chart_of_accounts FOR DELETE TO authenticated USING (is_admin());

-- JOURNAL_ENTRIES / JOURNAL_ENTRY_LINES
DROP POLICY IF EXISTS "journal_entries_select" ON journal_entries;
CREATE POLICY "journal_entries_select" ON journal_entries FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "journal_entries_insert" ON journal_entries;
CREATE POLICY "journal_entries_insert" ON journal_entries FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR current_role_name() IN ('Cashier', 'Accounting'));
DROP POLICY IF EXISTS "journal_entries_update" ON journal_entries;
CREATE POLICY "journal_entries_update" ON journal_entries FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "journal_entries_delete" ON journal_entries;
CREATE POLICY "journal_entries_delete" ON journal_entries FOR DELETE TO authenticated USING (is_admin());

DROP POLICY IF EXISTS "journal_entry_lines_select" ON journal_entry_lines;
CREATE POLICY "journal_entry_lines_select" ON journal_entry_lines FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "journal_entry_lines_insert" ON journal_entry_lines;
CREATE POLICY "journal_entry_lines_insert" ON journal_entry_lines FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR current_role_name() IN ('Cashier', 'Accounting'));
DROP POLICY IF EXISTS "journal_entry_lines_update" ON journal_entry_lines;
CREATE POLICY "journal_entry_lines_update" ON journal_entry_lines FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "journal_entry_lines_delete" ON journal_entry_lines;
CREATE POLICY "journal_entry_lines_delete" ON journal_entry_lines FOR DELETE TO authenticated USING (is_admin());

-- SHAREHOLDERS
DROP POLICY IF EXISTS "shareholders_select" ON shareholders;
CREATE POLICY "shareholders_select" ON shareholders FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "shareholders_insert" ON shareholders;
CREATE POLICY "shareholders_insert" ON shareholders FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR current_role_name() = 'Accounting');
DROP POLICY IF EXISTS "shareholders_update" ON shareholders;
CREATE POLICY "shareholders_update" ON shareholders FOR UPDATE TO authenticated
  USING (is_admin() OR current_role_name() = 'Accounting')
  WITH CHECK (is_admin() OR current_role_name() = 'Accounting');
DROP POLICY IF EXISTS "shareholders_delete" ON shareholders;
CREATE POLICY "shareholders_delete" ON shareholders FOR DELETE TO authenticated USING (is_admin());

-- REMITTANCES
DROP POLICY IF EXISTS "remittances_select" ON remittances;
CREATE POLICY "remittances_select" ON remittances FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "remittances_insert" ON remittances;
CREATE POLICY "remittances_insert" ON remittances FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR current_role_name() = 'Cashier');
DROP POLICY IF EXISTS "remittances_update" ON remittances;
CREATE POLICY "remittances_update" ON remittances FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "remittances_delete" ON remittances;
CREATE POLICY "remittances_delete" ON remittances FOR DELETE TO authenticated USING (is_admin());

-- CASH_COUNTS
DROP POLICY IF EXISTS "cash_counts_select" ON cash_counts;
CREATE POLICY "cash_counts_select" ON cash_counts FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "cash_counts_insert" ON cash_counts;
CREATE POLICY "cash_counts_insert" ON cash_counts FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR current_role_name() = 'Cashier');
DROP POLICY IF EXISTS "cash_counts_update" ON cash_counts;
CREATE POLICY "cash_counts_update" ON cash_counts FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "cash_counts_delete" ON cash_counts;
CREATE POLICY "cash_counts_delete" ON cash_counts FOR DELETE TO authenticated USING (is_admin());

-- AUDIT_LOGS
DROP POLICY IF EXISTS "audit_select" ON audit_logs;
CREATE POLICY "audit_select" ON audit_logs FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "audit_insert" ON audit_logs;
CREATE POLICY "audit_insert" ON audit_logs FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "audit_delete" ON audit_logs;
CREATE POLICY "audit_delete" ON audit_logs FOR DELETE TO authenticated USING (is_admin());

-- NOTIFICATIONS
DROP POLICY IF EXISTS "notif_select" ON notifications;
CREATE POLICY "notif_select" ON notifications FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "notif_insert" ON notifications;
CREATE POLICY "notif_insert" ON notifications FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "notif_update" ON notifications;
CREATE POLICY "notif_update" ON notifications FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "notif_delete" ON notifications;
CREATE POLICY "notif_delete" ON notifications FOR DELETE TO authenticated USING (is_admin());

-- SETTINGS
DROP POLICY IF EXISTS "settings_select" ON settings;
CREATE POLICY "settings_select" ON settings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "settings_insert" ON settings;
CREATE POLICY "settings_insert" ON settings FOR INSERT TO authenticated WITH CHECK (is_admin());
DROP POLICY IF EXISTS "settings_update" ON settings;
CREATE POLICY "settings_update" ON settings FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "settings_delete" ON settings;
CREATE POLICY "settings_delete" ON settings FOR DELETE TO authenticated USING (is_admin());

-- HOLIDAYS
DROP POLICY IF EXISTS "holidays_select" ON holidays;
CREATE POLICY "holidays_select" ON holidays FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "holidays_insert" ON holidays;
CREATE POLICY "holidays_insert" ON holidays FOR INSERT TO authenticated WITH CHECK (is_admin());
DROP POLICY IF EXISTS "holidays_update" ON holidays;
CREATE POLICY "holidays_update" ON holidays FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "holidays_delete" ON holidays;
CREATE POLICY "holidays_delete" ON holidays FOR DELETE TO authenticated USING (is_admin());
