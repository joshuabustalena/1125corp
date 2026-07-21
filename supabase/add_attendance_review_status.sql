-- Phase 8 of the Branch Manager Revision PRD: only an Administrator can
-- accept/reject an attendance record, across every employee (no Branch
-- Manager involvement, no branch scoping). Defaults to 'pending' so nothing
-- existing suddenly looks rejected; only an explicit reject excludes a
-- record from payroll's days-present count.
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS review_status text DEFAULT 'pending';
UPDATE attendance SET review_status = 'pending' WHERE review_status IS NULL;
