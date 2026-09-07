/*
  Corrects journal_entry_lines that were wrongly posted to "Repairs
  Expense" (code '5040') instead of the real "Incentives Expense" account.

  ROOT CAUSE: the Payroll Voucher code hardcoded account code '5040' for
  its Incentives Expense line. '5040' was already in use — "Repairs
  Expense", seeded by add_general_cash_vouchers.sql — so every incentive
  debit landed there instead. Meanwhile the client's own, separately
  created "Incentives Expense" account (a different code) never received
  anything automatically. Fixed going forward in
  app/(app)/payroll/page.tsx (now resolves the account by NAME, never a
  hardcoded code) — this script only cleans up what already got posted
  wrong before that fix shipped.

  Every affected line carries the exact memo 'Incentives Expense' — a
  genuine Repairs Expense entry (from a General Cash Voucher) would never
  have that memo — so this precisely finds only the mistakenly-posted
  lines and leaves any real Repairs Expense activity on that account alone.

  REVIEW BEFORE RUNNING — this rewrites historical financial records:
    1. Run the SELECT below first and check the rows it lists look right
       (should be one 'Incentives Expense'-memo'd debit line per Payroll
       Voucher that included a nonzero incentive).
    2. Then run the DO block to actually move them.
  Safe to re-run (idempotent) — once corrected, no rows match the WHERE
  clause the second time, so running it again is a no-op.
*/

-- 1. Preview — exactly what this will move, and to where.
SELECT
  jel.id AS line_id,
  je.entry_number,
  je.entry_date,
  je.description,
  jel.debit,
  (SELECT code || ' — ' || name FROM chart_of_accounts WHERE id = jel.account_id) AS currently_on,
  (SELECT code || ' — ' || name FROM chart_of_accounts WHERE name ILIKE 'Incentives Expense%' AND code <> '5040' LIMIT 1) AS should_be_on
FROM journal_entry_lines jel
JOIN journal_entries je ON je.id = jel.journal_entry_id
JOIN chart_of_accounts coa ON coa.id = jel.account_id
WHERE coa.code = '5040' AND jel.memo = 'Incentives Expense';

-- 2. The correction.
DO $$
DECLARE
  v_correct_account_id uuid;
  v_moved int;
BEGIN
  SELECT id INTO v_correct_account_id
  FROM chart_of_accounts
  WHERE name ILIKE 'Incentives Expense%' AND code <> '5040'
  LIMIT 1;

  IF v_correct_account_id IS NULL THEN
    RAISE NOTICE 'No "Incentives Expense" account found other than the mistaken 5040 (Repairs Expense) one — nothing moved. Create the correct account in the Chart of Accounts first, then re-run this.';
  ELSE
    UPDATE journal_entry_lines jel
    SET account_id = v_correct_account_id
    FROM chart_of_accounts coa
    WHERE coa.id = jel.account_id
      AND coa.code = '5040'
      AND jel.memo = 'Incentives Expense';

    GET DIAGNOSTICS v_moved = ROW_COUNT;
    RAISE NOTICE '% journal entry line(s) moved from Repairs Expense (5040) to the real Incentives Expense account.', v_moved;
  END IF;
END $$;
