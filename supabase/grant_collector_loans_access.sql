/*
  Re-grants "loans" to the Collector role (previously revoked). Run once in
  the SQL Editor.
*/
update roles
set permissions = permissions || '["loans"]'::jsonb
where name = 'Collector' and not (permissions @> '["loans"]'::jsonb);
