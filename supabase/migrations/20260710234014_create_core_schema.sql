/*
# 1125Corp Loan Management System - Core Schema

## Overview
Creates the complete relational database for an enterprise lending corporation:
users, roles, branches, areas, collectors, customers, loans, payments, receipts,
employees, attendance, payroll, employee loans, cash flow, expenses, audit logs,
notifications, documents, and settings.

## New Tables
1. roles - User role definitions (admin, branch_manager, cashier, collector, accounting)
2. profiles - Extended user profile linked to auth.users (role, branch, status)
3. branches - Branch offices
4. areas - Geographic areas under branches
5. collectors - Collector assignments (linked to profiles)
6. customers - Borrower records (personal info, address, loan limit, branch/area/collector)
7. customer_documents - Uploaded documents (valid ID, clearance, billing, promissory note)
8. loan_types - Loan product definitions
9. loans - Loan records (amount, interest, fees, status, due date, collector, branch, area)
10. payments - Payment collection records (principal, interest, penalty, GPS, receipt)
11. penalties - Manually-applied penalties per customer
12. receipts - Official receipts (OR number, loan, customer, collector, amount, balance)
13. employees - Employee records (department, position, salary, status)
14. employee_documents - Employee uploaded documents
15. attendance - Employee attendance (time in/out, late, absent, overtime, GPS, photo)
16. collector_attendance - Collector field attendance (photo, GPS, branch, area)
17. payroll - Payroll records per employee per period (salary, deductions, net)
18. employee_loans - Employee loan records (max 15000, max 2 active, 6 months)
19. cash_flow - Cash flow entries (inflow/outflow, category, reference)
20. expenses - Expense records (category, amount, date, branch)
21. loan_receivables - Loan receivable balances per loan
22. audit_logs - Audit trail (action, entity, user, IP, timestamp)
23. notifications - Notification queue (type, recipient, message, channel, status)
24. settings - System settings (interest rates, penalties, holidays, company info)
25. holidays - Holiday calendar (customizable Philippine holidays)

## Security
- RLS enabled on every table.
- Authenticated users can read/write business data.
- Admin-only write access on system tables via role check.

## Notes
1. All monetary amounts stored as numeric(12,2) in Philippine Pesos.
2. Timestamps stored as timestamptz with DEFAULT now().
3. UUIDs used for all primary keys.
*/

-- ============ ROLES ============
CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  description text,
  permissions jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- ============ BRANCHES (created before profiles for FK) ============
CREATE TABLE IF NOT EXISTS branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text UNIQUE NOT NULL,
  address text,
  phone text,
  email text,
  manager_id uuid,
  max_loan_limit numeric(12,2) DEFAULT 80000,
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now()
);

-- ============ PROFILES (extends auth.users) ============
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text NOT NULL,
  role_id uuid REFERENCES roles(id),
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  phone text,
  avatar_url text,
  status text DEFAULT 'active',
  last_login timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Add branches.manager_id FK now that profiles exists
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'branches_manager_id_fkey') THEN
    ALTER TABLE branches ADD CONSTRAINT branches_manager_id_fkey
      FOREIGN KEY (manager_id) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============ AREAS ============
CREATE TABLE IF NOT EXISTS areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  branch_id uuid REFERENCES branches(id) ON DELETE CASCADE,
  max_loan_limit numeric(12,2) DEFAULT 80000,
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now()
);

-- ============ COLLECTORS ============
CREATE TABLE IF NOT EXISTS collectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE CASCADE,
  area_id uuid REFERENCES areas(id) ON DELETE SET NULL,
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now()
);

-- ============ CUSTOMERS ============
CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  middle_name text,
  suffix text,
  birth_date date,
  gender text,
  photo_url text,
  government_id text,
  phone text,
  email text,
  address text,
  barangay text,
  city text,
  province text,
  zip_code text,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  area_id uuid REFERENCES areas(id) ON DELETE SET NULL,
  collector_id uuid REFERENCES collectors(id) ON DELETE SET NULL,
  max_loan_limit numeric(12,2) DEFAULT 80000,
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============ CUSTOMER DOCUMENTS ============
CREATE TABLE IF NOT EXISTS customer_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
  document_type text NOT NULL,
  file_url text NOT NULL,
  file_name text,
  uploaded_at timestamptz DEFAULT now()
);

