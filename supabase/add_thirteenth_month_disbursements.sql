-- 13th month paid early, with final pay, to a resigned/terminated employee
-- (Kat, Oct 2026). The voucher itself is made manually; this only records
-- that the employee's 13th month for that cycle has been paid and how much,
-- so the regular June/December 13th Month Voucher leaves them out instead
-- of paying them a second time. One record per employee per cycle.
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS thirteenth_month_disbursements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  year int NOT NULL,
  cycle text NOT NULL CHECK (cycle IN ('partial', 'full')),
  amount numeric(12,2) NOT NULL,
  notes text,
  disbursed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  disbursed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, year, cycle)
);

ALTER TABLE thirteenth_month_disbursements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "thirteenth_month_disbursements_select" ON thirteenth_month_disbursements;
CREATE POLICY "thirteenth_month_disbursements_select" ON thirteenth_month_disbursements
  FOR SELECT TO authenticated USING (true);

-- Same roles that can generate a 13th Month Voucher.
DROP POLICY IF EXISTS "thirteenth_month_disbursements_insert" ON thirteenth_month_disbursements;
CREATE POLICY "thirteenth_month_disbursements_insert" ON thirteenth_month_disbursements
  FOR INSERT TO authenticated WITH CHECK (is_admin() OR current_role_name() = 'Cashier');

DROP POLICY IF EXISTS "thirteenth_month_disbursements_delete" ON thirteenth_month_disbursements;
CREATE POLICY "thirteenth_month_disbursements_delete" ON thirteenth_month_disbursements
  FOR DELETE TO authenticated USING (is_admin());

DROP TRIGGER IF EXISTS audit_trail ON thirteenth_month_disbursements;
CREATE TRIGGER audit_trail AFTER INSERT OR UPDATE OR DELETE ON thirteenth_month_disbursements
  FOR EACH ROW EXECUTE FUNCTION log_audit_trail();
