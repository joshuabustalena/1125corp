import { supabase } from '@/lib/supabase/client';

/*
  Resolves the Chart of Accounts entry to post to for a given branch.

  The bookkeeping team keeps one account per branch for most things — a
  "Cash in Vault" for Balanga and another for Dinalupihan, likewise Loans
  Receivable, Interest Revenues, Service Fee, Salaries Expense, Employee
  Loan, Service Vehicle and Receivable from Uniform.

  HOW THEY'RE TOLD APART — and why this was rewritten
  ---------------------------------------------------
  Originally the branch lived in the NAME ("Cash in Vault - Balanga") and
  this resolver matched on that suffix. The team has since cleaned the Chart
  up: names are now plain ("Cash in Vault") and the branch lives in the
  chart_of_accounts.branch_id column, where it belongs.

  That silently broke the suffix match — only 2 of 16 branch lookups still
  resolved, and every miss fell through to a hard-coded default code, so
  Dinalupihan postings were landing on Balanga accounts.

  So: match on branch_id first, which is the real relationship. The old
  name-suffix form is still tried as a fallback for any account that hasn't
  been cleaned up yet, and a shared account (branch_id IS NULL) last.

  The code is returned EXACTLY as stored, never trimmed: three live accounts
  have a trailing space in their code ('1000 ', '1300 ', '1400 '), and every
  caller looks the account back up by exact match. Trimming would silently
  find nothing — and since postJournalEntry now refuses an entry whose
  account can't be resolved, that would block posting entirely.

  Codes are never used for matching. They aren't reliable: "Cash in Vault"
  for Balanga is stored as '1000 ' — with a trailing space — which collides
  with the separate "Cash on Hand" account at '1000'.
*/

// "Balanga Branch" -> "Balanga". Only used by the legacy fallback below.
function branchSuffix(branchName: string | null | undefined): string | null {
  if (!branchName) return null;
  const match = branchName.trim().match(/^(\S+)/);
  return match ? match[1] : null;
}

/*
  Returns the account CODE for `baseName` at `branchId`, or null when there
  is no such account. Callers should treat null as "do not post this line"
  rather than falling back to a fixed code — postJournalEntry now refuses to
  write an entry with an unresolvable account, which is the behaviour that
  keeps the ledger from silently going out of balance.

  `branchName` is optional and only feeds the legacy name-suffix fallback.
*/
export async function resolveBranchAccountCode(
  baseName: string,
  branchId: string | null | undefined,
  branchName?: string | null,
): Promise<string | null> {
  // 1. The real relationship: this branch's own account.
  if (branchId) {
    const { data } = await supabase
      .from('chart_of_accounts')
      .select('code')
      .eq('branch_id', branchId)
      .ilike('name', `${baseName}%`)
      .limit(1)
      .maybeSingle();
    if (data?.code) return data.code as string;
  }

  // 2. Legacy "<baseName> - <Branch>" naming, for accounts not yet cleaned up.
  const suffix = branchSuffix(branchName);
  if (suffix) {
    const { data } = await supabase
      .from('chart_of_accounts')
      .select('code')
      .ilike('name', `${baseName} - ${suffix}%`)
      .limit(1)
      .maybeSingle();
    if (data?.code) return data.code as string;
  }

  // 3. A company-wide account (no branch), e.g. SSS Payable.
  const { data } = await supabase
    .from('chart_of_accounts')
    .select('code')
    .is('branch_id', null)
    .ilike('name', `${baseName}%`)
    .limit(1)
    .maybeSingle();
  return (data?.code as string) ?? null;
}
