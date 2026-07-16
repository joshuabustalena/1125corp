import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

// Narrow, purpose-built endpoint: lets a Branch Manager raise a customer's
// max_loan_limit specifically while approving a loan that exceeds it.
// customers.max_loan_limit is otherwise Admin-only to edit (customers_update
// RLS policy), so this uses the service role and checks the role itself
// rather than loosening that policy for customers in general.
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
  if (requesterRole !== 'Administrator' && requesterRole !== 'Branch Manager') {
    return NextResponse.json({ error: 'Only a Branch Manager or Administrator can adjust a customer\'s max loan limit' }, { status: 403 });
  }

  const { customer_id, new_limit } = await request.json();
  if (!customer_id || !new_limit || Number(new_limit) <= 0) {
    return NextResponse.json({ error: 'customer_id and a positive new_limit are required' }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from('customers').update({ max_loan_limit: Number(new_limit) }).eq('id', customer_id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
