/*
  Per-employee page access, set from the Access tab on Add/Edit Employee.

  How access worked before
  ------------------------
  Purely by role: lib/auth-context.tsx read roles.permissions and every
  account with the same role got exactly the same tabs. Giving one Cashier
  access to Reports meant either changing the permissions of EVERY Cashier or
  inventing a new role.

  How it works now
  ----------------
  permissions_override is NULL for everyone by default, which means "just use
  the role's list" — so applying this migration changes nobody's access. Once
  an Administrator ticks boxes for one employee, that account's array is
  stored here and takes over from the role for that person only.

  An empty array [] is meaningful and NOT the same as NULL: it means this
  account was deliberately given no page permissions. That's why the column
  stays nullable instead of defaulting to '[]'.

  Run once in the Supabase SQL Editor. Safe to re-run.
*/

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS permissions_override jsonb;

COMMENT ON COLUMN profiles.permissions_override IS
  'Per-account page permissions. NULL = inherit from the role. An empty array means no access was granted, which is different from NULL.';
