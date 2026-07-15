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
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

type Line = { account_id: string; debit: string; credit: string; memo: string };

export default function GeneralLedgerPage() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const isAdmin = profile?.role_name === 'Administrator';
  const canManageShareholders = isAdmin || profile?.role_name === 'Accounting';
  const [accounts, setAccounts] = useState<any[]>([]);
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [shareholders, setShareholders] = useState<any[]>([]);
  const [shareholderDialogOpen, setShareholderDialogOpen] = useState(false);
  const [savingShareholder, setSavingShareholder] = useState(false);
  const [editingShareholder, setEditingShareholder] = useState<any>(null);
  const [shareholderForm, setShareholderForm] = useState({ name: '', capital_contributed: '', ownership_percent: '', date_invested: '', notes: '' });
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
  const [accountBalances, setAccountBalances] = useState<Record<string, number>>({});
  const [trialBalanceDate, setTrialBalanceDate] = useState(new Date().toISOString().split('T')[0]);
  const [trialBalance, setTrialBalance] = useState<any>(null);
  const [ledgerAccountId, setLedgerAccountId] = useState('');
  const [ledgerStartDate, setLedgerStartDate] = useState(new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0]);
  const [ledgerEndDate, setLedgerEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [ledgerRows, setLedgerRows] = useState<any[] | null>(null);
  const [ledgerOpeningBalance, setLedgerOpeningBalance] = useState(0);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [trendStartDate, setTrendStartDate] = useState(new Date(Date.now() - 365 * 86400000).toISOString().split('T')[0]);
  const [trendEndDate, setTrendEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [monthlyTrends, setMonthlyTrends] = useState<any[] | null>(null);
  const [trendsLoading, setTrendsLoading] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [{ data: accts }, { data: ents }, { data: shs }] = await Promise.all([
      supabase.from('chart_of_accounts').select('*').order('code'),
      supabase.from('journal_entries').select('*, journal_entry_lines(*, chart_of_accounts(code, name, account_type))').order('entry_date', { ascending: false }).order('created_at', { ascending: false }).limit(50),
      supabase.from('shareholders').select('*').order('ownership_percent', { ascending: false }),
    ]);
    setAccounts(accts ?? []);
    setEntries(ents ?? []);
    setShareholders(shs ?? []);
    await loadAccountBalances(accts ?? []);
    setLoading(false);
  }

  function openAddShareholder() {
    setEditingShareholder(null);
    setShareholderForm({ name: '', capital_contributed: '', ownership_percent: '', date_invested: '', notes: '' });
    setShareholderDialogOpen(true);
  }

  function openEditShareholder(s: any) {
    setEditingShareholder(s);
    setShareholderForm({
      name: s.name,
      capital_contributed: String(s.capital_contributed),
      ownership_percent: String(s.ownership_percent),
      date_invested: s.date_invested ?? '',
      notes: s.notes ?? '',
    });
    setShareholderDialogOpen(true);
  }

  async function handleSubmitShareholder(e: React.FormEvent) {
    e.preventDefault();
    setSavingShareholder(true);
    const payload = {
      name: shareholderForm.name,
      capital_contributed: Number(shareholderForm.capital_contributed) || 0,
      ownership_percent: Number(shareholderForm.ownership_percent) || 0,
      date_invested: shareholderForm.date_invested || null,
      notes: shareholderForm.notes || null,
    };

    const { error } = editingShareholder
      ? await supabase.from('shareholders').update(payload).eq('id', editingShareholder.id)
      : await supabase.from('shareholders').insert({ ...payload, created_by: profile?.id ?? null });

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: `Shareholder ${editingShareholder ? 'updated' : 'added'}` });
      setShareholderDialogOpen(false);
      load();
    }
    setSavingShareholder(false);
  }

  // Live "as of today" balance per account, shown as a column on the Chart
  // of Accounts tab. Sign follows each account's normal balance side (debit
  // for asset/expense, credit for liability/equity/revenue).
  async function loadAccountBalances(accts: any[]) {
    const today = new Date().toISOString().split('T')[0];
    const { data } = await supabase
      .from('journal_entry_lines')
      .select('debit, credit, account_id, journal_entries!inner(entry_date)')
      .lte('journal_entries.entry_date', today);

    const typeByAccount = new Map(accts.map(a => [a.id, a.account_type]));
    const totals: Record<string, number> = {};
    (data ?? []).forEach((l: any) => {
      const type = typeByAccount.get(l.account_id);
      const net = type === 'asset' || type === 'expense'
        ? Number(l.debit) - Number(l.credit)
        : Number(l.credit) - Number(l.debit);
      totals[l.account_id] = (totals[l.account_id] ?? 0) + net;
    });
    setAccountBalances(totals);
  }

  async function generateTrialBalance() {
    setStatementLoading(true);
    const { data } = await supabase
      .from('journal_entry_lines')
      .select('debit, credit, chart_of_accounts(code, name, account_type), journal_entries!inner(entry_date)')
      .lte('journal_entries.entry_date', trialBalanceDate);

    const byAccount: Record<string, { code: string; name: string; type: string; debit: number; credit: number }> = {};
    (data ?? []).forEach((l: any) => {
      const acc = l.chart_of_accounts;
      if (!acc) return;
      if (!byAccount[acc.code]) byAccount[acc.code] = { code: acc.code, name: acc.name, type: acc.account_type, debit: 0, credit: 0 };
      byAccount[acc.code].debit += Number(l.debit);
      byAccount[acc.code].credit += Number(l.credit);
    });

    const rows = Object.values(byAccount)
      .map(a => {
        const net = a.debit - a.credit;
        const isDebitNormal = a.type === 'asset' || a.type === 'expense';
        let debitBalance = 0;
        let creditBalance = 0;
        if (isDebitNormal) {
          if (net >= 0) debitBalance = net; else creditBalance = -net;
        } else if (-net >= 0) {
          creditBalance = -net;
        } else {
          debitBalance = net;
        }
        return { ...a, debitBalance, creditBalance };
      })
      .filter(r => r.debitBalance !== 0 || r.creditBalance !== 0)
      .sort((a, b) => a.code.localeCompare(b.code));

    const totalDebit = rows.reduce((s, r) => s + r.debitBalance, 0);
    const totalCredit = rows.reduce((s, r) => s + r.creditBalance, 0);
    setTrialBalance({ rows, totalDebit, totalCredit });
    setStatementLoading(false);
  }

  // Per-account "ledger card": every line ever posted to one account, in
  // date order, with a running balance — the actual General Ledger, as
  // distinct from the Journal Entries tab's chronological-by-transaction view.
  async function generateLedger() {
    if (!ledgerAccountId) return;
    setLedgerLoading(true);
    const account = accounts.find(a => a.id === ledgerAccountId);
    const isDebitNormal = account?.account_type === 'asset' || account?.account_type === 'expense';

    const { data } = await supabase
      .from('journal_entry_lines')
      .select('debit, credit, memo, journal_entries!inner(entry_number, entry_date, description, reference, created_at)')
      .eq('account_id', ledgerAccountId)
      .lte('journal_entries.entry_date', ledgerEndDate);

    const sorted = (data ?? []).slice().sort((a: any, b: any) => {
      const da = a.journal_entries?.entry_date ?? '';
      const db = b.journal_entries?.entry_date ?? '';
      if (da !== db) return da.localeCompare(db);
      return (a.journal_entries?.created_at ?? '').localeCompare(b.journal_entries?.created_at ?? '');
    });

    let running = 0;
    let opening = 0;
    const rows: any[] = [];
    sorted.forEach((l: any) => {
      const delta = isDebitNormal ? Number(l.debit) - Number(l.credit) : Number(l.credit) - Number(l.debit);
      const entryDate = l.journal_entries?.entry_date;
      running += delta;
      if (entryDate && entryDate < ledgerStartDate) {
        opening += delta;
        return;
      }
      rows.push({
        date: entryDate,
        entryNumber: l.journal_entries?.entry_number,
        description: l.journal_entries?.description,
        reference: l.journal_entries?.reference,
        memo: l.memo,
        debit: Number(l.debit),
        credit: Number(l.credit),
        balance: running,
      });
    });

    setLedgerRows(rows);
    setLedgerOpeningBalance(opening);
    setLedgerLoading(false);
  }

  // Opex = the "Operating Expenses" account (code 5000) specifically;
  // "expense" = every expense-type account combined (assumption noted in
  // the PRD — adjust the code check below if Opex should mean something else).
  async function generateMonthlyTrends() {
    setTrendsLoading(true);
    const { data } = await supabase
      .from('journal_entry_lines')
      .select('debit, credit, chart_of_accounts(code, account_type), journal_entries!inner(entry_date)')
      .gte('journal_entries.entry_date', trendStartDate)
      .lte('journal_entries.entry_date', trendEndDate);

    const byMonth: Record<string, { revenue: number; expense: number; opex: number }> = {};
    (data ?? []).forEach((l: any) => {
      const acc = l.chart_of_accounts;
      const entryDate = l.journal_entries?.entry_date;
      if (!acc || !entryDate) return;
      const month = entryDate.substring(0, 7);
      if (!byMonth[month]) byMonth[month] = { revenue: 0, expense: 0, opex: 0 };
      if (acc.account_type === 'revenue') {
        byMonth[month].revenue += Number(l.credit) - Number(l.debit);
      } else if (acc.account_type === 'expense') {
        const amt = Number(l.debit) - Number(l.credit);
        byMonth[month].expense += amt;
        if (acc.code === '5000') byMonth[month].opex += amt;
      }
    });

    const rows = Object.entries(byMonth)
      .map(([month, v]) => {
        const netIncome = v.revenue - v.expense;
        return {
          month,
          revenue: v.revenue,
          expense: v.expense,
          netIncome,
          netProfitPercent: v.revenue > 0 ? (netIncome / v.revenue) * 100 : 0,
          opex: v.opex,
        };
      })
      .sort((a, b) => a.month.localeCompare(b.month));

    setMonthlyTrends(rows);
    setTrendsLoading(false);
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
          <TabsTrigger value="ledger">General Ledger</TabsTrigger>
          <TabsTrigger value="accounts">Chart of Accounts</TabsTrigger>
          <TabsTrigger value="trial">Trial Balance</TabsTrigger>
          <TabsTrigger value="income">Income Statement</TabsTrigger>
          <TabsTrigger value="balance">Balance Sheet</TabsTrigger>
          <TabsTrigger value="trends">Monthly Trends</TabsTrigger>
          <TabsTrigger value="shareholders">Shareholders</TabsTrigger>
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

        <TabsContent value="ledger" className="space-y-4">
          <Card className="glass-card border-border">
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row gap-4 items-end">
                <div className="space-y-2 flex-1">
                  <Label>Account</Label>
                  <Select value={ledgerAccountId} onValueChange={setLedgerAccountId}>
                    <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                    <SelectContent>{accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 flex-1">
                  <Label>Start Date</Label>
                  <Input type="date" value={ledgerStartDate} onChange={(e) => setLedgerStartDate(e.target.value)} />
                </div>
                <div className="space-y-2 flex-1">
                  <Label>End Date</Label>
                  <Input type="date" value={ledgerEndDate} onChange={(e) => setLedgerEndDate(e.target.value)} />
                </div>
                <Button onClick={generateLedger} disabled={ledgerLoading || !ledgerAccountId}>
                  {ledgerLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Generate
                </Button>
              </div>
            </CardContent>
          </Card>

          {ledgerRows && (
            <Card className="glass-card border-border">
              <CardHeader>
                <CardTitle>{accounts.find(a => a.id === ledgerAccountId)?.code} — {accounts.find(a => a.id === ledgerAccountId)?.name}</CardTitle>
                <CardDescription>{formatDate(ledgerStartDate)} – {formatDate(ledgerEndDate)}</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Entry #</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow className="bg-secondary/30">
                      <TableCell colSpan={5} className="text-sm font-medium">Opening Balance</TableCell>
                      <TableCell className="text-right text-sm font-medium">{formatCurrency(ledgerOpeningBalance)}</TableCell>
                    </TableRow>
                    {ledgerRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">No activity in this date range</TableCell>
                      </TableRow>
                    ) : (
                      ledgerRows.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-sm">{formatDate(r.date)}</TableCell>
                          <TableCell className="text-sm font-mono">{r.entryNumber}</TableCell>
                          <TableCell className="text-sm">{r.description ?? r.memo ?? '—'}</TableCell>
                          <TableCell className="text-right text-sm">{r.debit > 0 ? formatCurrency(r.debit) : ''}</TableCell>
                          <TableCell className="text-right text-sm">{r.credit > 0 ? formatCurrency(r.credit) : ''}</TableCell>
                          <TableCell className="text-right text-sm font-medium">{formatCurrency(r.balance)}</TableCell>
                        </TableRow>
                      ))
                    )}
                    <TableRow className="border-t-2 border-border">
                      <TableCell colSpan={5} className="font-bold">Ending Balance</TableCell>
                      <TableCell className="text-right font-bold">
                        {formatCurrency(ledgerRows.length > 0 ? ledgerRows[ledgerRows.length - 1].balance : ledgerOpeningBalance)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
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
                    <TableHead className="text-right">Balance (as of today)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accounts.map(a => (
                    <TableRow key={a.id}>
                      <TableCell className="text-sm font-mono">{a.code}</TableCell>
                      <TableCell className="text-sm font-medium">{a.name}</TableCell>
                      <TableCell><Badge variant="outline" className="capitalize">{a.account_type}</Badge></TableCell>
                      <TableCell className="text-right text-sm font-medium">{formatCurrency(accountBalances[a.id] ?? 0)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trial" className="space-y-4">
          <Card className="glass-card border-border">
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row gap-4 items-end">
                <div className="space-y-2 flex-1">
                  <Label>As Of Date</Label>
                  <Input type="date" value={trialBalanceDate} onChange={(e) => setTrialBalanceDate(e.target.value)} />
                </div>
                <Button onClick={generateTrialBalance} disabled={statementLoading}>
                  {statementLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Generate
                </Button>
              </div>
            </CardContent>
          </Card>

          {trialBalance && (
            <Card className="glass-card border-border">
              <CardHeader><CardTitle>Trial Balance</CardTitle><CardDescription>As of {formatDate(trialBalanceDate)}</CardDescription></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trialBalance.rows.map((r: any) => (
                      <TableRow key={r.code}>
                        <TableCell className="text-sm font-mono">{r.code}</TableCell>
                        <TableCell className="text-sm">{r.name}</TableCell>
                        <TableCell className="text-right text-sm">{r.debitBalance > 0 ? formatCurrency(r.debitBalance) : ''}</TableCell>
                        <TableCell className="text-right text-sm">{r.creditBalance > 0 ? formatCurrency(r.creditBalance) : ''}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2 border-border">
                      <TableCell className="font-bold" colSpan={2}>Total</TableCell>
                      <TableCell className="text-right font-bold">{formatCurrency(trialBalance.totalDebit)}</TableCell>
                      <TableCell className="text-right font-bold">{formatCurrency(trialBalance.totalCredit)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                {Math.abs(trialBalance.totalDebit - trialBalance.totalCredit) > 0.01 ? (
                  <p className="text-xs text-destructive mt-3">Debits do not equal credits — check for unbalanced journal entries.</p>
                ) : (
                  <p className="text-xs text-success mt-3">Debits equal credits — the ledger is balanced.</p>
                )}
              </CardContent>
            </Card>
          )}
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

        <TabsContent value="trends" className="space-y-4">
          <Card className="glass-card border-border">
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row gap-4 items-end">
                <div className="space-y-2 flex-1">
                  <Label>Start Date</Label>
                  <Input type="date" value={trendStartDate} onChange={(e) => setTrendStartDate(e.target.value)} />
                </div>
                <div className="space-y-2 flex-1">
                  <Label>End Date</Label>
                  <Input type="date" value={trendEndDate} onChange={(e) => setTrendEndDate(e.target.value)} />
                </div>
                <Button onClick={generateMonthlyTrends} disabled={trendsLoading}>
                  {trendsLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Generate
                </Button>
              </div>
            </CardContent>
          </Card>

          {monthlyTrends && (
            monthlyTrends.length === 0 ? (
              <Card className="glass-card border-border">
                <CardContent className="p-8 text-center text-sm text-muted-foreground">No journal activity in this date range</CardContent>
              </Card>
            ) : (
              <>
                <Card className="glass-card border-border">
                  <CardHeader><CardTitle>Net Profit % and Opex per Month</CardTitle><CardDescription>{formatDate(trendStartDate)} – {formatDate(trendEndDate)}</CardDescription></CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={monthlyTrends.map(t => ({ name: monthLabel(t.month), 'Net Profit %': Math.round(t.netProfitPercent * 10) / 10, Opex: t.opex }))}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                        <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
                        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} />
                        <Tooltip contentStyle={{ backgroundColor: 'rgb(var(--card))', border: '1px solid rgb(var(--border))', borderRadius: '8px', fontSize: '12px' }} />
                        <Legend />
                        <Bar yAxisId="left" dataKey="Net Profit %" fill="#0B7A3D" radius={[4, 4, 0, 0]} />
                        <Bar yAxisId="right" dataKey="Opex" fill="#EF4444" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card className="glass-card border-border">
                  <CardHeader><CardTitle>Monthly Breakdown</CardTitle></CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Month</TableHead>
                          <TableHead className="text-right">Revenue</TableHead>
                          <TableHead className="text-right">Expenses</TableHead>
                          <TableHead className="text-right">Net Income</TableHead>
                          <TableHead className="text-right">Net Profit %</TableHead>
                          <TableHead className="text-right">Opex</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {monthlyTrends.map(t => (
                          <TableRow key={t.month}>
                            <TableCell className="text-sm font-medium">{monthLabel(t.month)}</TableCell>
                            <TableCell className="text-right text-sm">{formatCurrency(t.revenue)}</TableCell>
                            <TableCell className="text-right text-sm">{formatCurrency(t.expense)}</TableCell>
                            <TableCell className={`text-right text-sm font-medium ${t.netIncome >= 0 ? 'text-success' : 'text-destructive'}`}>{formatCurrency(t.netIncome)}</TableCell>
                            <TableCell className={`text-right text-sm font-medium ${t.netProfitPercent >= 0 ? 'text-success' : 'text-destructive'}`}>{t.netProfitPercent.toFixed(1)}%</TableCell>
                            <TableCell className="text-right text-sm">{formatCurrency(t.opex)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </>
            )
          )}
        </TabsContent>

        <TabsContent value="shareholders" className="space-y-4">
          {(() => {
            const totalCapital = shareholders.reduce((s, sh) => s + Number(sh.capital_contributed), 0);
            const totalPercent = shareholders.reduce((s, sh) => s + Number(sh.ownership_percent), 0);
            return (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <StatCard title="Total Capital Contributed" value={formatCurrency(totalCapital)} icon={<TrendingUp className="w-5 h-5" />} variant="success" />
                  <StatCard
                    title="Total Ownership Allocated"
                    value={`${totalPercent.toFixed(1)}%`}
                    icon={<Scale className="w-5 h-5" />}
                    variant={Math.abs(totalPercent - 100) < 0.01 ? 'success' : 'warning'}
                  />
                </div>
                <Card className="glass-card border-border">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0">
                    <div>
                      <CardTitle>Shareholders' Capital</CardTitle>
                      <CardDescription>{shareholders.length} shareholder{shareholders.length !== 1 ? 's' : ''}</CardDescription>
                    </div>
                    {canManageShareholders && (
                      <Button size="sm" variant="outline" onClick={openAddShareholder}>
                        <Plus className="w-4 h-4 mr-2" />
                        Add Shareholder
                      </Button>
                    )}
                  </CardHeader>
                  <CardContent className="p-0">
                    {shareholders.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-8">No shareholders recorded yet</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead className="text-right">Capital Contributed</TableHead>
                            <TableHead className="text-right">Ownership %</TableHead>
                            <TableHead>Date Invested</TableHead>
                            <TableHead>Notes</TableHead>
                            {canManageShareholders && <TableHead className="text-right">Actions</TableHead>}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {shareholders.map(sh => (
                            <TableRow key={sh.id}>
                              <TableCell className="text-sm font-medium">{sh.name}</TableCell>
                              <TableCell className="text-right text-sm">{formatCurrency(sh.capital_contributed)}</TableCell>
                              <TableCell className="text-right text-sm">{Number(sh.ownership_percent).toFixed(1)}%</TableCell>
                              <TableCell className="text-sm">{sh.date_invested ? formatDate(sh.date_invested) : '—'}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">{sh.notes ?? '—'}</TableCell>
                              {canManageShareholders && (
                                <TableCell className="text-right">
                                  <Button variant="ghost" size="sm" onClick={() => openEditShareholder(sh)}>Edit</Button>
                                </TableCell>
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                    {Math.abs(totalPercent - 100) >= 0.01 && shareholders.length > 0 && (
                      <p className="text-xs text-warning px-4 pb-4">Ownership percentages add up to {totalPercent.toFixed(1)}%, not 100% — double-check the entries above.</p>
                    )}
                  </CardContent>
                </Card>
              </>
            );
          })()}
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

      {/* Add/edit shareholder */}
      <Dialog open={shareholderDialogOpen} onOpenChange={setShareholderDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingShareholder ? 'Edit Shareholder' : 'Add Shareholder'}</DialogTitle>
            <DialogDescription>Track capital contributed and ownership percentage</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmitShareholder} className="space-y-4">
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input required value={shareholderForm.name} onChange={(e) => setShareholderForm({ ...shareholderForm, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Capital Contributed (₱) *</Label>
                <Input type="number" required value={shareholderForm.capital_contributed} onChange={(e) => setShareholderForm({ ...shareholderForm, capital_contributed: e.target.value })} placeholder="0.00" />
              </div>
              <div className="space-y-2">
                <Label>Ownership % *</Label>
                <Input type="number" required max="100" step="0.1" value={shareholderForm.ownership_percent} onChange={(e) => setShareholderForm({ ...shareholderForm, ownership_percent: e.target.value })} placeholder="0.0" />
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Date Invested</Label>
                <Input type="date" value={shareholderForm.date_invested} onChange={(e) => setShareholderForm({ ...shareholderForm, date_invested: e.target.value })} />
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Notes</Label>
                <Input value={shareholderForm.notes} onChange={(e) => setShareholderForm({ ...shareholderForm, notes: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShareholderDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={savingShareholder}>
                {savingShareholder && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {editingShareholder ? 'Update' : 'Add'} Shareholder
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
