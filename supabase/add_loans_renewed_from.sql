/*
  Links a renewal loan application back to the loan it renews, so:
  - approving the renewal can flip the old loan's status to 'renewed'
  - the payment calendar can walk the whole chain of renewals for one
    customer and show it as one continuous history.
  Run once in the SQL Editor.
*/
alter table loans add column if not exists renewed_from_loan_id uuid references loans(id) on delete set null;
