/*
  Makes apply_loan_payment write the receipt AND payment row in the SAME
  database transaction as the balance update, instead of the client doing
  three separate round-trips (RPC, then a receipts insert, then a payments
  insert) that a dropped connection can get cut off between.

  WHY THIS EXISTS — Maricor Tanjoco's loan (LN-2026-956066), twice now
  (Sep 17 and Sep 23, 2026): a collector taps Confirm, this RPC runs and
  genuinely decrements the balance, but the app never gets to actually
  write the receipt/payment row afterward (the phone loses signal, the tab
  gets backgrounded — anything that kills the JS mid-flight). Nothing
  throws, so none of the app's own error handling ever fires; the
  collector just sees no confirmation and, understandably, records the
  same real-world cash collection again later — which is how the same
  ₱200 ended up debited from her balance twice with only one receipt to
  show for it. Kat traced the actual field behavior: "wala lumalabas na
  encode kaya resibo siya uli" — no confirmation shown, so they re-enter
  it. The fix isn't a better confirmation message (the app never reaches
  the point of showing one in this exact failure) — it's removing the gap
  a client-side interruption can land in at all. Once balance-update and
  receipt/payment-write are one atomic statement, they can no longer
  happen as separate steps for anything to get cut off between: either the
  whole thing commits together, or none of it does, and the existing
  idempotency-key retry path (already handles "did my last attempt actually
  land") covers the rest.

  BACKWARD COMPATIBLE: every new parameter defaults to NULL. Passing none
  of them (p_or_number NULL) behaves exactly like the current function —
  balance-only, no receipt/payment write — so this doesn't require every
  caller to change at once. Only app/(app)/payments/page.tsx (the online
  submit and the offline-queue sync) is updated to pass them, in this same
  session.

  The existing 3-argument overload is DROPPED first rather than left
  alongside a new one — two overloads differing only in trailing optional
  parameters risks PostgREST resolving an ambiguous call incorrectly.
  Keeping exactly one version, with everything optional, is unambiguous
  and just as backward compatible.

  Safe to re-run.
*/

DROP FUNCTION IF EXISTS apply_loan_payment(uuid, numeric, uuid);

