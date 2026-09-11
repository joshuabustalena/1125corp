/*
  READ-ONLY — finds the duplicate Sep 11 cash count rows (same branch,
  same date, same totals, different stored variance) so we can see exactly
  which one to delete. Broadened to any date in case there are others like
  it, not just Sep 11.
*/
SELECT id, branch_id, count_date, vault_total, pcf_total, ending_balance,
       pcf_ending_balance, variance, created_at, counted_by
FROM cash_counts
WHERE (branch_id, count_date) IN (
  SELECT branch_id, count_date FROM cash_counts
  GROUP BY branch_id, count_date HAVING COUNT(*) > 1
)
ORDER BY count_date DESC, created_at ASC;
