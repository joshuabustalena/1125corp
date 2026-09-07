/*
  READ-ONLY diagnostic — finds exactly which journal entries are unbalanced
  (their own debits don't equal their own credits), so we can see the real
  cause of the Trial Balance's "Debits do not equal credits" warning instead
  of guessing further.

  Moving a debit between two expense accounts (like the Incentives Expense
  miscoding fix in fix_incentives_expense_miscode.sql) never changes the
  Trial Balance's grand total — it only relabels which account the money
  sits under. If the overall total is still off after that fix, it means a
  SEPARATE journal entry somewhere genuinely has an unequal debit/credit
  total (or no lines at all), and this finds it.

  Run both queries and share the results — no data is changed by this file.
*/

-- 1. Entries that DO have lines, but debit ≠ credit for that entry.
SELECT
  je.id,
  je.entry_number,
  je.entry_date,
  je.description,
  je.source,
  je.source_id,
  SUM(jel.debit) AS total_debit,
  SUM(jel.credit) AS total_credit,
  SUM(jel.debit) - SUM(jel.credit) AS difference
FROM journal_entries je
JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
GROUP BY je.id, je.entry_number, je.entry_date, je.description, je.source, je.source_id
HAVING ABS(SUM(jel.debit) - SUM(jel.credit)) > 0.01
ORDER BY je.entry_date DESC;

-- 2. Entries with NO lines at all (would silently vanish from every
--    report, but still count as "an entry exists" — the exact "23 empty
--    entries" class of issue rebuild_journal_entries.sql was written for).
SELECT je.id, je.entry_number, je.entry_date, je.description, je.source, je.source_id
FROM journal_entries je
LEFT JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
WHERE jel.id IS NULL
ORDER BY je.entry_date DESC;

-- 3. Specifically: every line ever posted to "Incentives Expense" or
--    "Withheld Funds Payable" (by name, whatever code they're actually at)
--    — to confirm the pair from any given Payroll Voucher truly matches up
--    1-for-1, post-correction.
SELECT
  coa.code, coa.name, je.entry_number, je.entry_date, je.description,
  jel.debit, jel.credit, jel.memo
FROM journal_entry_lines jel
JOIN chart_of_accounts coa ON coa.id = jel.account_id
JOIN journal_entries je ON je.id = jel.journal_entry_id
WHERE coa.name ILIKE 'Incentives Expense%' OR coa.name ILIKE 'Withheld Funds Payable%'
ORDER BY je.entry_date DESC;
