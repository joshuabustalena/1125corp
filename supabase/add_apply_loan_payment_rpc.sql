/*
  Fixes a real balance-corruption bug: posting a payment computed the new
  balance from whatever remaining_balance happened to already be sitting in
  the browser's local state (loaded once when the page opened), not the
  loan's actual current balance. If a collector posted a second payment on
  the same loan without the page re-fetching in between (or two people
  posted close together), the second payment's balance ended up computed
  against a stale, already-outdated number — e.g. balance correctly went
  280 -> 80 after one payment, but the very next payment recomputed from
  the old 280 instead of the new 80, writing a wrong 200 back to the loan.

  This function does the whole read-decrement-write as one atomic
  database operation (row-locked via FOR UPDATE), so it's always working
  off the true current balance no matter how stale the calling browser's
  local state is. Run once in the Supabase SQL Editor. Safe to re-run.
*/
CREATE OR REPLACE FUNCTION apply_loan_payment(p_loan_id uuid, p_amount numeric)
RETURNS TABLE(previous_balance numeric, new_balance numeric)
LANGUAGE plpgsql
AS $$
DECLARE
  v_previous numeric;
  v_new numeric;
BEGIN
  SELECT remaining_balance INTO v_previous FROM loans WHERE id = p_loan_id FOR UPDATE;
  IF v_previous IS NULL THEN
    RAISE EXCEPTION 'Loan % not found', p_loan_id;
  END IF;

  v_new := GREATEST(0, v_previous - p_amount);

  UPDATE loans
  SET remaining_balance = v_new,
      status = CASE WHEN v_new = 0 THEN 'paid' ELSE status END
  WHERE id = p_loan_id;

  RETURN QUERY SELECT v_previous, v_new;
END;
$$;

-- SECURITY INVOKER (the default) means this still runs under the calling
-- user's own RLS — a Field Collector/Cashier can only actually update a
-- loan they're already allowed to per the existing loans_update policy.
GRANT EXECUTE ON FUNCTION apply_loan_payment(uuid, numeric) TO authenticated;
