/*
  Saved Reports — every press of Generate on the Reports page keeps a copy
  of the result, so a past month can be opened again without downloading
  the CSV (Kat, Nov 2026).

  Matters most for Overdue Amount & Rate: it's always worked out as of
  TODAY from the loans' current balances, so a September figure can't be
  recomputed in October. Generating it at month end and keeping the copy is
  how a month's overdue stays on record.

  Who sees what:
    - Administrator / Admin Staff: every saved report.
    - Field Collector: only the ones they generated (their reports are
      limited to their own area).
    - Everyone else: their own branch's saved reports.
  Delete: an Administrator, or whoever generated it.
*/

CREATE TABLE IF NOT EXISTS saved_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type text NOT NULL,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,  -- NULL = All Branches
  area_id uuid REFERENCES areas(id) ON DELETE SET NULL,       -- NULL = All Areas
  branch_label text,
  area_label text,
  period_label text,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,                    -- startDate / endDate / monthFilter
  rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,                     -- total / count / average / overdueRate
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS saved_reports_type_created_idx ON saved_reports (report_type, created_at DESC);

ALTER TABLE saved_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saved_reports_select" ON saved_reports;
CREATE POLICY "saved_reports_select" ON saved_reports
  FOR SELECT TO authenticated USING (
    COALESCE(is_admin(), false)
    OR COALESCE(current_role_name() = 'Admin Staff', false)
    OR created_by = auth.uid()
    OR (
      COALESCE(current_role_name() <> 'Branch Field Collector', false)
      AND branch_id IS NOT NULL
      AND branch_id = (SELECT branch_id FROM profiles WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "saved_reports_insert" ON saved_reports;
CREATE POLICY "saved_reports_insert" ON saved_reports
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "saved_reports_delete" ON saved_reports;
CREATE POLICY "saved_reports_delete" ON saved_reports
  FOR DELETE TO authenticated USING (COALESCE(is_admin(), false) OR created_by = auth.uid());
