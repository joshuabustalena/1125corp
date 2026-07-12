/*
  One-time backfill: creates a `collectors` row for every existing employee
  who is a Collector with a login account, but predates the employees <->
  collectors sync. Safe to re-run — skips anyone already synced.
*/
insert into collectors (profile_id, branch_id, area_id, status)
select e.profile_id, e.branch_id, e.area_id, e.status
from employees e
where e.position = 'Collector'
  and e.profile_id is not null
  and not exists (select 1 from collectors c where c.profile_id = e.profile_id);
