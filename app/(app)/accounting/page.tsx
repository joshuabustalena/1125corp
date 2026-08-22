'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
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
import { formatCurrency, exportToCSV } from '@/lib/format';
import { postJournalEntry } from '@/lib/ledger';
import { resolveBranchAccountCode } from '@/lib/branch-accounts';
import { CASH_BUCKETS, cashBucketFor, isSpendableCashAccount } from '@/lib/cash-buckets';
import {
  Calculator, Plus, Download, Loader2, TrendingUp, TrendingDown, Banknote, Wallet, Landmark,
} from 'lucide-react';

const COMPANY_WIDE_VALUE = 'company-wide';

export default function AccountingPage() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const isAdmin = profile?.role_name === 'Administrator';
  // Still loaded (not rendered) purely to back the Export CSV button — the
  // Cash Flow / Expenses / Loan Receivable tables themselves were removed
  // from this dashboard at the client's request.
  const [cashFlow, setCashFlow] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [ledgerStats, setLedgerStats] = useState({
    cashByBucket: {} as Record<string, number>, todayCollections: 0,
    todayCashRelease: 0, todayCashExpenses: 0, totalReceivable: 0,
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogType, setDialogType] = useState<'cashflow' | 'expense'>('cashflow');
  const [saving, setSaving] = useState(false);
  // Admin: free "All Branches" filter (default). Everyone else: locked to
  // their own branch — same pattern as Dashboard/Chart of Accounts.
  const [branchFilter, setBranchFilter] = useState('all');
  const [branchResolved, setBranchResolved] = useState(false);

  const [form, setForm] = useState({
    type: 'inflow', category: '', amount: '', reference: '', notes: '', expense_date: '', expense_category: '', description: '', branch_id: '',
  });

  useEffect(() => {
    loadBranches();
  }, []);

  useEffect(() => {
    if (!profile) return;
    if (!isAdmin && profile.branch_id) setBranchFilter(profile.branch_id);
    setBranchResolved(true);
  }, [profile, isAdmin]);

  useEffect(() => {
    if (!branchResolved) return;
    load();
    loadLedgerStats();
  }, [branchResolved, branchFilter]);

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
    // Every branch keeps its own set of cash accounts now (Vault, Bank BPI,
    // Bank Gcash, etc. — however many each branch actually has), plus any
    // shared/company-wide cash account (branch_id null, e.g. "Cash on
    // Hand"). Pattern-match on the name instead of a couple of fixed codes
    // — those aren't reliably the same account across branches any more.
    let cashAcctQuery = supabase.from('chart_of_accounts').select('id, name').ilike('name', '%cash%');
    if (branchFilter !== 'all') cashAcctQuery = cashAcctQuery.or(`branch_id.eq.${branchFilter},branch_id.is.null`);
    const { data: cashAccountsRaw } = await cashAcctQuery;
    // Drop Cash Short/Over — named like cash and typed as an asset, but it's
    // a variance account, not spendable cash. See lib/cash-buckets.
    const cashAccounts = (cashAccountsRaw ?? []).filter((a: any) => isSpendableCashAccount(a.name));
    const cashAccountIds = cashAccounts.map((a: any) => a.id);
    const bucketByAccountId = new Map<string, string>(
      cashAccounts.map((a: any) => [a.id, cashBucketFor(a.name)])
    );

    // Payments/loans don't carry branch_id the same simple way everywhere —
    // loans has it directly; payments needs the branch's customer ids first
    // (same approach the Dashboard uses).
    let branchCustomerIds: string[] | null = null;
    if (branchFilter !== 'all') {
      const { data: bc } = await supabase.from('customers').select('id').eq('branch_id', branchFilter);
      branchCustomerIds = (bc ?? []).map((c: any) => c.id);
    }
    const NO_MATCH = ['00000000-0000-0000-0000-000000000000'];

    let cashLinesQuery = cashAccountIds.length > 0
      ? supabase.from('journal_entry_lines').select('account_id, debit, credit, journal_entries!inner(entry_date, source, branch_id)').in('account_id', cashAccountIds)
      : null;
    if (cashLinesQuery && branchFilter !== 'all') {
      // A cash line only counts for this branch's balance if the entry
      // itself is tagged to this branch OR is shared/company-wide — an
      // entry tagged to the OTHER branch touching a shared cash account
      // shouldn't bleed into this branch's balance.
      cashLinesQuery = cashLinesQuery.or(`branch_id.eq.${branchFilter},branch_id.is.null`, { foreignTable: 'journal_entries' });
    }
    let paymentsQuery = supabase.from('payments').select('amount_paid').eq('payment_date', today);
    if (branchCustomerIds !== null) paymentsQuery = paymentsQuery.in('customer_id', branchCustomerIds.length > 0 ? branchCustomerIds : NO_MATCH);
    let loansQuery = supabase.from('loans').select('remaining_balance').eq('status', 'active');
    if (branchFilter !== 'all') loansQuery = loansQuery.eq('branch_id', branchFilter);

    const [{ data: cashLines }, { data: paymentsToday }, { data: activeLoans }] = await Promise.all([
      cashLinesQuery ?? Promise.resolve({ data: [] as any[] }),
      paymentsQuery,
      loansQuery,
    ]);

    const cashByBucket: Record<string, number> = {};
    let todayCashRelease = 0, todayCashExpenses = 0;
    // Only an actual loan disbursement counts as "Cash Release" now — gas and
    // payroll vouchers are operating costs, so the client wants them inside
    // Total Cash Expenses instead of lumped with money going out to
    // borrowers.
    const releaseSources = ['disbursement'];
    const expenseSources = ['expense', 'general_cash_voucher', 'gas_voucher', 'payroll_voucher', 'thirteenth_month_voucher'];
    for (const l of (cashLines ?? []) as any[]) {
      const net = (Number(l.debit) || 0) - (Number(l.credit) || 0);
      const bucket = bucketByAccountId.get(l.account_id) ?? 'other';
      cashByBucket[bucket] = (cashByBucket[bucket] ?? 0) + net;
      const entryDate = l.journal_entries?.entry_date;
      const source = l.journal_entries?.source;
      if (entryDate === today && Number(l.credit) > 0) {
        if (releaseSources.includes(source)) todayCashRelease += Number(l.credit);
        else if (expenseSources.includes(source)) todayCashExpenses += Number(l.credit);
      }
    }

    setLedgerStats({
      cashByBucket,
      todayCollections: (paymentsToday ?? []).reduce((s, p: any) => s + Number(p.amount_paid), 0),
      todayCashRelease,
      todayCashExpenses,
      totalReceivable: (activeLoans ?? []).reduce((s, l: any) => s + Number(l.remaining_balance), 0),
    });
  }

  async function load() {
    setLoading(true);
    let cfQuery = supabase.from('cash_flow').select('*, branches(name)').order('transaction_date', { ascending: false }).limit(20);
    if (branchFilter !== 'all') {
      cfQuery = cfQuery.or(`branch_id.eq.${branchFilter},branch_id.is.null`);
    }
    const cf = await cfQuery;
    setCashFlow(cf.data ?? []);
    setLoading(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const entryBranchId = form.branch_id || null;
    if (dialogType === 'cashflow') {
      const { error } = await supabase.from('cash_flow').insert({
        type: form.type, category: form.category, amount: Number(form.amount),
        reference: form.reference || null, notes: form.notes || null,
        transaction_date: new Date().toISOString().split('T')[0],
        branch_id: entryBranchId,
      });
      if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
      else { toast({ title: 'Success', description: 'Cash flow entry added' }); setDialogOpen(false); load(); }
    } else {
      const expenseDate = form.expense_date || new Date().toISOString().split('T')[0];
      const { error } = await supabase.from('expenses').insert({
        category: form.expense_category, amount: Number(form.amount),
        description: form.description || null,
        expense_date: expenseDate,
        branch_id: entryBranchId,
      });
      if (error) {
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
      } else {
        // Same branch-aware account resolution as the rest of the ledger —
        // "1000" isn't reliably the right cash account for every branch.
        const branchName = branches.find(b => b.id === entryBranchId)?.name;
        const cashCode = (await resolveBranchAccountCode('Cash in Vault', branchName)) ?? '1000';
        postJournalEntry({
          entryDate: expenseDate,
          description: `Expense — ${form.expense_category}`,
          source: 'expense',
          createdBy: profile?.id ?? null,
          branchId: entryBranchId,
          lines: [
            { accountCode: '5000', debit: Number(form.amount), memo: form.description || form.expense_category },
            { accountCode: cashCode, credit: Number(form.amount), memo: 'Cash paid out' },
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
        {isAdmin ? (
          <Select value={branchFilter} onValueChange={setBranchFilter}>
            <SelectTrigger className="w-full sm:w-48"><SelectValue placeholder="All Branches" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Branches</SelectItem>
              {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : (
          <Badge variant="outline" className="h-9 px-3 flex items-center">
            {branches.find(b => b.id === branchFilter)?.name ?? '—'}
          </Badge>
        )}
        <Button variant="outline" size="sm" onClick={handleExport}><Download className="w-4 h-4 mr-2" />Export</Button>
        <Button size="sm" onClick={() => { setDialogType('cashflow'); setForm({ type: 'inflow', category: '', amount: '', reference: '', notes: '', expense_date: '', expense_category: '', description: '', branch_id: !isAdmin ? (profile?.branch_id ?? '') : (branchFilter !== 'all' ? branchFilter : '') }); setDialogOpen(true); }}>
          <Plus className="w-4 h-4 mr-2" />Cash Flow
        </Button>
        <Button size="sm" variant="outline" onClick={() => { setDialogType('expense'); setForm({ type: 'inflow', category: '', amount: '', reference: '', notes: '', expense_date: '', expense_category: '', description: '', branch_id: !isAdmin ? (profile?.branch_id ?? '') : (branchFilter !== 'all' ? branchFilter : '') }); setDialogOpen(true); }}>
          <Plus className="w-4 h-4 mr-2" />Expense
        </Button>
      </PageHeader>

      {/* Ledger-derived summary cards — real cash position and today's
          movement, straight from journal_entry_lines, not the manual
          Cash Flow/Expenses log below. */}
      {/* Each cash location on its own card (client request) instead of one
          lumped "Cash Balances" figure. "Other Cash" only appears when some
          cash account's name doesn't match any known bucket, so a newly
          added account is visible rather than silently dropped. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {CASH_BUCKETS.map(b => (
          <StatCard
            key={b.key}
            title={b.label}
            value={formatCurrency(ledgerStats.cashByBucket[b.key] ?? 0)}
            icon={<Banknote className="w-5 h-5" />}
            variant="success"
          />
        ))}
        {(ledgerStats.cashByBucket.other ?? 0) !== 0 && (
          <StatCard title="Other Cash" value={formatCurrency(ledgerStats.cashByBucket.other)} icon={<Banknote className="w-5 h-5" />} variant="default" subtitle="Cash accounts not in a named bucket" />
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Today's Collection" value={formatCurrency(ledgerStats.todayCollections)} icon={<TrendingUp className="w-5 h-5" />} variant="success" />
        <StatCard title="Today's Cash Release" value={formatCurrency(ledgerStats.todayCashRelease)} icon={<TrendingDown className="w-5 h-5" />} variant="warning" subtitle="Loan disbursements" />
        <StatCard title="Today's Cash Expenses" value={formatCurrency(ledgerStats.todayCashExpenses)} icon={<Wallet className="w-5 h-5" />} variant="danger" subtitle="Incl. gas, payroll & misc. vouchers" />
        <StatCard title="Total Receivable" value={formatCurrency(ledgerStats.totalReceivable)} icon={<Landmark className="w-5 h-5" />} variant="default" subtitle="Active loans outstanding" />
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogType === 'cashflow' ? 'Add Cash Flow Entry' : 'Add Expense'}</DialogTitle>
            <DialogDescription>{dialogType === 'cashflow' ? 'Record a cash inflow or outflow' : 'Record a new expense'}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {isAdmin && (
              <div className="space-y-2">
                <Label>Branch</Label>
                <Select value={form.branch_id || COMPANY_WIDE_VALUE} onValueChange={(v) => setForm({ ...form, branch_id: v === COMPANY_WIDE_VALUE ? '' : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={COMPANY_WIDE_VALUE}>Company-wide (no branch)</SelectItem>
                    {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
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
