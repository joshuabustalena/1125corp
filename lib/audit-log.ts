import { supabase } from '@/lib/supabase/client';

// Every table mutation (INSERT/UPDATE/DELETE) is already logged automatically
// by the log_audit_trail() database trigger (see
// supabase/add_audit_log_triggers.sql) — it fires regardless of whether the
// change came through a plain .insert()/.update()/.delete() or an RPC
// (apply_loan_payment, etc.), so most of the app never needs to call this.
//
// This helper exists only for the two things a table trigger structurally
// cannot see:
//   1. Login/logout — not a row mutation on any table.
//   2. Giving a business-meaningful 'approve'/'reject' label to a status
//      change the trigger would otherwise only record as a generic 'edit'
//      (the full before/after diff is still captured either way — this is
//      purely so the Audit Logs page's action filter has real data for
//      those two options).
export type AuditAction = 'login' | 'logout' | 'approve' | 'reject';

// Never throws and never blocks the action that triggered it — same
// resilience contract as postJournalEntry in lib/ledger.ts. A failed audit
// write must not roll back or interrupt whatever real business action
// prompted it.
export async function logAudit(params: {
  action: AuditAction;
  entityType?: string | null;
  entityId?: string | null;
  details?: Record<string, unknown> | null;
  // Every caller should pass this explicitly (profile?.id from useAuth() is
  // always in scope wherever this is called) — NOT left to fall back to a
  // network call here. supabase.auth.getUser() re-validates the token
  // against the Auth server on every call (unlike getSession(), which just
  // reads local storage), and doing that on every single approve/reject
  // click turned out to be exactly what was intermittently signing users
  // out mid-action and bouncing them back to the login page. A missing
  // user_id is a cosmetic gap in one log row; a surprise logout mid-approval
  // is not an acceptable price for it.
  userId?: string | null;
}): Promise<void> {
  try {
    await supabase.from('audit_logs').insert({
      user_id: params.userId ?? null,
      action: params.action,
      entity_type: params.entityType ?? null,
      entity_id: params.entityId ?? null,
      details: params.details ?? null,
    });
  } catch {
    // swallow — see comment above
  }
}
