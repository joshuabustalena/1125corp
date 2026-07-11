import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Narrow, self-service-only endpoint: updates ONLY the photo_url column,
// and ONLY on the employee row linked to the caller's own account (via
// profile_id, falling back to email for records not yet linked). This
// exists because the `employees` table's RLS intentionally restricts
// UPDATE to admins only — this route lets a non-admin's profile photo
// still reach their HR record without loosening that table's security
// for anything else.
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    return NextResponse.json({ error: 'Missing authorization token' }, { status: 401 });
  }

  const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !user?.email) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
  }

  const { photo_url } = await request.json();
  if (!photo_url) {
    return NextResponse.json({ error: 'photo_url is required' }, { status: 400 });
  }

  const { data: linked } = await supabaseAdmin.from('employees').update({ photo_url }).eq('profile_id', user.id).select('id');
  if (!linked || linked.length === 0) {
    const { error } = await supabaseAdmin.from('employees').update({ photo_url }).eq('email', user.email);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }

  return NextResponse.json({ success: true });
}
