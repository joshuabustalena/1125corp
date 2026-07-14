/*
  Collateral monitoring (ORCR / bank checks) — run this once in the
  Supabase SQL Editor.

  Requires current_role_name() and is_admin() to already exist (created by
  fix_loan_role_permissions.sql). Run that one first if you haven't.

  Lifecycle kept simple: held -> released. If you need more states later
  (partial release, damaged, disputed) that's a one-line CHECK/enum change.

  Safe to re-run any time (idempotent).
*/

CREATE TABLE IF NOT EXISTS collateral (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id uuid REFERENCES loans(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
  collateral_type text NOT NULL,
  reference_number text,
  description text,
  status text DEFAULT 'held',
  held_date date DEFAULT CURRENT_DATE,
  released_date date,
  released_to text,
  notes text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

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
