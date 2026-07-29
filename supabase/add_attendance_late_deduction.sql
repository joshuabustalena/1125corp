-- Late check-ins automatically deduct half a day's rate from pay by
-- default (computed at check-in time from the employee's daily rate).
-- late_deduction_is_custom marks records where an Administrator has
-- overridden that computed amount — payroll always sums whatever value is
-- actually stored here, it never recomputes it.
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS late_deduction numeric(12,2) DEFAULT 0;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS late_deduction_is_custom boolean DEFAULT false;

-- Payroll gets its own column to record what was actually deducted for
-- lateness during this specific cutoff, same pattern as loan_deduction /
-- carry_over_deduction, so the payslip can show it as its own line item.
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS late_deduction numeric(12,2) DEFAULT 0;

-- Backfill: existing LATE records created before this feature existed have
-- late_deduction stuck at the column's 0 default. Compute the same half-a-
-- day's-rate default for them retroactively — but only rows never touched
-- by an Administrator (late_deduction_is_custom = false), and only where
-- it's still exactly 0, so this is safe to re-run and never clobbers a
-- real custom value.
UPDATE attendance a
SET late_deduction = ROUND(
  (CASE WHEN e.pay_type = 'monthly' THEN e.salary / 26 ELSE e.salary END) / 2, 2
)
FROM employees e
WHERE a.employee_id = e.id
  AND a.status = 'late'
  AND a.late_deduction_is_custom = false
  AND COALESCE(a.late_deduction, 0) = 0;
