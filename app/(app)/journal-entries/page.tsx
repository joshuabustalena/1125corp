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
import { Plus, Loader2, Trash2, Search, ChevronLeft, ChevronRight } from 'lucide-react';

type Line = { account_id: string; debit: string; credit: string; memo: string };
const SHARED_VALUE = 'shared';
const PAGE_SIZE = 20;

export default function JournalEntriesPage() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const isAdmin = profile?.role_name === 'Administrator';
  const [accounts, setAccounts] = useState<any[]>([]);
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [entryForm, setEntryForm] = useState({ entry_date: new Date().toISOString().split('T')[0], reference: '', description: '', branch_id: SHARED_VALUE });
  const [lines, setLines] = useState<Line[]>([
    { account_id: '', debit: '', credit: '', memo: '' },
    { account_id: '', debit: '', credit: '', memo: '' },
  ]);
  const [branches, setBranches] = useState<any[]>([]);
  // Defaults to "All Branches" — every entry across every branch, same as
  // before this filter existed — and narrows down from there.
  const [branchFilter, setBranchFilter] = useState('all');
  // "Last 50 entries, newest first" with no way to see anything older and
  // no way to jump straight to a specific one — a manually-entered fix
  // (or any entry more than 50 postings back) became unreachable once
  // enough automated postings pushed it off the list. Search + pagination
  // fix both.
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    supabase.from('branches').select('id, name').eq('status', 'active').order('name').then(({ data }) => setBranches(data ?? []));
  }, []);

  // Search/branch changing always jumps back to page 0 — passed explicitly
  // to load() rather than relying on `page` state (which hasn't re-rendered
  // yet at this point), same reasoning as the Audit Logs page's pager.
  useEffect(() => {
    if (!profile) return;
    setPage(0);
    load(0);
  }, [profile, branchFilter, search]);

  async function load(pageArg?: number) {
    const p = pageArg ?? page;
    setLoading(true);
    // Every branch now keeps its own Chart of Accounts — a non-admin only
    // gets their own branch's accounts plus shared/company-wide ones (no
    // branch_id) in the picker below. Admin still sees every account,
    // since a manual entry here isn't tied to one branch the way a loan or
    // payroll voucher is.
    let acctsQuery = supabase.from('chart_of_accounts').select('*').order('code');
    if (!isAdmin && profile?.branch_id) {
      acctsQuery = acctsQuery.or(`branch_id.eq.${profile.branch_id},branch_id.is.null`);
    }
    // Fetches one row past the page size — if that extra row comes back,
    // there's a next page. Cheaper than an exact count on every page turn.
    let entriesQuery = supabase.from('journal_entries').select('*, branches(name), journal_entry_lines(*, chart_of_accounts(code, name, account_type))').order('entry_date', { ascending: false }).order('created_at', { ascending: false }).range(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE);
    if (search) entriesQuery = entriesQuery.or(`entry_number.ilike.%${search}%,description.ilike.%${search}%,reference.ilike.%${search}%`);
    if (!isAdmin) {
      // A non-admin sees only their own branch plus shared/company-wide
      // entries, with no way to switch — the same lock the Dashboard and
      // Accounting already apply. A Balanga cashier gets Balanga + shared.
      // With no branch assigned they get shared entries only, rather than
      // silently falling through to every branch.
      entriesQuery = profile?.branch_id
        ? entriesQuery.or(`branch_id.eq.${profile.branch_id},branch_id.is.null`)
        : entriesQuery.is('branch_id', null);
    } else if (branchFilter !== 'all') {
      entriesQuery = branchFilter === SHARED_VALUE ? entriesQuery.is('branch_id', null) : entriesQuery.eq('branch_id', branchFilter);
    }
    const [{ data: accts }, { data: ents }] = await Promise.all([
      acctsQuery,
      entriesQuery,
    ]);
    setAccounts(accts ?? []);
    const rows = ents ?? [];
    setHasMore(rows.length > PAGE_SIZE);
    setEntries(rows.slice(0, PAGE_SIZE));
    setLoading(false);
  }

  function handleNext() {
    const next = page + 1;
    setPage(next);
    load(next);
  }

  function handlePrev() {
    const prev = Math.max(0, page - 1);
    setPage(prev);
    load(prev);
  }

  function openNewEntry() {
    setEntryForm({
      entry_date: new Date().toISOString().split('T')[0],
      reference: '',
      description: '',
      branch_id: !isAdmin && profile?.branch_id ? profile.branch_id : SHARED_VALUE,
    });
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

  // Only lines that actually have an account picked; a line with an amount
  // typed but no account selected is exactly what postJournalEntry's own
  // "missing account" rule guards against elsewhere, but this form had no
  // equivalent — it let totals look balanced from the raw amounts, then
  // dropped the account-less line at submit, saving a real entry short.
  const hasAmount = (l: Line) => Number(l.debit) > 0 || Number(l.credit) > 0;
  const incompleteLines = lines.filter(l => hasAmount(l) && !l.account_id);
  const validLines = lines.filter(l => l.account_id && hasAmount(l));
  const totalDebit = validLines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalCredit = validLines.reduce((s, l) => s + Number(l.credit || 0), 0);
  const isBalanced = incompleteLines.length === 0 && validLines.length >= 2
    && totalDebit === totalCredit && totalDebit > 0;

  async function handleSubmitEntry(e: React.FormEvent) {
    e.preventDefault();
    if (incompleteLines.length > 0) {
      toast({ title: 'Missing account', description: 'Every line with an amount needs an account selected — pick one or clear the amount.', variant: 'destructive' });
      return;
    }
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
      branch_id: entryForm.branch_id === SHARED_VALUE ? null : entryForm.branch_id,
    }).select('id').single();

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      setSaving(false);
      return;
    }

    const linesPayload = validLines.map(l => ({
      journal_entry_id: entry.id,
      account_id: l.account_id,
      debit: Number(l.debit) || 0,
      credit: Number(l.credit) || 0,
      memo: l.memo || null,
    }));

    const { error: linesError } = linesPayload.length > 0
      ? await supabase.from('journal_entry_lines').insert(linesPayload)
      : { error: { message: 'No lines to save' } as any };
    if (linesError) {
      // Don't leave a headless entry behind — this is what let two blank
      // "Manual" entries sit in the ledger with a description and nothing
      // else.
      await supabase.from('journal_entries').delete().eq('id', entry.id);
      toast({ title: 'Error', description: linesError.message, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: 'Journal entry recorded' });
      setDialogOpen(false);
      load();
    }
    setSaving(false);
  }

  async function handleDeleteEntry() {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from('journal_entries').delete().eq('id', deleteTarget.id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Deleted', description: `Journal entry ${deleteTarget.entry_number} removed` });
      setDeleteTarget(null);
      load();
    }
    setDeleting(false);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Journal Entries" description="Record and review manual and system-generated journal entries">
        {isAdmin ? (
          <Select value={branchFilter} onValueChange={setBranchFilter}>
            <SelectTrigger className="w-full sm:w-48"><SelectValue placeholder="All Branches" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Branches</SelectItem>
              <SelectItem value={SHARED_VALUE}>Shared / Company-wide</SelectItem>
              {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : (
          /* A badge, not a dropdown: there is nothing to choose between. */
          <span className="inline-flex items-center h-9 px-3 rounded-md border border-border bg-secondary/30 text-sm">
            {branches.find(b => b.id === profile?.branch_id)?.name ?? 'Shared only'}
          </span>
        )}
        <Button size="sm" onClick={openNewEntry}>
          <Plus className="w-4 h-4 mr-2" />
          New Journal Entry
        </Button>
      </PageHeader>

      <Card className="glass-card border-border">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by entry #, description, or reference..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card border-border">
        <CardHeader>
          <CardTitle>Journal Entries</CardTitle>
          <CardDescription>Page {page + 1} · newest first</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No journal entries {search ? 'match your search' : 'yet'}</p>
          ) : (
            <div className="divide-y divide-border">
              {entries.map(entry => (
                <div key={entry.id} className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="font-mono text-sm font-medium">{entry.entry_number}</span>
                      <span className="text-xs text-muted-foreground ml-2">{formatDate(entry.entry_date)}</span>
                      <Badge variant="outline" className="ml-2 capitalize">{entry.source}</Badge>
                      <Badge variant="secondary" className="ml-2">{entry.branches?.name ?? 'Shared'}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      {entry.reference && <span className="text-xs text-muted-foreground">Ref: {entry.reference}</span>}
                      {isAdmin && (
                        <Button variant="ghost" size="icon" title="Delete" onClick={() => setDeleteTarget(entry)}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {/* Explicit column widths — without them the auto-layout
                      table hands all the slack to the account column and
                      flings the debit/credit figures to the far right edge,
                      leaving the wide empty gap the client asked to remove. */}
                  <Table className="table-fixed">
                    <TableBody>
                      {(entry.journal_entry_lines ?? []).map((line: any) => (
                        <TableRow key={line.id}>
                          <TableCell className="text-base py-2 w-[55%]">{line.chart_of_accounts?.code} — {line.chart_of_accounts?.name}</TableCell>
                          <TableCell className="text-base py-2 text-right font-medium w-[22%]">{Number(line.debit) > 0 ? formatCurrency(line.debit) : ''}</TableCell>
                          <TableCell className="text-base py-2 text-right font-medium w-[23%]">{Number(line.credit) > 0 ? formatCurrency(line.credit) : ''}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {entry.description && <p className="text-xs text-muted-foreground mt-2">{entry.description}</p>}
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <span className="text-xs text-muted-foreground">Page {page + 1}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handlePrev} disabled={loading || page === 0}>
                <ChevronLeft className="w-4 h-4 mr-1" />Previous
              </Button>
              <Button variant="outline" size="sm" onClick={handleNext} disabled={loading || !hasMore}>
                Next<ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Date *</Label>
                <Input type="date" required value={entryForm.entry_date} onChange={(e) => setEntryForm({ ...entryForm, entry_date: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Reference *</Label>
                <Input required value={entryForm.reference} onChange={(e) => setEntryForm({ ...entryForm, reference: e.target.value })} placeholder="OR#, voucher#, etc." />
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Branch</Label>
                <Select value={entryForm.branch_id} onValueChange={(v) => setEntryForm({ ...entryForm, branch_id: v })} disabled={!isAdmin}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SHARED_VALUE}>Shared / Company-wide</SelectItem>
                    {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
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
              <span>{incompleteLines.length > 0 ? 'Select an account for every amount' : isBalanced ? 'Balanced' : 'Not balanced'}</span>
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Input value={entryForm.description} onChange={(e) => setEntryForm({ ...entryForm, description: e.target.value })} />
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

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Journal Entry</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete entry {deleteTarget?.entry_number}? This will remove all its lines too and cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteEntry} disabled={deleting}>
              {deleting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
