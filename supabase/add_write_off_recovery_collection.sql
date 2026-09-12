/*
  Kat's Sep 2026 follow-up on Write-Off: a collector should be able to
  record a recovery payment on an already-written-off loan the SAME way
  they record any other collection — pick it in the Payment Collection
  dialog on app/(app)/payments/page.tsx, same fields, same OR receipt —
  instead of needing admin-only access to /write-off/[id]. Loan details
  shown are identical; the only thing that has to differ is the accounting:
  the amount must never be counted as a receivable again, and it has to
  land in Miscellaneous Income, not Loans Receivable.

  Two schema changes make that possible:

  1. apply_loan_payment's balance update currently does
     `status = CASE WHEN v_new = 0 THEN 'paid' ELSE status END`. That's
     correct for a normal loan, but a written-off loan fully recovered to
     zero must STAY 'written_off' — flipping it to 'paid' would silently
     pull it out of the Write-Off tab (which filters on
     status = 'written_off') and drop it back into ordinary "paid loan"
     territory everywhere else, undoing the write-off itself. This was a
     dormant bug: nothing could reach it before now, since
     app/(app)/payments/page.tsx never offered a written-off loan for
     selection in the first place.

  2. remittances.is_write_off_recovery: field-collected payments never post
     to the ledger at collection time — see the comment in
     app/(app)/payments/page.tsx's handleSubmit — they wait until the
     Cashier records the collector's Remittance, which auto-credits Loans
     Receivable for the whole batch. A write-off recovery collected the
     same way must NOT be swept into that same Loans Receivable credit, so
     it's tracked as its own separate pool: payments against a
     status = 'written_off' loan are excluded from the normal
     collected/owed figures on app/(app)/remittance/page.tsx and shown
     instead as a separate "Write-Off Recovery Owed" balance, remitted with
     its own button that auto-credits Miscellaneous Income (4040) instead
     of Loans Receivable. This column tags which kind a given remittance
     row was, so that split can be reconstructed later (e.g. by
     supabase/rebuild_journal_entries.sql, which should credit Miscellaneous
     Income for any remittance row that has this flag set, not Loans
     Receivable — not yet updated there, since no recovery remittance has
     ever existed before this migration).

  Payments recorded directly on /write-off/[id] (the existing admin-only
  page — an office/walk-in recording, not a field collection) are
  unaffected: those never set payments.collector_id, and both the old and
  new remittance queries only ever sum rows that have one, so that path
  keeps posting its own immediate Debit Cash in Vault / Credit
  Miscellaneous Income entry exactly as before, with no double-count risk.

  Safe to re-run.
*/

CREATE OR REPLACE FUNCTION apply_loan_payment(p_loan_id uuid, p_amount numeric, p_idempotency_key uuid DEFAULT NULL)
RETURNS TABLE(previous_balance numeric, new_balance numeric, already_applied boolean)
LANGUAGE plpgsql
AS $$
DECLARE
  v_previous numeric;
  v_new      numeric;
  v_status   text;
  v_prior_previous numeric;
  v_prior_new      numeric;
BEGIN
  SELECT l.remaining_balance, l.status INTO v_previous, v_status FROM loans l WHERE l.id = p_loan_id FOR UPDATE;
  IF v_previous IS NULL THEN
    RAISE EXCEPTION 'Loan % not found', p_loan_id;
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT a.previous_balance, a.new_balance
      INTO v_prior_previous, v_prior_new
      FROM loan_payment_applications a
     WHERE a.idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN QUERY SELECT v_prior_previous, v_prior_new, true;
      RETURN;
    END IF;
  END IF;

  v_new := GREATEST(0, v_previous - p_amount);

  UPDATE loans
  -- A written-off loan stays 'written_off' no matter how far a recovery
  -- payment brings the balance down — see migration comment above.
  -- IS DISTINCT FROM (not <>) on purpose: loans.status has no NOT NULL
  -- constraint, and this function is callable directly (any authenticated
  -- user, not just through the app's own UI, which never sends a NULL
  -- status loan today) — <> against a NULL v_status would evaluate to
  -- NULL rather than true, silently falling through to the ELSE branch
  -- and leaving status NULL instead of 'paid', where the original
  -- (pre-write-off) version of this function always forced 'paid' here
  -- regardless of the loan's prior status.
  SET remaining_balance = v_new,
      status = CASE WHEN v_new = 0 AND v_status IS DISTINCT FROM 'written_off' THEN 'paid' ELSE v_status END
  WHERE id = p_loan_id;

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO loan_payment_applications (idempotency_key, loan_id, amount, previous_balance, new_balance)
    VALUES (p_idempotency_key, p_loan_id, p_amount, v_previous, v_new);
  END IF;

  RETURN QUERY SELECT v_previous, v_new, false;
END;
$$;

GRANT EXECUTE ON FUNCTION apply_loan_payment(uuid, numeric, uuid) TO authenticated;

-- "collection" (default, existing behavior) vs "write-off recovery" — see
-- migration comment above for why these two can never share one Loans
-- Receivable credit.
ALTER TABLE remittances ADD COLUMN IF NOT EXISTS is_write_off_recovery boolean NOT NULL DEFAULT false;
