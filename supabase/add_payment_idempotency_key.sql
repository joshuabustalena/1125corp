/*
  Fixes a real double-deduction bug: a lost RPC response could cause the
  exact same payment to be applied to a loan's balance twice.

  HOW IT HAPPENED (confirmed against a live case — Charito Ferrer, Area 2:
  balance 6,220, one ₱200 payment made, balance ended up 5,820 instead of
  the correct 6,020 — a difference of exactly one extra ₱200 deduction)
  --------------------------------------------------------------------
  apply_loan_payment() is a pure "decrement by amount" call with no memory
  of which specific attempt asked for it. In app/(app)/payments/page.tsx,
  handleSubmit() treats an RPC call that comes back with no error `.code`
  as "actually offline" and queues the SAME payment for a later retry
  (queueOfflinePayment()) — this is meant to catch navigator.onLine lying
  about having a real signal. But a request can also fail this exact way
  when it DID reach the server and DID commit (the balance really was
  decremented), and only the response on the way back was lost to a bad
  connection. The client can't tell those two cases apart, so it queued a
  retry either way. When that retry later synced, apply_loan_payment() ran
  a second time for money that was already taken off the balance once.

  THE FIX, AND WHY IT NEEDS ITS OWN TABLE
  ---------------------------------------
  apply_loan_payment() now takes an idempotency key, generated once per
  submit attempt in the browser and carried through to the offline queue if
  that attempt falls back there. The FIRST call for a given key decrements
  the balance AND records that fact in loan_payment_applications; every
  subsequent call with the same key is recognized as a replay and returns
  the ORIGINAL balances with already_applied = true, without touching the
  loan again.

  The record is written by this function, inside the same transaction as
  the balance update — NOT inferred from the payments row the app inserts
  afterwards. That distinction is the whole fix. An earlier version of this
  migration looked the key up in payments.idempotency_key instead, which
  does not work for the very scenario above: when the response is lost, the
  client never gets far enough to insert that payments row, so the replay
  found nothing and deducted a second time. Verified against live data —
  a ₱200 payment still came off twice (₱400 total). Writing the record here,
  atomically with the UPDATE, closes it: either both land or neither does.

  The loan row is locked BEFORE the key is checked, so two concurrent calls
  with the same key against the same loan serialize — the second one sees
  the first one's committed record instead of racing past it.

  WHAT THE CALLER MUST STILL DO
  -----------------------------
  already_applied = true means only that the BALANCE was already applied.
  It does not promise a receipts/payments row exists — in the lost-response
  case it specifically does not. The caller must check for a payments row
  with the same key and, if there isn't one, still insert the receipt and
  payment (using the new_balance returned here), so the money stays
  recorded. payments.idempotency_key exists for exactly that check.

  Return signature changed (added already_applied), so the function is
  dropped and recreated rather than just replaced — CREATE OR REPLACE can't
  change a function's output columns.

  Safe to run more than once, including over the earlier version of this
  same file.
*/

ALTER TABLE payments ADD COLUMN IF NOT EXISTS idempotency_key uuid;

-- Enforced as a partial unique index (not a table constraint) so it only
-- applies to rows that actually set the key — every payment recorded
-- before this migration has NULL here, and those must never collide with
-- each other.
CREATE UNIQUE INDEX IF NOT EXISTS payments_idempotency_key_uidx
  ON payments (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- The authoritative "this attempt's balance change already happened"
-- record. Written by apply_loan_payment itself, in the same transaction as
-- the UPDATE it describes.
CREATE TABLE IF NOT EXISTS loan_payment_applications (
  idempotency_key  uuid PRIMARY KEY,
  loan_id          uuid NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  amount           numeric NOT NULL,
  previous_balance numeric NOT NULL,
  new_balance      numeric NOT NULL,
  applied_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS loan_payment_applications_loan_idx
  ON loan_payment_applications (loan_id);

ALTER TABLE loan_payment_applications ENABLE ROW LEVEL SECURITY;

-- Same permissiveness as the payments table's own policies: anyone who can
-- post a payment can write the matching application record. The function
-- runs SECURITY INVOKER (see below), so these are what let it write at all.
DROP POLICY IF EXISTS "loan_payment_applications_select" ON loan_payment_applications;
CREATE POLICY "loan_payment_applications_select" ON loan_payment_applications
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "loan_payment_applications_insert" ON loan_payment_applications;
CREATE POLICY "loan_payment_applications_insert" ON loan_payment_applications
  FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "loan_payment_applications_delete" ON loan_payment_applications;
CREATE POLICY "loan_payment_applications_delete" ON loan_payment_applications
  FOR DELETE TO authenticated USING (is_admin());

DROP FUNCTION IF EXISTS apply_loan_payment(uuid, numeric);
DROP FUNCTION IF EXISTS apply_loan_payment(uuid, numeric, uuid);

CREATE FUNCTION apply_loan_payment(p_loan_id uuid, p_amount numeric, p_idempotency_key uuid DEFAULT NULL)
RETURNS TABLE(previous_balance numeric, new_balance numeric, already_applied boolean)
LANGUAGE plpgsql
AS $$
DECLARE
  v_previous numeric;
  v_new      numeric;
  v_prior_previous numeric;
  v_prior_new      numeric;
BEGIN
  -- Lock the loan FIRST, then check the key. Doing it in this order is what
  -- makes two concurrent calls with the same key safe: the second one waits
  -- here, then sees the record the first one just wrote.
  SELECT l.remaining_balance INTO v_previous FROM loans l WHERE l.id = p_loan_id FOR UPDATE;
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
  SET remaining_balance = v_new,
      status = CASE WHEN v_new = 0 THEN 'paid' ELSE status END
  WHERE id = p_loan_id;

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO loan_payment_applications (idempotency_key, loan_id, amount, previous_balance, new_balance)
    VALUES (p_idempotency_key, p_loan_id, p_amount, v_previous, v_new);
  END IF;

  RETURN QUERY SELECT v_previous, v_new, false;
END;
$$;

-- SECURITY INVOKER (the default) means this still runs under the calling
-- user's own RLS — a Field Collector/Cashier can only actually update a
-- loan they're already allowed to per the existing loans_update policy.
GRANT EXECUTE ON FUNCTION apply_loan_payment(uuid, numeric, uuid) TO authenticated;
