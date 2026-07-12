/*
  A pre-existing bug always saved payments.customer_id as NULL (the code
  evaluated to `undefined` regardless of condition). This backfills it from
  each payment's loan, so the new customer filter on the Payments page also
  works correctly on existing records. Run once in SQL Editor.
*/
update payments p
set customer_id = l.customer_id
from loans l
where p.loan_id = l.id and p.customer_id is null;
