/*
  Empties the general ledger. Client decision: reset everything and let the
  books build up again from the next transaction onward.

  Run this as-is. It deletes and then verifies; nothing is commented out.

  WHY A RESET IS SAFE TO DO NOW
  -----------------------------
  The old ledger was corrupt: 23 entries had no lines at all and 3 more did
  not balance. postJournalEntry() used to skip any line whose account code was
  missing and still write the entry, logging only a console.warn — and the
  Chart of Accounts had been split per branch while the app still posted to
  flat codes. Both halves are fixed in the app now: accounts resolve by name
  per branch, and a missing code aborts the entire entry instead of leaving a
  half-written one. So entries created after this reset cannot rot the same
  way.

  WHAT THIS DELETES
  -----------------
  journal_entries and journal_entry_lines. Nothing else.

  These screens read from them and will show zero until new transactions post:
    - General Ledger, Journal Entries, Account Ledger
    - Financial Statements (Trial Balance / Income Statement / Balance Sheet)
    - Cash balances on the Accounting and main Dashboards
    - Cash Count's Beginning / Ending Cash Balance

  WHAT SURVIVES
  -------------
  Every business record: loans, payments, receipts, remittances, cash
  vouchers, gas vouchers, payroll, customers, employees. No customer balance
  and no payment history is affected — only the accounting mirror of them.

  NOT REVERSIBLE. There is no regeneration routine; entries are written at
  transaction time, not derived on demand. If the history should be rebuilt
  rather than started from zero, run supabase/rebuild_journal_entries.sql
  instead — that one regenerates all 224 entries from the source tables and
  comes out balanced. Do not run both.
*/

BEGIN;

-- Lines first: journal_entry_lines references journal_entries. Explicit
-- rather than relying on ON DELETE CASCADE, so it behaves the same either way.
DELETE FROM journal_entry_lines;
DELETE FROM journal_entries;

-- Abort if anything survived, rather than reporting success on a partial wipe.
DO $reset$
DECLARE
  v_entries bigint;
  v_lines   bigint;
BEGIN
  SELECT count(*) INTO v_entries FROM journal_entries;
  SELECT count(*) INTO v_lines   FROM journal_entry_lines;

  IF v_entries <> 0 OR v_lines <> 0 THEN
    RAISE EXCEPTION 'Reset incomplete: % entries and % lines remain - rolling back', v_entries, v_lines;
  END IF;

  RAISE NOTICE 'Ledger cleared. journal_entries and journal_entry_lines are both empty.';
END;
$reset$;

COMMIT;

-- Confirmation. Both counts must read 0, and the business records below must
-- still show their original totals.
SELECT 'journal_entries'     AS table_name, count(*) AS rows FROM journal_entries
UNION ALL SELECT 'journal_entry_lines', count(*) FROM journal_entry_lines
UNION ALL SELECT '--- untouched ---',    NULL
UNION ALL SELECT 'loans',                count(*) FROM loans
UNION ALL SELECT 'payments',             count(*) FROM payments
UNION ALL SELECT 'receipts',             count(*) FROM receipts
UNION ALL SELECT 'remittances',          count(*) FROM remittances
UNION ALL SELECT 'cash_vouchers',        count(*) FROM cash_vouchers
UNION ALL SELECT 'general_cash_vouchers', count(*) FROM general_cash_vouchers
UNION ALL SELECT 'gas_vouchers',         count(*) FROM gas_vouchers
UNION ALL SELECT 'payroll',              count(*) FROM payroll;
