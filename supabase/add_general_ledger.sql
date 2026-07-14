/*
  General Ledger — Chart of Accounts, Journal Entries, and the tables that
  back the Income Statement / Balance Sheet. Run this once in the Supabase
  SQL Editor.

  Requires current_role_name() and is_admin() to already exist (created by
  fix_loan_role_permissions.sql). Run that one first if you haven't.

  Design notes:
  - Minimal double-entry ledger: journal_entries (header) + journal_entry_lines
    (debit/credit rows). Every entry's lines must balance (sum(debit) =
    sum(credit)) — enforced in the app before insert, not a DB constraint
    (Postgres CHECK constraints can't span multiple rows).
  - Financial statements are computed on the fly by grouping lines by
    account_type over a date range — nothing is pre-aggregated/stored.
  - A default chart of accounts is seeded (Cash, Loans Receivable, Interest/
    Service Fee/Collection Charge/Penalty Income, Operating/Salaries Expense,
    Accounts Payable, Owner's Equity). Add more via the UI (Administrator only).

  Safe to re-run any time (idempotent).
*/

CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  account_type text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_number text UNIQUE NOT NULL,
  entry_date date NOT NULL,
  reference text,
  description text,
  source text DEFAULT 'manual',
  source_id uuid,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS journal_entry_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id uuid REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id uuid REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  debit numeric(12,2) DEFAULT 0,
  credit numeric(12,2) DEFAULT 0,
  memo text
);

INSERT INTO chart_of_accounts (code, name, account_type) VALUES
  ('1000', 'Cash on Hand', 'asset'),
  ('1010', 'Cash in Bank', 'asset'),
  ('1100', 'Loans Receivable', 'asset'),
  ('2000', 'Accounts Payable', 'liability'),
  ('3000', 'Owner''s Equity', 'equity'),
  ('4000', 'Interest Income', 'revenue'),
  ('4010', 'Service Fee Income', 'revenue'),
  ('4020', 'Collection Charges Income', 'revenue'),
  ('4030', 'Penalty Income', 'revenue'),
  ('5000', 'Operating Expenses', 'expense'),
  ('5010', 'Salaries Expense', 'expense')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE chart_of_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "coa_select" ON chart_of_accounts;
CREATE POLICY "coa_select" ON chart_of_accounts FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "coa_insert" ON chart_of_accounts;
CREATE POLICY "coa_insert" ON chart_of_accounts FOR INSERT TO authenticated WITH CHECK (is_admin());
DROP POLICY IF EXISTS "coa_update" ON chart_of_accounts;
CREATE POLICY "coa_update" ON chart_of_accounts FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "coa_delete" ON chart_of_accounts;
CREATE POLICY "coa_delete" ON chart_of_accounts FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "journal_entries_select" ON journal_entries;
CREATE POLICY "journal_entries_select" ON journal_entries FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "journal_entries_insert" ON journal_entries;
CREATE POLICY "journal_entries_insert" ON journal_entries FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR current_role_name() IN ('Cashier', 'Accounting'));
DROP POLICY IF EXISTS "journal_entries_update" ON journal_entries;
CREATE POLICY "journal_entries_update" ON journal_entries FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "journal_entries_delete" ON journal_entries;
CREATE POLICY "journal_entries_delete" ON journal_entries FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE journal_entry_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "journal_entry_lines_select" ON journal_entry_lines;
CREATE POLICY "journal_entry_lines_select" ON journal_entry_lines FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "journal_entry_lines_insert" ON journal_entry_lines;
CREATE POLICY "journal_entry_lines_insert" ON journal_entry_lines FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR current_role_name() IN ('Cashier', 'Accounting'));
DROP POLICY IF EXISTS "journal_entry_lines_update" ON journal_entry_lines;
CREATE POLICY "journal_entry_lines_update" ON journal_entry_lines FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "journal_entry_lines_delete" ON journal_entry_lines;
CREATE POLICY "journal_entry_lines_delete" ON journal_entry_lines FOR DELETE TO authenticated USING (is_admin());
