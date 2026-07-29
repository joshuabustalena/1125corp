-- SSS/PhilHealth/Pag-IBIG deduction config, editable by an Administrator
-- from Settings -> Deductions. Each is a JSON object so an Administrator
-- can choose "percent" (of that cutoff's expected basic pay) or "fixed"
-- (a flat peso amount), AND set a different value for the two actual pay
-- dates — the 1st of the month and the 16th of the month — since some
-- statutory deductions are only taken out once per month, not both cutoffs.
-- Percent values match what payroll previously had hardcoded (4.5/3.5/2),
-- so nothing changes for existing payrolls until an Administrator edits them.
INSERT INTO settings (key, value, category) VALUES
  ('sss_deduction', '{"type":"percent","period_1":4.5,"period_16":4.5}', 'payroll'),
  ('philhealth_deduction', '{"type":"percent","period_1":3.5,"period_16":3.5}', 'payroll'),
  ('pagibig_deduction', '{"type":"percent","period_1":2,"period_16":2}', 'payroll')
ON CONFLICT (key) DO NOTHING;
