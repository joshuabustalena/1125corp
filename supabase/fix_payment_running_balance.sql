/*
  Fixes the "loan balance" bug reported from Payment History: two payments
  showing the same balance, and an older payment showing a balance that only
  makes sense for a much later point in the loan.

  Root cause
  ----------
  payments.remaining_balance is a HISTORICAL SNAPSHOT — the loan's running
  balance as of that one payment. But edit_loan_payment stamped the loan's
  *current* (post-everything) balance onto the edited row:

      UPDATE payments SET ..., remaining_balance = v_new_balance
      WHERE id = p_payment_id;

  So editing an old payment rewrote its snapshot with today's balance, and
  delete_loan_payment never touched the other rows at all — every payment
  after a deleted one kept a snapshot that no longer matched reality.

  The loan's own remaining_balance was always right; only the per-payment
  history was wrong, which is why this looked like a display-only oddity.

  Fix
  ---
  A single resequence_loan_payment_balances(loan) helper recomputes every
  payment's snapshot from total_payable downward in ledger order, and both
  RPCs call it after mutating. Also repairs existing bad rows once, at the
  bottom of this file.

  Run once in the Supabase SQL Editor. Safe to re-run.
*/

-- Ledger order is (payment_date, created_at): payment_date is what the
-- Payment History report sorts and prints by, with created_at breaking ties
-- for two payments recorded on the same day. Rebuilding in this order keeps
-- the printed running balance monotonic down the page, which is the whole
-- point of the column.
CREATE OR REPLACE FUNCTION resequence_loan_payment_balances(p_loan_id uuid)
RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE
  v_total_payable numeric;
  v_running numeric;
  r RECORD;
BEGIN
  SELECT total_payable INTO v_total_payable FROM loans WHERE id = p_loan_id;
  IF v_total_payable IS NULL THEN
    RAISE EXCEPTION 'Loan % not found', p_loan_id;
  END IF;

  v_running := v_total_payable;

  FOR r IN
    SELECT id, amount_paid, receipt_id
    FROM payments
    WHERE loan_id = p_loan_id
    ORDER BY payment_date ASC, created_at ASC
  LOOP
    -- Clamped at 0 the same way apply_loan_payment clamps, so an overpayment
    -- settles the loan rather than driving the history negative.
    v_running := GREATEST(0, v_running - COALESCE(r.amount_paid, 0));

    UPDATE payments SET remaining_balance = v_running WHERE id = r.id;
    IF r.receipt_id IS NOT NULL THEN
      UPDATE receipts SET remaining_balance = v_running WHERE id = r.receipt_id;
    END IF;
  END LOOP;

  RETURN v_running;
END;
$$;

-- Signatures are unchanged, but dropping first keeps this file safe to re-run
-- against whatever shape an earlier version left behind.
DROP FUNCTION IF EXISTS edit_loan_payment(uuid, numeric, date);
DROP FUNCTION IF EXISTS delete_loan_payment(uuid);

CREATE OR REPLACE FUNCTION edit_loan_payment(p_payment_id uuid, p_new_amount numeric, p_new_date date)
RETURNS TABLE(out_loan_id uuid, new_balance numeric, new_status text)
LANGUAGE plpgsql
AS $$
DECLARE
  v_loan_id uuid;
  v_receipt_id uuid;
  v_status text;
  v_new_balance numeric;
  v_new_status text;
BEGIN
  SELECT loan_id, receipt_id INTO v_loan_id, v_receipt_id
  FROM payments WHERE id = p_payment_id FOR UPDATE;
  IF v_loan_id IS NULL THEN
    RAISE EXCEPTION 'Payment % not found', p_payment_id;
  END IF;

  SELECT status INTO v_status FROM loans WHERE id = v_loan_id FOR UPDATE;

  -- Write the new amount/date first, then let the resequence pass derive
  -- every balance from scratch. Deriving beats the old delta arithmetic:
  -- it can't drift, and it repairs any snapshot an earlier bug corrupted.
  UPDATE payments SET amount_paid = p_new_amount, payment_date = p_new_date
  WHERE id = p_payment_id;
  IF v_receipt_id IS NOT NULL THEN
    UPDATE receipts SET amount = p_new_amount, payment_date = p_new_date
    WHERE id = v_receipt_id;
  END IF;

  v_new_balance := resequence_loan_payment_balances(v_loan_id);

  v_new_status := CASE
    WHEN v_new_balance = 0 THEN 'paid'
    WHEN v_status = 'paid' THEN 'active'
    ELSE v_status
  END;

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
  v_receipt_id uuid;
  v_status text;
  v_new_balance numeric;
  v_new_status text;
BEGIN
  SELECT loan_id, receipt_id INTO v_loan_id, v_receipt_id
  FROM payments WHERE id = p_payment_id FOR UPDATE;
  IF v_loan_id IS NULL THEN
    RAISE EXCEPTION 'Payment % not found', p_payment_id;
  END IF;

  SELECT status INTO v_status FROM loans WHERE id = v_loan_id FOR UPDATE;

  DELETE FROM payments WHERE id = p_payment_id;
  IF v_receipt_id IS NOT NULL THEN
    DELETE FROM receipts WHERE id = v_receipt_id;
  END IF;

  -- Every payment AFTER the deleted one had a stale snapshot before; the
  -- resequence pass is what makes deletion safe in the middle of a history.
  v_new_balance := resequence_loan_payment_balances(v_loan_id);

  v_new_status := CASE WHEN v_new_balance = 0 THEN 'paid'
                       WHEN v_status = 'paid' THEN 'active'
                       ELSE v_status END;

  UPDATE loans SET remaining_balance = v_new_balance, status = v_new_status WHERE id = v_loan_id;

  RETURN QUERY SELECT v_loan_id, v_new_balance, v_new_status;
END;
$$;

GRANT EXECUTE ON FUNCTION resequence_loan_payment_balances(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION edit_loan_payment(uuid, numeric, date) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_loan_payment(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- One-time repair of history corrupted by the old behaviour.
--
-- Only per-payment snapshots are rewritten. loans.remaining_balance is
-- deliberately NOT touched here: it was always correct (it equals
-- total_payable minus the sum of payments), and rewriting live loan balances
-- from a migration is far riskier than fixing the display column.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  l RECORD;
  v_fixed int := 0;
BEGIN
  FOR l IN SELECT DISTINCT loan_id FROM payments WHERE loan_id IS NOT NULL LOOP
    PERFORM resequence_loan_payment_balances(l.loan_id);
    v_fixed := v_fixed + 1;
  END LOOP;
  RAISE NOTICE 'Resequenced payment history for % loan(s)', v_fixed;
END;
$$;
