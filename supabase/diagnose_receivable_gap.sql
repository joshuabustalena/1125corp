/*
  Dashboard Receivable vs the Trial Balance's Loans Receivable (Kat, Nov
  2026). READ-ONLY: nothing here writes anything. Run each query on its own
  in Supabase > SQL Editor.

  The two are built differently:
    Dashboard      = remaining_balance summed over ACTIVE loans.
    Trial Balance  = the Loans Receivable accounts: a release debits it, a
                     Remittance credits it (payments never post on their own),
                     write-offs credit it, and Kat's manual entries and cash
                     vouchers adjust it.

  What the Nov 2026 runs showed: Dinalupihan matched exactly; Balanga's
  ledger was 5,070 higher. The ledger was right. Perez, Rosa's legacy loan
  LN-2026-59525 had been saved with status 'overdue' (an Edit Loan option at
  the time), so the Dashboard and the Collection List, which count only
  'active', left out its 5,070 balance. Fixed by setting it back to
  'active'; no journal entry. Check this first next time:
    SELECT loan_number, status, remaining_balance FROM loans
    WHERE status = 'overdue' OR (status NOT IN ('active', 'pending', 'approved', 'declined', 'written_off') AND remaining_balance > 0);
  QUERY 2's other rows (Garcia, Hepullier, ...) had already been evened out
  by Kat's manual entries.

  Not usable for this: payments vs remittances over all time. Payments from
  before the system, and those of deleted collectors (collector_id is SET
  NULL on delete, for payments and remittances alike), make that total
  meaningless. The 49 legacy Balanga loans (status active, disbursed_at
  NULL) have no release entry; their receivable came in through Kat's
  manual opening entries, so QUERY 2 leaves them out.
*/

-- QUERY 1: the gap per branch ---------------------------------------------
WITH ledger AS (
  SELECT a.branch_id, sum(l.debit - l.credit) AS amt
  FROM journal_entry_lines l
  JOIN chart_of_accounts a ON a.id = l.account_id
  WHERE trim(a.name) ILIKE 'Loans Receivable%'
  GROUP BY a.branch_id
),
dash AS (
  SELECT branch_id, sum(remaining_balance) AS amt FROM loans WHERE status = 'active' GROUP BY branch_id
)
SELECT coalesce(b.name, '(no branch on account)') AS branch,
       round(coalesce(g.amt, 0), 2) AS trial_balance_lr,
       round(coalesce(d.amt, 0), 2) AS dashboard_receivable,
       round(coalesce(g.amt, 0) - coalesce(d.amt, 0), 2) AS gap
FROM ledger g
FULL JOIN branches b ON b.id = g.branch_id
LEFT JOIN dash d ON d.branch_id = b.id
ORDER BY 1;


-- QUERY 2: loans whose ledger and system balance disagree -----------------
-- ledger_minus_dashboard > 0: the ledger carries more than the system, e.g.
-- a renewal whose offset credit was short. Change the branch name to check
-- another branch. Rows Kat already corrected with a manual entry or cash
-- voucher still show here, since those entries aren't linked to a loan.
WITH br AS (SELECT id FROM branches WHERE name ILIKE 'Balanga%'),
lr AS (SELECT id FROM chart_of_accounts WHERE trim(name) ILIKE 'Loans Receivable%'),
disb AS (
  SELECT e.source_id AS loan_id, sum(l.debit) AS booked, sum(l.credit) AS offset_credit
  FROM journal_entries e
  JOIN journal_entry_lines l ON l.journal_entry_id = e.id
  WHERE e.source = 'disbursement' AND l.account_id IN (SELECT id FROM lr)
  GROUP BY e.source_id
),
paid AS (SELECT loan_id, sum(amount_paid) AS amt FROM payments GROUP BY loan_id),
renewal AS (
  SELECT lo.renewed_from_loan_id AS old_id, sum(d.offset_credit) AS offset_credit
  FROM loans lo JOIN disb d ON d.loan_id = lo.id
  WHERE lo.renewed_from_loan_id IS NOT NULL GROUP BY 1
),
calc AS (
  SELECT lo.loan_number, lo.status, lo.customer_id,
         d.booked, coalesce(p.amt, 0) AS payments, coalesce(rn.offset_credit, 0) AS offset_by_renewal,
         CASE WHEN lo.status = 'active' THEN lo.remaining_balance ELSE 0 END AS on_dashboard
  FROM loans lo
  JOIN disb d ON d.loan_id = lo.id
  LEFT JOIN paid p ON p.loan_id = lo.id
  LEFT JOIN renewal rn ON rn.old_id = lo.id
  WHERE lo.branch_id IN (SELECT id FROM br) AND lo.status <> 'written_off'
)
SELECT c.loan_number, c.status,
       trim(coalesce(cu.last_name, '') || ', ' || coalesce(cu.first_name, '')) AS customer,
       round(c.booked, 2) AS booked_at_release,
       round(c.payments, 2) AS payments,
       round(c.offset_by_renewal, 2) AS offset_by_renewal,
       round(c.on_dashboard, 2) AS balance_on_dashboard,
       round(c.booked - c.payments - c.offset_by_renewal - c.on_dashboard, 2) AS ledger_minus_dashboard
FROM calc c
LEFT JOIN customers cu ON cu.id = c.customer_id
WHERE abs(c.booked - c.payments - c.offset_by_renewal - c.on_dashboard) > 0.5
ORDER BY abs(c.booked - c.payments - c.offset_by_renewal - c.on_dashboard) DESC;
