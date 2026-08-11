import { supabase } from '@/lib/supabase/client';
import { sendPushNotification } from '@/lib/push';

// Broadcasts one notification (in-app row + push) per role listed — used
// for things like "a new loan is pending approval", where whoever holds
// that role needs to know, not one specific person.
//
// Administrator always gets a copy too, whether or not it's in the passed
// list — the owner/admin wants full visibility into everything happening
// in the system, not just the events some call site remembered to
// explicitly address to them.
//
// Pass branchId to scope it to just that branch's staff (e.g. only the
// Branch Manager of the branch the loan belongs to, not every Branch
// Manager company-wide) — company-wide roles like Administrator ignore
// branchId entirely and always reach everyone with that role, since they
// aren't tied to one branch. Omit branchId for a role that has no
// meaningful branch (rare) to keep the old company-wide behavior.
export async function notifyRoles(recipientTypes: string[], params: { type: string; title: string; message: string; url?: string }, branchId?: string | null): Promise<void> {
  const allTypes = recipientTypes.includes('administrator') ? recipientTypes : [...recipientTypes, 'administrator'];
  const rows = allTypes.map((recipientType) => ({
    type: params.type,
    recipient_type: recipientType,
    branch_id: recipientType === 'administrator' ? null : (branchId ?? null),
    message: params.message,
    channel: 'in_app',
    status: 'sent',
    sent_at: new Date().toISOString(),
  }));
  await supabase.from('notifications').insert(rows);
  for (const recipientType of allTypes) {
    sendPushNotification({
      recipientType,
      branchId: recipientType === 'administrator' ? undefined : (branchId ?? undefined),
      title: params.title,
      body: params.message,
      url: params.url,
    });
  }
}

// Notifies one specific person (e.g. "your leave request was approved") —
// only works if that person has a linked profile (a login account was
// created for them; see employees.profile_id). Silently does nothing
// otherwise, since there's no other way to reach someone with no account.
// Administrator always gets a copy too, same reasoning as notifyRoles —
// full visibility into everything, personal notifications included.
export async function notifyProfile(profileId: string | null | undefined, params: { type: string; title: string; message: string; url?: string; recipientName?: string | null }): Promise<void> {
  if (!profileId) return;
  await supabase.from('notifications').insert([
    {
      type: params.type,
      recipient_type: 'individual',
      recipient_id: profileId,
      recipient_name: params.recipientName ?? null,
      message: params.message,
      channel: 'in_app',
      status: 'sent',
      sent_at: new Date().toISOString(),
    },
    {
      type: params.type,
      recipient_type: 'administrator',
      branch_id: null,
      message: params.message,
      channel: 'in_app',
      status: 'sent',
      sent_at: new Date().toISOString(),
    },
  ]);
  sendPushNotification({ profileId, title: params.title, body: params.message, url: params.url });
  sendPushNotification({ recipientType: 'administrator', title: params.title, body: params.message, url: params.url });
}
