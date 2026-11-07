/*
  Incentive Statements — replaces the Excel Kat emails out each month (Nov
  2026). The computation lives in lib/incentives.ts; this holds its factor
  tables and each employee's statement per month.

  incentive_factors: the tables Kat's sheet looks factors up in, editable from
  the Incentives page. A rate uses the row with the highest threshold at or
  below it (7.75% overdue uses the 7.50% row).
    overdue_release       overdue rate %  -> factor on Total Release
    liquidity_collection  liquidity %     -> factor on Collection
    release_bonus         area release    -> "1M Incentive" amount, before the
                                             business-days deduction
    cashier_release       (one row)       -> factor on the branch's Total Release

  Values are from Kat's sheet, "Monthly Incentive Computation 2026". The
  sheet's Proxy tables aren't used (Kat, Nov 2026): a Proxy's release factor
  comes from the overdue table at the branch's overdue rate. cashier_release is
  0.0004, as Kat confirmed (Oct 2026: 4,413,000 x 0.0004 = 1,765.20). A blank
  factor added later shows "factor missing" and blocks approval.

  incentive_statements: one per employee per month (first of the month).
  results is a snapshot of what was computed, so changing a factor later never
  rewrites an approved statement.

  Access follows payroll: an Administrator prepares and approves, Admin Staff
  can read everything (they hold payroll_read), and everyone else sees only
  their own approved statements.

  Safe to re-run: seeds skip rows that already exist, so Kat's edits to the
  tables are kept.
*/

CREATE TABLE IF NOT EXISTS incentive_factors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL CHECK (table_name IN ('overdue_release', 'liquidity_collection', 'release_bonus', 'cashier_release')),
  threshold numeric NOT NULL,
  value numeric,
  UNIQUE (table_name, threshold)
);

INSERT INTO incentive_factors (table_name, threshold, value) VALUES
  ('overdue_release', 0, 0.007), ('overdue_release', 0.1, 0.0065), ('overdue_release', 0.5, 0.006),
  ('overdue_release', 1, 0.0055), ('overdue_release', 1.5, 0.0054), ('overdue_release', 2.5, 0.0053),
  ('overdue_release', 2.8, 0.005), ('overdue_release', 3, 0.0049), ('overdue_release', 3.5, 0.0048),
  ('overdue_release', 4, 0.0047), ('overdue_release', 4.5, 0.0046), ('overdue_release', 5, 0.0045),
  ('overdue_release', 5.5, 0.0044), ('overdue_release', 6, 0.0043), ('overdue_release', 6.5, 0.0042),
  ('overdue_release', 7, 0.0041), ('overdue_release', 7.5, 0.004), ('overdue_release', 8, 0.0039),
  ('overdue_release', 8.5, 0.0038), ('overdue_release', 9, 0.0037), ('overdue_release', 9.5, 0.0036),
  ('overdue_release', 10, 0.0035), ('overdue_release', 10.5, 0.0034), ('overdue_release', 11, 0.0033),
  ('overdue_release', 11.5, 0.0032), ('overdue_release', 12, 0.0031), ('overdue_release', 12.5, 0.003),
  ('overdue_release', 13, 0.0029), ('overdue_release', 14, 0.0028), ('overdue_release', 15, 0.0027),
  ('overdue_release', 16, 0.0026), ('overdue_release', 17, 0.0025), ('overdue_release', 18, 0.0024),
  ('overdue_release', 19, 0.0022), ('overdue_release', 20, 0.002), ('overdue_release', 20.2, 0.0019),
  ('overdue_release', 20.5, 0.0018), ('overdue_release', 20.7, 0.0017), ('overdue_release', 20.8, 0.0016),
  ('overdue_release', 20.9, 0.0015), ('overdue_release', 21, 0.0014), ('overdue_release', 22, 0.0013),
  ('overdue_release', 23, 0.00125), ('overdue_release', 24, 0.0012), ('overdue_release', 25, 0.00115),
  ('overdue_release', 26, 0.0011), ('overdue_release', 27, 0.00105), ('overdue_release', 28, 0.001),
  ('overdue_release', 29, 0.00095), ('overdue_release', 30, 0.0009),
  ('liquidity_collection', 51, 0.003), ('liquidity_collection', 55, 0.0033), ('liquidity_collection', 60, 0.0034),
  ('liquidity_collection', 65, 0.0035), ('liquidity_collection', 70, 0.0039), ('liquidity_collection', 75, 0.004),
  ('liquidity_collection', 80, 0.0044), ('liquidity_collection', 85, 0.00445), ('liquidity_collection', 86, 0.0045),
  ('liquidity_collection', 87, 0.00455), ('liquidity_collection', 88, 0.0046), ('liquidity_collection', 89, 0.00465),
  ('liquidity_collection', 90, 0.0047), ('liquidity_collection', 92, 0.00475), ('liquidity_collection', 95, 0.0048),
  ('liquidity_collection', 97, 0.00485), ('liquidity_collection', 98, 0.0049), ('liquidity_collection', 100, 0.00495),
  ('liquidity_collection', 110, 0.005),
  ('release_bonus', 1000000, 20000), ('release_bonus', 1500000, 30000), ('release_bonus', 2000000, 40000),
  ('cashier_release', 0, 0.0004)
