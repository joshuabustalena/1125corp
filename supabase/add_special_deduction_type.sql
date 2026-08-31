/*
  Adds "Special Deduction" as a 6th Special Loan type — a general/catch-all
  deduction for anything that needs to come out of an employee's pay but
  doesn't fit SSS Loan, Pag-IBIG Loan, Service Vehicle, Uniform, or Cash
  Shortage. Client's own framing: "para kyng sakali may need ikaltas
  sakanila na hindi kabilang sa types ng special loans... kami na bahala"
  (in case something needs deducting that isn't one of the special loan
  types... we'll take care of it ourselves).

  Deliberately NOT posted to the Payroll Voucher's auto-journal-entry
  (handleGenerateVoucher in app/(app)/payroll/page.tsx) — there's no single
  fixed Chart of Accounts line for a category that's meant to be flexible
  by design, unlike Service Vehicle/Uniform/Cash Shortage which each map to
  one specific account. Same treatment sss_loan/pag_ibig_loan already get:
  deducted from the employee's net pay on the payslip, but not booked as
  part of the company-ledger expense — "kami na bahala" is the same intent.
*/

ALTER TABLE employee_special_loans DROP CONSTRAINT IF EXISTS employee_special_loans_loan_type_check;
ALTER TABLE employee_special_loans ADD CONSTRAINT employee_special_loans_loan_type_check
  CHECK (loan_type IN ('sss_loan', 'pag_ibig_loan', 'service_vehicle', 'uniform', 'cash_shortage', 'special_deduction'));

ALTER TABLE payroll ADD COLUMN IF NOT EXISTS special_deduction numeric NOT NULL DEFAULT 0;
