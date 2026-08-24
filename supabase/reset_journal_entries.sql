/*
  Resets the general ledger — journal entries ONLY.

  Why
  ---
  26 of 312 live entries are broken: 23 have no lines at all and 3 don't
  balance. They were written by postJournalEntry(), which used to skip any
  line whose account code wasn't in the Chart of Accounts and create the
  entry anyway — silently, with only a console.warn. The Chart had been
  split per branch ("Cash in Vault - Balanga" etc.) while the app still
  posted to the old flat codes, so those lines resolved to nothing.

  Both halves of that are now fixed: postings resolve accounts by name per
  branch, and lib/ledger.ts refuses to create an entry at all when a code is
  missing, so this cannot silently recur.

  WHAT THIS DELETES — and what it does not
  ----------------------------------------
  Deleted:  journal_entries + journal_entry_lines. That is the accounting
            ledger: General Ledger, Journal Entries, Financial Statements
            (Trial Balance / Income Statement / Balance Sheet), the cash
            balances on the Accounting and main Dashboards, and Cash Count's
            Beginning/Ending Cash Balance all read from these and will show
            zero afterwards.

  NOT touched: every underlying business record. Loans, payments, receipts,
            remittances, cash vouchers, gas vouchers, payroll, expenses and
            cash flow all live in their own tables and are untouched. No
            customer balance, no payment history and no voucher is lost —
            only the accounting mirror of them.

  There is no regeneration routine: entries are written at transaction time,
  not derived on demand. So the ledger restarts empty and fills up again from
  the next transaction onward. If the client needs the history rebuilt rather
  than restarted, that is a separate backfill job — say so BEFORE running
  this, because this cannot be undone.

  HOW TO RUN
  ----------
  Step 1 alone first: it only reports, it changes nothing. Read the numbers,
  confirm they match what you expect, and only then run Step 2.
*/

-- ===========================================================================
-- STEP 1 — REPORT ONLY. Safe. Run this first and read the output.
-- ===========================================================================
SELECT 'entries'          AS what, count(*)::text AS value FROM journal_entries
UNION ALL
SELECT 'lines',           count(*)::text FROM journal_entry_lines
UNION ALL
SELECT 'entries w/o lines', count(*)::text FROM journal_entries e
  WHERE NOT EXISTS (SELECT 1 FROM journal_entry_lines l WHERE l.journal_entry_id = e.id)
UNION ALL
SELECT 'total debit',     to_char(coalesce(sum(debit), 0),  'FM999999999.00') FROM journal_entry_lines
UNION ALL
SELECT 'total credit',    to_char(coalesce(sum(credit), 0), 'FM999999999.00') FROM journal_entry_lines
UNION ALL
SELECT 'oldest entry',    coalesce(min(entry_date)::text, '-') FROM journal_entries
UNION ALL
SELECT 'newest entry',    coalesce(max(entry_date)::text, '-') FROM journal_entries;

-- These are the business records that will SURVIVE. If any of these is 0
-- when you expect data, stop — something else is wrong and a ledger reset
-- is not the fix.
SELECT 'loans' AS table_name, count(*) FROM loans
UNION ALL SELECT 'payments', count(*) FROM payments
UNION ALL SELECT 'receipts', count(*) FROM receipts
UNION ALL SELECT 'remittances', count(*) FROM remittances
UNION ALL SELECT 'cash_vouchers', count(*) FROM cash_vouchers
UNION ALL SELECT 'general_cash_vouchers', count(*) FROM general_cash_vouchers
UNION ALL SELECT 'gas_vouchers', count(*) FROM gas_vouchers
UNION ALL SELECT 'payroll', count(*) FROM payroll;


-- ===========================================================================
-- STEP 2 — THE RESET. Destructive and NOT reversible.
-- Uncomment the block below only after Step 1 looks right.
-- ===========================================================================

-- BEGIN;
--
-- -- Lines first: journal_entry_lines references journal_entries. (If the FK
-- -- is ON DELETE CASCADE this is redundant, but being explicit means the
-- -- statement behaves the same either way.)
-- DELETE FROM journal_entry_lines;
-- DELETE FROM journal_entries;
--
-- -- Confirm both are empty BEFORE committing. If these aren't 0, ROLLBACK.
-- SELECT count(*) AS entries_left FROM journal_entries;
-- SELECT count(*) AS lines_left   FROM journal_entry_lines;
--
-- COMMIT;
