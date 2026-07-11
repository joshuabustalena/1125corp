import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function POST(request: NextRequest) {
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
    return NextResponse.json({ error: 'Only administrators can delete login accounts' }, { status: 403 });
  }

  const { profile_id } = await request.json();
  if (!profile_id) {
    return NextResponse.json({ error: 'profile_id is required' }, { status: 400 });
  }

  // Deleting the auth user cascades to remove the matching profiles row too
  // (profiles.id references auth.users(id) on delete cascade).
  const { error } = await supabaseAdmin.auth.admin.deleteUser(profile_id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
