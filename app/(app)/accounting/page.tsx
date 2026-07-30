'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { StatCard } from '@/components/dashboard/stat-card';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency, formatDate, exportToCSV } from '@/lib/format';
import { postJournalEntry } from '@/lib/ledger';
import {
  Calculator, Plus, Download, Loader2, TrendingUp, TrendingDown, Banknote, Wallet, Landmark,
} from 'lucide-react';

export default function AccountingPage() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const [cashFlow, setCashFlow] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [receivables, setReceivables] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [ledgerStats, setLedgerStats] = useState({
    cashVaultBalance: 0, cashBankBalance: 0, todayCollections: 0,
    todayCashRelease: 0, todayCashExpenses: 0, totalReceivable: 0,
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogType, setDialogType] = useState<'cashflow' | 'expense'>('cashflow');
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    type: 'inflow', category: '', amount: '', reference: '', notes: '', expense_date: '', expense_category: '', description: '',
  });

  useEffect(() => { load(); loadBranches(); loadLedgerStats(); }, []);

  async function loadBranches() {
    const { data } = await supabase.from('branches').select('id, name').eq('status', 'active');
    setBranches(data ?? []);
  }

  // Real cash position and today's movement, derived straight from the
  // general ledger (journal_entry_lines) instead of the separate manual
  // cash_flow/expenses tables below — those are only as good as whoever
  // remembers to log an entry there, while every voucher/disbursement in
  // the app already auto-posts to the ledger via postJournalEntry.
  async function loadLedgerStats() {
    const today = new Date().toISOString().split('T')[0];
    const { data: cashAccounts } = await supabase.from('chart_of_accounts').select('id, code').in('code', ['1000', '1010']);
    const vaultId = cashAccounts?.find(a => a.code === '1000')?.id;
    const bankId = cashAccounts?.find(a => a.code === '1010')?.id;
    const cashAccountIds = (cashAccounts ?? []).map(a => a.id);

    const [{ data: cashLines }, { data: paymentsToday }, { data: activeLoans }] = await Promise.all([
      cashAccountIds.length > 0
        ? supabase.from('journal_entry_lines').select('account_id, debit, credit, journal_entries(entry_date, source)').in('account_id', cashAccountIds)
        : Promise.resolve({ data: [] as any[] }),
      supabase.from('payments').select('amount_paid').eq('payment_date', today),
      supabase.from('loans').select('remaining_balance').eq('status', 'active'),
    ]);

    let cashVaultBalance = 0, cashBankBalance = 0, todayCashRelease = 0, todayCashExpenses = 0;
    const releaseSources = ['disbursement', 'gas_voucher', 'payroll_voucher', 'thirteenth_month_voucher'];
    const expenseSources = ['expense', 'general_cash_voucher'];
    for (const l of (cashLines ?? []) as any[]) {
      const net = (Number(l.debit) || 0) - (Number(l.credit) || 0);
      if (l.account_id === vaultId) cashVaultBalance += net;
      if (l.account_id === bankId) cashBankBalance += net;
      const entryDate = l.journal_entries?.entry_date;
      const source = l.journal_entries?.source;
      if (entryDate === today && Number(l.credit) > 0) {
        if (releaseSources.includes(source)) todayCashRelease += Number(l.credit);
        else if (expenseSources.includes(source)) todayCashExpenses += Number(l.credit);
      }
    }

    setLedgerStats({
      cashVaultBalance,
      cashBankBalance,
      todayCollections: (paymentsToday ?? []).reduce((s, p: any) => s + Number(p.amount_paid), 0),
      todayCashRelease,
      todayCashExpenses,
      totalReceivable: (activeLoans ?? []).reduce((s, l: any) => s + Number(l.remaining_balance), 0),
    });
  }

  async function load() {
    setLoading(true);
    const [cf, ex, recv] = await Promise.all([
      supabase.from('cash_flow').select('*, branches(name)').order('transaction_date', { ascending: false }).limit(20),
      supabase.from('expenses').select('*, branches(name)').order('expense_date', { ascending: false }).limit(20),
      supabase.from('loan_receivables').select('*, loans(loan_number, customers(first_name, last_name))').order('as_of_date', { ascending: false }).limit(20),
    ]);
    setCashFlow(cf.data ?? []);
    setExpenses(ex.data ?? []);
    setReceivables(recv.data ?? []);
    setLoading(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    if (dialogType === 'cashflow') {
      const { error } = await supabase.from('cash_flow').insert({
        type: form.type, category: form.category, amount: Number(form.amount),
        reference: form.reference || null, notes: form.notes || null,
        transaction_date: new Date().toISOString().split('T')[0],
      });
      if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
      else { toast({ title: 'Success', description: 'Cash flow entry added' }); setDialogOpen(false); load(); }
    } else {
      const expenseDate = form.expense_date || new Date().toISOString().split('T')[0];
      const { error } = await supabase.from('expenses').insert({
        category: form.expense_category, amount: Number(form.amount),
        description: form.description || null,
        expense_date: expenseDate,
      });
      if (error) {
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
      } else {
        postJournalEntry({
          entryDate: expenseDate,
          description: `Expense — ${form.expense_category}`,
          source: 'expense',
          createdBy: profile?.id ?? null,
          lines: [
            { accountCode: '5000', debit: Number(form.amount), memo: form.description || form.expense_category },
            { accountCode: '1000', credit: Number(form.amount), memo: 'Cash paid out' },
          ],
        });
        toast({ title: 'Success', description: 'Expense added' });
        setDialogOpen(false);
        load();
      }
    }
    setSaving(false);
  }

  function handleExport() {
    exportToCSV(cashFlow.map(c => ({ Date: c.transaction_date, Type: c.type, Category: c.category, Amount: c.amount, Reference: c.reference ?? '' })), 'cash-flow.csv');
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Accounting" description="Cash flow, expenses, receivables, and financial summaries">
        <Button variant="outline" size="sm" onClick={handleExport}><Download className="w-4 h-4 mr-2" />Export</Button>
        <Button size="sm" onClick={() => { setDialogType('cashflow'); setForm({ type: 'inflow', category: '', amount: '', reference: '', notes: '', expense_date: '', expense_category: '', description: '' }); setDialogOpen(true); }}>
          <Plus className="w-4 h-4 mr-2" />Cash Flow
        </Button>
        <Button size="sm" variant="outline" onClick={() => { setDialogType('expense'); setForm({ type: 'inflow', category: '', amount: '', reference: '', notes: '', expense_date: '', expense_category: '', description: '' }); setDialogOpen(true); }}>
          <Plus className="w-4 h-4 mr-2" />Expense
        </Button>
      </PageHeader>

      {/* Ledger-derived summary cards — real cash position and today's
          movement, straight from journal_entry_lines, not the manual
          Cash Flow/Expenses log below. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard
          title="Cash Balances"
          value={formatCurrency(ledgerStats.cashVaultBalance + ledgerStats.cashBankBalance)}
          icon={<Banknote className="w-5 h-5" />}
          variant="success"
          subtitle={`Vault ${formatCurrency(ledgerStats.cashVaultBalance)} · Bank ${formatCurrency(ledgerStats.cashBankBalance)}`}
        />
        <StatCard title="Today's Collection" value={formatCurrency(ledgerStats.todayCollections)} icon={<TrendingUp className="w-5 h-5" />} variant="success" />
        <StatCard title="Today's Cash Release" value={formatCurrency(ledgerStats.todayCashRelease)} icon={<TrendingDown className="w-5 h-5" />} variant="warning" subtitle="Loan/gas/payroll disbursements" />
        <StatCard title="Today's Cash Expenses" value={formatCurrency(ledgerStats.todayCashExpenses)} icon={<Wallet className="w-5 h-5" />} variant="danger" subtitle="Repairs, misc. cash vouchers" />
        <StatCard title="Total Receivable" value={formatCurrency(ledgerStats.totalReceivable)} icon={<Landmark className="w-5 h-5" />} variant="default" subtitle="Active loans outstanding" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cash Flow */}
        <Card className="glass-card border-border">
          <CardHeader><CardTitle>Cash Flow</CardTitle><CardDescription>Recent transactions</CardDescription></CardHeader>
          <CardContent>
            {loading ? <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div> : cashFlow.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No entries</p> : (
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Category</TableHead><TableHead>Amount</TableHead></TableRow></TableHeader>
                <TableBody>
                  {cashFlow.map(c => (
                    <TableRow key={c.id}>
                      <TableCell className="text-sm">{formatDate(c.transaction_date)}</TableCell>
                      <TableCell><Badge variant={c.type === 'inflow' ? 'default' : 'destructive'}>{c.type}</Badge></TableCell>
                      <TableCell className="text-sm">{c.category}</TableCell>
                      <TableCell className={`text-sm font-medium ${c.type === 'inflow' ? 'text-success' : 'text-destructive'}`}>{formatCurrency(c.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Expenses */}
        <Card className="glass-card border-border">
          <CardHeader><CardTitle>Expenses</CardTitle><CardDescription>Recent expense records</CardDescription></CardHeader>
          <CardContent>
            {loading ? <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div> : expenses.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No expenses</p> : (
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Category</TableHead><TableHead>Amount</TableHead></TableRow></TableHeader>
                <TableBody>
                  {expenses.map(e => (
                    <TableRow key={e.id}>
                      <TableCell className="text-sm">{formatDate(e.expense_date)}</TableCell>
                      <TableCell className="text-sm">{e.category}</TableCell>
                      <TableCell className="text-sm font-medium text-destructive">{formatCurrency(e.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Loan Receivables */}
      <Card className="glass-card border-border">
        <CardHeader><CardTitle>Loan Receivables</CardTitle><CardDescription>Outstanding balances</CardDescription></CardHeader>
        <CardContent>
          {loading ? <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div> : receivables.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No receivables</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Loan #</TableHead><TableHead>Customer</TableHead><TableHead>Principal</TableHead><TableHead>Interest</TableHead><TableHead>Penalty</TableHead><TableHead>Total</TableHead><TableHead>As Of</TableHead></TableRow></TableHeader>
              <TableBody>
                {receivables.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm font-medium">{r.loans?.loan_number ?? '—'}</TableCell>
                    <TableCell className="text-sm">{r.loans ? `${r.loans.customers?.first_name} ${r.loans.customers?.last_name}` : '—'}</TableCell>
                    <TableCell className="text-sm">{formatCurrency(r.principal_balance)}</TableCell>
                    <TableCell className="text-sm">{formatCurrency(r.interest_balance)}</TableCell>
                    <TableCell className="text-sm">{formatCurrency(r.penalty_balance)}</TableCell>
                    <TableCell className="text-sm font-bold">{formatCurrency(r.total_balance)}</TableCell>
                    <TableCell className="text-sm">{formatDate(r.as_of_date)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogType === 'cashflow' ? 'Add Cash Flow Entry' : 'Add Expense'}</DialogTitle>
            <DialogDescription>{dialogType === 'cashflow' ? 'Record a cash inflow or outflow' : 'Record a new expense'}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {dialogType === 'cashflow' ? (
              <>
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="inflow">Inflow</SelectItem><SelectItem value="outflow">Outflow</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>Category *</Label><Input required value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Loan Disbursement, Collection" /></div>
                <div className="space-y-2"><Label>Amount (₱) *</Label><Input type="number" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
                <div className="space-y-2"><Label>Reference</Label><Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></div>
                <div className="space-y-2"><Label>Notes</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
              </>
            ) : (
              <>
                <div className="space-y-2"><Label>Category *</Label><Input required value={form.expense_category} onChange={(e) => setForm({ ...form, expense_category: e.target.value })} placeholder="e.g. Utilities, Rent" /></div>
                <div className="space-y-2"><Label>Amount (₱) *</Label><Input type="number" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
                <div className="space-y-2"><Label>Date</Label><Input type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} /></div>
                <div className="space-y-2"><Label>Description</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
              </>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Add Entry</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
