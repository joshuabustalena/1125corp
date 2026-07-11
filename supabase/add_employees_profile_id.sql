/*
  Links employees to their login account directly via profile_id, instead of
  matching by email (which breaks if there are duplicate/mismatched email
  values across the two tables). Run once in SQL Editor.
*/
alter table employees add column if not exists profile_id uuid references profiles(id) on delete set null;

-- One-time backfill: link existing employees to their matching profile by email,
-- for accounts that were created before this column existed.
update employees e
set profile_id = p.id
from profiles p
where e.profile_id is null and p.email = e.email;
