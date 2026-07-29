import { NextRequest, NextResponse } from 'next/server';
import webpush from 'web-push';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

function roleToRecipientType(roleName: string | null | undefined): string | null {
  if (!roleName) return null;
  return roleName.toLowerCase().replace(/\s+/g, '_');
}

// Fans a single notification out to every device subscribed for either a
// whole role (recipientType — mirrors the `recipient_type` string already
// used on the `notifications` table, e.g. 'administrator', 'branch_manager',
// or 'all' for everyone) or one specific person (profileId — used for
// personal notifications like "your leave request was approved", where
// broadcasting to the requester's entire role would reach the wrong people).
export async function POST(request: NextRequest) {
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT;
  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    return NextResponse.json({ error: 'Push is not configured' }, { status: 501 });
  }
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  const { recipientType, branchId, profileId, title, body, url } = await request.json();
  if ((!recipientType && !profileId) || !title || !body) {
    return NextResponse.json({ error: 'title, body, and either recipientType or profileId are required' }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdmin();

  let profileIds: string[];
  if (profileId) {
    profileIds = [profileId];
  } else if (recipientType === 'all') {
    const { data: profiles } = await supabaseAdmin.from('profiles').select('id').eq('status', 'active');
    profileIds = (profiles ?? []).map((p: any) => p.id);
  } else {
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, branch_id, roles(name)')
      .eq('status', 'active');
    // Administrator is company-wide, never branch-scoped — branchId only
    // narrows roles that actually belong to one branch (Branch Manager,
    // Cashier, etc).
    profileIds = (profiles ?? [])
      .filter((p: any) => roleToRecipientType(p.roles?.name) === recipientType)
      .filter((p: any) => recipientType === 'administrator' || !branchId || p.branch_id === branchId)
      .map((p: any) => p.id);
  }

  if (profileIds.length === 0) {
    return NextResponse.json({ sent: 0 });
  }

  const { data: subscriptions } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .in('profile_id', profileIds);

  const payload = JSON.stringify({ title, body, url: url ?? '/notifications' });
  const staleIds: string[] = [];
  let sent = 0;

  await Promise.all((subscriptions ?? []).map(async (sub: any) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
      sent++;
    } catch (err: any) {
      // 404/410 = the browser's push service no longer recognizes this
      // subscription (uninstalled, permission revoked, etc.) — clean it up
      // so future sends don't keep retrying a dead endpoint.
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        staleIds.push(sub.id);
      }
    }
  }));

  if (staleIds.length > 0) {
    await supabaseAdmin.from('push_subscriptions').delete().in('id', staleIds);
  }

  return NextResponse.json({ sent });
}
