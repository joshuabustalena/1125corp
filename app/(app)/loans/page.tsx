'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
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
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency, formatDate, generateLoanNumber, computeLoanDetails, exportToCSV } from '@/lib/format';
import {
  Landmark, Plus, Search, Download, Eye, Loader2, Calculator, RefreshCw,
} from 'lucide-react';
import { useRouter } from 'next/navigation';

interface Loan {
  id: string;
  loan_number: string;
  amount: number;
  interest_rate: number;
  interest_amount: number;
  service_fee: number;
  release_amount: number;
  total_payable: number;
  remaining_balance: number;
  status: string;
  due_date: string | null;
  release_date: string | null;
  customers: { first_name: string; last_name: string } | null;
  collectors: { profiles: { full_name: string } } | null;
  branches: { name: string } | null;
  loan_types: { name: string } | null;
}

export default function LoansPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [loans, setLoans] = useState<Loan[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [areas, setAreas] = useState<any[]>([]);
  const [collectors, setCollectors] = useState<any[]>([]);
  const [loanTypes, setLoanTypes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const pageSize = 10;

  const [form, setForm] = useState({
    customer_id: searchParams.get('customer') ?? '',
    loan_type_id: '',
    amount: '',
    interest_rate: '8',
    term_days: '60',
    collector_id: '',
    branch_id: '',
    area_id: '',
    release_date: new Date().toISOString().split('T')[0],
  });

  useEffect(() => {
    loadLoans();
    loadOptions();
  }, [search, statusFilter, page]);

  async function loadOptions() {
    const [c, b, a, col, lt] = await Promise.all([
      supabase.from('customers').select('id, first_name, last_name').eq('status', 'active').order('first_name'),
      supabase.from('branches').select('id, name').eq('status', 'active'),
      supabase.from('areas').select('id, name, branch_id').eq('status', 'active'),
      supabase.from('collectors').select('id, profiles(full_name)').eq('status', 'active'),
      supabase.from('loan_types').select('id, name, interest_rate, term_days').eq('status', 'active'),
    ]);
    setCustomers(c.data ?? []);
    setBranches(b.data ?? []);
    setAreas(a.data ?? []);
    setCollectors(col.data ?? []);
    setLoanTypes(lt.data ?? []);
  }

  async function loadLoans() {
    setLoading(true);
    let query = supabase
      .from('loans')
      .select('*, customers(first_name, last_name), collectors(profiles(full_name)), branches(name), loan_types(name)', { count: 'exact' });

    if (search) {
      query = query.or(`loan_number.ilike.%${search}%`);
    }
    if (statusFilter !== 'all') query = query.eq('status', statusFilter);

    query = query.range((page - 1) * pageSize, page * pageSize - 1).order('created_at', { ascending: false });

    const { data, count } = await query;
    setLoans((data as any) ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }

  const computed = form.amount ? computeLoanDetails(Number(form.amount), Number(form.interest_rate), Number(form.term_days)) : null;
  const dueDate = form.release_date ? new Date(new Date(form.release_date).getTime() + Number(form.term_days) * 86400000).toISOString().split('T')[0] : '';

  function handleLoanTypeChange(id: string) {
    const lt = loanTypes.find(t => t.id === id);
    if (lt) {
      setForm({ ...form, loan_type_id: id, interest_rate: String(lt.interest_rate), term_days: String(lt.term_days) });
    } else {
      setForm({ ...form, loan_type_id: id });
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const loanNumber = generateLoanNumber();
    const details = computeLoanDetails(Number(form.amount), Number(form.interest_rate), Number(form.term_days));

    const payload = {
      loan_number: loanNumber,
      customer_id: form.customer_id,
      loan_type_id: form.loan_type_id || null,
      amount: Number(form.amount),
      interest_rate: Number(form.interest_rate),
      interest_amount: details.interestAmount,
      service_fee: details.serviceFee,
      release_amount: details.releaseAmount,
      total_payable: details.totalPayable,
      remaining_balance: details.totalPayable,
      term_days: Number(form.term_days),
      collector_id: form.collector_id || null,
      branch_id: form.branch_id || null,
      area_id: form.area_id || null,
      status: 'active',
      release_date: form.release_date,
      due_date: dueDate,
    };

    const { error } = await supabase.from('loans').insert(payload);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: `Loan ${loanNumber} created successfully` });
      setDialogOpen(false);
      setForm({ ...form, customer_id: '', amount: '' });
      loadLoans();
    }
    setSaving(false);
  }

  function handleExport() {
    exportToCSV(
      loans.map(l => ({
        LoanNumber: l.loan_number,
        Customer: `${l.customers?.first_name ?? ''} ${l.customers?.last_name ?? ''}`,
        Amount: l.amount,
        Interest: l.interest_rate,
        TotalPayable: l.total_payable,
        Balance: l.remaining_balance,
        DueDate: l.due_date ?? '',
        Status: l.status,
      })),
      'loans.csv'
    );
  }

  const totalPages = Math.ceil(total / pageSize);
  const statusVariant = (status: string) => {
    switch (status) {
      case 'active': return 'default';
      case 'overdue': return 'destructive';
      case 'paid': return 'secondary';
      case 'pending': return 'outline';
      default: return 'secondary';
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Loan Management" description="Create and manage customer loans">
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="w-4 h-4 mr-2" />
          Export
        </Button>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          New Loan
        </Button>
      </PageHeader>

      {/* Filters */}
      <Card className="glass-card border-border">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by loan number..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="glass-card border-border">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : loans.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Landmark className="w-12 h-12 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">No loans found</p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Loan #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Interest</TableHead>
                    <TableHead>Release</TableHead>
                    <TableHead>Balance</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loans.map((l) => (
                    <TableRow key={l.id} className="cursor-pointer hover:bg-secondary/50" onClick={() => router.push(`/loans/${l.id}`)}>
                      <TableCell className="font-medium text-sm">{l.loan_number}</TableCell>
                      <TableCell className="text-sm">{l.customers?.first_name} {l.customers?.last_name}</TableCell>
                      <TableCell className="text-sm">{formatCurrency(l.amount)}</TableCell>
                      <TableCell className="text-sm">{l.interest_rate}%</TableCell>
                      <TableCell className="text-sm">{formatCurrency(l.release_amount)}</TableCell>
                      <TableCell className="text-sm font-medium">{formatCurrency(l.remaining_balance)}</TableCell>
                      <TableCell className="text-sm">{formatDate(l.due_date)}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(l.status)}>{l.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); router.push(`/loans/${l.id}`); }}>
                          <Eye className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between p-4 border-t border-border">
                <p className="text-sm text-muted-foreground">
                  Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Create Loan Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Loan</DialogTitle>
            <DialogDescription>Set up a new loan for a customer</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Customer *</Label>
                <Select value={form.customer_id} onValueChange={(v) => setForm({ ...form, customer_id: v })} required>
                  <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                  <SelectContent>
                    {customers.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.first_name} {c.last_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Loan Type</Label>
                <Select value={form.loan_type_id} onValueChange={handleLoanTypeChange}>
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    {loanTypes.map(lt => (
                      <SelectItem key={lt.id} value={lt.id}>{lt.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Loan Amount (₱) *</Label>
                <Input type="number" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" />
              </div>
              <div className="space-y-2">
                <Label>Interest Rate (%)</Label>
                <Input type="number" value={form.interest_rate} onChange={(e) => setForm({ ...form, interest_rate: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Term (Days)</Label>
                <Input type="number" value={form.term_days} onChange={(e) => setForm({ ...form, term_days: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Release Date</Label>
                <Input type="date" value={form.release_date} onChange={(e) => setForm({ ...form, release_date: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Branch</Label>
                <Select value={form.branch_id} onValueChange={(v) => setForm({ ...form, branch_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                  <SelectContent>
                    {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Collector</Label>
                <Select value={form.collector_id} onValueChange={(v) => setForm({ ...form, collector_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select collector" /></SelectTrigger>
                  <SelectContent>
                    {collectors.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.profiles?.full_name ?? 'Unknown'}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Computed summary */}
            {computed && (
              <div className="p-4 rounded-xl bg-secondary/50 border border-border space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-primary mb-2">
                  <Calculator className="w-4 h-4" />
                  Loan Summary
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Principal:</span><span className="font-medium">{formatCurrency(Number(form.amount))}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Interest:</span><span className="font-medium">{formatCurrency(computed.interestAmount)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Service Fee:</span><span className="font-medium text-warning">{formatCurrency(computed.serviceFee)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Release:</span><span className="font-medium text-success">{formatCurrency(computed.releaseAmount)}</span></div>
                  <div className="flex justify-between col-span-2 pt-2 border-t border-border"><span className="text-muted-foreground">Total Payable:</span><span className="font-bold text-primary">{formatCurrency(computed.totalPayable)}</span></div>
                  <div className="flex justify-between col-span-2"><span className="text-muted-foreground">Due Date:</span><span className="font-medium">{formatDate(dueDate)}</span></div>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving || !form.customer_id || !form.amount}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Create Loan
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