-- ============ LOAN TYPES ============
CREATE TABLE IF NOT EXISTS loan_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  interest_rate numeric(5,2) DEFAULT 8.00,
  term_days int DEFAULT 60,
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now()
);

-- ============ LOANS ============
CREATE TABLE IF NOT EXISTS loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_number text UNIQUE NOT NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
  loan_type_id uuid REFERENCES loan_types(id) ON DELETE SET NULL,
  amount numeric(12,2) NOT NULL,
  interest_rate numeric(5,2) DEFAULT 8.00,
  interest_amount numeric(12,2) DEFAULT 0,
  service_fee numeric(12,2) DEFAULT 0,
  release_amount numeric(12,2) DEFAULT 0,
  total_payable numeric(12,2) DEFAULT 0,
  term_days int DEFAULT 60,
  collector_id uuid REFERENCES collectors(id) ON DELETE SET NULL,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  area_id uuid REFERENCES areas(id) ON DELETE SET NULL,
  status text DEFAULT 'pending',
  due_date date,
  release_date date,
  remaining_balance numeric(12,2) DEFAULT 0,
  offset_balance numeric(12,2) DEFAULT 0,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============ RECEIPTS (created before payments for FK) ============
CREATE TABLE IF NOT EXISTS receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  or_number text UNIQUE NOT NULL,
  loan_id uuid REFERENCES loans(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  collector_id uuid REFERENCES collectors(id) ON DELETE SET NULL,
  amount numeric(12,2) NOT NULL,
  remaining_balance numeric(12,2) DEFAULT 0,
  payment_date date NOT NULL,
  qr_data text,
  created_at timestamptz DEFAULT now()
);

-- ============ PAYMENTS ============
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id uuid REFERENCES loans(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
  collector_id uuid REFERENCES collectors(id) ON DELETE SET NULL,
  receipt_id uuid REFERENCES receipts(id) ON DELETE SET NULL,
  amount_paid numeric(12,2) NOT NULL,
  principal numeric(12,2) DEFAULT 0,
  interest numeric(12,2) DEFAULT 0,
  penalty numeric(12,2) DEFAULT 0,
  remaining_balance numeric(12,2) DEFAULT 0,
  payment_date date NOT NULL,
  payment_time time,
  gps_lat numeric(10,7),
  gps_lng numeric(10,7),
  notes text,
  created_at timestamptz DEFAULT now()
);

-- ============ PENALTIES ============
CREATE TABLE IF NOT EXISTS penalties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
  loan_id uuid REFERENCES loans(id) ON DELETE CASCADE,
  penalty_type text NOT NULL,
  amount numeric(12,2) NOT NULL,
  reason text,
  applied_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  applied_at timestamptz DEFAULT now()
);

-- ============ EMPLOYEES ============
CREATE TABLE IF NOT EXISTS employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  middle_name text,
  department text,
  position text,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  salary numeric(12,2) DEFAULT 0,
  status text DEFAULT 'active',
  hire_date date,
  phone text,
  email text,
  address text,
  photo_url text,
  paid_leaves_used int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============ EMPLOYEE DOCUMENTS ============
CREATE TABLE IF NOT EXISTS employee_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE,
  document_type text NOT NULL,
  file_url text NOT NULL,
  file_name text,
  uploaded_at timestamptz DEFAULT now()
);

-- ============ ATTENDANCE ============
CREATE TABLE IF NOT EXISTS attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE,
  date date NOT NULL,
  time_in timestamptz,
  time_out timestamptz,
  photo_in_url text,
  photo_out_url text,
  gps_lat numeric(10,7),
  gps_lng numeric(10,7),
  status text DEFAULT 'present',
  late_minutes int DEFAULT 0,
  overtime_minutes int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- ============ COLLECTOR ATTENDANCE ============
CREATE TABLE IF NOT EXISTS collector_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collector_id uuid REFERENCES collectors(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  area_id uuid REFERENCES areas(id) ON DELETE SET NULL,
  date date NOT NULL,
  time_in timestamptz,
  photo_url text,
  gps_lat numeric(10,7),
  gps_lng numeric(10,7),
  created_at timestamptz DEFAULT now()
);

