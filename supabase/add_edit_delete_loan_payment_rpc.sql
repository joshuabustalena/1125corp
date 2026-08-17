/*
  Extends the same fix as apply_loan_payment.sql (row-locked, atomic balance
  math) to cover editing and deleting a payment — those two flows were still
  doing the old read-in-JS-then-write pattern, which meant they could still
  corrupt remaining_balance under concurrency the same way posting a new
  payment used to. Run once in the Supabase SQL Editor. Safe to re-run.
*/

-- Postgres won't let CREATE OR REPLACE change a function's return columns
-- (only the body) — dropping first makes this safe to re-run regardless of
-- what shape an earlier version of this function was left in.
DROP FUNCTION IF EXISTS edit_loan_payment(uuid, numeric, date);
DROP FUNCTION IF EXISTS delete_loan_payment(uuid);

CREATE OR REPLACE FUNCTION edit_loan_payment(p_payment_id uuid, p_new_amount numeric, p_new_date date)
RETURNS TABLE(out_loan_id uuid, new_balance numeric, new_status text)
LANGUAGE plpgsql
AS $$
DECLARE
  v_loan_id uuid;
  v_old_amount numeric;
  v_receipt_id uuid;
  v_current_balance numeric;
  v_status text;
  v_delta numeric;
  v_new_balance numeric;
  v_new_status text;
BEGIN
  -- Locked too, not just the loan row — without this, a second concurrent
  -- edit on this exact same payment could read amount_paid from before the
  -- first edit's commit, computing its delta off a stale old amount and
  -- writing a wrong balance even though the loan row above is locked.
  SELECT loan_id, amount_paid, receipt_id INTO v_loan_id, v_old_amount, v_receipt_id
  FROM payments WHERE id = p_payment_id FOR UPDATE;
  IF v_loan_id IS NULL THEN
    RAISE EXCEPTION 'Payment % not found', p_payment_id;
  END IF;

  SELECT remaining_balance, status INTO v_current_balance, v_status FROM loans WHERE id = v_loan_id FOR UPDATE;

  v_delta := p_new_amount - v_old_amount;
  v_new_balance := GREATEST(0, v_current_balance - v_delta);
  -- A balance that drops to 0 marks the loan paid; a balance that moves back
  -- above 0 (amount was reduced) reopens a loan that had been marked paid —
  -- same status logic apply_loan_payment already uses.
  v_new_status := CASE
    WHEN v_new_balance = 0 THEN 'paid'
    WHEN v_status = 'paid' THEN 'active'
    ELSE v_status
  END;

  UPDATE payments SET amount_paid = p_new_amount, payment_date = p_new_date, remaining_balance = v_new_balance
  WHERE id = p_payment_id;

  IF v_receipt_id IS NOT NULL THEN
    UPDATE receipts SET amount = p_new_amount, payment_date = p_new_date, remaining_balance = v_new_balance
    WHERE id = v_receipt_id;
  END IF;

  UPDATE loans SET remaining_balance = v_new_balance, status = v_new_status WHERE id = v_loan_id;

  RETURN QUERY SELECT v_loan_id, v_new_balance, v_new_status;
END;
$$;

CREATE OR REPLACE FUNCTION delete_loan_payment(p_payment_id uuid)
RETURNS TABLE(out_loan_id uuid, new_balance numeric, new_status text)
LANGUAGE plpgsql
AS $$
DECLARE
  v_loan_id uuid;
  v_amount numeric;
  v_receipt_id uuid;
  v_current_balance numeric;
  v_status text;
  v_new_balance numeric;
  v_new_status text;
BEGIN
  -- Same reasoning as edit_loan_payment: lock the payment row itself too,
  -- not just the loan, so a concurrent edit/delete on this exact payment
  -- can't be read here with a stale amount.
  SELECT loan_id, amount_paid, receipt_id INTO v_loan_id, v_amount, v_receipt_id
  FROM payments WHERE id = p_payment_id FOR UPDATE;
  IF v_loan_id IS NULL THEN
    RAISE EXCEPTION 'Payment % not found', p_payment_id;
  END IF;

  SELECT remaining_balance, status INTO v_current_balance, v_status FROM loans WHERE id = v_loan_id FOR UPDATE;

  v_new_balance := v_current_balance + v_amount;
  v_new_status := CASE WHEN v_status = 'paid' THEN 'active' ELSE v_status END;

  DELETE FROM payments WHERE id = p_payment_id;
  IF v_receipt_id IS NOT NULL THEN
    DELETE FROM receipts WHERE id = v_receipt_id;
  END IF;

  UPDATE loans SET remaining_balance = v_new_balance, status = v_new_status WHERE id = v_loan_id;

  RETURN QUERY SELECT v_loan_id, v_new_balance, v_new_status;
END;
$$;

-- SECURITY INVOKER (the default) — both still run under the calling user's
-- own RLS, same as apply_loan_payment.
GRANT EXECUTE ON FUNCTION edit_loan_payment(uuid, numeric, date) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_loan_payment(uuid) TO authenticated;
