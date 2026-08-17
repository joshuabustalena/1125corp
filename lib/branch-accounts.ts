import { supabase } from '@/lib/supabase/client';

/*
  The live Chart of Accounts has since been split per-branch by the
  bookkeeping team (e.g. "Loans Receivable - Balanga" code 1100 vs. "Loans
  Receivable - Dinalupihan" code 1200), but the account codes hardcoded
  throughout this app's auto-posting journal entries were never updated to
  match — some no longer exist at all (silently dropped lines), and at
  least one code ("1000") is now claimed by two different accounts ("Cash
  on Hand" and "Cash in Vault - Balanga"), so resolving by a fixed code is
  no longer reliable for these.

  This resolves the correct account by exact NAME match instead — safer
  than guessing a code, and self-correcting if the client renumbers an
  account later. See docs/notes-to-website-prd.md item 1 / the ledger bug
  writeup for the full context.
*/

// "Balanga Branch" -> "Balanga", "Dinalupihan Branch" -> "Dinalupihan" — the
// short suffix already used on every branch-specific Chart of Accounts
// entry today, not something this app invented.
function branchSuffix(branchName: string | null | undefined): string | null {
  if (!branchName) return null;
  const match = branchName.trim().match(/^(\S+)/);
  return match ? match[1] : null;
}

// Resolves the Chart of Accounts CODE for "<baseName> - <branch>" (e.g.
// resolveBranchAccountCode('Loans Receivable', 'Balanga Branch') -> '1100').
// Returns null if no branch name is known or no matching account exists yet
// (e.g. Dinalupihan currently has no "Service Vehicle Loan" account at
// all) — callers should fall back to a sane default and let the existing
// missingCodes warning in postJournalEntry surface the gap.
export async function resolveBranchAccountCode(baseName: string, branchName: string | null | undefined): Promise<string | null> {
  const suffix = branchSuffix(branchName);
  if (!suffix) return null;
  const { data } = await supabase
    .from('chart_of_accounts')
    .select('code')
    .ilike('name', `${baseName} - ${suffix}%`)
    .limit(1)
    .maybeSingle();
  return data?.code ?? null;
}
