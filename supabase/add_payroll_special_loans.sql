/*
  Payroll special-loan deductions, Payroll Voucher, and 13th Month Voucher
  — run once in the Supabase SQL Editor. Safe to re-run (idempotent).

  - sss_loan, pag_ibig_loan, uniform, service_vehicle already existed as
    dormant columns on `payroll` from the original schema (never wired up
    to any UI); cash_shortage is new. All five are manually entered per
    cutoff (no fixed formula/term, per the client's spec — "no specific
    computations and terms of payment, every cut off deduction").
  - employee_special_loans tracks the running balance behind each of those
    five deduction types, same idea as employee_loans but simpler (no
    schedule/term — a balance that only moves when someone enters a
    deduction on a payroll row).
  - payroll_vouchers is the per-cutoff (period + pay_date + branch) summary
    of everyone's net pay, generated once "disbursed" — mirrors gas_vouchers'
    shape (a jsonb `lines` array, one row per included employee). Marks the
    included payroll rows via payroll.voucher_id so the same paid row is
    never pulled into two vouchers (and never double-posts the journal
    entry).
  - thirteenth_month_vouchers is the equivalent for the semi-annual 13th
    month disbursement (Partial = Dec-May, paid in June; Full = Jun-Nov,
    paid in December).
  - New Chart of Accounts entries so "for each deduction, 1 account for
    accounting" (the client's own words) has somewhere to post to.
*/

ALTER TABLE payroll ADD COLUMN IF NOT EXISTS sss_loan numeric(12,2) DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS pag_ibig_loan numeric(12,2) DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS uniform numeric(12,2) DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS service_vehicle numeric(12,2) DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS cash_shortage numeric(12,2) DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS voucher_id uuid;

CREATE TABLE IF NOT EXISTS employee_special_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE,
  loan_type text NOT NULL CHECK (loan_type IN ('sss_loan', 'pag_ibig_loan', 'service_vehicle', 'uniform', 'cash_shortage')),
  original_amount numeric(12,2) NOT NULL DEFAULT 0,
  remaining_balance numeric(12,2) NOT NULL DEFAULT 0,
  status text DEFAULT 'active',
  notes text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payroll_vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_number text UNIQUE NOT NULL,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  period text NOT NULL,
  pay_date date NOT NULL,
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_net_pay numeric(12,2) NOT NULL DEFAULT 0,
  prepared_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  cashier_name text,
  admin_name text,
  created_at timestamptz DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_voucher_id_fkey') THEN
    ALTER TABLE payroll ADD CONSTRAINT payroll_voucher_id_fkey
      FOREIGN KEY (voucher_id) REFERENCES payroll_vouchers(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS thirteenth_month_vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_number text UNIQUE NOT NULL,
  cycle text NOT NULL CHECK (cycle IN ('partial', 'full')),
  year int NOT NULL,
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_net_pay numeric(12,2) NOT NULL DEFAULT 0,
  prepared_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  cashier_name text,
  admin_name text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE employee_special_loans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "employee_special_loans_select" ON employee_special_loans;
CREATE POLICY "employee_special_loans_select" ON employee_special_loans FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "employee_special_loans_insert" ON employee_special_loans;
CREATE POLICY "employee_special_loans_insert" ON employee_special_loans FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR current_role_name() = 'Branch Manager');
DROP POLICY IF EXISTS "employee_special_loans_update" ON employee_special_loans;
CREATE POLICY "employee_special_loans_update" ON employee_special_loans FOR UPDATE TO authenticated
  USING (is_admin() OR current_role_name() = 'Branch Manager') WITH CHECK (is_admin() OR current_role_name() = 'Branch Manager');
DROP POLICY IF EXISTS "employee_special_loans_delete" ON employee_special_loans;
CREATE POLICY "employee_special_loans_delete" ON employee_special_loans FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE payroll_vouchers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payroll_vouchers_select" ON payroll_vouchers;
CREATE POLICY "payroll_vouchers_select" ON payroll_vouchers FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "payroll_vouchers_insert" ON payroll_vouchers;
CREATE POLICY "payroll_vouchers_insert" ON payroll_vouchers FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR current_role_name() = 'Cashier');
DROP POLICY IF EXISTS "payroll_vouchers_delete" ON payroll_vouchers;
CREATE POLICY "payroll_vouchers_delete" ON payroll_vouchers FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE thirteenth_month_vouchers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "thirteenth_month_vouchers_select" ON thirteenth_month_vouchers;
CREATE POLICY "thirteenth_month_vouchers_select" ON thirteenth_month_vouchers FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "thirteenth_month_vouchers_insert" ON thirteenth_month_vouchers;
CREATE POLICY "thirteenth_month_vouchers_insert" ON thirteenth_month_vouchers FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR current_role_name() = 'Cashier');
DROP POLICY IF EXISTS "thirteenth_month_vouchers_delete" ON thirteenth_month_vouchers;
CREATE POLICY "thirteenth_month_vouchers_delete" ON thirteenth_month_vouchers FOR DELETE TO authenticated USING (is_admin());

INSERT INTO chart_of_accounts (code, name, account_type) VALUES
  ('1110', 'Employee Loan', 'asset'),
  ('1120', 'Service Vehicle Loan', 'asset'),
  ('1130', 'Uniform', 'asset'),
  ('1140', 'Cash Shortage', 'asset'),
  ('2010', 'SSS Payable', 'liability'),
  ('2020', 'Philhealth Payable', 'liability'),
  ('2030', 'PagIBIG Payable', 'liability'),
  ('5030', 'Employee Benefits Expense', 'expense')
ON CONFLICT (code) DO NOTHING;
