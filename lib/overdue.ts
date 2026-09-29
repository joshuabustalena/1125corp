// Shared by the Dashboard's Overdue stat cards and the Reports page's
// Overdue Amount & Rate report — Katrina flagged (Sep 29) that the two kept
// disagreeing (Dashboard showed past-due only; Reports already had the
// merged figure), which traces back to this logic living as two separate,
// silently-diverging copies. One shared function now, so they can't drift
// apart again.

// Same Sunday-exclusion convention as Collection List's delay formula.
export function countCollectionDaysBetween(start: Date, end: Date): number {
  if (start > end) return 0;
  let count = 0;
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (d.getDay() !== 0) count++;
  }
  return count;
}

// One loan's exposure, merging the two things the client tracks together:
// the full balance once a loan is genuinely past its due date, and — for a
// loan still inside its term — how far behind the daily schedule it has
// fallen. Client asked (Aug 2026) for the Overdue figures to include BOTH,
// "even if not past due", so every part of the app that reports an overdue
// amount agrees with the others.
export function overdueOrDelayFor(l: any, today: Date): { amount: number; isPastDue: boolean; daysOverdue: number } {
  const totalPayable = Number(l.total_payable) || 0;
  const remainingBalance = Number(l.remaining_balance) || 0;
  const isPastDue = !!(l.due_date && new Date(l.due_date) < today);
  if (isPastDue) {
    return {
      amount: remainingBalance,
      isPastDue: true,
      daysOverdue: Math.floor((today.getTime() - new Date(l.due_date).getTime()) / 86400000),
    };
  }
  // Always the auto-computed split (Total Payable / Term Days), never the
  // stored daily_payment — the same rule Collection List follows.
  const dailyPayment = l.term_days > 0 ? totalPayable / l.term_days : 0;
  if (!l.release_date || dailyPayment <= 0) return { amount: 0, isPastDue: false, daysOverdue: 0 };
  const firstDueDay = new Date(l.release_date);
  if (firstDueDay > today) return { amount: 0, isPastDue: false, daysOverdue: 0 };
  const collectionDaysElapsed = countCollectionDaysBetween(firstDueDay, today);
  const amountAlreadyPaid = totalPayable - remainingBalance;
  const behind = dailyPayment * collectionDaysElapsed - amountAlreadyPaid;
  return { amount: Math.round(Math.max(0, behind) * 100) / 100, isPastDue: false, daysOverdue: 0 };
}
