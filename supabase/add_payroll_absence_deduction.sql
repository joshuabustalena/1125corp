/*
  Absences on a fixed (monthly) salary — Kat, Oct 2026.

  A fixed-salary employee is paid a flat half-month each cutoff. Approved
  leave is now credited on the payslip, and any other scheduled work day
  they didn't attend is deducted at one day's pay: salary / 26 for a Branch
  Manager (Mon–Sat), salary / 20 for Admin Staff (Mon–Fri). Holidays are
  never counted as absences.

    absent_days        NULL for daily-rate staff (their basic pay already
                       counts only days present); the count for fixed salary.
                       NULL also marks a payslip generated before this, which
                       the 13th month works out live instead.
    absence_deduction  the amount deducted, part of Total Deductions.

  Run this BEFORE deploying the matching code — payroll generation writes
  both columns and would fail without them. Safe to re-run.
*/

ALTER TABLE payroll ADD COLUMN IF NOT EXISTS absent_days integer;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS absence_deduction numeric NOT NULL DEFAULT 0;
