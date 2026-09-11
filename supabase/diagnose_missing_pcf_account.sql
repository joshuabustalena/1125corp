/*
  READ-ONLY — checks, for each branch, whether a "Petty Cash Fund" account
  actually exists for it (branch-specific or shared) — the same lookup
  fix_cash_count_variance_pcf.sql and the app's own loadLockedFields() both
  do. A branch with no row here is why that fix had no effect for it.
*/
SELECT
  b.id AS branch_id, b.name AS branch_name,
  (SELECT code || ' — ' || name FROM chart_of_accounts WHERE branch_id = b.id AND name ILIKE 'Petty Cash Fund%' LIMIT 1) AS branch_specific_pcf,
  (SELECT code || ' — ' || name FROM chart_of_accounts WHERE branch_id IS NULL AND name ILIKE 'Petty Cash Fund%' LIMIT 1) AS shared_pcf
FROM branches b
ORDER BY b.name;

-- All "Petty Cash Fund"-ish accounts that DO exist, wherever they are —
-- in case the name doesn't start with exactly "Petty Cash Fund".
SELECT code, name, account_type, branch_id FROM chart_of_accounts
WHERE name ILIKE '%petty%cash%';
