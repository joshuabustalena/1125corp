/*
  A pre-existing bug never saved payments.collector_id or receipts.collector_id
  when posting a payment, so the Collector column on the Payments page always
  showed blank. This backfills both from each payment's loan. Run once in the
  SQL Editor.
*/
update payments p
set collector_id = l.collector_id
from loans l
where p.loan_id = l.id and p.collector_id is null and l.collector_id is not null;

update receipts r
set collector_id = l.collector_id
from loans l
where r.loan_id = l.id and r.collector_id is null and l.collector_id is not null;
