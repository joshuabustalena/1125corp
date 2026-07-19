ALTER TABLE payroll ADD COLUMN IF NOT EXISTS loan_deduction numeric(12,2) DEFAULT 0;
