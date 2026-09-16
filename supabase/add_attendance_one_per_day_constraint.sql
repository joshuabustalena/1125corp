/*
  Kat's Sep 2026 request: an employee should only ever be able to check in
  ONCE per day. The app already tried to guard against this on the client
  (see confirmCapture's `records.some(...)` check in attendance/page.tsx),
  but that guard only looks at whatever the page already has loaded — it
  can't stop a race between two rapid taps, two devices, or a retry, which
  is exactly how Julie Ann Pendarlipe (and others) ended up with 8+ near-
  identical check-in rows for the same day (Kat's Discord screenshot,
  Sep 16 2026). A unique constraint is the only way to make "once per day"
  actually impossible rather than just discouraged.

  IMPORTANT — run this AFTER cleaning up existing duplicates, not before.
  A UNIQUE constraint can't be added while duplicate (employee_id, date)
  rows already exist; Postgres will reject it and name the conflict. Use
  the new Admin-only Delete button on the Attendance page to remove the
  extra rows for anyone currently duplicated (Julie Ann Pendarlipe, Carl
  Lhennon Del Mundo, Mia Lyn Maglaque per that screenshot, and whoever else
  the query below turns up) — for each person/day, keep one row (ideally
  one that already has both Time In and Time Out, if any of the duplicates
  do) and delete the rest.

  Run this first to see who's still duplicated before deleting anything:

    SELECT employee_id, date, count(*), array_agg(id) AS row_ids
    FROM attendance
    GROUP BY employee_id, date
    HAVING count(*) > 1;

  Once that returns zero rows, run the ALTER TABLE below.
*/

ALTER TABLE attendance
  ADD CONSTRAINT attendance_one_per_employee_per_day UNIQUE (employee_id, date);
