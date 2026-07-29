/*
  Adds a suggested per-cutoff deduction amount to employee_special_loans,
  same idea as employee_loans.deduction_amount — set once when the loan is
  recorded, so the Payroll page's "Edit Deductions" dialog can default to
  it (capped at whatever's left on the balance) instead of starting blank
  every single cutoff. Still fully editable per cutoff — this is just the
  starting suggestion, not a locked-in formula.

  Run once in the Supabase SQL Editor. Safe to re-run (idempotent).
*/

ALTER TABLE employee_special_loans ADD COLUMN IF NOT EXISTS deduction_amount numeric(12,2) DEFAULT 0;
