/*
  UPDATE (Sept 2026): the '5040' row below never actually took effect.
  Code '5040' was already in use — "Repairs Expense", seeded earlier by
  add_general_cash_vouchers.sql — so `ON CONFLICT (code) DO NOTHING`
  silently skipped this insert. The Payroll Voucher's code was hardcoding
  '5040' for its Incentives Expense line as a result, meaning every
  incentive got posted to Repairs Expense instead. That's now fixed in
  app/(app)/payroll/page.tsx to resolve the account by NAME
  (resolveBranchAccountCode('Incentives Expense', null, null)) rather than
  a hardcoded code — see fix_incentives_expense_miscode.sql for correcting
  the journal entries this already affected.

  Separately, the client has since manually created their own "Incentives
  Expense" account in the Chart of Accounts UI at a different code (5300)
  — so this file's original INSERT for it is now not just ineffective but
  unnecessary too. Left as a no-op (harmless — ON CONFLICT DO NOTHING) for
  the historical record rather than deleted outright.

  ORIGINAL COMMENT
  ----------------
  Two new Chart of Accounts entries so the Payroll Voucher's automated
  journal entry can book incentive pay as its own ledger lines instead of
  it only ever showing up folded into net_pay:

    Dr Incentives Expense       (the incentive granted)
        Cr Withheld Funds Payable   (the 25% retention held back)

  Company-wide (no branch_id), same flat-code treatment already used for
  SSS/Philhealth/PagIBIG Payable in this same journal entry.

  Run once in the Supabase SQL Editor. Safe to re-run (idempotent).
*/

INSERT INTO chart_of_accounts (code, name, account_type) VALUES
  ('5040', 'Incentives Expense', 'expense'),  -- no-op: '5040' is already "Repairs Expense"
  ('2040', 'Withheld Funds Payable', 'liability')
ON CONFLICT (code) DO NOTHING;
