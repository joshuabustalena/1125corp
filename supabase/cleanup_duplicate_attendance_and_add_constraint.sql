-- Finishes "Double punch for attendance are not allowed" (tracker #74).
--
-- The app has blocked a second check-in per day since Sep 16, 2026 and no
-- new duplicate has appeared since Sep 13. But the database constraint from
-- add_attendance_one_per_day_constraint.sql was never applied, because 35
-- old duplicate rows (27 employee/day pairs, July–Sep 13) are still there and
-- Postgres refuses a UNIQUE constraint while duplicates exist.
--
-- This keeps exactly one row per employee per day, then adds the constraint.
-- Row kept, in order of preference:
--   1. review_status 'accepted', then 'pending', then 'rejected'
--   2. has a Time Out (a complete day) over a check-in only
--   3. earliest Time In
-- Payroll counts only 'accepted' rows, and every pair but one has at most one
-- accepted row, so this changes no payroll except the next item.
--
-- Known: Jonies De Guzman, 2026-08-28 has TWO accepted rows, so that day was
-- likely counted twice in the Aug 16–31 payroll (paid Sep 1). This deletes the
-- extra row going forward; the paid payslip itself is not changed here.
--
-- Step 1 — preview what will be deleted (run alone first):
--   WITH ranked AS (
--     SELECT a.id, a.employee_id, a.date, a.review_status, a.time_in, a.time_out,
--            row_number() OVER (
--              PARTITION BY a.employee_id, a.date
--              ORDER BY CASE a.review_status WHEN 'accepted' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
--                       (a.time_out IS NULL), a.time_in NULLS LAST, a.created_at
--            ) AS rn
--     FROM attendance a
--   )
--   SELECT r.*, e.first_name, e.last_name
--   FROM ranked r JOIN employees e ON e.id = r.employee_id
--   WHERE r.rn > 1
--   ORDER BY r.date, e.last_name;
--
-- Step 2 — delete the extras and add the constraint (one transaction):

BEGIN;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY employee_id, date
           ORDER BY CASE review_status WHEN 'accepted' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
                    (time_out IS NULL), time_in NULLS LAST, created_at
         ) AS rn
  FROM attendance
)
DELETE FROM attendance WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_one_per_employee_per_day;
ALTER TABLE attendance
  ADD CONSTRAINT attendance_one_per_employee_per_day UNIQUE (employee_id, date);

COMMIT;
