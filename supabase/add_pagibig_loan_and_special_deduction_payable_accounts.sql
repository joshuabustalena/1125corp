/*
  Accounts for the two payroll deductions that were never booked on the
  Payroll Voucher's journal entry (handleGenerateVoucher in
  app/(app)/payroll/page.tsx):

    2031  PagIBIG Loans Payable       — employees' Pag-IBIG loan amortizations
    2050  Special Deduction Payable   — the catch-all "Special Deduction"

  Both shared (branch_id NULL), like SSS Loans Payable (2011) which Kat
  created for SSS loans in Oct 2026. The voucher resolves them by NAME, so
  they can be renamed/recoded later as long as the name still starts the
  same way.

  Run this BEFORE deploying the matching code: a voucher whose Pag-IBIG
  loan or special deduction is non-zero can't post its journal entry while
  the account is missing.

  Safe to re-run — skips an account that already exists by name.
*/

INSERT INTO chart_of_accounts (code, name, account_type, branch_id)
SELECT '2031', 'PagIBIG Loans Payable', 'liability', NULL
WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE name ILIKE 'PagIBIG Loans Payable%');

INSERT INTO chart_of_accounts (code, name, account_type, branch_id)
SELECT '2050', 'Special Deduction Payable', 'liability', NULL
WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE name ILIKE 'Special Deduction Payable%');
