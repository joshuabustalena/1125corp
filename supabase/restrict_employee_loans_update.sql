-- All edits to employee loans (Approve/Reject, and the Admin Edit dialog's
-- amount/balance/deduction/term changes) are now Admin-only. Delete was
-- already admin-only (emp_loans_delete).
DROP POLICY IF EXISTS "emp_loans_update" ON employee_loans;
CREATE POLICY "emp_loans_update" ON employee_loans FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());
