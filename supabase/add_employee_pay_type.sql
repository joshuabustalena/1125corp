-- Phase 10 of the Branch Manager Revision PRD: Branch Managers get a flat
-- ₱20,000 MONTHLY salary instead of the daily-rate × attendance formula
-- used for everyone else. 'daily' is the default so every existing
-- employee's pay computation is unaffected.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS pay_type text DEFAULT 'daily';

-- Set the existing Branch Manager employees to the flat ₱20,000/month rate.
UPDATE employees
SET pay_type = 'monthly', salary = 20000
WHERE position = 'Branch Manager';
