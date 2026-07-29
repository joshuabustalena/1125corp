/*
  Per-branch notification scoping — run once in the Supabase SQL Editor.
  Safe to re-run (idempotent).

  Role-broadcast notifications (recipient_type = 'branch_manager', 'cashier',
  etc.) used to reach EVERY user with that role company-wide, even though
  the event usually only concerns one branch. `branch_id` lets a broadcast
  be scoped to just that branch's staff — NULL means unscoped (reaches
  everyone with the role, same as before; used for company-wide roles like
  Administrator, and for old rows created before this column existed).
*/

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_branch ON notifications(branch_id);
