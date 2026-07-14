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
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { StatCard } from '@/components/dashboard/stat-card';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency, formatDate, generateEntryNumber } from '@/lib/format';
import { BookOpen, Plus, Loader2, Trash2, TrendingUp, TrendingDown, Scale } from 'lucide-react';

type Line = { account_id: string; debit: string; credit: string; memo: string };

export default function GeneralLedgerPage() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const isAdmin = profile?.role_name === 'Administrator';
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

  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);
  const [accountForm, setAccountForm] = useState({ code: '', name: '', account_type: 'asset' });

  const [startDate, setStartDate] = useState(new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().split('T')[0]);
  const [incomeStatement, setIncomeStatement] = useState<any>(null);
  const [balanceSheet, setBalanceSheet] = useState<any>(null);
  const [statementLoading, setStatementLoading] = useState(false);

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

  async function handleAddAccount(e: React.FormEvent) {
    e.preventDefault();
    setSavingAccount(true);
    const { error } = await supabase.from('chart_of_accounts').insert(accountForm);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: 'Account added' });
      setAccountDialogOpen(false);
      setAccountForm({ code: '', name: '', account_type: 'asset' });
      load();
    }
    setSavingAccount(false);
  }

  async function generateIncomeStatement() {
    setStatementLoading(true);
    const { data } = await supabase
      .from('journal_entry_lines')
      .select('debit, credit, chart_of_accounts(name, account_type), journal_entries!inner(entry_date)')
      .gte('journal_entries.entry_date', startDate)
      .lte('journal_entries.entry_date', endDate);

    const revenue: Record<string, number> = {};
    const expense: Record<string, number> = {};
    (data ?? []).forEach((l: any) => {
      const type = l.chart_of_accounts?.account_type;
      const name = l.chart_of_accounts?.name ?? 'Unknown';
      if (type === 'revenue') revenue[name] = (revenue[name] ?? 0) + (Number(l.credit) - Number(l.debit));
      if (type === 'expense') expense[name] = (expense[name] ?? 0) + (Number(l.debit) - Number(l.credit));
    });
    const totalRevenue = Object.values(revenue).reduce((s, v) => s + v, 0);
    const totalExpense = Object.values(expense).reduce((s, v) => s + v, 0);
    setIncomeStatement({ revenue, expense, totalRevenue, totalExpense, netIncome: totalRevenue - totalExpense });
    setStatementLoading(false);
  }

  async function generateBalanceSheet() {
    setStatementLoading(true);
    const { data } = await supabase
      .from('journal_entry_lines')
      .select('debit, credit, chart_of_accounts(name, account_type), journal_entries!inner(entry_date)')
      .lte('journal_entries.entry_date', asOfDate);

    const byAccount: Record<string, { type: string; balance: number }> = {};
    (data ?? []).forEach((l: any) => {
      const type = l.chart_of_accounts?.account_type;
      const name = l.chart_of_accounts?.name ?? 'Unknown';
      if (!byAccount[name]) byAccount[name] = { type, balance: 0 };
      if (type === 'asset' || type === 'expense') byAccount[name].balance += Number(l.debit) - Number(l.credit);
      else byAccount[name].balance += Number(l.credit) - Number(l.debit);
    });

    const assets = Object.entries(byAccount).filter(([, v]) => v.type === 'asset');
    const liabilities = Object.entries(byAccount).filter(([, v]) => v.type === 'liability');
    const equity = Object.entries(byAccount).filter(([, v]) => v.type === 'equity');
    const revenueTotal = Object.entries(byAccount).filter(([, v]) => v.type === 'revenue').reduce((s, [, v]) => s + v.balance, 0);
    const expenseTotal = Object.entries(byAccount).filter(([, v]) => v.type === 'expense').reduce((s, [, v]) => s + v.balance, 0);
    const retainedEarnings = revenueTotal - expenseTotal;

    const totalAssets = assets.reduce((s, [, v]) => s + v.balance, 0);
    const totalLiabilities = liabilities.reduce((s, [, v]) => s + v.balance, 0);
    const totalEquity = equity.reduce((s, [, v]) => s + v.balance, 0) + retainedEarnings;

    setBalanceSheet({ assets, liabilities, equity, retainedEarnings, totalAssets, totalLiabilities, totalEquity });
    setStatementLoading(false);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="General Ledger" description="Chart of accounts, journal entries, and financial statements">
        <Button size="sm" onClick={openNewEntry}>
          <Plus className="w-4 h-4 mr-2" />
          New Journal Entry
        </Button>
      </PageHeader>

      <Tabs defaultValue="entries">
        <TabsList>
          <TabsTrigger value="entries">Journal Entries</TabsTrigger>
          <TabsTrigger value="accounts">Chart of Accounts</TabsTrigger>
          <TabsTrigger value="income">Income Statement</TabsTrigger>
          <TabsTrigger value="balance">Balance Sheet</TabsTrigger>
        </TabsList>

        <TabsContent value="entries">
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
                      {entry.description && <p className="text-sm text-muted-foreground mb-2">{entry.description}</p>}
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
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="accounts">
          <Card className="glass-card border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Chart of Accounts</CardTitle>
                <CardDescription>{accounts.length} accounts</CardDescription>
              </div>
              {isAdmin && (
                <Button size="sm" variant="outline" onClick={() => setAccountDialogOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Account
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accounts.map(a => (
                    <TableRow key={a.id}>
                      <TableCell className="text-sm font-mono">{a.code}</TableCell>
                      <TableCell className="text-sm font-medium">{a.name}</TableCell>
                      <TableCell><Badge variant="outline" className="capitalize">{a.account_type}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="income" className="space-y-4">
          <Card className="glass-card border-border">
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row gap-4 items-end">
                <div className="space-y-2 flex-1">
                  <Label>Start Date</Label>
                  <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div className="space-y-2 flex-1">
                  <Label>End Date</Label>
                  <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
                <Button onClick={generateIncomeStatement} disabled={statementLoading}>
                  {statementLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Generate
                </Button>
              </div>
            </CardContent>
          </Card>

          {incomeStatement && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <StatCard title="Total Revenue" value={formatCurrency(incomeStatement.totalRevenue)} icon={<TrendingUp className="w-5 h-5" />} variant="success" />
                <StatCard title="Total Expenses" value={formatCurrency(incomeStatement.totalExpense)} icon={<TrendingDown className="w-5 h-5" />} variant="danger" />
                <StatCard title="Net Income" value={formatCurrency(incomeStatement.netIncome)} icon={<Scale className="w-5 h-5" />} variant={incomeStatement.netIncome >= 0 ? 'success' : 'danger'} />
              </div>
              <Card className="glass-card border-border">
                <CardHeader><CardTitle>Income Statement</CardTitle><CardDescription>{formatDate(startDate)} – {formatDate(endDate)}</CardDescription></CardHeader>
                <CardContent>
                  <Table>
                    <TableBody>
                      <TableRow><TableCell className="font-semibold" colSpan={2}>Revenue</TableCell></TableRow>
                      {Object.entries(incomeStatement.revenue).map(([name, amt]: any) => (
                        <TableRow key={name}><TableCell className="pl-6 text-sm">{name}</TableCell><TableCell className="text-right text-sm">{formatCurrency(amt)}</TableCell></TableRow>
                      ))}
                      <TableRow><TableCell className="font-medium">Total Revenue</TableCell><TableCell className="text-right font-medium">{formatCurrency(incomeStatement.totalRevenue)}</TableCell></TableRow>
                      <TableRow><TableCell className="font-semibold pt-4" colSpan={2}>Expenses</TableCell></TableRow>
                      {Object.entries(incomeStatement.expense).map(([name, amt]: any) => (
                        <TableRow key={name}><TableCell className="pl-6 text-sm">{name}</TableCell><TableCell className="text-right text-sm">{formatCurrency(amt)}</TableCell></TableRow>
                      ))}
                      <TableRow><TableCell className="font-medium">Total Expenses</TableCell><TableCell className="text-right font-medium">{formatCurrency(incomeStatement.totalExpense)}</TableCell></TableRow>
                      <TableRow className="border-t-2 border-border"><TableCell className="font-bold pt-2">Net Income</TableCell><TableCell className="text-right font-bold pt-2">{formatCurrency(incomeStatement.netIncome)}</TableCell></TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="balance" className="space-y-4">
          <Card className="glass-card border-border">
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row gap-4 items-end">
                <div className="space-y-2 flex-1">
                  <Label>As Of Date</Label>
                  <Input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} />
                </div>
                <Button onClick={generateBalanceSheet} disabled={statementLoading}>
                  {statementLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Generate
                </Button>
              </div>
            </CardContent>
          </Card>

          {balanceSheet && (
            <Card className="glass-card border-border">
              <CardHeader><CardTitle>Balance Sheet</CardTitle><CardDescription>As of {formatDate(asOfDate)}</CardDescription></CardHeader>
              <CardContent>
                <Table>
                  <TableBody>
                    <TableRow><TableCell className="font-semibold" colSpan={2}>Assets</TableCell></TableRow>
                    {balanceSheet.assets.map(([name, v]: any) => (
                      <TableRow key={name}><TableCell className="pl-6 text-sm">{name}</TableCell><TableCell className="text-right text-sm">{formatCurrency(v.balance)}</TableCell></TableRow>
                    ))}
                    <TableRow><TableCell className="font-medium">Total Assets</TableCell><TableCell className="text-right font-medium">{formatCurrency(balanceSheet.totalAssets)}</TableCell></TableRow>

                    <TableRow><TableCell className="font-semibold pt-4" colSpan={2}>Liabilities</TableCell></TableRow>
                    {balanceSheet.liabilities.map(([name, v]: any) => (
                      <TableRow key={name}><TableCell className="pl-6 text-sm">{name}</TableCell><TableCell className="text-right text-sm">{formatCurrency(v.balance)}</TableCell></TableRow>
                    ))}
                    <TableRow><TableCell className="font-medium">Total Liabilities</TableCell><TableCell className="text-right font-medium">{formatCurrency(balanceSheet.totalLiabilities)}</TableCell></TableRow>

                    <TableRow><TableCell className="font-semibold pt-4" colSpan={2}>Equity</TableCell></TableRow>
                    {balanceSheet.equity.map(([name, v]: any) => (
                      <TableRow key={name}><TableCell className="pl-6 text-sm">{name}</TableCell><TableCell className="text-right text-sm">{formatCurrency(v.balance)}</TableCell></TableRow>
                    ))}
                    <TableRow><TableCell className="pl-6 text-sm">Retained Earnings (computed)</TableCell><TableCell className="text-right text-sm">{formatCurrency(balanceSheet.retainedEarnings)}</TableCell></TableRow>
                    <TableRow><TableCell className="font-medium">Total Equity</TableCell><TableCell className="text-right font-medium">{formatCurrency(balanceSheet.totalEquity)}</TableCell></TableRow>

                    <TableRow className="border-t-2 border-border">
                      <TableCell className="font-bold pt-2">Total Liabilities + Equity</TableCell>
                      <TableCell className="text-right font-bold pt-2">{formatCurrency(balanceSheet.totalLiabilities + balanceSheet.totalEquity)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                {Math.abs(balanceSheet.totalAssets - (balanceSheet.totalLiabilities + balanceSheet.totalEquity)) > 0.01 && (
                  <p className="text-xs text-destructive mt-3">Assets do not equal Liabilities + Equity — check for unbalanced or missing journal entries.</p>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

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

      {/* New account (admin) */}
      <Dialog open={accountDialogOpen} onOpenChange={setAccountDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Account</DialogTitle>
            <DialogDescription>Add a new account to the chart of accounts</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddAccount} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Code *</Label>
                <Input required value={accountForm.code} onChange={(e) => setAccountForm({ ...accountForm, code: e.target.value })} placeholder="e.g. 1020" />
              </div>
              <div className="space-y-2">
                <Label>Type *</Label>
                <Select value={accountForm.account_type} onValueChange={(v) => setAccountForm({ ...accountForm, account_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="asset">Asset</SelectItem>
                    <SelectItem value="liability">Liability</SelectItem>
                    <SelectItem value="equity">Equity</SelectItem>
                    <SelectItem value="revenue">Revenue</SelectItem>
                    <SelectItem value="expense">Expense</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Name *</Label>
                <Input required value={accountForm.name} onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })} placeholder="e.g. Petty Cash Fund" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAccountDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={savingAccount}>
                {savingAccount && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
