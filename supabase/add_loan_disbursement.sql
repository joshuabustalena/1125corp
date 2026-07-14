/*
  Loan disbursement + Cash Voucher — run this once in the Supabase SQL Editor.

  Requires current_role_name() and enforce_loan_status_change() to already
  exist (created by fix_loan_role_permissions.sql). Run that one first if
  you haven't.

  Splits loan approval into two real steps:
    pending  --(Branch Manager/Admin approves)-->  approved
    approved --(Cashier/Admin disburses)-->         active
  and generates a cash_vouchers row on disbursement.

  Safe to re-run any time (idempotent).
*/

ALTER TABLE loans ADD COLUMN IF NOT EXISTS disbursed_by uuid REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS disbursed_at timestamptz;

CREATE TABLE IF NOT EXISTS cash_vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_number text UNIQUE NOT NULL,
  loan_id uuid REFERENCES loans(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  amount numeric(12,2) NOT NULL,
  prepared_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  voucher_date date NOT NULL,
  notes text,
  created_at timestamptz DEFAULT now()
);

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

-- Replaces the old approve/decline/renew-only rule: approve/decline stays
-- Branch Manager/Admin, disburse (active)/renew becomes Cashier/Admin.
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

DROP POLICY IF EXISTS "loans_update" ON loans;
CREATE POLICY "loans_update" ON loans FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (is_admin() OR current_role_name() IN ('Collector', 'Branch Manager', 'Cashier'));
