/*
  Third batch of double-submit-bug corrections — Sep 11, 2026 (Query 2 of
  diagnose_double_submit_impact.sql).

  Carmen Valenzuela: new victim today.
  Matias Dacuba: hit AGAIN — already corrected once in
  fix_double_submit_victims_sep10.sql, but a second, separate incident on
  the same loan today reintroduced the same phantom-deduction pattern.

  Root cause for both: the retry-with-same-key hardening added Sep 10
  (callApplyLoanPaymentWithRetry) only closed the gap for "looks like a
  network failure" errors — a genuine Postgres error (a statement timeout,
  a dropped connection mid-RPC) after all 3 retries still fell through to
  a plain error toast that discarded the idempotency key, leaving the
  collector to tap Submit again with a fresh one. That's exactly what a
  Postgres-coded error under DB load is: not proof the balance UPDATE
  never committed server-side. Now fixed in app/(app)/payments/page.tsx —
  every apply_loan_payment failure, not just network-looking ones, queues
  with the same key instead of discarding it.

  Same resequence_loan_payment_balances() fix as the two earlier batches —
  see fix_double_submit_victims.sql for the full explanation of why this is
  the right tool (derives the one true balance from total_payable and every
  real payment, rather than trusting either stale snapshot).

  Read-only preview first:

    SELECT id, loan_number, remaining_balance AS current_balance, total_payable
    FROM loans
    WHERE id IN ('1c8a9342-e4a9-4a7c-8543-ce6510099c85',
                 '4e7cb474-ed66-48a6-bfb3-edacb0c873fd');

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
    '1c8a9342-e4a9-4a7c-8543-ce6510099c85'::uuid, -- Matias Dacuba, LN-2026-70059 (2nd incident)
    '4e7cb474-ed66-48a6-bfb3-edacb0c873fd'::uuid  -- Carmen Valenzuela, LN-2026-21760...
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
-- WHERE id IN ('1c8a9342-e4a9-4a7c-8543-ce6510099c85', '4e7cb474-ed66-48a6-bfb3-edacb0c873fd');