ON CONFLICT (table_name, threshold) DO NOTHING;

CREATE TABLE IF NOT EXISTS incentive_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  month date NOT NULL,
  statement_type text NOT NULL CHECK (statement_type IN ('collector', 'branch_manager', 'proxy', 'cashier')),
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  area_id uuid REFERENCES areas(id) ON DELETE SET NULL,
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  results jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_incentive numeric(12,2) NOT NULL DEFAULT 0,
  withheld numeric(12,2) NOT NULL DEFAULT 0,
  net_incentive numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  approved_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, month)
);

CREATE INDEX IF NOT EXISTS incentive_statements_month_idx ON incentive_statements (month);

-- The employee rows belonging to the signed-in user, the same way My Payslip
-- finds them (profile link, then email). SECURITY DEFINER so a collector's own
-- access to employees doesn't decide whether they can see their statement.
CREATE OR REPLACE FUNCTION my_employee_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id
  FROM employees e
  JOIN profiles p ON p.id = auth.uid()
  WHERE e.profile_id = p.id OR (p.email IS NOT NULL AND e.email = p.email);
$$;

REVOKE ALL ON FUNCTION my_employee_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION my_employee_ids() TO authenticated;

ALTER TABLE incentive_factors ENABLE ROW LEVEL SECURITY;
ALTER TABLE incentive_statements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "incentive_factors_select" ON incentive_factors;
CREATE POLICY "incentive_factors_select" ON incentive_factors
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "incentive_factors_insert" ON incentive_factors;
CREATE POLICY "incentive_factors_insert" ON incentive_factors
  FOR INSERT TO authenticated WITH CHECK (COALESCE(is_admin(), false));

DROP POLICY IF EXISTS "incentive_factors_update" ON incentive_factors;
CREATE POLICY "incentive_factors_update" ON incentive_factors
  FOR UPDATE TO authenticated USING (COALESCE(is_admin(), false)) WITH CHECK (COALESCE(is_admin(), false));

DROP POLICY IF EXISTS "incentive_factors_delete" ON incentive_factors;
CREATE POLICY "incentive_factors_delete" ON incentive_factors
  FOR DELETE TO authenticated USING (COALESCE(is_admin(), false));

DROP POLICY IF EXISTS "incentive_statements_select" ON incentive_statements;
CREATE POLICY "incentive_statements_select" ON incentive_statements
  FOR SELECT TO authenticated USING (
    COALESCE(is_admin(), false)
    OR COALESCE(current_role_name() = 'Admin Staff', false)
    OR (status = 'approved' AND employee_id IN (SELECT my_employee_ids()))
  );

DROP POLICY IF EXISTS "incentive_statements_insert" ON incentive_statements;
CREATE POLICY "incentive_statements_insert" ON incentive_statements
  FOR INSERT TO authenticated WITH CHECK (COALESCE(is_admin(), false));

DROP POLICY IF EXISTS "incentive_statements_update" ON incentive_statements;
CREATE POLICY "incentive_statements_update" ON incentive_statements
  FOR UPDATE TO authenticated USING (COALESCE(is_admin(), false)) WITH CHECK (COALESCE(is_admin(), false));

DROP POLICY IF EXISTS "incentive_statements_delete" ON incentive_statements;
CREATE POLICY "incentive_statements_delete" ON incentive_statements
  FOR DELETE TO authenticated USING (COALESCE(is_admin(), false));

DROP TRIGGER IF EXISTS audit_trail ON incentive_statements;
CREATE TRIGGER audit_trail AFTER INSERT OR UPDATE OR DELETE ON incentive_statements
  FOR EACH ROW EXECUTE FUNCTION log_audit_trail();

DROP TRIGGER IF EXISTS audit_trail ON incentive_factors;
CREATE TRIGGER audit_trail AFTER INSERT OR UPDATE OR DELETE ON incentive_factors
  FOR EACH ROW EXECUTE FUNCTION log_audit_trail();

-- An earlier draft of this file also seeded a proxy_release table, since
-- dropped (Kat: the sheet's proxy tables aren't used). Clears it wherever that
-- draft was run; does nothing on a fresh run.
DELETE FROM incentive_factors WHERE table_name = 'proxy_release';
ALTER TABLE incentive_factors DROP CONSTRAINT IF EXISTS incentive_factors_table_name_check;
ALTER TABLE incentive_factors ADD CONSTRAINT incentive_factors_table_name_check
  CHECK (table_name IN ('overdue_release', 'liquidity_collection', 'release_bonus', 'cashier_release'));
