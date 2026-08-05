/*
  Fixes: a Cashier creating a new loan application has it silently rejected
  by the database (Row Level Security), while the exact same action works
  fine for an Administrator. The `loans` table's INSERT policy never
  included 'Cashier' even though Cashier already has the `loans`
  permission and the full "New Loan" UI in the app.

  Run once in the Supabase SQL Editor. Safe to re-run (idempotent).
*/
DROP POLICY IF EXISTS "loans_insert" ON loans;
CREATE POLICY "loans_insert" ON loans FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR current_role_name() IN ('Branch Field Collector', 'Branch Manager', 'Cashier'));
