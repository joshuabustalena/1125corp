// Which days an employee is scheduled to work, and what one day of a fixed
// (monthly) salary is worth. Per Kat (Oct 2026): Admin Staff work Monday to
// Friday, so their day is salary / 20; everyone else works Monday to
// Saturday, so a Branch Manager's day is salary / 26. Sunday is never a
// work day. Shared by Payroll (absences, Days Present, 13th month) and
// Attendance (late/undertime) so the two can't disagree.
const FIVE_DAY_WEEK_POSITIONS = ['Admin Staff'];

type Scheduled = { position?: string | null };

export function worksFiveDayWeek(emp: Scheduled | null | undefined): boolean {
  return !!emp?.position && FIVE_DAY_WEEK_POSITIONS.includes(emp.position);
}

export function isScheduledWorkDay(dateStr: string, emp: Scheduled | null | undefined): boolean {
  const day = new Date(`${dateStr}T00:00:00`).getDay();
  if (day === 0) return false;
  return !(day === 6 && worksFiveDayWeek(emp));
}

function pad(n: number) { return String(n).padStart(2, '0'); }

// Every scheduled work day from start to end inclusive, as YYYY-MM-DD.
export function scheduledWorkDates(start: string, end: string, emp: Scheduled | null | undefined): string[] {
  const dates: string[] = [];
  const last = new Date(`${end}T00:00:00`);
  for (let d = new Date(`${start}T00:00:00`); d <= last; d.setDate(d.getDate() + 1)) {
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    if (isScheduledWorkDay(key, emp)) dates.push(key);
  }
  return dates;
}

// One day's pay: the daily rate itself for daily-rate staff, or the monthly
// salary spread over the employee's work days per month.
export function dailyRateOf(emp: Scheduled & { salary?: number | string | null; pay_type?: string | null }): number {
  const salary = Number(emp.salary) || 0;
  if (emp.pay_type !== 'monthly') return salary;
  return salary / (worksFiveDayWeek(emp) ? 20 : 26);
}
