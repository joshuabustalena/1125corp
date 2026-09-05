/*
  Undertime deduction — mirrors the existing late_deduction/
  late_deduction_is_custom pair (add_attendance_late_deduction.sql):
  computed automatically at check-out from actual hours worked vs. the
  8-hour schedule, pro-rated at (daily rate / 8) per short hour, capped at
  a full day (8 hours). An Administrator can still override the stored
  value afterwards, same as Late Deduction — the _is_custom flag stops a
  later recalculation from silently clobbering that override.

  Run once in the Supabase SQL Editor. Safe to re-run (idempotent).
*/

ALTER TABLE attendance ADD COLUMN IF NOT EXISTS undertime_minutes int;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS undertime_deduction numeric(12,2) DEFAULT 0;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS undertime_deduction_is_custom boolean DEFAULT false;

-- Folded into payroll the same way late_deduction already is.
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS undertime_deduction numeric(12,2) DEFAULT 0;
