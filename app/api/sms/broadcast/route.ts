import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

// Semaphore allows up to 1000 recipients per call when they're passed as a
// comma-separated list in `number` — batching this way (instead of one
// request per customer) avoids the 120-requests/minute rate limit entirely
// for anything under ~120,000 recipients.
const SEMAPHORE_BATCH_SIZE = 1000;

// Philippine mobile numbers only — Semaphore expects 09XXXXXXXXX (11
// digits, i.e. no +63/63 prefix). Normalizes whatever format got typed into
// the Customer record (+639..., 639..., spaces/dashes) into that shape.
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('09')) return digits;
  if (digits.length === 12 && digits.startsWith('639')) return `0${digits.slice(2)}`;
  if (digits.length === 10 && digits.startsWith('9')) return `0${digits}`;
  return null;
}

export async function POST(request: NextRequest) {
  const supabaseAdmin = getSupabaseAdmin();
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    return NextResponse.json({ error: 'Missing authorization token' }, { status: 401 });
  }

  const { data: { user: requester }, error: requesterError } = await supabaseAdmin.auth.getUser(token);
  if (requesterError || !requester) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
  }

  const { data: requesterProfile } = await supabaseAdmin
    .from('profiles')
    .select('role_id, roles(name)')
    .eq('id', requester.id)
    .maybeSingle();

  const requesterRole = (requesterProfile as any)?.roles?.name;
  if (requesterRole !== 'Administrator') {
    return NextResponse.json({ error: 'Only administrators can send a broadcast SMS' }, { status: 403 });
  }

  const { message, customerIds, filterSummary } = await request.json();
  if (!message || typeof message !== 'string' || !message.trim()) {
    return NextResponse.json({ error: 'Message is required' }, { status: 400 });
  }
  if (!Array.isArray(customerIds) || customerIds.length === 0) {
    return NextResponse.json({ error: 'No recipients selected' }, { status: 400 });
  }

  const apiKey = process.env.SEMAPHORE_API_KEY;
  const senderName = process.env.SEMAPHORE_SENDER_NAME;
  if (!apiKey) {
    return NextResponse.json({ error: 'SEMAPHORE_API_KEY is not configured on the server' }, { status: 500 });
  }

  const { data: customers } = await supabaseAdmin
    .from('customers')
    .select('id, phone')
    .in('id', customerIds);

  const numbers = Array.from(new Set(
    (customers ?? [])
      .map((c: any) => c.phone ? normalizePhone(c.phone) : null)
      .filter((n: string | null): n is string => !!n)
  ));

  if (numbers.length === 0) {
    return NextResponse.json({ error: 'None of the selected customers have a usable phone number' }, { status: 400 });
  }

  const batches: string[][] = [];
  for (let i = 0; i < numbers.length; i += SEMAPHORE_BATCH_SIZE) {
    batches.push(numbers.slice(i, i + SEMAPHORE_BATCH_SIZE));
  }

  let sentCount = 0;
  let failedCount = 0;
  const errors: string[] = [];

  for (const batch of batches) {
    try {
      const body = new URLSearchParams({
        apikey: apiKey,
        number: batch.join(','),
        message: message.trim(),
        ...(senderName ? { sendername: senderName } : {}),
      });
      const res = await fetch('https://api.semaphore.co/api/v4/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const result = await res.json();
      if (!res.ok) {
        failedCount += batch.length;
        errors.push(typeof result === 'string' ? result : JSON.stringify(result));
      } else {
        // Semaphore returns one object per recipient for a bulk send.
        const created = Array.isArray(result) ? result.length : batch.length;
        sentCount += created;
        failedCount += Math.max(0, batch.length - created);
      }
    } catch (err: any) {
      failedCount += batch.length;
      errors.push(err?.message ?? 'Network error calling Semaphore');
    }
  }

  await supabaseAdmin.from('sms_broadcasts').insert({
    message: message.trim(),
    filter_summary: filterSummary ?? null,
    recipient_count: numbers.length,
    sent_count: sentCount,
    failed_count: failedCount,
    sent_by: requester.id,
  });

  return NextResponse.json({
    success: failedCount === 0,
    recipientCount: numbers.length,
    sentCount,
    failedCount,
    errors: errors.slice(0, 5),
  });
}
