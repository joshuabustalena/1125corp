import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { supabaseAdmin } from '@/lib/supabase/admin';

function generatePassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%&*';
  const all = upper + lower + digits + symbols;
  const pick = (chars: string) => chars[Math.floor(Math.random() * chars.length)];
  const required = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  const rest = Array.from({ length: 8 }, () => pick(all));
  return [...required, ...rest].sort(() => Math.random() - 0.5).join('');
}

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
    return NextResponse.json({ error: 'Only administrators can create login accounts' }, { status: 403 });
  }

  const { email, full_name, role_name, branch_id, employee_id } = await request.json();
  if (!email || !full_name || !role_name) {
    return NextResponse.json({ error: 'email, full_name, and role_name are required' }, { status: 400 });
  }

  const { data: role } = await supabaseAdmin.from('roles').select('id').eq('name', role_name).maybeSingle();
  if (!role) {
    return NextResponse.json({ error: `Role "${role_name}" not found` }, { status: 400 });
  }

  const password = generatePassword();

  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  });

  if (createError || !created.user) {
    return NextResponse.json({ error: createError?.message ?? 'Failed to create account' }, { status: 400 });
  }

  const { error: profileError } = await supabaseAdmin.from('profiles').insert({
    id: created.user.id,
    email,
    full_name,
    role_id: role.id,
    branch_id: branch_id || null,
    status: 'active',
  });

  if (profileError) {
    await supabaseAdmin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }

  if (employee_id) {
    await supabaseAdmin.from('employees').update({ profile_id: created.user.id }).eq('id', employee_id);

    // If this employee is a Collector, mirror them into the `collectors` table
    // too — customers.collector_id references collectors(id), a separate
    // table from employees, so both must stay in sync.
    const { data: employee } = await supabaseAdmin.from('employees').select('position, area_id').eq('id', employee_id).maybeSingle();
    if (employee?.position === 'Collector') {
      const { data: existingCollector } = await supabaseAdmin.from('collectors').select('id').eq('profile_id', created.user.id).maybeSingle();
      const collectorPayload = { branch_id: branch_id || null, area_id: employee.area_id ?? null, status: 'active' };
      if (existingCollector) {
        await supabaseAdmin.from('collectors').update(collectorPayload).eq('id', existingCollector.id);
      } else {
        await supabaseAdmin.from('collectors').insert({ profile_id: created.user.id, ...collectorPayload });
      }
    }
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  let emailSent = false;
  let emailError: string | null = null;

  if (resendApiKey) {
    try {
      const resend = new Resend(resendApiKey);
      const { error: sendError } = await resend.emails.send({
        from: 'onboarding@resend.dev',
        to: email,
        subject: 'Your 1125Corp account has been created',
        html: `
          <p>Hi ${full_name},</p>
          <p>An account has been created for you on the 1125Corp lending platform.</p>
          <p><strong>Email:</strong> ${email}<br/>
          <strong>Temporary password:</strong> ${password}</p>
          <p>Please log in and change your password as soon as possible.</p>
        `,
      });
      if (sendError) emailError = sendError.message;
      else emailSent = true;
    } catch (err: any) {
      emailError = err?.message ?? 'Failed to send email';
    }
  } else {
    emailError = 'RESEND_API_KEY not configured';
  }

  return NextResponse.json({
    success: true,
    emailSent,
    emailError,
    password: emailSent ? undefined : password,
  });
}
