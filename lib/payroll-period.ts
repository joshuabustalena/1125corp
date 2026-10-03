// Semi-monthly payroll, paid on the 1st and the 16th of each month, each
// covering the cutoff that just ended before that pay date:
// - "1" (paid the 1st) covers the 16th of the PREVIOUS month through that
//   month's actual last day.
// - "16" (paid the 16th) covers the 1st–15th of the SAME month.
function pad(n: number) { return String(n).padStart(2, '0'); }
function toDateStr(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

export function getPeriodRange(payDateStr: string, period: string) {
  const payDate = new Date(payDateStr);
  const year = payDate.getFullYear();
  const month = payDate.getMonth();
  if (period === '1') {
    return { start: toDateStr(new Date(year, month - 1, 16)), end: toDateStr(new Date(year, month, 0)) };
  }
  return { start: toDateStr(new Date(year, month, 1)), end: toDateStr(new Date(year, month, 15)) };
}

// First day of the cutoff a work date falls in ('YYYY-MM-01' or
// 'YYYY-MM-16') — the same value getPeriodRange(...).start gives for the
// payroll that pays that date, so the two can be matched directly.
export function cutoffStartForDate(dateStr: string): string {
  return `${dateStr.slice(0, 7)}-${Number(dateStr.slice(8, 10)) <= 15 ? '01' : '16'}`;
}
