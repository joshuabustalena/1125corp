/*
  Follow-up to fix_cash_count_variance.sql — that migration fixed Variance
  to compare against the ledger's Ending Balance instead of pending
  remittances, but Ending Balance only ever tracked the Cash in Vault
  account. Petty Cash Fund is its own separate Chart of Accounts entry
  (e.g. code 10011 vs Vault's 1000), so any count with real PCF activity
  still showed a leftover "variance" exactly equal to its PCF total —
  visible in the live test right after the first fix (Sep 11: Vault Total
  matched perfectly, but a ₱1,190.00 variance remained, matching the PCF
  total to the peso).

  This walks each row's own branch's Petty Cash Fund account the same way
  app/(app)/cash-count/page.tsx now does (loadLockedFields, pcfEndingBalance)
  — up through that row's own count_date, scoped to that branch (or a
  shared/branch_id-NULL account, resolved the same two-step way
  resolveBranchAccountCode tries branch-specific then shared).

  Recomputes variance from scratch each time (vault_total + pcf_total -
  ending_balance - pcf_ending_balance) rather than adjusting whatever the
  column currently holds — this fully subsumes fix_cash_count_variance.sql
  (same formula, plus the PCF term), so running THIS file alone is enough;
  no need to run that one first, and safe to run this one more than once.
*/

UPDATE cash_counts cc
SET variance = COALESCE(cc.vault_total, cc.vault_amount, 0) + COALESCE(cc.pcf_total, cc.petty_cash_amount, 0)
             - COALESCE(cc.ending_balance, 0)
             - COALESCE(pcf.balance, 0)
FROM (
  SELECT cc2.id,
    (
      SELECT COALESCE(SUM(jel.debit - jel.credit), 0)
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.journal_entry_id
      WHERE jel.account_id = COALESCE(
        (SELECT id FROM chart_of_accounts WHERE branch_id = cc2.branch_id AND name ILIKE 'Petty Cash Fund%' LIMIT 1),
        (SELECT id FROM chart_of_accounts WHERE branch_id IS NULL AND name ILIKE 'Petty Cash Fund%' LIMIT 1)
      )
      AND je.entry_date <= cc2.count_date
      AND (je.branch_id = cc2.branch_id OR je.branch_id IS NULL)
    ) AS balance
  FROM cash_counts cc2
) pcf
WHERE cc.id = pcf.id;
