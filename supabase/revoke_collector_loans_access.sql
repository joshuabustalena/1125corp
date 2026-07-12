/*
  Undoes the "loans" grant from grant_collector_loans_payments_access.sql —
  Collector should keep "payments" but not see the Loans tab. Run once in
  the SQL Editor.
*/
update roles
set permissions = permissions - 'loans'
where name = 'Collector';
