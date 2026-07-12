/*
  Cashier needs to see the Loans page to review and approve pending loan
  applications. Adds "loans" to their permission set. Run once in SQL Editor.
*/
update roles
set permissions = permissions || '["loans"]'::jsonb
where name = 'Cashier' and not (permissions @> '["loans"]'::jsonb);