-- ============ PAYROLL ============
CREATE TABLE IF NOT EXISTS payroll (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE,
  period text NOT NULL,
  pay_date date NOT NULL,
  basic_salary numeric(12,2) DEFAULT 0,
  overtime_pay numeric(12,2) DEFAULT 0,
  incentive numeric(12,2) DEFAULT 0,
  sss numeric(12,2) DEFAULT 0,
  philhealth numeric(12,2) DEFAULT 0,
  pag_ibig numeric(12,2) DEFAULT 0,
  sss_loan numeric(12,2) DEFAULT 0,
  pag_ibig_loan numeric(12,2) DEFAULT 0,
  uniform numeric(12,2) DEFAULT 0,
  service_vehicle numeric(12,2) DEFAULT 0,
  other_deductions numeric(12,2) DEFAULT 0,
  employee_loan_deduction numeric(12,2) DEFAULT 0,
  incentive_retention numeric(12,2) DEFAULT 0,
  net_pay numeric(12,2) DEFAULT 0,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

-- ============ EMPLOYEE LOANS ============
CREATE TABLE IF NOT EXISTS employee_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL,
  remaining_balance numeric(12,2) DEFAULT 0,
  deduction_amount numeric(12,2) DEFAULT 0,
  term_months int DEFAULT 6,
  status text DEFAULT 'pending',
  approved_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- ============ CASH FLOW ============
CREATE TABLE IF NOT EXISTS cash_flow (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  category text NOT NULL,
  amount numeric(12,2) NOT NULL,
  reference text,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  transaction_date date NOT NULL,
  notes text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

-- ============ EXPENSES ============
CREATE TABLE IF NOT EXISTS expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  amount numeric(12,2) NOT NULL,
  description text,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  expense_date date NOT NULL,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

-- ============ LOAN RECEIVABLES ============
CREATE TABLE IF NOT EXISTS loan_receivables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id uuid REFERENCES loans(id) ON DELETE CASCADE,
  principal_balance numeric(12,2) DEFAULT 0,
  interest_balance numeric(12,2) DEFAULT 0,
  penalty_balance numeric(12,2) DEFAULT 0,
  total_balance numeric(12,2) DEFAULT 0,
  as_of_date date NOT NULL,
  updated_at timestamptz DEFAULT now()
);

-- ============ AUDIT LOGS ============
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  details jsonb,
  ip_address text,
  created_at timestamptz DEFAULT now()
);

-- ============ NOTIFICATIONS ============
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  recipient_type text NOT NULL,
  recipient_id uuid,
  recipient_name text,
  message text,
  channel text DEFAULT 'email',
  status text DEFAULT 'pending',
  sent_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- ============ SETTINGS ============
CREATE TABLE IF NOT EXISTS settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value jsonb NOT NULL,
  category text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

-- ============ HOLIDAYS ============
CREATE TABLE IF NOT EXISTS holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  holiday_date date NOT NULL,
  type text DEFAULT 'regular',
  is_custom boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- ============ INDEXES ============
CREATE INDEX IF NOT EXISTS idx_customers_branch ON customers(branch_id);
CREATE INDEX IF NOT EXISTS idx_customers_area ON customers(area_id);
CREATE INDEX IF NOT EXISTS idx_customers_collector ON customers(collector_id);
CREATE INDEX IF NOT EXISTS idx_loans_customer ON loans(customer_id);
CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(status);
CREATE INDEX IF NOT EXISTS idx_loans_due_date ON loans(due_date);
CREATE INDEX IF NOT EXISTS idx_payments_loan ON payments(loan_id);
CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_receipts_or ON receipts(or_number);
CREATE INDEX IF NOT EXISTS idx_attendance_employee_date ON attendance(employee_id, date);
CREATE INDEX IF NOT EXISTS idx_payroll_employee ON payroll(employee_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_cash_flow_date ON cash_flow(transaction_date);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);

-- ============ RLS ============
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
ALTER TABLE collector_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_flow ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_receivables ENABLE ROW LEVEL SECURITY;
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

-- Generic policy generator pattern: drop then create
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
CREATE POLICY "customers_insert" ON customers FOR INSERT TO authenticated WITH CHECK (true);
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
-- Helper: current user's role name (Collector requests loans, Branch Manager
-- approves/declines them, Cashier is view-only, Administrator can do everything)
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

