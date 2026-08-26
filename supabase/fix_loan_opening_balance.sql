/*
  Corrects the opening balance used when a loan's payment history is rebuilt.

  THE BUG — and it is mine
  ------------------------
  supabase/fix_payment_running_balance.sql introduced
  resequence_loan_payment_balances(), which rebuilds every payment's running
  balance. It started the running total at total_payable:

      v_running := v_total_payable;

  That is wrong. At release, the day-one payment is withheld from the
  proceeds — the borrower never receives it — so the loan starts at
  total_payable MINUS that withheld amount, which is exactly what the
  disbursement code does:

      remaining_balance: totalPayable - firstDayAmount

  Starting from the full total_payable silently adds the day-one payment back
  onto what the borrower owes. Effects on live data:

    - 134 of 149 active loans have payment snapshots that are one day's
      payment too high (from the one-time repair in that migration).
    - 15 loans have a wrong loans.remaining_balance — those are the ones where
      an edit or delete has run since, because only those paths write the loan
      row. Borrowers there are being asked for more than they owe.

  WHY THE WITHHELD AMOUNT IS DERIVED, NOT READ FROM daily_payment
  ---------------------------------------------------------------
  daily_payment says what SHOULD have been withheld. What actually was is
  amount - release_amount - offset_balance - service_fee. On six renewals from
  12-14 Aug those disagree: the day-one payment was never withheld from the
  proceeds even though the Loan Agreement lists it, so the borrower received
  more cash. Deriving from release_amount keeps every loan faithful to the
  money that actually moved, and makes the two groups of error — balances too
  high AND too low — come out right in one pass.

  Not disbursed yet, or no release recorded: opening balance is total_payable,
  since nothing has been withheld.

  Runs in one transaction with a verification step; if anything still fails to
  reconcile afterwards it raises and the whole thing rolls back.
*/

CREATE OR REPLACE FUNCTION loan_opening_balance(p_loan_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT GREATEST(
    0,
    coalesce(l.total_payable, 0) - CASE
      WHEN l.disbursed_at IS NULL OR coalesce(l.release_amount, 0) = 0 THEN 0
      ELSE GREATEST(0, coalesce(l.amount, 0)
                     - coalesce(l.release_amount, 0)
                     - coalesce(l.offset_balance, 0)
                     - coalesce(l.service_fee, 0))
    END
  )
  FROM loans l WHERE l.id = p_loan_id;
$$;

-- Same function as before, but starting from the real opening balance.
CREATE OR REPLACE FUNCTION resequence_loan_payment_balances(p_loan_id uuid)
RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE
  v_running numeric;
  r RECORD;
BEGIN
  SELECT loan_opening_balance(p_loan_id) INTO v_running;
  IF v_running IS NULL THEN
    RAISE EXCEPTION 'Loan % not found', p_loan_id;
  END IF;

  FOR r IN
    SELECT id, amount_paid, receipt_id
    FROM payments
    WHERE loan_id = p_loan_id
    ORDER BY payment_date ASC, created_at ASC
  LOOP
    v_running := GREATEST(0, v_running - coalesce(r.amount_paid, 0));
    UPDATE payments SET remaining_balance = v_running WHERE id = r.id;
    IF r.receipt_id IS NOT NULL THEN
      UPDATE receipts SET remaining_balance = v_running WHERE id = r.receipt_id;
    END IF;
  END LOOP;

  RETURN v_running;
END;
$$;

GRANT EXECUTE ON FUNCTION loan_opening_balance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION resequence_loan_payment_balances(uuid) TO authenticated;

BEGIN;

DO $repair$
DECLARE
  rec RECORD;
  v_final numeric;
  v_snapshots int := 0;
  v_balances  int := 0;
  v_left      int;
BEGIN
  FOR rec IN
    SELECT id, loan_number, status, remaining_balance FROM loans
  LOOP
    v_final := resequence_loan_payment_balances(rec.id);
    v_snapshots := v_snapshots + 1;

    -- A renewed loan is deliberately zeroed: its balance was carried into the
    -- replacement loan as offset_balance, so it must NOT be recomputed here.
    IF rec.status <> 'renewed' AND abs(coalesce(rec.remaining_balance, 0) - v_final) > 0.01 THEN
      UPDATE loans
      SET remaining_balance = v_final,
          status = CASE WHEN v_final = 0 AND status = 'active' THEN 'paid'
                        WHEN v_final > 0 AND status = 'paid'   THEN 'active'
                        ELSE status END
      WHERE id = rec.id;
      v_balances := v_balances + 1;
      RAISE NOTICE 'loan % : balance % -> %', rec.loan_number, rec.remaining_balance, v_final;
    END IF;
  END LOOP;

  RAISE NOTICE 'resequenced % loan(s); corrected % balance(s)', v_snapshots, v_balances;

  -- Nothing may remain out of step.
  -- Aliased lo, not l: the loop RECORD above is named rec precisely because
  -- PL/pgSQL resolves a bare l.status to a variable before a column, which is
  -- what raised "column reference is ambiguous" on the first run.
  SELECT count(*) INTO v_left
  FROM loans lo
  WHERE lo.status <> 'renewed'
    AND coalesce(lo.remaining_balance, 0) <> 0
    AND abs(coalesce(lo.remaining_balance, 0)
            - GREATEST(0, loan_opening_balance(lo.id)
               - coalesce((SELECT sum(amount_paid) FROM payments p WHERE p.loan_id = lo.id), 0))) > 0.01;
  IF v_left > 0 THEN
    RAISE EXCEPTION '% loan(s) still do not reconcile - rolling back', v_left;
  END IF;
END;
$repair$;

COMMIT;

-- Confirmation: must return 0.
SELECT count(*) AS loans_still_out_of_step
FROM loans lo
WHERE lo.status <> 'renewed'
  AND coalesce(lo.remaining_balance, 0) <> 0
  AND abs(coalesce(lo.remaining_balance, 0)
          - GREATEST(0, loan_opening_balance(lo.id)
             - coalesce((SELECT sum(amount_paid) FROM payments p WHERE p.loan_id = lo.id), 0))) > 0.01;
