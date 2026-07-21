-- Approved leave should count as a paid present day even with no
-- attendance record for that day. These columns store what payroll
-- actually credited so the payslip can show it explicitly.
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS leave_pay numeric(12,2) DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS leave_days_credited int DEFAULT 0;
