/*
  Collection List — printable per-collector worksheet (Borrower Name, Date
  Released, Due Date, Amount Release, Amount Delayed/Overdue, Daily
  Payment, Balance, blank Payment Received column) that a Cashier prints
  every morning for each field collector to carry — no new table needed,
  it's generated straight from `loans`/`customers`. Run once in the
  Supabase SQL Editor. Safe to re-run (idempotent).
*/
UPDATE roles SET permissions = permissions || '["collection_list"]'::jsonb
WHERE name = 'Cashier' AND NOT permissions @> '["collection_list"]'::jsonb;
