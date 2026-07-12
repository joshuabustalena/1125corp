/*
  Collector accounts should also see the Customers, Loans, and Payments tabs
  (Customers is already granted). Adds "loans" and "payments" to their
  permission set, one at a time so re-running this is safe. Run once in
  the SQL Editor.
*/
update roles
set permissions = permissions || '["loans"]'::jsonb
where name = 'Collector' and not (permissions @> '["loans"]'::jsonb);

update roles
set permissions = permissions || '["payments"]'::jsonb
where name = 'Collector' and not (permissions @> '["payments"]'::jsonb);
