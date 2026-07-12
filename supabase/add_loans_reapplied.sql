/*
  Tracks whether a declined loan has already been re-submitted as a new
  application, so the "Re-apply" button only needs to be clicked once and
  then disappears for that row. Run once in the SQL Editor.
*/
alter table loans add column if not exists reapplied boolean default false;
