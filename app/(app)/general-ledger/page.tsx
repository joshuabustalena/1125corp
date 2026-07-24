'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
import { formatCurrency, formatDate } from '@/lib/format';
import { Plus, Loader2, TrendingUp, TrendingDown, Scale } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export default function GeneralLedgerPage() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const isAdmin = profile?.role_name === 'Administrator';
  const canManageShareholders = isAdmin || profile?.role_name === 'Accounting';
  const [shareholders, setShareholders] = useState<any[]>([]);
  const [shareholderDialogOpen, setShareholderDialogOpen] = useState(false);
  const [savingShareholder, setSavingShareholder] = useState(false);
  const [editingShareholder, setEditingShareholder] = useState<any>(null);
  const [shareholderForm, setShareholderForm] = useState({ name: '', capital_contributed: '', ownership_percent: '', date_invested: '', notes: '' });

  const [startDate, setStartDate] = useState(new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().split('T')[0]);
  const [incomeStatement, setIncomeStatement] = useState<any>(null);
  const [balanceSheet, setBalanceSheet] = useState<any>(null);
  const [statementLoading, setStatementLoading] = useState(false);
  const [trialBalanceDate, setTrialBalanceDate] = useState(new Date().toISOString().split('T')[0]);
  const [trialBalance, setTrialBalance] = useState<any>(null);
  const [trendStartDate, setTrendStartDate] = useState(new Date(Date.now() - 365 * 86400000).toISOString().split('T')[0]);
  const [trendEndDate, setTrendEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [monthlyTrends, setMonthlyTrends] = useState<any[] | null>(null);
  const [trendsLoading, setTrendsLoading] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    const { data: shs } = await supabase.from('shareholders').select('*').order('ownership_percent', { ascending: false });
    setShareholders(shs ?? []);
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
    const revenueTotal = Object.entries(byAccount).filter(([, v]) => v.type === 'revenue').reduce((s, [, v]) => s + v.balance, 0);
    const expenseTotal = Object.entries(byAccount).filter(([, v]) => v.type === 'expense').reduce((s, [, v]) => s + v.balance, 0);
    const retainedEarnings = revenueTotal - expenseTotal;

    // Owner's Equity is driven by the Shareholders' Capital table (the
    // authoritative record of actual investment), not by whatever's been
    // posted to equity-type chart-of-accounts via journal entries — those
    // could previously drift apart from the real capital ledger. Retained
    // Earnings still layers on top since it's a genuinely separate
    // component (accumulated profit/loss), not part of contributed capital.
    const shareholdersCapital = shareholders.reduce((s, sh) => s + Number(sh.capital_contributed), 0);

    const totalAssets = assets.reduce((s, [, v]) => s + v.balance, 0);
    const totalLiabilities = liabilities.reduce((s, [, v]) => s + v.balance, 0);
    const totalEquity = shareholdersCapital + retainedEarnings;

    setBalanceSheet({ assets, liabilities, shareholdersCapital, retainedEarnings, totalAssets, totalLiabilities, totalEquity });
    setStatementLoading(false);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Financial Statements" description="Trial balance, income statement, balance sheet, trends, and shareholders" />

      <Tabs defaultValue="trial">
        <TabsList>
          <TabsTrigger value="trial">Trial Balance</TabsTrigger>
          <TabsTrigger value="income">Income Statement</TabsTrigger>
          <TabsTrigger value="balance">Balance Sheet</TabsTrigger>
          <TabsTrigger value="trends">Monthly Trends</TabsTrigger>
          <TabsTrigger value="shareholders">Shareholders</TabsTrigger>
        </TabsList>

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
                    <TableRow><TableCell className="pl-6 text-sm">Shareholders' Capital</TableCell><TableCell className="text-right text-sm">{formatCurrency(balanceSheet.shareholdersCapital)}</TableCell></TableRow>
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
