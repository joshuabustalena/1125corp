/*
  Restricts customer creation to Administrators only — run this once in the
  Supabase SQL Editor.

  Before this, any authenticated user of any role could insert a customer
  row (WITH CHECK (true)) — this closes that gap. Viewing, updating, and
  deleting customers are unaffected.

  Safe to re-run any time (idempotent).
*/

DROP POLICY IF EXISTS "customers_insert" ON customers;
CREATE POLICY "customers_insert" ON customers FOR INSERT TO authenticated WITH CHECK (is_admin());
