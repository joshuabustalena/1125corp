/*
  Lets Cashier create customer records (previously Admin-only) — run this
  once in the Supabase SQL Editor. Reopens the item-7 gap from the Cashier
  PRD, scoped to Cashier specifically rather than everyone.

  Safe to re-run any time (idempotent).
*/

DROP POLICY IF EXISTS "customers_insert" ON customers;
CREATE POLICY "customers_insert" ON customers FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR current_role_name() = 'Cashier');
