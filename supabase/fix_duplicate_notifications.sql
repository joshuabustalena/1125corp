/*
  Fixes duplicate "Overdue"/"Upcoming Due" alerts (Sep 10, 2026 report —
  the same loan getting the identical alert 10+ times, all "just now").

  Root cause: checkDueDateAlerts() (lib/due-date-alerts.ts) is a
  check-then-insert — it SELECTs existing alerts for a loan, and only
  INSERTs a new one if none exists yet. That's fine for one caller at a
  time, but it runs on every topbar mount for every signed-in user, with no
  database-level lock between the check and the insert. When many sessions
  call it back to back (exactly what happened right after
  fix_notifications_insert_policy.sql went live — every session that had
  been silently failing to insert for hours all became able to at once),
  each one's SELECT ran before any of the others' INSERT had landed, so
  each one independently concluded "no alert exists yet" and created its
  own — a classic check-then-insert race, not something a naive re-check
  in the same function actually closes.

  Fix, in two parts:
  1. De-duplicate what's already there — keep the oldest row per
     (loan_id, type), delete the rest. Uses ROW_NUMBER() over a single
     pass, not a self-join — a self-join of notifications against itself
     is the first version of this file, and it's slow/can hang on a table
     with as many duplicate rows as this bug produced (no index yet to
     support it at the point it runs, since the index below can't exist
     until the duplicates are already gone).
  2. A partial UNIQUE index on (loan_id, type), scoped to just the two
     alert types that are meant to be one-per-loan (other notifications —
     broadcasts, etc. — have loan_id NULL and are untouched by this). This
     is what actually closes the race: the database itself now refuses a
     second alert for the same loan+type no matter how many sessions try
     at once, instead of relying on application code to check first.

  App-side, checkDueDateAlerts()'s plain .insert() is changed to .upsert()
  with ignoreDuplicates so hitting this constraint is a silent no-op
  instead of a console error — see lib/due-date-alerts.ts.

  Wrapped in one transaction with an explicit table lock: the app is live
  and still actively re-triggering checkDueDateAlerts() right now (that's
  the whole bug), so a new duplicate can land in the gap between the
  DELETE finishing and CREATE UNIQUE INDEX starting if the two aren't run
  as one atomic step — which is exactly what happened on the first
  (unlocked) run of this file: CREATE UNIQUE INDEX failed because a fresh
  duplicate had already been inserted by some other session milliseconds
  after the DELETE committed. SHARE ROW EXCLUSIVE blocks other
  writers (INSERT/UPDATE/DELETE) for the few seconds this takes, but still
  allows concurrent reads — the notification bell keeps working for
  everyone else while this runs, nothing user-facing hangs.

  Safe to re-run.
*/

BEGIN;
LOCK TABLE notifications IN SHARE ROW EXCLUSIVE MODE;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY loan_id, type ORDER BY created_at ASC, id ASC
  ) AS rn
  FROM notifications
  WHERE loan_id IS NOT NULL AND type IN ('upcoming_due', 'overdue')
)
DELETE FROM notifications
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_loan_type_unique
  ON notifications(loan_id, type)
  WHERE loan_id IS NOT NULL AND type IN ('upcoming_due', 'overdue');

COMMIT;
