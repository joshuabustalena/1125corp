/*
  Adds Philippine holiday pay to payroll generation.

  The Holiday Calendar (Settings > Holidays) has existed since the schema
  was created but was never actually wired into payroll — it was a
  reference calendar with no effect on anyone's pay.

  Client's rule, standard DOLE treatment:
    Regular Holiday   — worked: 200% of the daily rate (double pay).
                         not worked: 100% (still a paid day).
    Special Holiday   — worked: 130% of the daily rate.
                         not worked: 0% (no pay, same as an ordinary absence).

  Branch Manager (fixed semi-monthly salary, pay_type = 'monthly') is
  excluded — same reasoning already applied to the birthday bonus and leave
  pay just above it in generatePayroll(): a fixed salary already doesn't
  depend on which specific days were worked, so the day-by-day premium
  doesn't apply the same way.

  holiday_pay is stored as the EXTRA amount on top of whatever basic_salary
  already counted for that day (1x if the day has a present/late attendance
  record, 0x if not) — not the day's total pay — so it adds cleanly:
    Regular,  worked: basic_salary already has 1x -> holiday_pay = +1x (2x total)
    Regular,  not worked: basic_salary has 0x -> holiday_pay = +1x (1x total)
    Special,  worked: basic_salary already has 1x -> holiday_pay = +0.3x (1.3x total)
    Special,  not worked: basic_salary has 0x -> holiday_pay = +0 (0x total)

  holiday_days counts how many holidays in the cutoff actually contributed
  pay (every worked or unworked Regular Holiday, only worked Special
  Holidays) — kept only for a friendly payslip label ("Holiday Pay (2
  holidays)"), the same light-touch detail level birthday_bonus/leave_pay
  already get (a flag / a day count, not a full itemized breakdown).
*/

ALTER TABLE payroll ADD COLUMN IF NOT EXISTS holiday_pay numeric NOT NULL DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS holiday_days integer NOT NULL DEFAULT 0;
