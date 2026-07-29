/*
  Gas Voucher / Gas Allowance feature — run once in the Supabase SQL Editor.
  Safe to re-run (idempotent).

  - Adds the "Transportation Expense" account used by the auto journal entry
    (Debit Transportation Expense / Credit Cash on Hand — "Cash on Hand" is
    the account the app already uses for what the client calls "Cash in
    Vault", same mapping as Cash Count and loan disbursement).
  - Creates gas_vouchers: one row per generated voucher. `lines` is a jsonb
    array of every collector shown on the printed form for that branch/date
    ({ collector_id, name, amount }), since the set of collectors and who
    actually received an allowance that day varies per voucher — no need for
    a separate line-items table, following the same pattern as
    cash_counts.vault_denominations.
  - RLS mirrors cash_counts: anyone signed in can view, only Cashier/Admin
    can create, only Admin can edit/delete.
  - Grants the new `gas_voucher` permission to the Cashier role so the page
    (gated via lib/permissions.ts) is reachable; Administrator already has
    "*" and needs nothing added.
*/

INSERT INTO chart_of_accounts (code, name, account_type) VALUES
  ('5020', 'Transportation Expense', 'expense')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS gas_vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_number text UNIQUE NOT NULL,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  voucher_date date NOT NULL,
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  prepared_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  cashier_name text,
  branch_manager_name text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE gas_vouchers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gas_vouchers_select" ON gas_vouchers;
CREATE POLICY "gas_vouchers_select" ON gas_vouchers FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "gas_vouchers_insert" ON gas_vouchers;
CREATE POLICY "gas_vouchers_insert" ON gas_vouchers FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR current_role_name() = 'Cashier');
DROP POLICY IF EXISTS "gas_vouchers_update" ON gas_vouchers;
CREATE POLICY "gas_vouchers_update" ON gas_vouchers FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "gas_vouchers_delete" ON gas_vouchers;
CREATE POLICY "gas_vouchers_delete" ON gas_vouchers FOR DELETE TO authenticated USING (is_admin());

UPDATE roles SET permissions = permissions || '["gas_voucher"]'::jsonb
WHERE name = 'Cashier' AND NOT permissions @> '["gas_voucher"]'::jsonb;
