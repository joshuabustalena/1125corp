/*
  Fixes the loans RLS policies after renaming the "Collector" role to
  "Branch Field Collector" — run this once in the Supabase SQL Editor.

  The role row itself and existing employees.position values were already
  updated directly via the API, but the loans_insert/loans_update policies
  hardcode the old role name as a string literal, so they need to be
  re-created to recognize the new name. Without this, Branch Field
  Collectors would silently lose the ability to submit loan requests.

  Safe to re-run any time (idempotent).
*/

DROP POLICY IF EXISTS "loans_insert" ON loans;
CREATE POLICY "loans_insert" ON loans FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR current_role_name() IN ('Branch Field Collector', 'Branch Manager'));

DROP POLICY IF EXISTS "loans_update" ON loans;
CREATE POLICY "loans_update" ON loans FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (is_admin() OR current_role_name() IN ('Branch Field Collector', 'Branch Manager', 'Cashier'));
