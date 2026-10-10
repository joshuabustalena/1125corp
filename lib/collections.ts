// What a loan's release itself collects: the day-one first payment plus a
// renewal's offset (the old loan's balance), both withheld from the
// proceeds. The service fee is withheld too but is income, not a
// collection. "Total Amount Collected" = cash payments + this, per Kat
// (Oct 2026). Shared by the Monthly Collection report and the Dashboard's
// collection cards so the two can't drift apart.
export const RELEASED_LOAN_STATUSES = ['active', 'renewed', 'paid', 'written_off'];

export function collectedAtRelease(loan: {
  daily_payment?: number | string | null;
  total_payable?: number | string | null;
  term_days?: number | null;
  offset_balance?: number | string | null;
}): number {
  const firstPayment = Number(loan.daily_payment) > 0
    ? Number(loan.daily_payment)
    : ((loan.term_days ?? 0) > 0 ? (Number(loan.total_payable) || 0) / (loan.term_days as number) : 0);
  return firstPayment + (Number(loan.offset_balance) || 0);
}
