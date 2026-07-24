'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency, formatDate, generateEntryNumber } from '@/lib/format';
import { Plus, Loader2, Trash2 } from 'lucide-react';

type Line = { account_id: string; debit: string; credit: string; memo: string };

export default function JournalEntriesPage() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [entryForm, setEntryForm] = useState({ entry_date: new Date().toISOString().split('T')[0], reference: '', description: '' });
  const [lines, setLines] = useState<Line[]>([
    { account_id: '', debit: '', credit: '', memo: '' },
    { account_id: '', debit: '', credit: '', memo: '' },
  ]);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [{ data: accts }, { data: ents }] = await Promise.all([
      supabase.from('chart_of_accounts').select('*').order('code'),
      supabase.from('journal_entries').select('*, journal_entry_lines(*, chart_of_accounts(code, name, account_type))').order('entry_date', { ascending: false }).order('created_at', { ascending: false }).limit(50),
    ]);
    setAccounts(accts ?? []);
    setEntries(ents ?? []);
    setLoading(false);
  }

  function openNewEntry() {
    setEntryForm({ entry_date: new Date().toISOString().split('T')[0], reference: '', description: '' });
    setLines([
      { account_id: '', debit: '', credit: '', memo: '' },
      { account_id: '', debit: '', credit: '', memo: '' },
    ]);
    setDialogOpen(true);
  }

  function addLine() {
    setLines([...lines, { account_id: '', debit: '', credit: '', memo: '' }]);
  }

  function removeLine(i: number) {
    setLines(lines.filter((_, idx) => idx !== i));
  }

  function updateLine(i: number, field: keyof Line, value: string) {
    setLines(lines.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)));
  }

  const totalDebit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  const isBalanced = totalDebit === totalCredit && totalDebit > 0;

  async function handleSubmitEntry(e: React.FormEvent) {
    e.preventDefault();
    if (!isBalanced) {
      toast({ title: 'Not balanced', description: 'Total debits must equal total credits before this entry can be saved.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const { data: entry, error } = await supabase.from('journal_entries').insert({
      entry_number: generateEntryNumber(),
      entry_date: entryForm.entry_date,
      reference: entryForm.reference || null,
      description: entryForm.description || null,
      source: 'manual',
      created_by: profile?.id ?? null,
    }).select('id').single();

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      setSaving(false);
      return;
    }

    const linesPayload = lines
      .filter(l => l.account_id && (Number(l.debit) > 0 || Number(l.credit) > 0))
      .map(l => ({
        journal_entry_id: entry.id,
        account_id: l.account_id,
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
        memo: l.memo || null,
      }));

    const { error: linesError } = await supabase.from('journal_entry_lines').insert(linesPayload);
    if (linesError) {
      toast({ title: 'Error', description: linesError.message, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: 'Journal entry recorded' });
      setDialogOpen(false);
      load();
    }
    setSaving(false);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Journal Entries" description="Record and review manual and system-generated journal entries">
        <Button size="sm" onClick={openNewEntry}>
          <Plus className="w-4 h-4 mr-2" />
          New Journal Entry
        </Button>
      </PageHeader>

      <Card className="glass-card border-border">
        <CardHeader>
          <CardTitle>Recent Journal Entries</CardTitle>
          <CardDescription>Last 50 entries, newest first</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No journal entries yet</p>
          ) : (
            <div className="divide-y divide-border">
              {entries.map(entry => (
                <div key={entry.id} className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="font-mono text-sm font-medium">{entry.entry_number}</span>
                      <span className="text-xs text-muted-foreground ml-2">{formatDate(entry.entry_date)}</span>
                      <Badge variant="outline" className="ml-2 capitalize">{entry.source}</Badge>
                    </div>
                    {entry.reference && <span className="text-xs text-muted-foreground">Ref: {entry.reference}</span>}
                  </div>
                  <Table>
                    <TableBody>
                      {(entry.journal_entry_lines ?? []).map((line: any) => (
                        <TableRow key={line.id}>
                          <TableCell className="text-sm py-1.5">{line.chart_of_accounts?.code} — {line.chart_of_accounts?.name}</TableCell>
                          <TableCell className="text-sm py-1.5 text-right">{Number(line.debit) > 0 ? formatCurrency(line.debit) : ''}</TableCell>
                          <TableCell className="text-sm py-1.5 text-right">{Number(line.credit) > 0 ? formatCurrency(line.credit) : ''}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {entry.description && <p className="text-sm text-muted-foreground mt-2">{entry.description}</p>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* New journal entry */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>New Journal Entry</DialogTitle>
            <DialogDescription>Debits must equal credits before this can be saved</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmitEntry} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Date *</Label>
                <Input type="date" required value={entryForm.entry_date} onChange={(e) => setEntryForm({ ...entryForm, entry_date: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Reference</Label>
                <Input value={entryForm.reference} onChange={(e) => setEntryForm({ ...entryForm, reference: e.target.value })} placeholder="OR#, voucher#, etc." />
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Description</Label>
                <Input value={entryForm.description} onChange={(e) => setEntryForm({ ...entryForm, description: e.target.value })} />
              </div>
            </div>

            <div className="space-y-2">
              {lines.map((line, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-5">
                    {i === 0 && <Label className="text-xs">Account</Label>}
                    <Select value={line.account_id} onValueChange={(v) => updateLine(i, 'account_id', v)}>
                      <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                      <SelectContent>{accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-3">
                    {i === 0 && <Label className="text-xs">Debit</Label>}
                    <Input type="number" value={line.debit} onChange={(e) => updateLine(i, 'debit', e.target.value)} placeholder="0.00" />
                  </div>
                  <div className="col-span-3">
                    {i === 0 && <Label className="text-xs">Credit</Label>}
                    <Input type="number" value={line.credit} onChange={(e) => updateLine(i, 'credit', e.target.value)} placeholder="0.00" />
                  </div>
                  <div className="col-span-1">
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeLine(i)} disabled={lines.length <= 2}>
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

            <div className={`flex justify-between text-sm p-3 rounded-lg ${isBalanced ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
              <span>Total Debit: {formatCurrency(totalDebit)}</span>
              <span>Total Credit: {formatCurrency(totalCredit)}</span>
              <span>{isBalanced ? 'Balanced' : 'Not balanced'}</span>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving || !isBalanced}>
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
