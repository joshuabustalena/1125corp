-- Phase 9 of the Branch Manager Revision PRD: a formal request/approval
-- queue for customer credit-limit increases (separate from the existing
-- direct bump-during-loan-approval endpoint, which stays as-is for that
-- specific over-limit-at-approval-time case).
CREATE TABLE IF NOT EXISTS credit_limit_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  current_limit numeric(12,2) NOT NULL,
  requested_limit numeric(12,2) NOT NULL,
  reason text,
  status text DEFAULT 'pending',
  reviewed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE credit_limit_requests ENABLE ROW LEVEL SECURITY;

-- Matches this project's existing pattern (e.g. employee_loans): broad
-- table-level access for any authenticated user, with the real role-based
-- restrictions enforced in the app itself.
DROP POLICY IF EXISTS "credit_limit_requests_select" ON credit_limit_requests;
CREATE POLICY "credit_limit_requests_select" ON credit_limit_requests FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "credit_limit_requests_insert" ON credit_limit_requests;
CREATE POLICY "credit_limit_requests_insert" ON credit_limit_requests FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "credit_limit_requests_update" ON credit_limit_requests;
CREATE POLICY "credit_limit_requests_update" ON credit_limit_requests FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
