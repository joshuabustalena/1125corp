/*
  Lets a notification reference the loan it's about, so the due-date check
  can tell which loans have already been notified about (avoids re-creating
  the same "upcoming due" / "overdue" alert every time someone opens the
  Notifications page). Run once in the SQL Editor.
*/
alter table notifications add column if not exists loan_id uuid references loans(id) on delete cascade;
