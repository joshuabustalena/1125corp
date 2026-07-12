/*
  Cashier should also see the Attendance tab, same as Branch Manager.
  Adds "attendance" to their permission set. Run once in SQL Editor.
*/
update roles
set permissions = permissions || '["attendance"]'::jsonb
where name = 'Cashier' and not (permissions @> '["attendance"]'::jsonb);
