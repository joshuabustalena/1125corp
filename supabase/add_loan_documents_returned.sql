-- Monthly Release report's tick-off column (Kat, Oct 2026): marks that a
-- loan's signed documents have been returned to the office. It used to live
-- only in the browser and vanished on refresh; it's now saved per loan so
-- the monitoring survives across days and devices.
--
-- Updated through the existing loans_update RLS policy (same roles that can
-- already edit a loan), and every change is captured by the loans audit
-- trigger. Safe to re-run.
ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS documents_returned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS documents_returned_at timestamptz,
  ADD COLUMN IF NOT EXISTS documents_returned_by uuid REFERENCES profiles(id) ON DELETE SET NULL;
