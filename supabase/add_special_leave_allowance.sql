-- Phase 7 of the Branch Manager Revision PRD: special leave (solo parent,
-- VAWC, etc.) gets its own +7-day allowance, tracked separately from the
-- regular annual leave bucket (paid_leaves_used) so the two never mix.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS special_leaves_used int DEFAULT 0;

-- Global default for the special-leave allowance, editable later the same
-- way paid_leaves_annual already is.
INSERT INTO settings (key, value, category)
VALUES ('special_leaves_annual', '7', 'hr')
ON CONFLICT (key) DO NOTHING;
