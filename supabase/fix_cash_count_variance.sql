/*
  Fixes the Cash Count "Variance" column — Kat's Sep 11 report: History
  showing a huge red variance on nearly every count, even ones that were
  actually balanced.

  Root cause: Variance was computed as
      (Vault Total + PCF Total) - Expected Cash
  where "Expected Cash" is pending remittances not yet reconciled — a
  small, often-zero number on any day nothing was left over — NOT what the
  ledger says should be sitting in the vault. So Variance was really just
  showing close to the full counted amount as a "discrepancy" regardless of
  whether the count was actually correct. Confirmed from the data itself:
  on most rows Vault Total already equals Ending Balance (the actual,
  correct comparison point — the Cash in Vault account's ledger running
  balance, same figure printed as "Ending Cash Balance" on the sheet) —
  those counts WERE balanced, Variance just never reflected it.

  Fixed going forward in app/(app)/cash-count/page.tsx (both the live
  preview and what gets stored on submit) to compare against Ending
  Balance instead. This is the matching one-time repair of every existing
  History row, using each row's own already-stored totals — no new
  computation, no assumptions, just re-deriving the same figure from data
  already sitting right there.

  Safe to re-run.
*/

UPDATE cash_counts
SET variance = COALESCE(vault_total, vault_amount, 0) + COALESCE(pcf_total, petty_cash_amount, 0) - COALESCE(ending_balance, 0);
