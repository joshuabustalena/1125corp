import { supabase } from '@/lib/supabase/client';

// Push service endpoints require the VAPID public key as a raw Uint8Array,
// not the base64url string it's normally shared as.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export function isPushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
}

export async function getPushSubscriptionState(): Promise<'unsupported' | 'denied' | 'subscribed' | 'unsubscribed'> {
  if (!isPushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return subscription ? 'subscribed' : 'unsubscribed';
}

// Asks the browser for notification permission, subscribes this device to
// the push service, and saves the subscription against the signed-in
// profile so app/api/push/send knows where to deliver pushes for them.
export async function subscribeToPush(profileId: string): Promise<boolean> {
  if (!isPushSupported()) return false;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidPublicKey) return false;

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription()
    ?? await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });

  const json = subscription.toJSON();
  const { error } = await supabase.from('push_subscriptions').upsert({
    profile_id: profileId,
    endpoint: json.endpoint,
    p256dh: json.keys?.p256dh,
    auth: json.keys?.auth,
  }, { onConflict: 'endpoint' });

  return !error;
}

export async function unsubscribeFromPush(): Promise<void> {
  if (!isPushSupported()) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
  await subscription.unsubscribe();
}

// Fire-and-forget, same as postJournalEntry — the notification row this
// accompanies has already been saved, so a failed push must never surface
// as an error on whatever action triggered it. Pass either recipientType
// (broadcast to a whole role, optionally narrowed to one branch via
// branchId) or profileId (one specific person).
export async function sendPushNotification(params: { recipientType?: string; branchId?: string; profileId?: string; title: string; body: string; url?: string }): Promise<void> {
  try {
    await fetch('/api/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  } catch {
    // swallow — see comment above
  }
}