CREATE OR REPLACE FUNCTION apply_loan_payment(
  p_loan_id uuid,
  p_amount numeric,
  p_idempotency_key uuid DEFAULT NULL,
  -- When p_or_number is NULL (the default), this behaves exactly like the
  -- old balance-only function — nothing below runs. Pass it (and the rest)
  -- to also write the receipt + payment row atomically.
  p_or_number text DEFAULT NULL,
  p_customer_id uuid DEFAULT NULL,
  p_collector_id uuid DEFAULT NULL,
  p_payment_date date DEFAULT NULL,
  p_payment_time time DEFAULT NULL,
  p_gps_lat numeric DEFAULT NULL,
  p_gps_lng numeric DEFAULT NULL,
  p_location_address text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS TABLE(previous_balance numeric, new_balance numeric, already_applied boolean, receipt_id uuid, payment_id uuid)
LANGUAGE plpgsql
AS $$
DECLARE
  v_previous numeric;
  v_new      numeric;
  v_status   text;
  v_loan_number text;
  v_prior_previous numeric;
  v_prior_new      numeric;
  v_receipt_id uuid;
  v_payment_id uuid;
BEGIN
  SELECT l.remaining_balance, l.status, l.loan_number INTO v_previous, v_status, v_loan_number
  FROM loans l WHERE l.id = p_loan_id FOR UPDATE;
  IF v_previous IS NULL THEN
    RAISE EXCEPTION 'Loan % not found', p_loan_id;
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT a.previous_balance, a.new_balance
      INTO v_prior_previous, v_prior_new
      FROM loan_payment_applications a
     WHERE a.idempotency_key = p_idempotency_key;
    IF FOUND THEN
      -- Balance for this exact attempt was already applied on an earlier
      -- try — but the receipt/payment write might still be missing (a
      -- lost response after that earlier attempt's balance update
      -- committed, same class of gap this whole change exists to close).
      -- Check, and write it now if genuinely still missing, before
      -- returning — this is what makes a retried sync eventually
      -- self-heal a previously-interrupted attempt instead of leaving it
      -- stuck as a balance-only ghost forever.
      SELECT p.id INTO v_payment_id FROM payments p WHERE p.idempotency_key = p_idempotency_key;
      IF v_payment_id IS NULL AND p_or_number IS NOT NULL THEN
        INSERT INTO receipts (or_number, loan_id, customer_id, collector_id, amount, remaining_balance, payment_date, qr_data)
        VALUES (p_or_number, p_loan_id, p_customer_id, p_collector_id, p_amount, v_prior_new, COALESCE(p_payment_date, CURRENT_DATE),
                json_build_object('or', p_or_number, 'loan', v_loan_number, 'amount', p_amount)::text)
        RETURNING id INTO v_receipt_id;

        INSERT INTO payments (loan_id, customer_id, collector_id, receipt_id, idempotency_key, amount_paid, principal, interest, penalty, remaining_balance, payment_date, payment_time, gps_lat, gps_lng, location_address, notes)
        VALUES (p_loan_id, p_customer_id, p_collector_id, v_receipt_id, p_idempotency_key, p_amount, 0, 0, 0, v_prior_new, COALESCE(p_payment_date, CURRENT_DATE), p_payment_time, p_gps_lat, p_gps_lng, p_location_address, p_notes)
        RETURNING id INTO v_payment_id;
      END IF;
      RETURN QUERY SELECT v_prior_previous, v_prior_new, true, v_receipt_id, v_payment_id;
      RETURN;
    END IF;
  END IF;

  v_new := GREATEST(0, v_previous - p_amount);

  -- A written-off loan stays 'written_off' no matter how far a recovery
  -- payment brings the balance down (see add_write_off_recovery_collection.sql).
  -- IS DISTINCT FROM, not <>, so a NULL status can't silently fall through.
  UPDATE loans
  SET remaining_balance = v_new,
      status = CASE WHEN v_new = 0 AND v_status IS DISTINCT FROM 'written_off' THEN 'paid' ELSE v_status END
  WHERE id = p_loan_id;

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO loan_payment_applications (idempotency_key, loan_id, amount, previous_balance, new_balance)
    VALUES (p_idempotency_key, p_loan_id, p_amount, v_previous, v_new);
  END IF;

  -- The atomic part: same transaction as the balance UPDATE above — either
  -- both the balance change AND this receipt/payment commit together, or
  -- (on any error, including a dropped connection before COMMIT) neither
  -- does. There is no longer a window between "balance moved" and
  -- "receipt exists" for a client to get cut off inside.
  IF p_or_number IS NOT NULL THEN
    INSERT INTO receipts (or_number, loan_id, customer_id, collector_id, amount, remaining_balance, payment_date, qr_data)
    VALUES (p_or_number, p_loan_id, p_customer_id, p_collector_id, p_amount, v_new, COALESCE(p_payment_date, CURRENT_DATE),
            json_build_object('or', p_or_number, 'loan', v_loan_number, 'amount', p_amount)::text)
    RETURNING id INTO v_receipt_id;

    INSERT INTO payments (loan_id, customer_id, collector_id, receipt_id, idempotency_key, amount_paid, principal, interest, penalty, remaining_balance, payment_date, payment_time, gps_lat, gps_lng, location_address, notes)
    VALUES (p_loan_id, p_customer_id, p_collector_id, v_receipt_id, p_idempotency_key, p_amount, 0, 0, 0, v_new, COALESCE(p_payment_date, CURRENT_DATE), p_payment_time, p_gps_lat, p_gps_lng, p_location_address, p_notes)
    RETURNING id INTO v_payment_id;
  END IF;

  RETURN QUERY SELECT v_previous, v_new, false, v_receipt_id, v_payment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION apply_loan_payment(
  uuid, numeric, uuid, text, uuid, uuid, date, time, numeric, numeric, text, text
) TO authenticated;
