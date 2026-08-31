/*
  Removes duplicate rows from the Holiday Calendar.

  92 rows existed for what should have been 11 distinct holidays — the same
  seed INSERT (supabase/migrations/20260710234014_create_core_schema.sql)
  was re-run against the live database multiple times in July, and nothing
  stopped it from inserting the same (date, name) pair again each time.
  10 of the 11 holidays had 9-10 duplicate rows apiece; only Ninoy Aquino
  Day (2026-08-21, the one Special holiday seeded) was never duplicated.

  Keeps the OLDEST row per (holiday_date, name) — matches what's shown in
  the UI today (Settings > Holidays lists them ordered by date, one per
  date, since duplicates render identically and are indistinguishable on
  screen) — and deletes the rest. A unique index is then added so the same
  seed script can safely be re-run in the future without creating this
  again (ON CONFLICT DO NOTHING would then apply instead of inserting a
  duplicate).

  Nothing references holidays.id as a foreign key (payroll doesn't join to
  it yet), so deleting the extra rows is safe with no cleanup elsewhere
  needed.
*/

BEGIN;

DELETE FROM holidays h
WHERE h.id NOT IN (
  SELECT DISTINCT ON (holiday_date, name) id
  FROM holidays
  ORDER BY holiday_date, name, created_at ASC
);

-- Guards against the same seed running twice again in the future.
CREATE UNIQUE INDEX IF NOT EXISTS holidays_date_name_uidx ON holidays (holiday_date, name);

COMMIT;

-- Confirmation: should show exactly 11 rows, no duplicates.
SELECT holiday_date, name, type, is_custom FROM holidays ORDER BY holiday_date;
