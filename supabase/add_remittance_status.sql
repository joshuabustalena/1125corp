-- "pending" = collected by a field collector, recorded, but not yet
-- reconciled into a branch's Daily Cash Count. "received" = swept into a
-- completed cash count, so it doesn't get counted again on a later day.
--
-- Existing rows predate this concept entirely, so they're backfilled as
-- already "received" (historical/reconciled) rather than suddenly showing
-- up as pending amounts owed. Only new remittances going forward default
-- to "pending" until a cash count consumes them.
ALTER TABLE remittances ADD COLUMN IF NOT EXISTS status text;
UPDATE remittances SET status = 'received' WHERE status IS NULL;
ALTER TABLE remittances ALTER COLUMN status SET DEFAULT 'pending';
