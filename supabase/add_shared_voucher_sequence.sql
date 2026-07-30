/*
  Shared sequential voucher numbering — run once in the Supabase SQL Editor.
  Safe to re-run (idempotent).

  The client wants every cash voucher (loan release, gas allowance,
  payroll, 13th month, and the general cash voucher) to draw from ONE
  shared incrementing sequence — e.g. 1-1391, then 1-1392 next, regardless
  of which voucher type generated it — instead of each type having its own
  independent randomly-suffixed code. A Postgres sequence guarantees no two
  concurrent "Generate" clicks (even across different branches/users) ever
  get the same number.

  Starts at 1 — this is a new digital sequence, not a continuation of the
  company's old paper-voucher numbering (those numbers can't be reliably
  known/synced from here).
*/

CREATE SEQUENCE IF NOT EXISTS cash_voucher_number_seq START WITH 1;

CREATE OR REPLACE FUNCTION next_cash_voucher_number()
RETURNS text
LANGUAGE sql
AS $$
  SELECT '1-' || nextval('cash_voucher_number_seq')::text;
$$;
