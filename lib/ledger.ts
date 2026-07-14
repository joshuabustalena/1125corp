import { supabase } from '@/lib/supabase/client';
import { generateEntryNumber } from '@/lib/format';

type LedgerLine = { accountCode: string; debit?: number; credit?: number; memo?: string };

// Auto-posts a balanced journal entry from elsewhere in the app (a payment,
// a disbursement, an expense). Never throws — if the ledger post fails, the
// primary business action (which already succeeded) must not be rolled back
// or blocked on account of it.
export async function postJournalEntry(params: {
  entryDate: string;
  description: string;
  reference?: string | null;
  source: string;
  sourceId?: string | null;
  createdBy?: string | null;
  lines: LedgerLine[];
}): Promise<void> {
  try {
    const codes = Array.from(new Set(params.lines.map(l => l.accountCode)));
    const { data: accounts } = await supabase.from('chart_of_accounts').select('id, code').in('code', codes);
    const codeToId = new Map((accounts ?? []).map((a: any) => [a.code, a.id]));

    const { data: entry, error } = await supabase.from('journal_entries').insert({
      entry_number: generateEntryNumber(),
      entry_date: params.entryDate,
      reference: params.reference ?? null,
      description: params.description,
      source: params.source,
      source_id: params.sourceId ?? null,
      created_by: params.createdBy ?? null,
    }).select('id').single();

    if (error || !entry) return;

    const linesPayload = params.lines
      .filter(l => codeToId.has(l.accountCode) && ((l.debit ?? 0) > 0 || (l.credit ?? 0) > 0))
      .map(l => ({
        journal_entry_id: entry.id,
        account_id: codeToId.get(l.accountCode),
        debit: l.debit ?? 0,
        credit: l.credit ?? 0,
        memo: l.memo ?? null,
      }));

    if (linesPayload.length > 0) {
      await supabase.from('journal_entry_lines').insert(linesPayload);
    }
  } catch {
    // swallow — see comment above
  }
}
