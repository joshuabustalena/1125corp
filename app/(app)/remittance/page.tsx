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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [form, setForm] = useState({ collector_id: '', collector_name: '', amount: 0, notes: '' });
  const [lines, setLines] = useState<Line[]>([{ account_id: '', amount: '' }]);

  useEffect(() => {
    if (!profile) return;
    loadData();
  }, [date, profile]);

  useEffect(() => {
    if (!canRecordRemittance) return;
    supabase.from('chart_of_accounts').select('id, code, name').order('code').then(({ data }) => setAccounts(data ?? []));
  }, [canRecordRemittance]);

  async function loadData() {
    setLoading(true);
    let colQuery = supabase.from('collectors').select('id, branch_id, profile_id, profiles(full_name)').eq('status', 'active');
    if (isFieldCollector && profile) colQuery = colQuery.eq('profile_id', profile.id);

    const [{ data: cols }, { data: pays }, { data: rems }] = await Promise.all([
      colQuery,
      supabase.from('payments').select('collector_id, amount_paid').eq('payment_date', date),
      supabase.from('remittances').select('collector_id, amount').eq('remittance_date', date),
    ]);

    setCollectors(cols ?? []);

    const collectedMap: Record<string, number> = {};
    (pays ?? []).forEach((p: any) => {
      if (!p.collector_id) return;
      collectedMap[p.collector_id] = (collectedMap[p.collector_id] ?? 0) + Number(p.amount_paid);
    });
    setCollected(collectedMap);

    const remittedMap: Record<string, number> = {};
    (rems ?? []).forEach((r: any) => {
      remittedMap[r.collector_id] = (remittedMap[r.collector_id] ?? 0) + Number(r.amount);
    });
    setRemitted(remittedMap);
    setLoading(false);
  }

  function openRecord(collectorId: string, collectorName: string) {
    const owed = (collected[collectorId] ?? 0) - (remitted[collectorId] ?? 0);
    setForm({ collector_id: collectorId, collector_name: collectorName, amount: owed > 0 ? owed : 0, notes: '' });
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
  const visibleAccounts = accounts.filter(a => a.code === '1000' || a.code === '1010');

  const totalDebit = lines.reduce((s, l) => s + Number(l.amount || 0), 0);
  // Every peso collected has to land in a cash account — the split can't
  // fall short of or exceed the actual amount being remitted.
  const matchesRemittance = totalDebit > 0 && Math.abs(totalDebit - form.amount) < 0.01;
  const canSave = matchesRemittance;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.collector_id || !canSave) return;
    setSaving(true);

    const loansReceivableAccount = accounts.find(a => a.code === '1100');
    if (!loansReceivableAccount) {
      toast({ title: 'Error', description: 'Loans Receivable account (1100) not found in the Chart of Accounts', variant: 'destructive' });
      setSaving(false);
      return;
    }

    const { data: remittance, error } = await supabase.from('remittances').insert({
      collector_id: form.collector_id,
      amount: form.amount,
      remittance_date: date,
      received_by: profile?.id ?? null,
      notes: form.notes || null,
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
      description: `Collector remittance — ${form.collector_name}`,
      source: 'remittance',
      source_id: remittance.id,
      created_by: profile?.id ?? null,
    }).select('id').single();

    if (entryError || !entry) {
      toast({ title: 'Remittance saved, but ledger post failed', description: entryError?.message, variant: 'destructive' });
      setDialogOpen(false);
      loadData();
      setSaving(false);
      return;
    }

    // Debit whichever cash account(s) the user picked; the credit side
    // (Loans Receivable) is always automatic — a remittance is collections
    // coming in, which pays down what customers owe, never a manual choice.
    const linesPayload = lines
      .filter(l => l.account_id && Number(l.amount) > 0)
      .map(l => ({
        journal_entry_id: entry.id,
        account_id: l.account_id,
        debit: Number(l.amount) || 0,
        credit: 0,
      }));
    linesPayload.push({
      journal_entry_id: entry.id,
      account_id: loansReceivableAccount.id,
      debit: 0,
      credit: totalDebit,
    });
    await supabase.from('journal_entry_lines').insert(linesPayload);

    toast({ title: 'Success', description: 'Remittance recorded' });
    setDialogOpen(false);
    loadData();
    setSaving(false);
  }

  const rows = collectors.map(c => {
    const collectedAmt = collected[c.id] ?? 0;
    const remittedAmt = remitted[c.id] ?? 0;
    return {
      id: c.id,
      name: c.profiles?.full_name ?? 'Unassigned',
      collected: collectedAmt,
      remitted: remittedAmt,
      owed: collectedAmt - remittedAmt,
    };
  }).filter(r => r.collected > 0 || r.remitted > 0);

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
              </TableBody>
            </Table>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Record Remittance — {form.collector_name}</DialogTitle>
            <DialogDescription>
              Which cash account(s) is the {formatCurrency(form.amount)} remittance going into? Loans Receivable is credited automatically — the total must match the remittance amount exactly.
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
              <span>{canSave ? 'Matches' : 'Does not match remittance amount'}</span>
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
