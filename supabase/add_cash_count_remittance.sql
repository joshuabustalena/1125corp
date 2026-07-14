/*
  Daily Cash Count + Collector Remittance — run this once in the Supabase
  SQL Editor.

  Requires current_role_name() and is_admin() to already exist (created by
  fix_loan_role_permissions.sql). Run that one first if you haven't.

  Safe to re-run any time (idempotent).
*/

CREATE TABLE IF NOT EXISTS remittances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collector_id uuid REFERENCES collectors(id) ON DELETE SET NULL,
  amount numeric(12,2) NOT NULL,
  remittance_date date NOT NULL,
  received_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cash_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  count_date date NOT NULL,
  expected_amount numeric(12,2) DEFAULT 0,
  counted_amount numeric(12,2) NOT NULL,
  variance numeric(12,2) DEFAULT 0,
  counted_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE remittances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "remittances_select" ON remittances;
CREATE POLICY "remittances_select" ON remittances FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "remittances_insert" ON remittances;
CREATE POLICY "remittances_insert" ON remittances FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR current_role_name() = 'Cashier');
DROP POLICY IF EXISTS "remittances_update" ON remittances;
CREATE POLICY "remittances_update" ON remittances FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "remittances_delete" ON remittances;
CREATE POLICY "remittances_delete" ON remittances FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE cash_counts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cash_counts_select" ON cash_counts;
CREATE POLICY "cash_counts_select" ON cash_counts FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "cash_counts_insert" ON cash_counts;
CREATE POLICY "cash_counts_insert" ON cash_counts FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR current_role_name() = 'Cashier');
DROP POLICY IF EXISTS "cash_counts_update" ON cash_counts;
CREATE POLICY "cash_counts_update" ON cash_counts FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "cash_counts_delete" ON cash_counts;
CREATE POLICY "cash_counts_delete" ON cash_counts FOR DELETE TO authenticated USING (is_admin());
