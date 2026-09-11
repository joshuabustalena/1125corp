/*
  READ-ONLY — for each "Petty Cash Fund" account, how many journal entry
  lines have ever been posted to it, and their total? If this comes back
  0 rows / 0 total for a branch's PCF account, its ledger balance is
  genuinely ₱0.00 — not a lookup failure, just nothing has ever been
  posted there — which is a different problem than the one
  fix_cash_count_variance_pcf.sql fixes.
*/
SELECT
  coa.branch_id, coa.code, coa.name,
  COUNT(jel.id) AS lines_posted,
  COALESCE(SUM(jel.debit - jel.credit), 0) AS ledger_balance
FROM chart_of_accounts coa
LEFT JOIN journal_entry_lines jel ON jel.account_id = coa.id
WHERE coa.name ILIKE 'Petty Cash Fund%'
GROUP BY coa.branch_id, coa.code, coa.name;
