/*
  Shareholders' Capital registry — run this once in the Supabase SQL Editor.

  Requires current_role_name() and is_admin() to already exist (created by
  fix_loan_role_permissions.sql). Run that one first if you haven't.

  Kept as an informational registry, not wired into the double-entry
  ledger — adding a shareholder here does not auto-post a journal entry to
  Owner's Equity. See the Accounting Dept PRD Phase 4 notes if this needs
  to become a real sub-ledger later.

  Safe to re-run any time (idempotent).
*/

CREATE TABLE IF NOT EXISTS shareholders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  capital_contributed numeric(14,2) NOT NULL DEFAULT 0,
  ownership_percent numeric(5,2) NOT NULL DEFAULT 0,
  date_invested date,
  notes text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE shareholders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "shareholders_select" ON shareholders;
CREATE POLICY "shareholders_select" ON shareholders FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "shareholders_insert" ON shareholders;
CREATE POLICY "shareholders_insert" ON shareholders FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR current_role_name() = 'Accounting');
DROP POLICY IF EXISTS "shareholders_update" ON shareholders;
CREATE POLICY "shareholders_update" ON shareholders FOR UPDATE TO authenticated
  USING (is_admin() OR current_role_name() = 'Accounting')
  WITH CHECK (is_admin() OR current_role_name() = 'Accounting');
DROP POLICY IF EXISTS "shareholders_delete" ON shareholders;
CREATE POLICY "shareholders_delete" ON shareholders FOR DELETE TO authenticated USING (is_admin());
