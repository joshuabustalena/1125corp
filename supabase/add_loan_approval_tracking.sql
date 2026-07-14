/*
  Tracks who approved a loan and when — needed for the "Verified by /
  Branch Manager" field on the Acknowledgement Receipt of Loan document.
  Run once in the Supabase SQL Editor. Safe to re-run any time.
*/
ALTER TABLE loans ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS approved_at timestamptz;
