/*
  Adds a column to store the human-readable address resolved from GPS
  coordinates at check-in/check-out time. Run once in the SQL Editor.
*/
alter table attendance add column if not exists location_address text;
