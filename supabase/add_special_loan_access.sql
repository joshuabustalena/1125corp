/*
  Per-employee toggle for whether an employee can see the "Special Loans"
  tab on the Employee Loans page at all (SSS Loan, Pag-IBIG Loan, Service
  Vehicle, Uniform, Cash Shortage) — a separate, finer-grained control from
  the site-wide "Employee Loans" permission on the Access tab, which only
  governs whether the page is reachable in the first place.

  Client's ask: an Admin-only checklist of employee names, and only a
  checked employee sees/has access to Special Loans in their own account —
  everyone else doesn't see that tab at all (Administrator and Branch
  Manager are unaffected either way; they already see everything).

  Auto-granted to anyone who already has a Special Loan record, so this
  doesn't yank visibility away from an employee who's mid-way through
  paying one off the moment it ships. New employees default to false —
  Admin grants it explicitly per the new checklist.
*/

ALTER TABLE employees ADD COLUMN IF NOT EXISTS special_loan_access boolean NOT NULL DEFAULT false;

UPDATE employees e
SET special_loan_access = true
WHERE special_loan_access = false
  AND EXISTS (SELECT 1 FROM employee_special_loans sl WHERE sl.employee_id = e.id);

-- Confirmation: lists who now has access and why.
SELECT e.id, e.first_name, e.last_name, e.special_loan_access,
       EXISTS (SELECT 1 FROM employee_special_loans sl WHERE sl.employee_id = e.id) AS has_existing_special_loan
FROM employees e
ORDER BY e.special_loan_access DESC, e.last_name;
