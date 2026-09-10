/*
  Second batch of double-submit-bug corrections — Sep 10, 2026 (Query 2 of
  diagnose_double_submit_impact.sql), root-caused to the same-day
  notifications table overload (missing index + blocked RLS insert; see
  add_notifications_created_at_index.sql / fix_notifications_insert_policy.sql):
  under that DB load, apply_loan_payment's balance UPDATE could commit
  server-side while the client still got back a genuine error, and the
  collector's manual retry (a fresh idempotency key) then applied the same
  payment a second time. Now that the underlying DB issue is fixed, this
  shouldn't recur — see the retry-with-same-key hardening in
  app/(app)/payments/page.tsx (callApplyLoanPaymentWithRetry).

  Same fix as fix_double_submit_victims.sql: resequence_loan_payment_balances()
  (supabase/fix_payment_running_balance.sql) derives the one true balance —
  total_payable minus every real payment, in order — for each loan below,
  and this script stamps that result onto loans.remaining_balance too
  (its normal callers don't need to; this bug corrupted the loan-level
  balance itself, unlike the bug that function was originally built for).

  Unlike the first batch (Jenalyn/Analyn), none of these four have been
  hand-edited by Kat yet, so loans.remaining_balance and the last payment's
  own snapshot should currently agree with each other — just both wrong by
  the same doubled amount. Resequencing fixes both in one pass regardless.

  Matias Dacuba shows up twice in Query 2 (two flagged payments on the same
  loan) — no special handling needed, resequencing walks his whole payment
  history in order and corrects it in one pass same as the others.

  Read-only preview first:

    SELECT id, loan_number, remaining_balance AS current_balance, total_payable
    FROM loans
    WHERE id IN ('0b7a8947-6300-46b3-8f01-53fac71cb069',
                 '1c8a9342-e4a9-4a7c-8543-ce6510099c85',
                 '7e42188a-36b8-4e89-b63a-de1d81b1a742',
                 'd957e775-2dc0-468c-ad1a-6630eb88e3ee');

  Safe to re-run.
*/

DO $$
DECLARE
  v_loan_id uuid;
  v_status text;
  v_new_balance numeric;
  v_new_status text;
BEGIN
  FOREACH v_loan_id IN ARRAY ARRAY[
    '0b7a8947-6300-46b3-8f01-53fac71cb069'::uuid, -- Elma Valerio, LN-2026-58812
    '1c8a9342-e4a9-4a7c-8543-ce6510099c85'::uuid, -- Matias Dacuba, LN-2026-70059
    '7e42188a-36b8-4e89-b63a-de1d81b1a742'::uuid, -- Jennylyn Senolos, LN-2026-59557
    'd957e775-2dc0-468c-ad1a-6630eb88e3ee'::uuid  -- Jirah Mustre, LN-2026-61250
  ]
  LOOP
    SELECT status INTO v_status FROM loans WHERE id = v_loan_id FOR UPDATE;
    IF v_status IS NULL THEN
      RAISE NOTICE 'Loan % not found — skipped', v_loan_id;
      CONTINUE;
    END IF;

    v_new_balance := resequence_loan_payment_balances(v_loan_id);
    v_new_status := CASE
      WHEN v_new_balance = 0 THEN 'paid'
      WHEN v_status = 'paid' THEN 'active'
      ELSE v_status
    END;

    UPDATE loans SET remaining_balance = v_new_balance, status = v_new_status
    WHERE id = v_loan_id;

    RAISE NOTICE 'Loan % corrected -> balance %, status %', v_loan_id, v_new_balance, v_new_status;
  END LOOP;
END $$;

-- Verify after running:
-- SELECT id, loan_number, remaining_balance, status FROM loans
-- WHERE id IN ('0b7a8947-6300-46b3-8f01-53fac71cb069', '1c8a9342-e4a9-4a7c-8543-ce6510099c85',
--              '7e42188a-36b8-4e89-b63a-de1d81b1a742', 'd957e775-2dc0-468c-ad1a-6630eb88e3ee');
