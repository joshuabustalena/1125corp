/*
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
  ('5040', 'Incentives Expense', 'expense'),
  ('2040', 'Withheld Funds Payable', 'liability')
ON CONFLICT (code) DO NOTHING;
