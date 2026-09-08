/*
  Corrects the loans confirmed (via supabase/diagnose_double_submit_impact.sql,
  all 3 checks) to actually carry the double-submit bug's damage. Two
  different shapes, two different fixes:

  1. Jenalyn Balasa and Analyn Celorico — a "phantom" extra deduction: the
     loan's remaining_balance got decremented twice, but only ONE
     payment/receipt row exists. Query 1 showed their loans.remaining_balance
     had already been hand-edited (by Kat) back to something close to right,
     but the payments table's own snapshot on that one row was still stale —
     which is why the Payment History screen kept showing the wrong number
     ("hindi talaga nagreflect"). Rather than trust either the stale
     snapshot or the hand-edit, this recomputes the one true answer —
     total_payable minus every real payment, in order — using
     resequence_loan_payment_balances(), the exact same helper
     edit_loan_payment/delete_loan_payment already rely on
     (supabase/fix_payment_running_balance.sql). That function only ever
     touches the payments/receipts snapshot columns (it was built for a bug
     where the loan balance was already correct); this bug also corrupted
     loans.remaining_balance itself, so this script additionally stamps its
     result onto the loan row — the one thing its normal callers don't need
     to do.

  2. Nora Zuniga is NOT handled here. Her case is a genuine duplicate ROW
     (two real ₱400 payments, 23 seconds apart) rather than a phantom
     deduction with no matching row — the right tool for that is the
     existing "Delete Payment" button on her loan's detail page
     (/loans/[id]), which calls delete_loan_payment and already resequences
     everything correctly. Safer to go through the same tested UI path than
     a raw SQL DELETE here.

  Read-only preview first (run this block alone and check the numbers before
  running the UPDATE below):

    SELECT id, loan_number, remaining_balance AS current_balance,
           total_payable
    FROM loans
    WHERE id IN ('49178c1d-da20-4260-b40c-26c4ea83fb9c',
                 'e251dce6-52a8-484d-9d0c-a4b541e5aa05');

  Safe to re-run — resequencing is idempotent.
*/

DO $$
DECLARE
  v_loan_id uuid;
  v_status text;
  v_new_balance numeric;
  v_new_status text;
BEGIN
  FOREACH v_loan_id IN ARRAY ARRAY[
    '49178c1d-da20-4260-b40c-26c4ea83fb9c'::uuid, -- Jenalyn Balasa, LN-2026-18321...
    'e251dce6-52a8-484d-9d0c-a4b541e5aa05'::uuid  -- Analyn Celorico, LN-2026-47922
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
-- WHERE id IN ('49178c1d-da20-4260-b40c-26c4ea83fb9c', 'e251dce6-52a8-484d-9d0c-a4b541e5aa05');
