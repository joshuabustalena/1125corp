/*
  General Cash Voucher — run once in the Supabase SQL Editor.
  Safe to re-run (idempotent).

  Client's rule: every journal entry that credits a Cash account (Cash on
  Hand a.k.a. "Cash in Vault", or Cash in Bank) needs a voucher as proof of
  disbursement. The other vouchers already built this session (Gas
  Voucher, Payroll Voucher, 13th Month Voucher, and the loan release's
  existing `cash_vouchers` table) already cover their own specific cases
  with their own auto journal entry. This is the catch-all for everything
  else — a one-off cash expense (repairs, misc. purchases, an employee
  loan payout recorded directly instead of through payroll, etc.) that has
  no specialized voucher of its own.

  Named `general_cash_vouchers` (not `cash_vouchers`) because that table
  name is already taken by the loan disbursement receipt from earlier in
  this project — unrelated, do not confuse the two.

  `lines` is a jsonb array of the DEBIT side only — [{ account_code,
  account_name, amount }] — one row per Chart of Accounts line being
  funded. The credit side (which Cash account, and the total) is implied
  by cash_account_code / total_amount, matching the reference paper form
  where the Account-Description table only itemizes the debits.
*/

INSERT INTO chart_of_accounts (code, name, account_type) VALUES
  ('5040', 'Repairs Expense', 'expense')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS general_cash_vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_number text UNIQUE NOT NULL,
  payee text NOT NULL,
  particulars text NOT NULL,
  voucher_date date NOT NULL,
  cash_account_code text NOT NULL,
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  prepared_by_name text,
  checked_by_name text,
  approved_by_name text,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE general_cash_vouchers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "general_cash_vouchers_select" ON general_cash_vouchers;
CREATE POLICY "general_cash_vouchers_select" ON general_cash_vouchers FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "general_cash_vouchers_insert" ON general_cash_vouchers;
CREATE POLICY "general_cash_vouchers_insert" ON general_cash_vouchers FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR current_role_name() = 'Cashier');
DROP POLICY IF EXISTS "general_cash_vouchers_delete" ON general_cash_vouchers;
CREATE POLICY "general_cash_vouchers_delete" ON general_cash_vouchers FOR DELETE TO authenticated USING (is_admin());

UPDATE roles SET permissions = permissions || '["cash_vouchers"]'::jsonb
WHERE name = 'Cashier' AND NOT permissions @> '["cash_vouchers"]'::jsonb;
