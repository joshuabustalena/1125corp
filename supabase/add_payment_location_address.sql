/*
  Stores the human-readable address resolved from GPS coordinates at the
  moment a payment is posted (same pattern as attendance's location_address).
  Run once in the SQL Editor.
*/
alter table payments add column if not exists location_address text;
