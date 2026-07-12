/*
  Lets a Cashier record why a loan application was declined, so the Branch
  Manager who submitted it can see the reason. Run once in the SQL Editor.
*/
alter table loans add column if not exists decline_reason text;
