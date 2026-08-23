/*
  Sequential Official Receipt numbers, replacing the old random
  `OR-{year}-{6 random digits}` generator.

  Why this was a problem
  ---------------------
  The random form drew from 900,000 values. At 529 receipts the
  birthday-paradox chance that some pair collides was already ~14%, and it
  grows quadratically — ~89% by 2,000 receipts. `receipts.or_number` is
  UNIQUE, so a collision could never corrupt data; it would simply reject
  the insert. But that failure is far worse for a payment collected OFFLINE:
  the borrower is handed a printed receipt at the doorstep, and the number on
  that paper is only checked against the database hours later at sync time.

  Numbering scheme
  ----------------
  `OR-{year}-{sequence padded to 6}` — e.g. OR-2026-000530. Every existing
  receipt's suffix is >= 100000 (that was the random generator's floor), so
  padded sequence values 000001..099999 cannot collide with any legacy
  number. That leaves 99,999 receipts of headroom before the two ranges
  would ever meet.

  Offline
  -------
  A sequence needs the database, but a collector with no signal still has to
  print a receipt on the spot. reserve_or_numbers() hands a device a BLOCK of
  numbers while it still has a connection; the client stores them and draws
  from that block offline. Because the sequence issued each number
  exclusively, no two devices can ever be holding the same one.

  Numbers reserved but never used become permanent gaps in the series. That
  is deliberate and safe — uniqueness is what matters here, and the previous
  random scheme had no gapless guarantee either.

  Run once in the Supabase SQL Editor. Safe to re-run.
*/

CREATE SEQUENCE IF NOT EXISTS receipt_or_number_seq START WITH 1 INCREMENT BY 1;

CREATE OR REPLACE FUNCTION next_or_number()
RETURNS text
LANGUAGE sql
AS $$
  SELECT 'OR-' || EXTRACT(YEAR FROM CURRENT_DATE)::int || '-' ||
         LPAD(nextval('receipt_or_number_seq')::text, 6, '0');
$$;

-- Draws p_count numbers in one round trip so a device can stock up before
-- heading into an area with no signal. Capped so a bug (or a stale retry
-- loop) can't burn through the series in a single call.
CREATE OR REPLACE FUNCTION reserve_or_numbers(p_count int)
RETURNS text[]
LANGUAGE plpgsql
AS $$
DECLARE
  v_out text[] := '{}';
  i int;
BEGIN
  IF p_count IS NULL OR p_count < 1 THEN
    RAISE EXCEPTION 'p_count must be at least 1';
  END IF;
  IF p_count > 200 THEN
    RAISE EXCEPTION 'p_count may not exceed 200 (asked for %)', p_count;
  END IF;

  FOR i IN 1..p_count LOOP
    v_out := array_append(
      v_out,
      'OR-' || EXTRACT(YEAR FROM CURRENT_DATE)::int || '-' ||
      LPAD(nextval('receipt_or_number_seq')::text, 6, '0')
    );
  END LOOP;

  RETURN v_out;
END;
$$;

GRANT USAGE, SELECT ON SEQUENCE receipt_or_number_seq TO authenticated;
GRANT EXECUTE ON FUNCTION next_or_number() TO authenticated;
GRANT EXECUTE ON FUNCTION reserve_or_numbers(int) TO authenticated;
