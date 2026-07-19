-- Only Administrators can edit an existing payment record (delete was
-- already admin-only). No app flow currently updates a payment row after
-- it's inserted, so this only closes a gap — it doesn't break Post Payment
-- (which only ever inserts).
DROP POLICY IF EXISTS "payments_update" ON payments;
CREATE POLICY "payments_update" ON payments FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());
