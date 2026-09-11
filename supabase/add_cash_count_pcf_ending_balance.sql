/*
  Kat's Sep 11 follow-up: show Vault and Petty Cash Fund variance
  SEPARATELY instead of one combined number, so it's obvious which of the
  two (if either) actually has a discrepancy — the whole reason the
  combined figure was confusing is that Vault can be perfectly correct
  while PCF alone carries a variance (or vice versa), and one number
  hides which.

  New column mirrors the existing ending_balance (Vault's ledger running
  balance) but for Petty Cash Fund — stored going forward by
  app/(app)/cash-count/page.tsx's handleSubmit (pcfEndingBalance, already
  computed in loadLockedFields since fix_cash_count_variance_pcf.sql).

  vault_variance / pcf_variance are NOT separate stored columns — they're
  just (vault_total - ending_balance) and (pcf_total - pcf_ending_balance),
  derived inline wherever shown, same as how the combined `variance`
  column has always worked. Storing derived numbers twice invites them
  drifting apart; the four numbers this needs are already columns.

  This migration also backfills pcf_ending_balance for every existing row
  — same ledger walk as fix_cash_count_variance_pcf.sql — so History shows
  the correct split for old counts too, not just new ones.

  Safe to re-run.
*/

ALTER TABLE cash_counts ADD COLUMN IF NOT EXISTS pcf_ending_balance numeric(12,2) DEFAULT 0;

UPDATE cash_counts cc
SET pcf_ending_balance = COALESCE(pcf.balance, 0)
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
