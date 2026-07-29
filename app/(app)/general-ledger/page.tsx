'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { StatCard } from '@/components/dashboard/stat-card';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency, formatDate } from '@/lib/format';
import { Loader2, TrendingUp, TrendingDown, Scale } from 'lucide-react';

export default function GeneralLedgerPage() {
  // Shareholders' Capital feeds the Balance Sheet's equity section below —
  // full shareholder management (add/edit) lives on its own /shareholders
  // page now, but this data is still loaded here for that calculation.
  const [shareholders, setShareholders] = useState<any[]>([]);

  const [startDate, setStartDate] = useState(new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().split('T')[0]);
  const [incomeStatement, setIncomeStatement] = useState<any>(null);
  const [balanceSheet, setBalanceSheet] = useState<any>(null);
  const [statementLoading, setStatementLoading] = useState(false);
  const [trialBalanceDate, setTrialBalanceDate] = useState(new Date().toISOString().split('T')[0]);
  const [trialBalance, setTrialBalance] = useState<any>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    const { data: shs } = await supabase.from('shareholders').select('*').order('ownership_percent', { ascending: false });
    setShareholders(shs ?? []);
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
      <PageHeader title="Financial Statements" description="Trial balance, income statement, and balance sheet" />

      <Tabs defaultValue="trial">
        <TabsList>
          <TabsTrigger value="trial">Trial Balance</TabsTrigger>
          <TabsTrigger value="income">Income Statement</TabsTrigger>
          <TabsTrigger value="balance">Balance Sheet</TabsTrigger>
        </TabsList>

        <TabsContent value="trial" className="space-y-4">
          <Card className="glass-card border-border">
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-end">
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
              <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-end">
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
              <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-end">
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

      </Tabs>

    </div>
  );
}
