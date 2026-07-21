-- Birthday leave / birthday double-pay:
-- 1. employees.birth_date is now required by the app (Add/Edit Employee
--    form) so payroll can detect when a pay period covers an employee's
--    birthday.
-- 2. payroll gets two new columns to record what happened on the
--    employee's birthday during that cutoff, so the payslip can show it
--    explicitly instead of silently folding it into basic pay:
--    - birthday_bonus: the peso amount added for the birthday (one day's
--      rate), whether or not the employee actually clocked in that day.
--    - birthday_worked: true if they clocked in on their birthday (bonus is
--      on top of their normal day's pay = double pay that day), false if
--      they didn't work (auto-present/paid birthday leave, single day's pay
--      for a day with no attendance record at all).
ALTER TABLE employees ADD COLUMN IF NOT EXISTS birth_date date;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS birthday_bonus numeric(12,2) DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS birthday_worked boolean;
