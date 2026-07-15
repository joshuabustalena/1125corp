import { supabase } from '@/lib/supabase/client';

const UPCOMING_DUE_WINDOW_DAYS = 3;

// Check-on-load due-date alerting: there's no cron/scheduled-job
// infrastructure in this project, so this runs whenever a Branch Manager
// or Admin opens a page that calls it (Notifications, Dashboard) rather
// than firing the instant a loan becomes due. Each loan gets at most one
// 'upcoming_due' and one 'overdue' notification (no daily repeats).
export async function checkDueDateAlerts(): Promise<void> {
  try {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const windowEnd = new Date(today.getTime() + UPCOMING_DUE_WINDOW_DAYS * 86400000).toISOString().split('T')[0];

    const { data: loans } = await supabase
      .from('loans')
      .select('id, loan_number, due_date, remaining_balance, customers(first_name, last_name)')
      .eq('status', 'active')
      .gt('remaining_balance', 0)
      .lte('due_date', windowEnd);

    if (!loans || loans.length === 0) return;

    const loanIds = loans.map(l => l.id);
    const { data: existing } = await supabase
      .from('notifications')
      .select('loan_id, type')
      .in('loan_id', loanIds)
      .in('type', ['upcoming_due', 'overdue']);

    const alreadyNotified = new Set((existing ?? []).map((n: any) => `${n.loan_id}:${n.type}`));

    const toInsert: any[] = [];
    for (const loan of loans as any[]) {
      const isOverdue = loan.due_date < todayStr;
      const type = isOverdue ? 'overdue' : 'upcoming_due';
      const key = `${loan.id}:${type}`;
      if (alreadyNotified.has(key)) continue;

      const customerName = loan.customers ? `${loan.customers.first_name} ${loan.customers.last_name}` : 'Unknown customer';
      const message = isOverdue
        ? `Loan ${loan.loan_number} (${customerName}) is overdue — was due ${loan.due_date}.`
        : `Loan ${loan.loan_number} (${customerName}) is due on ${loan.due_date}.`;

      toInsert.push({
        type,
        recipient_type: 'branch_manager',
        message,
        channel: 'in_app',
        status: 'sent',
        sent_at: new Date().toISOString(),
        loan_id: loan.id,
      });
    }

    if (toInsert.length > 0) {
      await supabase.from('notifications').insert(toInsert);
    }
  } catch {
    // Alerting must never block the page that triggered the check.
  }
}
