/*
  Safety net: the Loan Disbursement journal entry (see handleDisburse() in
  app/(app)/loans/[id]/page.tsx) posts to accounts 1000 (Cash on Hand),
  1100 (Loans Receivable), 4000 (Interest Income), and 4010 (Service Fee
  Income). If any of these codes were ever renamed/deleted while
  restructuring the Chart of Accounts into per-branch cash accounts, that
  line silently never posts — this just guarantees the codes exist so the
  amounts always land somewhere, without touching anything if they're
  already there. Run once in the Supabase SQL Editor. Safe to re-run.
*/
INSERT INTO chart_of_accounts (code, name, account_type) VALUES
  ('1000', 'Cash on Hand', 'asset'),
  ('1100', 'Loans Receivable', 'asset'),
  ('4000', 'Interest Income', 'revenue'),
  ('4010', 'Service Fee Income', 'revenue')
ON CONFLICT (code) DO NOTHING;
