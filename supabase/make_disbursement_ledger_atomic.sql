-- Root-cause fix for the recurring "loan disbursed, journal entry missing"
-- bug (LN-2026-255256 Jyllan Pimentel Sep 22; LN-2026-550326 Rheyline De
-- Guzman Sep 30, month-end system load — Balanga).
--
-- The client-side disbursement flow posted a journal entry across roughly
-- 9 separate network round trips: 4 reads to resolve account codes to ids
-- (inside postJournalEntry), 1 insert for the journal_entries row, then up
-- to 5 more inserts for its lines. A connection drop between ANY of those —
-- far more likely during a high-traffic stretch like everyone closing out
-- books at month-end — landed the loan and its cash voucher (already saved
-- by that point) with no ledger entry at all, and nothing but a toast (that
-- Aug 2026's fix at least made visible) to show it.
--
-- This collapses that entire sequence into ONE round trip, inside ONE
-- database transaction: it either all lands, or none of it does. A retry
-- (from the disbursement flow itself, or from the loan page's own "Post
-- Journal Entry" button) is safe to call again — it's idempotent on
-- (source='disbursement', source_id=loan_id), so a client that times out
-- waiting for a response that actually landed server-side won't create a
-- duplicate entry on retry.
--
-- Account CODE resolution by branch name (resolveBranchAccountCode) stays
-- client-side — it's a handful of quick reads with nothing written yet if
-- one fails, not the risky part. This function takes the resolved codes
-- and does everything from there in one transaction.

DROP FUNCTION IF EXISTS post_disbursement_ledger_entry(uuid, text, date, text, text, uuid, uuid, text, text, text, text, numeric, numeric, numeric, numeric, numeric);

CREATE OR REPLACE FUNCTION post_disbursement_ledger_entry(
  p_loan_id uuid,
  p_entry_number text,
  p_entry_date date,
  p_description text,
  p_reference text,
  p_created_by uuid,
  p_branch_id uuid,
  p_receivable_code text,
  p_cash_code text,
  p_interest_code text,
  p_servicefee_code text,
  p_receivable_debit numeric,
  p_offset_credit numeric,
  p_cash_credit numeric,
  p_servicefee_credit numeric,
  p_interest_credit numeric
)
RETURNS TABLE(ok boolean, missing_codes text[], journal_entry_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_receivable_id uuid;
  v_cash_id uuid;
  v_interest_id uuid;
  v_servicefee_id uuid;
  v_missing text[] := '{}';
  v_entry_id uuid;
BEGIN
  -- Idempotent: a disbursement only ever has one ledger entry. If one
  -- already exists (this call landed once already, and the caller is
  -- retrying after a client-side timeout), return it as-is instead of
  -- posting a duplicate.
  SELECT id INTO v_entry_id FROM journal_entries WHERE source = 'disbursement' AND source_id = p_loan_id;
  IF v_entry_id IS NOT NULL THEN
    RETURN QUERY SELECT true, ARRAY[]::text[], v_entry_id;
    RETURN;
  END IF;

  SELECT id INTO v_receivable_id FROM chart_of_accounts WHERE code = p_receivable_code;
  SELECT id INTO v_cash_id FROM chart_of_accounts WHERE code = p_cash_code;
  SELECT id INTO v_interest_id FROM chart_of_accounts WHERE code = p_interest_code;
  SELECT id INTO v_servicefee_id FROM chart_of_accounts WHERE code = p_servicefee_code;

  -- Same "only a code backing a real non-zero line counts as missing" rule
  -- postJournalEntry already followed — Loans Receivable always applies,
  -- the others only matter if their line is actually non-zero.
  IF v_receivable_id IS NULL THEN v_missing := array_append(v_missing, p_receivable_code); END IF;
  IF v_cash_id IS NULL AND p_cash_credit > 0 THEN v_missing := array_append(v_missing, p_cash_code); END IF;
  IF v_interest_id IS NULL AND p_interest_credit > 0 THEN v_missing := array_append(v_missing, p_interest_code); END IF;
  IF v_servicefee_id IS NULL AND p_servicefee_credit > 0 THEN v_missing := array_append(v_missing, p_servicefee_code); END IF;

  IF array_length(v_missing, 1) > 0 THEN
    RETURN QUERY SELECT false, v_missing, NULL::uuid;
    RETURN;
  END IF;

  INSERT INTO journal_entries(entry_number, entry_date, reference, description, source, source_id, created_by, branch_id)
  VALUES (p_entry_number, p_entry_date, p_reference, p_description, 'disbursement', p_loan_id, p_created_by, p_branch_id)
  RETURNING id INTO v_entry_id;

  IF p_receivable_debit > 0 THEN
    INSERT INTO journal_entry_lines(journal_entry_id, account_id, debit, credit, memo)
    VALUES (v_entry_id, v_receivable_id, p_receivable_debit, 0, 'Loans Receivable (Loan + Interest - First Payment)');
  END IF;
  IF p_offset_credit > 0 THEN
    INSERT INTO journal_entry_lines(journal_entry_id, account_id, debit, credit, memo)
    VALUES (v_entry_id, v_receivable_id, 0, p_offset_credit, 'Offset balance from previous loan');
  END IF;
  IF p_cash_credit > 0 THEN
    INSERT INTO journal_entry_lines(journal_entry_id, account_id, debit, credit, memo)
    VALUES (v_entry_id, v_cash_id, 0, p_cash_credit, 'Cash released to borrower');
  END IF;
  IF p_servicefee_credit > 0 THEN
    INSERT INTO journal_entry_lines(journal_entry_id, account_id, debit, credit, memo)
    VALUES (v_entry_id, v_servicefee_id, 0, p_servicefee_credit, 'Service fee');
  END IF;
  IF p_interest_credit > 0 THEN
    INSERT INTO journal_entry_lines(journal_entry_id, account_id, debit, credit, memo)
    VALUES (v_entry_id, v_interest_id, 0, p_interest_credit, 'Interest revenue');
  END IF;

  RETURN QUERY SELECT true, ARRAY[]::text[], v_entry_id;
END;
$$;

GRANT EXECUTE ON FUNCTION post_disbursement_ledger_entry(uuid, text, date, text, text, uuid, uuid, text, text, text, text, numeric, numeric, numeric, numeric, numeric) TO authenticated;
