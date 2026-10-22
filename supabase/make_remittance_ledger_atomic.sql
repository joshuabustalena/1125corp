/*
  Records a collector remittance and its journal entry in ONE transaction.

  The Remittance page used to do three separate round trips — insert the
  remittance, insert the journal entry header, insert its lines. When the
  connection dropped after the first, the remittance saved with no ledger
  post at all: Reynaldo Taduyo's ₱6,370 on Oct 22 2026 (Dinalupihan) shows
  in Remittance History but never reached Journal Entries. Inside this
  function it all lands or none of it does, so the cashier just retries.

  SECURITY INVOKER (the default): it runs with the caller's own rights, so
  the existing RLS on remittances / journal_entries / journal_entry_lines
  still decides who may record one — nothing is widened.

  p_lines is the full set of ledger lines, e.g.
    [{"account_id": "...", "debit": 4950, "credit": 0},
     {"account_id": "...", "debit": 1500, "credit": 0},
     {"account_id": "...", "debit": 0,    "credit": 6450}]
  Debits must equal credits, or nothing is written.
*/

CREATE OR REPLACE FUNCTION record_remittance_with_ledger(
  p_collector_id uuid,
  p_amount numeric,
  p_remittance_date date,
  p_received_by uuid,
  p_notes text,
  p_is_recovery boolean,
  p_entry_number text,
  p_description text,
  p_branch_id uuid,
  p_lines jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_remittance_id uuid;
  v_entry_id uuid;
  v_debit numeric;
  v_credit numeric;
BEGIN
  SELECT COALESCE(SUM((l->>'debit')::numeric), 0), COALESCE(SUM((l->>'credit')::numeric), 0)
    INTO v_debit, v_credit
  FROM jsonb_array_elements(p_lines) AS l;

  IF v_debit <= 0 OR round(v_debit, 2) <> round(v_credit, 2) THEN
    RAISE EXCEPTION 'Remittance ledger lines do not balance (debit %, credit %)', v_debit, v_credit;
  END IF;

  INSERT INTO remittances(collector_id, amount, remittance_date, received_by, notes, is_write_off_recovery)
  VALUES (p_collector_id, p_amount, p_remittance_date, p_received_by, p_notes, p_is_recovery)
  RETURNING id INTO v_remittance_id;

  INSERT INTO journal_entries(entry_number, entry_date, reference, description, source, source_id, created_by, branch_id)
  VALUES (p_entry_number, p_remittance_date, NULL, p_description, 'remittance', v_remittance_id, p_received_by, p_branch_id)
  RETURNING id INTO v_entry_id;

  INSERT INTO journal_entry_lines(journal_entry_id, account_id, debit, credit)
  SELECT v_entry_id, (l->>'account_id')::uuid, COALESCE((l->>'debit')::numeric, 0), COALESCE((l->>'credit')::numeric, 0)
  FROM jsonb_array_elements(p_lines) AS l;

  RETURN v_remittance_id;
END;
$$;

REVOKE ALL ON FUNCTION record_remittance_with_ledger(uuid, numeric, date, uuid, text, boolean, text, text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION record_remittance_with_ledger(uuid, numeric, date, uuid, text, boolean, text, text, uuid, jsonb) TO authenticated;
