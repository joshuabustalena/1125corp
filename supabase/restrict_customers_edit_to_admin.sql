/*
  Only Administrator can edit or delete a customer record — collectors,
  cashiers, and branch managers can view/create per their existing rules,
  but editing/deleting customer details is Admin-only.

  DELETE was already Admin-only ("customers_delete"); this only tightens
  UPDATE, which previously allowed any authenticated user. Run once in the
  Supabase SQL Editor. Mirrors supabase/table_policies.sql and the
  customers section of supabase/migrations/20260710234014_create_core_schema.sql.
*/

DROP POLICY IF EXISTS "customers_update" ON customers;
CREATE POLICY "customers_update" ON customers FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());
