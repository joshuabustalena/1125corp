/*
  Strips stray leading/trailing whitespace from the Chart of Accounts.

  THE PROBLEM
  -----------
  Three accounts have a trailing space inside their CODE:

      "1000 "  Cash in Vault - Balanga
      "1300 "  Employee Loan (Balanga)
      "1400 "  Service Vehicle Loan

  On screen "1000 " and "1000" look identical, but every lookup in the app is
  an exact match, so searching for "1000" finds nothing. That was one step
  away from being serious: postJournalEntry now REFUSES an entry whose account
  cannot be resolved, so a lookup returning "1000" would have silently stopped
  every Balanga loan disbursement from reaching the ledger — with no error
  anywhere, and gas vouchers still working (they read the code straight off
  the dropdown), which would have made it look like nothing was wrong.

  The app was made tolerant of this (lib/branch-accounts.ts returns the code
  exactly as stored). This cleans the data so the trap is gone for good.

  WHY THE VOUCHER TABLES ARE UPDATED TOO
  --------------------------------------
  Seven existing vouchers store the dirty code as plain text:
      gas_vouchers.cash_account_code           5 rows
      general_cash_vouchers.cash_account_code  2 rows
  Trimming only chart_of_accounts would orphan those — their reprints and the
  ledger rebuild look the account up by that stored text. All of it is trimmed
  together, in one transaction.

  journal_entry_lines is NOT affected: it references accounts by account_id
  (uuid), not by code.

  Names are trimmed as well. Ten accounts carry a trailing space in the NAME
  ("Loans Receivable ", "Cash in Vault ", …). Those are harmless today because
  the resolver matches on a prefix, but they make the Chart look inconsistent
  and invite the same class of bug.

  Run once in the Supabase SQL Editor. Safe to re-run — trimming an already
  clean value changes nothing.
*/

BEGIN;

-- 1. The stored text on existing vouchers, BEFORE the codes they point at
--    change, so nothing is left dangling mid-transaction.
UPDATE gas_vouchers
SET cash_account_code = btrim(cash_account_code)
WHERE cash_account_code IS DISTINCT FROM btrim(cash_account_code);

UPDATE general_cash_vouchers
SET cash_account_code = btrim(cash_account_code)
WHERE cash_account_code IS DISTINCT FROM btrim(cash_account_code);

-- Line-level account codes inside the jsonb array (none dirty today, but
-- this keeps the two in step if that ever changes).
UPDATE general_cash_vouchers gcv
SET lines = sub.cleaned
FROM (
  SELECT id,
         jsonb_agg(
           CASE
             WHEN elem ? 'account_code'
               THEN jsonb_set(elem, '{account_code}', to_jsonb(btrim(elem->>'account_code')))
             ELSE elem
           END
           ORDER BY ord
         ) AS cleaned
  FROM general_cash_vouchers,
       LATERAL jsonb_array_elements(coalesce(lines, '[]'::jsonb)) WITH ORDINALITY AS t(elem, ord)
  GROUP BY id
) sub
WHERE gcv.id = sub.id
  AND gcv.lines IS DISTINCT FROM sub.cleaned;

-- 2. The Chart itself.
UPDATE chart_of_accounts
SET code = btrim(code),
    name = btrim(name)
WHERE code IS DISTINCT FROM btrim(code)
   OR name IS DISTINCT FROM btrim(name);

-- 3. Abort if trimming created a duplicate code. Two accounts collapsing onto
--    the same code would make every lookup ambiguous, which is worse than the
--    whitespace was.
DO $trim$
DECLARE
  v_dupes int;
  v_dirty int;
BEGIN
  SELECT count(*) INTO v_dupes FROM (
    SELECT code FROM chart_of_accounts GROUP BY code HAVING count(*) > 1
  ) d;
  IF v_dupes > 0 THEN
    RAISE EXCEPTION 'Trimming would leave % duplicate account code(s) - rolling back', v_dupes;
  END IF;

  SELECT count(*) INTO v_dirty FROM chart_of_accounts
   WHERE code IS DISTINCT FROM btrim(code) OR name IS DISTINCT FROM btrim(name);
  IF v_dirty > 0 THEN
    RAISE EXCEPTION 'Still % row(s) with stray whitespace - rolling back', v_dirty;
  END IF;

  RAISE NOTICE 'Chart of Accounts cleaned; no duplicate codes.';
END;
$trim$;

COMMIT;

-- Confirmation: all three counts must be 0.
SELECT 'dirty codes'  AS what, count(*) FROM chart_of_accounts WHERE code IS DISTINCT FROM btrim(code)
UNION ALL SELECT 'dirty names', count(*) FROM chart_of_accounts WHERE name IS DISTINCT FROM btrim(name)
UNION ALL SELECT 'duplicate codes', (SELECT count(*) FROM (SELECT code FROM chart_of_accounts GROUP BY code HAVING count(*) > 1) d);
