-- Phase 1 of the Branch Manager Revision PRD: new customers should default
-- to a ₱30,000 max loan limit instead of ₱80,000. Existing customers keep
-- whatever limit they already have — this only changes the default applied
-- to rows inserted from now on.
ALTER TABLE customers ALTER COLUMN max_loan_limit SET DEFAULT 30000;

-- Keep the (currently informational) global settings value in sync too.
UPDATE settings SET value = '30000' WHERE key = 'max_customer_loan';