-- Blocks status changes (approve/decline/renew) from anyone but Branch Manager/Administrator,
-- even if they can otherwise insert/update a loan row (e.g. Collector reapplying).
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

DROP POLICY IF EXISTS "loans_select" ON loans;
CREATE POLICY "loans_select" ON loans FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "loans_insert" ON loans;
CREATE POLICY "loans_insert" ON loans FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR current_role_name() IN ('Collector', 'Branch Manager'));
DROP POLICY IF EXISTS "loans_update" ON loans;
CREATE POLICY "loans_update" ON loans FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (is_admin() OR current_role_name() IN ('Collector', 'Branch Manager'));
DROP POLICY IF EXISTS "loans_delete" ON loans;
CREATE POLICY "loans_delete" ON loans FOR DELETE TO authenticated USING (is_admin());

DROP TRIGGER IF EXISTS loans_status_change_guard ON loans;
CREATE TRIGGER loans_status_change_guard
BEFORE UPDATE ON loans
FOR EACH ROW EXECUTE FUNCTION enforce_loan_status_change();

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
DROP POLICY IF EXISTS "emp_loans_select" ON employee_loans;
CREATE POLICY "emp_loans_select" ON employee_loans FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "emp_loans_insert" ON employee_loans;
CREATE POLICY "emp_loans_insert" ON employee_loans FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "emp_loans_update" ON employee_loans;
CREATE POLICY "emp_loans_update" ON employee_loans FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "emp_loans_delete" ON employee_loans;
CREATE POLICY "emp_loans_delete" ON employee_loans FOR DELETE TO authenticated USING (is_admin());

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

-- ============ SEED DATA ============
INSERT INTO roles (name, description, permissions) VALUES
  ('Administrator', 'Full system access', '["*"]'::jsonb),
  ('Branch Manager', 'Manage branch operations', '["customers","loans","payments","reports","attendance","employees","payroll"]'::jsonb),
  ('Cashier', 'Payments only', '["payments","receipts","customers_read"]'::jsonb),
  ('Collector', 'Collections, attendance, customer accounts', '["collections","attendance","customers","reports"]'::jsonb),
  ('Accounting', 'Accounting and reports', '["accounting","reports","cash_flow","expenses"]'::jsonb)
ON CONFLICT (name) DO NOTHING;

INSERT INTO loan_types (name, interest_rate, term_days) VALUES
  ('Default (8% / 60 days)', 8.00, 60),
  ('Standard (7.25% / 3 months)', 7.25, 90)
ON CONFLICT DO NOTHING;

INSERT INTO settings (key, value, category) VALUES
  ('default_interest_rate', '8.00', 'interest'),
  ('default_term_days', '60', 'loan'),
  ('service_charge_above_10000', '3', 'loan'),
  ('service_charge_below_10000', '300', 'loan'),
  ('renewal_offset_required', '40', 'loan'),
  ('max_customer_loan', '80000', 'loan'),
  ('max_employee_loan', '15000', 'loan'),
  ('max_active_employee_loans', '2', 'loan'),
  ('employee_loan_max_months', '6', 'loan'),
  ('paid_leaves_annual', '5', 'payroll'),
  ('incentive_retention_percent', '25', 'payroll'),
  ('payroll_schedule', '["15","30"]', 'payroll'),
  ('company_name', '"1125Corp"', 'company'),
  ('company_domain', '"1125corp.org"', 'company')
ON CONFLICT (key) DO NOTHING;

INSERT INTO holidays (name, holiday_date, type) VALUES
  ('New Year''s Day', '2026-01-01', 'regular'),
  ('Araw ng Kagitingan', '2026-04-09', 'regular'),
  ('Maundy Thursday', '2026-04-02', 'regular'),
  ('Good Friday', '2026-04-03', 'regular'),
  ('Labor Day', '2026-05-01', 'regular'),
  ('Independence Day', '2026-06-12', 'regular'),
  ('National Heroes Day', '2026-08-31', 'regular'),
  ('Bonifacio Day', '2026-11-30', 'regular'),
  ('Christmas Day', '2026-12-25', 'regular'),
  ('Rizal Day', '2026-12-30', 'regular')
ON CONFLICT DO NOTHING;
