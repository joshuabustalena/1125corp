/*
  Lets an employee (typically a Collector) be assigned to a specific
  collection area within their branch. Run once in SQL Editor.
*/
alter table employees add column if not exists area_id uuid references areas(id) on delete set null;
