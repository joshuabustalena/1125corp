ALTER TABLE payroll ADD COLUMN IF NOT EXISTS carry_over_deduction numeric(12,2) DEFAULT 0;
