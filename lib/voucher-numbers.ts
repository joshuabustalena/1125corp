import { supabase } from '@/lib/supabase/client';

// Every cash voucher (loan release, Gas Voucher, Payroll Voucher, 13th
// Month Voucher, general Cash Voucher) shares ONE sequential number —
// e.g. 1-1391, then 1-1392 — via the `cash_voucher_number_seq` Postgres
// sequence (see supabase/add_shared_voucher_sequence.sql), so numbering
// stays sequential across voucher types instead of each having its own
// independent random code.
export async function getNextVoucherNumber(): Promise<string> {
  const { data, error } = await supabase.rpc('next_cash_voucher_number');
  if (error || !data) {
    // Fallback so a generate flow never hard-blocks if the migration
    // hasn't been run yet — only collides in the unlikely case two
    // vouchers generate in the same millisecond without it applied.
    return `1-${Date.now()}`;
  }
  return data as string;
}
