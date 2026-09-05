/*
  A Cashier can already INSERT into payroll_vouchers/thirteenth_month_vouchers
  (see add_payroll_special_loans.sql), but generating a Payroll Voucher also
  stamps voucher_id onto the `payroll` rows it just swept up — an UPDATE on
  `payroll` itself. That policy was still admin-only, so the app's new
  voucher-only Cashier carve-out (Payroll page, Voucher tab) would create the
  voucher successfully but silently fail to mark those rows as vouchered,
  leaving them eligible to be pulled into a second, duplicate voucher.

  Widen payroll_update the same way payroll_vouchers/thirteenth_month_vouchers
  already are: Administrator or Cashier. This does not touch payroll_insert
  (still admin-only — a Cashier can never create/approve payroll rows, only
  flag existing 'paid' ones as vouchered) or payroll_select (already open to
  every authenticated user).

  Safe to re-run (idempotent).
*/

DROP POLICY IF EXISTS "payroll_update" ON payroll;
CREATE POLICY "payroll_update" ON payroll FOR UPDATE TO authenticated
  USING (is_admin() OR current_role_name() = 'Cashier')
  WITH CHECK (is_admin() OR current_role_name() = 'Cashier');
