'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency, generateEntryNumber } from '@/lib/format';
import { resolveBranchAccountCode } from '@/lib/branch-accounts';
import { selectAllRows } from '@/lib/db-chunk';
import { ArrowRightLeft, Loader2, Wallet, Plus, Trash2 } from 'lucide-react';

type Line = { account_id: string; amount: string };

export default function RemittancePage() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const isFieldCollector = profile?.role_name === 'Branch Field Collector';
  const isAdmin = profile?.role_name === 'Administrator';
  const isCashier = profile?.role_name === 'Cashier';
  const canRecordRemittance = isAdmin || isCashier;
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(true);
  const [collectors, setCollectors] = useState<any[]>([]);
  const [collected, setCollected] = useState<Record<string, number>>({});
  const [remitted, setRemitted] = useState<Record<string, number>>({});
  // All-time (not just this date) collected vs. remitted per collector, as
  // of end of the selected date — this is what "Balance Owed" is actually
  // based on now, so an unremitted amount from an earlier day keeps
  // showing up (carries over) instead of resetting to 0 the next day.
  // Collected/Remitted columns still show just that day's activity.
  const [cumulativeCollected, setCumulativeCollected] = useState<Record<string, number>>({});
  const [cumulativeRemitted, setCumulativeRemitted] = useState<Record<string, number>>({});
  // Same four figures, but for payments collected against an already
  // written-off loan (Kat's Sep 2026 request — see
  // supabase/add_write_off_recovery_collection.sql). Kept in a completely
  // separate pool from collected/remitted/cumulative* above: this money was
  // never a receivable, so it must never share a remittance with, or get
  // counted toward, the normal Loans-Receivable-credited figures.
  const [collectedRecovery, setCollectedRecovery] = useState<Record<string, number>>({});
  const [remittedRecovery, setRemittedRecovery] = useState<Record<string, number>>({});
  const [cumulativeCollectedRecovery, setCumulativeCollectedRecovery] = useState<Record<string, number>>({});
  const [cumulativeRemittedRecovery, setCumulativeRemittedRecovery] = useState<Record<string, number>>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [accounts, setAccounts] = useState<any[]>([]);
  // category 'recovery' is a write-off recovery settlement — auto-credits
  // Miscellaneous Income instead of Loans Receivable. See openRecord.
  const [form, setForm] = useState({ collector_id: '', collector_name: '', amount: 0, notes: '', category: 'collection' as 'collection' | 'recovery' });
  const [lines, setLines] = useState<Line[]>([{ account_id: '', amount: '' }]);

  useEffect(() => {
    if (!profile) return;
    loadData();
  }, [date, profile]);

  useEffect(() => {
    if (!canRecordRemittance) return;
    supabase.from('chart_of_accounts').select('id, code, name, branch_id').order('code').then(({ data }) => setAccounts(data ?? []));
  }, [canRecordRemittance]);

  async function loadData() {
    setLoading(true);
    let colQuery = supabase.from('collectors').select('id, branch_id, profile_id, profiles(full_name), branches(name)').eq('status', 'active');
    if (isFieldCollector && profile) colQuery = colQuery.eq('profile_id', profile.id);
    // Collection is a per-branch process: a Cashier/Branch Manager/Accounting
    // user at one branch must not see or collect another branch's collectors
    // (e.g. Dinalupihan staff must only handle Dinalupihan customers).
    // Administrator is unrestricted.
    else if (!isAdmin && profile?.branch_id) colQuery = colQuery.eq('branch_id', profile.branch_id);

    // The two cumulative queries are paginated: they read EVERY payment and
    // remittance ever recorded up to this date, and PostgREST silently caps
    // a plain query at 1000 rows. Once `payments` crossed that (1,077 rows),
    // the missing 77 made Balance Owed read as a large NEGATIVE number for
    // the two collectors whose payments happened to fall outside the first
    // 1000 — collected came back short while remitted, only 54 rows, stayed
    // complete. The two same-day queries above them are one date each and
    // stay far under the cap.
    // payments carries no status of its own — loans(status) is embedded so
    // a write-off recovery payment (loan status = 'written_off', which
    // never reverts — see add_write_off_recovery_collection.sql) can be
    // split into its own pool below instead of inflating what's "owed"
    // against real receivables.
    const [{ data: cols }, { data: pays }, { data: rems }, cumPays, cumRems] = await Promise.all([
      colQuery,
      supabase.from('payments').select('collector_id, amount_paid, loans(status)').eq('payment_date', date),
      supabase.from('remittances').select('collector_id, amount, is_write_off_recovery').eq('remittance_date', date),
      selectAllRows<any>(() => supabase.from('payments').select('collector_id, amount_paid, loans(status)').lte('payment_date', date)),
      selectAllRows<any>(() => supabase.from('remittances').select('collector_id, amount, is_write_off_recovery').lte('remittance_date', date)),
    ]);

    setCollectors(cols ?? []);

    function sumByCollector(rows: any[], amountKey: string, filter?: (r: any) => boolean): Record<string, number> {
      const map: Record<string, number> = {};
      for (const r of rows) {
        if (!r.collector_id) continue;
        if (filter && !filter(r)) continue;
        map[r.collector_id] = (map[r.collector_id] ?? 0) + Number(r[amountKey]);
      }
      return map;
    }

    const isRecoveryPayment = (r: any) => r.loans?.status === 'written_off';
    const isRecoveryRemittance = (r: any) => !!r.is_write_off_recovery;

    setCollected(sumByCollector(pays ?? [], 'amount_paid', (r) => !isRecoveryPayment(r)));
    setCollectedRecovery(sumByCollector(pays ?? [], 'amount_paid', isRecoveryPayment));
    setRemitted(sumByCollector(rems ?? [], 'amount', (r) => !isRecoveryRemittance(r)));
    setRemittedRecovery(sumByCollector(rems ?? [], 'amount', isRecoveryRemittance));
    setCumulativeCollected(sumByCollector(cumPays, 'amount_paid', (r) => !isRecoveryPayment(r)));
    setCumulativeCollectedRecovery(sumByCollector(cumPays, 'amount_paid', isRecoveryPayment));
    setCumulativeRemitted(sumByCollector(cumRems, 'amount', (r) => !isRecoveryRemittance(r)));
    setCumulativeRemittedRecovery(sumByCollector(cumRems, 'amount', isRecoveryRemittance));
    setLoading(false);
  }

  function openRecord(collectorId: string, collectorName: string, category: 'collection' | 'recovery' = 'collection') {
    const owed = category === 'recovery'
      ? (cumulativeCollectedRecovery[collectorId] ?? 0) - (cumulativeRemittedRecovery[collectorId] ?? 0)
      : (cumulativeCollected[collectorId] ?? 0) - (cumulativeRemitted[collectorId] ?? 0);
    setForm({ collector_id: collectorId, collector_name: collectorName, amount: owed > 0 ? owed : 0, notes: '', category });
    setLines([{ account_id: '', amount: '' }]);
    setDialogOpen(true);
  }

  function addLine() {
    setLines([...lines, { account_id: '', amount: '' }]);
  }

  function removeLine(i: number) {
    setLines(lines.filter((_, idx) => idx !== i));
  }

  function updateLine(i: number, field: keyof Line, value: string) {
    setLines(lines.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)));
  }

  // A remittance is always cash physically turned in — the credit side is
  // always Loans Receivable, applied automatically on submit, so the only
  // thing anyone (Cashier or Admin) picks here is which cash account(s)
  // it's going into (e.g. split between Cash on Hand and Cash in Bank if
  // part of it gets deposited).
  // Every cash-on-hand/in-bank account is a valid remittance destination
  // (per branch there can be a vault, a short/over, and several bank
  // accounts) — the only one excluded is Petty Cash Fund, which isn't
  // meant to receive collector remittances.
  // Scoped to the collector's own branch (plus any company-wide account,
  // branch_id NULL — e.g. a shared Cash Reserve Fund) — same pattern
  // cash-vouchers/page.tsx already uses, so a Balanga collector's
  // remittance can't accidentally get credited to a Dinalupihan-only
  // account, and vice versa.
  const selectedCollectorBranchId = collectors.find(c => c.id === form.collector_id)?.branch_id ?? null;
  const visibleAccounts = accounts.filter(a =>
    a.name.toLowerCase().includes('cash') && !a.name.toLowerCase().includes('petty cash') &&
    (!a.branch_id || a.branch_id === selectedCollectorBranchId)
  );

  // Same bug class as Journal Entries: a line with an amount typed but no
  // cash account picked used to still count toward totalDebit, so the split
  // could show "Matches" and let Save through, then get silently dropped at
  // submit — leaving a remittance entry with ONLY the automatic Loans
  // Receivable credit and no debit side at all (JE-2026-217886).
  const incompleteLines = lines.filter(l => Number(l.amount) > 0 && !l.account_id);
  const validLines = lines.filter(l => l.account_id && Number(l.amount) > 0);
  const totalDebit = validLines.reduce((s, l) => s + Number(l.amount || 0), 0);
  // Every peso collected has to land in a cash account — the split can't
  // fall short of or exceed the actual amount being remitted.
  const matchesRemittance = totalDebit > 0 && Math.abs(totalDebit - form.amount) < 0.01;
  const canSave = incompleteLines.length === 0 && matchesRemittance;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.collector_id || !canSave) return;
    if (incompleteLines.length > 0) {
      toast({ title: 'Missing account', description: 'Every line with an amount needs a cash account selected.', variant: 'destructive' });
      return;
    }
    setSaving(true);

    // Same branch-aware resolution as loan disbursement / the payroll
    // voucher — the live Chart of Accounts has a separate Loans Receivable
    // per branch (e.g. 1100 for Balanga, 1200 for Dinalupihan), so this
    // collector's own branch determines which one gets credited.
    //
    // A write-off recovery settlement credits Miscellaneous Income instead
    // — that money was never a receivable, so crediting Loans Receivable
    // here would quietly reintroduce it into that total exactly like a
    // recovery payment posting straight to it would. See
    // supabase/add_write_off_recovery_collection.sql.
    const isRecovery = form.category === 'recovery';
    const targetAccountName = isRecovery ? 'Miscellaneous Income' : 'Loans Receivable';
    const collector = collectors.find(c => c.id === form.collector_id);
    const targetCode = (await resolveBranchAccountCode(targetAccountName, (collector as any)?.branch_id, (collector as any)?.branches?.name)) ?? '';
    const targetAccount = accounts.find(a => a.code === targetCode);
    if (!targetAccount) {
      toast({ title: 'Error', description: `${targetAccountName} account (${targetCode}) not found in the Chart of Accounts`, variant: 'destructive' });
      setSaving(false);
      return;
    }

    const { data: remittance, error } = await supabase.from('remittances').insert({
      collector_id: form.collector_id,
      amount: form.amount,
      remittance_date: date,
      received_by: profile?.id ?? null,
      notes: form.notes || null,
      is_write_off_recovery: isRecovery,
    }).select('id').single();

    if (error || !remittance) {
      toast({ title: 'Error', description: error?.message ?? 'Could not record remittance', variant: 'destructive' });
      setSaving(false);
      return;
    }

    const { data: entry, error: entryError } = await supabase.from('journal_entries').insert({
      entry_number: generateEntryNumber(),
      entry_date: date,
      reference: null,
      description: isRecovery
        ? `Collector remittance (write-off recovery) — ${form.collector_name}`
        : `Collector remittance — ${form.collector_name}`,
      source: 'remittance',
      source_id: remittance.id,
      created_by: profile?.id ?? null,
      branch_id: (collector as any)?.branch_id ?? null,
    }).select('id').single();

    if (entryError || !entry) {
      toast({ title: 'Remittance saved, but ledger post failed', description: entryError?.message, variant: 'destructive' });
      setDialogOpen(false);
      loadData();
      setSaving(false);
      return;
    }

    // Debit whichever cash account(s) the user picked (validLines only —
    // already known to all have an account); the credit side (Loans
    // Receivable, or Miscellaneous Income for a write-off recovery) is
    // always automatic — a remittance is money coming in, never a manual
    // choice on that side.
    const linesPayload = [
      ...validLines.map(l => ({
        journal_entry_id: entry.id,
        account_id: l.account_id,
        debit: Number(l.amount) || 0,
        credit: 0,
      })),
      {
        journal_entry_id: entry.id,
        account_id: targetAccount.id,
        debit: 0,
        credit: totalDebit,
      },
    ];
    const { error: linesError } = await supabase.from('journal_entry_lines').insert(linesPayload);
    if (linesError) {
      // Don't leave a one-sided ledger entry behind — delete the header so
      // this doesn't join JE-2026-217886 as a credit-only orphan.
      await supabase.from('journal_entries').delete().eq('id', entry.id);
      toast({ title: 'Remittance saved, but ledger post failed', description: linesError.message, variant: 'destructive' });
      setDialogOpen(false);
      loadData();
      setSaving(false);
      return;
    }

    toast({ title: 'Success', description: 'Remittance recorded' });
    setDialogOpen(false);
    loadData();
    setSaving(false);
  }

  const rows = collectors.map(c => {
    const collectedAmt = collected[c.id] ?? 0;
    const remittedAmt = remitted[c.id] ?? 0;
    // Owed is the running, all-time balance as of this date — not just
    // today's collected minus today's remitted — so an unremitted amount
    // from an earlier day carries over instead of resetting.
    const owed = (cumulativeCollected[c.id] ?? 0) - (cumulativeRemitted[c.id] ?? 0);
    // Same running-balance shape, but for write-off recovery payments —
    // kept entirely separate so it never mixes into the receivable figure
    // above. See supabase/add_write_off_recovery_collection.sql.
    const owedRecovery = (cumulativeCollectedRecovery[c.id] ?? 0) - (cumulativeRemittedRecovery[c.id] ?? 0);
    return {
      id: c.id,
      name: c.profiles?.full_name ?? 'Unassigned',
      collected: collectedAmt,
      remitted: remittedAmt,
      owed,
      collectedRecovery: collectedRecovery[c.id] ?? 0,
      remittedRecovery: remittedRecovery[c.id] ?? 0,
      owedRecovery,
    };
  }).filter(r => r.collected > 0 || r.remitted > 0 || r.owed > 0 || r.collectedRecovery > 0 || r.remittedRecovery > 0 || r.owedRecovery > 0);

  const totalOwed = rows.reduce((s, r) => s + Math.max(0, r.owed), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={isFieldCollector ? 'My Remittance' : 'Collector Remittance'}
        description={isFieldCollector ? 'How much of your collections you still need to turn in to the Cashier' : "Cash collected by field collectors vs. what's been turned in"}
      >
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" />
      </PageHeader>

      <Card className="glass-card border-border">
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">{isFieldCollector ? 'Still Owed to Cashier' : 'Total Still Owed to Cashier'}</p>
              <p className="text-2xl font-bold">{formatCurrency(totalOwed)}</p>
            </div>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-warning/10 text-warning">
              <Wallet className="w-5 h-5" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card border-border">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ArrowRightLeft className="w-12 h-12 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">No collections recorded for this date</p>
            </div>
          ) : (
            <>
            {/* Mobile card list */}
            <div className="md:hidden divide-y divide-border">
              {rows.map(r => (
                <div key={r.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium text-sm truncate">{r.name}</p>
                    <Badge variant={r.owed > 0 ? 'destructive' : 'default'} className="shrink-0">{formatCurrency(r.owed)}</Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div><p className="text-xs text-muted-foreground">Collected</p><p>{formatCurrency(r.collected)}</p></div>
                    <div><p className="text-xs text-muted-foreground">Remitted</p><p>{formatCurrency(r.remitted)}</p></div>
                  </div>
                  {canRecordRemittance && (
                    <div className="mt-3 flex justify-end">
                      <Button variant="outline" size="sm" disabled={r.owed <= 0} onClick={() => openRecord(r.id, r.name)}>
                        Record Remittance
                      </Button>
                    </div>
                  )}
                  {/* Write-off recovery — its own pool, never mixed into the
                      receivable figures above. Only shown once there's
                      actually a recovery to account for. */}
                  {(r.owedRecovery > 0 || r.collectedRecovery > 0 || r.remittedRecovery > 0) && (
                    <div className="mt-3 pt-3 border-t border-border">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-xs text-muted-foreground">Write-Off Recovery</p>
                        <Badge variant={r.owedRecovery > 0 ? 'destructive' : 'default'} className="shrink-0">{formatCurrency(r.owedRecovery)}</Badge>
                      </div>
                      {canRecordRemittance && (
                        <div className="mt-2 flex justify-end">
                          <Button variant="outline" size="sm" disabled={r.owedRecovery <= 0} onClick={() => openRecord(r.id, r.name, 'recovery')}>
                            Record Recovery
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <Table className="hidden md:table">
              <TableHeader>
                <TableRow>
                  <TableHead>Collector</TableHead>
                  <TableHead>Collected</TableHead>
                  <TableHead>Remitted</TableHead>
                  <TableHead>Balance Owed</TableHead>
                  {canRecordRemittance && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(r => (
                  <TableRow key={r.id} className="hover:bg-secondary/50">
                    <TableCell className="text-sm font-medium">{r.name}</TableCell>
                    <TableCell className="text-sm">{formatCurrency(r.collected)}</TableCell>
                    <TableCell className="text-sm">{formatCurrency(r.remitted)}</TableCell>
                    <TableCell className="text-sm font-medium">
                      <Badge variant={r.owed > 0 ? 'destructive' : 'default'}>{formatCurrency(r.owed)}</Badge>
                    </TableCell>
                    {canRecordRemittance && (
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" disabled={r.owed <= 0} onClick={() => openRecord(r.id, r.name)}>
                          Record Remittance
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {/* Write-off recovery — kept off the main row entirely (never
                    mixed into Collected/Remitted/Balance Owed above), one
                    line per collector that actually has any, matching the
                    mobile card's treatment. */}
                {rows.filter(r => r.owedRecovery > 0 || r.collectedRecovery > 0 || r.remittedRecovery > 0).map(r => (
                  <TableRow key={`${r.id}-recovery`} className="hover:bg-secondary/50 bg-secondary/20">
                    <TableCell className="text-sm text-muted-foreground">{r.name} — Write-Off Recovery</TableCell>
                    <TableCell className="text-sm">{formatCurrency(r.collectedRecovery)}</TableCell>
                    <TableCell className="text-sm">{formatCurrency(r.remittedRecovery)}</TableCell>
                    <TableCell className="text-sm font-medium">
                      <Badge variant={r.owedRecovery > 0 ? 'destructive' : 'default'}>{formatCurrency(r.owedRecovery)}</Badge>
                    </TableCell>
                    {canRecordRemittance && (
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" disabled={r.owedRecovery <= 0} onClick={() => openRecord(r.id, r.name, 'recovery')}>
                          Record Recovery
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{form.category === 'recovery' ? 'Record Recovery' : 'Record Remittance'} — {form.collector_name}</DialogTitle>
            <DialogDescription>
              Which cash account(s) is the {formatCurrency(form.amount)} {form.category === 'recovery' ? 'write-off recovery' : 'remittance'} going into? {form.category === 'recovery' ? 'Miscellaneous Income' : 'Loans Receivable'} is credited automatically — the total must match the amount exactly.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              {lines.map((line, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-8">
                    {i === 0 && <Label className="text-xs">Cash Account</Label>}
                    <Select value={line.account_id} onValueChange={(v) => updateLine(i, 'account_id', v)}>
                      <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                      <SelectContent>{visibleAccounts.map(a => <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-3">
                    {i === 0 && <Label className="text-xs">Amount</Label>}
                    <Input type="number" value={line.amount} onChange={(e) => updateLine(i, 'amount', e.target.value)} placeholder="0.00" />
                  </div>
                  <div className="col-span-1">
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeLine(i)} disabled={lines.length <= 1}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addLine}>
                <Plus className="w-4 h-4 mr-2" />
                Add Line
              </Button>
            </div>

            <div className={`flex flex-wrap justify-between gap-2 text-sm p-3 rounded-lg ${canSave ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
              <span>Total: {formatCurrency(totalDebit)}</span>
              <span>Remittance Amount: {formatCurrency(form.amount)}</span>
              <span>{incompleteLines.length > 0 ? 'Select an account for every amount' : canSave ? 'Matches' : 'Does not match remittance amount'}</span>
            </div>

            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving || !canSave}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Save Entry
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
