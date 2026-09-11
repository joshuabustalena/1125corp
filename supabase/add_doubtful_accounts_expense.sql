/*
  Write-Off, step 2 — Kat's Sep 11 follow-up: writing off a loan should
  also post the standard bad-debt journal entry immediately, at the moment
  of write-off, for the loan's remaining balance at that moment:

    Debit  Doubtful Accounts Expense
    Credit Loans Receivable

  (Confirmed against Filomina Valdoz's write-off: ₱19,650.00 remaining
  balance, same amount both sides.)

  Doubtful Accounts Expense is branch-scoped, same convention as Loans
  Receivable/Cash in Vault/etc. — Kat gave codes 5601 (Balanga) and 5600
  (Dinalupihan), best-effort read of a slightly ambiguous message; ask her
  to confirm exactly which code belongs to which branch before treating
  these as final. Doesn't matter much either way, on purpose: the app
  resolves this account by NAME via resolveBranchAccountCode (see
  app/(app)/loans/[id]/page.tsx's handleWriteOff), never by a hardcoded
  code — the lesson from this session's '5040' collision (Incentives
  Expense silently landing on "Repairs Expense" because the app trusted a
  flat code that turned out to already be taken). If these two codes are
  swapped or wrong, fix them directly in the Chart of Accounts UI — the
  app will still resolve the right account either way, by name and branch.

  Run once. Safe to re-run.
*/

DO $$
DECLARE
  v_balanga_id uuid;
  v_dinalupihan_id uuid;
BEGIN
  SELECT id INTO v_balanga_id FROM branches WHERE name ILIKE 'Balanga%' LIMIT 1;
  SELECT id INTO v_dinalupihan_id FROM branches WHERE name ILIKE 'Dinalupihan%' LIMIT 1;

  IF v_balanga_id IS NOT NULL THEN
    INSERT INTO chart_of_accounts (code, name, account_type, branch_id)
    VALUES ('5601', 'Doubtful Accounts Expense', 'expense', v_balanga_id)
    ON CONFLICT (code) DO NOTHING;
  END IF;

  IF v_dinalupihan_id IS NOT NULL THEN
    INSERT INTO chart_of_accounts (code, name, account_type, branch_id)
    VALUES ('5600', 'Doubtful Accounts Expense', 'expense', v_dinalupihan_id)
    ON CONFLICT (code) DO NOTHING;
  END IF;
END $$;
