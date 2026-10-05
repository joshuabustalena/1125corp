-- Leave balance counters (employees.paid_leaves_used / special_leaves_used)
-- were updated from the browser with a plain UPDATE on employees, which RLS
-- only allows for Administrators. A Branch Manager approving a leave got no
-- error but changed nothing, so every leave a Branch Manager approved was
-- never deducted (found Oct 2026: Carl Del Mundo, Randy Madlangbayan, Mia Lyn
-- Maglaque, Rommel Matawaran). The browser also computed "current + days"
-- from data loaded when the page opened, so two quick Admin entries could
-- overwrite each other and count only once.
--
-- This applies the change inside the database in one atomic statement, and
-- allows exactly who may approve leave: an Administrator for anyone, or a
-- Branch Manager for an employee in their own branch. Safe to re-run.

CREATE OR REPLACE FUNCTION adjust_leave_balance(p_employee_id uuid, p_bucket text, p_days int)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch uuid;
  v_new int;
BEGIN
  -- COALESCE matters: with no signed-in user current_role_name() is NULL,
  -- which made the whole condition NULL, and "IF NOT NULL" does not raise,
  -- so the first version of this let anonymous calls through.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;

  IF p_bucket NOT IN ('paid', 'special') THEN
    RAISE EXCEPTION 'Unknown leave bucket: %', p_bucket;
  END IF;

  SELECT branch_id INTO v_branch FROM employees WHERE id = p_employee_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  IF NOT COALESCE(
    is_admin()
    OR (current_role_name() = 'Branch Manager'
        AND v_branch IS NOT NULL
        AND v_branch = (SELECT branch_id FROM profiles WHERE id = auth.uid())),
    false
  ) THEN
    RAISE EXCEPTION 'You are not allowed to change this employee''s leave balance';
  END IF;

  IF p_bucket = 'paid' THEN
    UPDATE employees SET paid_leaves_used = GREATEST(0, COALESCE(paid_leaves_used, 0) + p_days)
    WHERE id = p_employee_id RETURNING paid_leaves_used INTO v_new;
  ELSE
    UPDATE employees SET special_leaves_used = GREATEST(0, COALESCE(special_leaves_used, 0) + p_days)
    WHERE id = p_employee_id RETURNING special_leaves_used INTO v_new;
  END IF;

  RETURN v_new;
END;
$$;

-- New functions are executable by PUBLIC (including the anon role) unless
-- revoked, so only signed-in users may call this one.
REVOKE ALL ON FUNCTION adjust_leave_balance(uuid, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION adjust_leave_balance(uuid, text, int) TO authenticated;
