import { supabase } from '@/lib/supabase/client';
import { generateEntryNumber } from '@/lib/format';

type LedgerLine = { accountCode: string; debit?: number; credit?: number; memo?: string };

export type PostJournalEntryResult = {
  ok: boolean;
  // Account codes that were referenced by a non-zero line but don't exist
  // in the Chart of Accounts — that line got silently dropped as a result.
  // A line that's zero on purpose (e.g. no offset balance on a non-renewal
  // loan) is NOT included here; only genuine "we tried to book a real
  // amount and couldn't find where" gaps are.
  missingCodes: string[];
};

// Auto-posts a balanced journal entry from elsewhere in the app (a payment,
// a disbursement, an expense). Never throws — if the ledger post fails, the
// primary business action (which already succeeded) must not be rolled back
// or blocked on account of it. Callers that care whether every line
// actually landed (rather than firing-and-forgetting) can await the result
// and check `missingCodes`.
export async function postJournalEntry(params: {
  entryDate: string;
  description: string;
  reference?: string | null;
  source: string;
  sourceId?: string | null;
  createdBy?: string | null;
  // Left undefined/null for anything that isn't tied to one specific
  // branch (e.g. the 13th Month Voucher, which can span every branch at
  // once) — shows up as "Shared" in the Journal Entries branch filter,
  // same convention chart_of_accounts.branch_id already uses.
  branchId?: string | null;
  lines: LedgerLine[];
}): Promise<PostJournalEntryResult> {
  try {
    const codes = Array.from(new Set(params.lines.map(l => l.accountCode)));
    const { data: accounts } = await supabase.from('chart_of_accounts').select('id, code').in('code', codes);
    const codeToId = new Map((accounts ?? []).map((a: any) => [a.code, a.id]));

    const missingCodes = Array.from(new Set(
      params.lines
        .filter(l => ((l.debit ?? 0) > 0 || (l.credit ?? 0) > 0) && !codeToId.has(l.accountCode))
        .map(l => l.accountCode)
    ));
    if (missingCodes.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `postJournalEntry: account code(s) not found in Chart of Accounts — their lines were skipped: ${missingCodes.join(', ')}`,
        { description: params.description, source: params.source, lines: params.lines }
      );
    }

    const { data: entry, error } = await supabase.from('journal_entries').insert({
      entry_number: generateEntryNumber(),
      entry_date: params.entryDate,
      reference: params.reference ?? null,
      description: params.description,
      source: params.source,
      source_id: params.sourceId ?? null,
      created_by: params.createdBy ?? null,
      branch_id: params.branchId ?? null,
    }).select('id').single();

    if (error || !entry) return { ok: false, missingCodes };

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
    return { ok: true, missingCodes };
  } catch {
    // swallow — see comment above
    return { ok: false, missingCodes: [] };
  }
}
