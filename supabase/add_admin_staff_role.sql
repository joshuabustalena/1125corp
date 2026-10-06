-- Admin Staff role (Kat, Oct 2026). Sees both branches. Access:
--   Lending  : view all; can post payments (collection still records under
--              the customer's field collector)
--   HR       : Employees view + upload documents; Payroll, Employee Loans,
--              Leave Requests view only; own attendance only (only an
--              Administrator reviews an Admin Staff's attendance)
--   Finance  : Financial Statements, Shareholders, Cash Count, Collection
--              List, Remittance, Reports, Write-Off — full
--   System   : Audit Logs
--   No access: General Ledger, Journal Entries, Chart of Accounts.
--
-- '<key>_read' entries open a page view-only (lib/permissions.ts).
-- Each policy below is the current definition with 'Admin Staff' added for
-- an action this role is allowed to take. Safe to re-run.

INSERT INTO roles (name, description, permissions)
SELECT 'Admin Staff',
       'Company-wide office staff: views lending and HR, posts payments, runs finance pages',
       '["customers_read","loans_read","payments","penalties_read","receipts","credit_limit_requests_read","broadcast_sms_read","employees_read","payroll_read","employee_loans_read","leave_requests_read","attendance","financial_statements","cash_count","collection_list","remittance","reports","write_off","audit_logs"]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'Admin Staff');

UPDATE roles
SET permissions = '["customers_read","loans_read","payments","penalties_read","receipts","credit_limit_requests_read","broadcast_sms_read","employees_read","payroll_read","employee_loans_read","leave_requests_read","attendance","financial_statements","cash_count","collection_list","remittance","reports","write_off","audit_logs"]'::jsonb
WHERE name = 'Admin Staff';

-- Posting a payment updates the loan's balance through apply_loan_payment
-- (SECURITY INVOKER); Write-Off updates the loan too.
DROP POLICY IF EXISTS "loans_update" ON loans;
CREATE POLICY "loans_update" ON loans FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (is_admin() OR current_role_name() IN ('Branch Field Collector', 'Branch Proxy Collector', 'Branch Manager', 'Cashier', 'Admin Staff'));

-- Remittance and Cash Count.
DROP POLICY IF EXISTS "remittances_insert" ON remittances;
CREATE POLICY "remittances_insert" ON remittances FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR current_role_name() IN ('Cashier', 'Admin Staff'));

DROP POLICY IF EXISTS "cash_counts_insert" ON cash_counts;
CREATE POLICY "cash_counts_insert" ON cash_counts FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR current_role_name() IN ('Cashier', 'Admin Staff'));

-- Remittance and Write-Off post their own journal entries. Admin Staff has
-- no access to the Journal Entries page itself; this only lets those two
-- flows record their ledger lines.
DROP POLICY IF EXISTS "journal_entries_insert" ON journal_entries;
CREATE POLICY "journal_entries_insert" ON journal_entries FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR current_role_name() IN ('Cashier', 'Accounting', 'Admin Staff'));

DROP POLICY IF EXISTS "journal_entry_lines_insert" ON journal_entry_lines;
CREATE POLICY "journal_entry_lines_insert" ON journal_entry_lines FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR current_role_name() IN ('Cashier', 'Accounting', 'Admin Staff'));

-- Shareholders.
DROP POLICY IF EXISTS "shareholders_insert" ON shareholders;
CREATE POLICY "shareholders_insert" ON shareholders FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR current_role_name() IN ('Accounting', 'Admin Staff'));

DROP POLICY IF EXISTS "shareholders_update" ON shareholders;
CREATE POLICY "shareholders_update" ON shareholders FOR UPDATE TO authenticated
  USING (is_admin() OR current_role_name() IN ('Accounting', 'Admin Staff'))
  WITH CHECK (is_admin() OR current_role_name() IN ('Accounting', 'Admin Staff'));

-- Employee documents: upload and replace (delete stays Administrator-only).
DROP POLICY IF EXISTS "emp_docs_insert" ON employee_documents;
CREATE POLICY "emp_docs_insert" ON employee_documents FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR current_role_name() = 'Admin Staff');

DROP POLICY IF EXISTS "emp_docs_update" ON employee_documents;
CREATE POLICY "emp_docs_update" ON employee_documents FOR UPDATE TO authenticated
  USING (is_admin() OR current_role_name() = 'Admin Staff')
  WITH CHECK (is_admin() OR current_role_name() = 'Admin Staff');
