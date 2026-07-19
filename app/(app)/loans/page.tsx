'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  CalendarDays, ChevronLeft, ChevronRight,
  ChevronDown, Check, Pencil, Trash2,
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
  decline_reason: string | null;
  customer_id: string;
  loan_type_id: string | null;
  term_days: number;
  collector_id: string | null;
  branch_id: string | null;
  area_id: string | null;
  reapplied: boolean;
  customers: { first_name: string; last_name: string } | null;
  collectors: { profiles: { full_name: string } } | null;
  branches: { name: string } | null;
  areas: { name: string } | null;
  loan_types: { name: string } | null;
}

export default function LoansPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { profile } = useAuth();
  const isAdmin = profile?.role_name === 'Administrator';
  const isCollector = profile?.role_name === 'Branch Field Collector';
  const [myCollector, setMyCollector] = useState<{ id: string; branch_id: string | null; area_id: string | null } | null>(null);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [areas, setAreas] = useState<any[]>([]);
  const [collectors, setCollectors] = useState<any[]>([]);
  const [loanTypes, setLoanTypes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [customerFilter, setCustomerFilter] = useState('all');
  const [areaFilter, setAreaFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleMonth, setScheduleMonth] = useState(new Date());
  const [existingLoanBlock, setExistingLoanBlock] = useState<string | null>(null);
  const [reapplyingId, setReapplyingId] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<Loan | null>(null);
  const [editForm, setEditForm] = useState({
    amount: '', interest_rate: '', term_days: '', service_fee: '', release_amount: '',
    total_payable: '', remaining_balance: '', release_date: '', due_date: '', status: '',
  });
  const [editSaving, setEditSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Loan | null>(null);
  const [deleting, setDeleting] = useState(false);
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
    custom_daily_payment: '',
  });

  async function checkExistingLoans(customerId: string): Promise<string | null> {
    if (!customerId) return null;
    const { data } = await supabase
      .from('loans')
      .select('loan_number, total_payable, remaining_balance')
      .eq('customer_id', customerId)
      .in('status', ['active', 'overdue']);

    const unpaid = (data ?? []).find(l => {
      const paidRatio = l.total_payable > 0 ? (l.total_payable - l.remaining_balance) / l.total_payable : 1;
      return paidRatio < 0.6;
    });

    return unpaid
      ? `This customer's existing loan (${unpaid.loan_number}) isn't at least 60% paid yet — a new loan can't be created until it is.`
      : null;
  }

  function handleCustomerChange(customerId: string) {
    setForm(prev => ({ ...prev, customer_id: customerId }));
    setExistingLoanBlock(null);
    checkExistingLoans(customerId).then(setExistingLoanBlock);
  }

  useEffect(() => {
    if (!form.customer_id) return;
    const customer = customers.find(c => c.id === form.customer_id);
    if (!customer) return;
    setForm(prev => ({
      ...prev,
      branch_id: customer.branch_id ?? '',
      area_id: customer.area_id ?? '',
      collector_id: customer.collector_id ?? '',
    }));
  }, [form.customer_id, customers]);

  useEffect(() => {
    if (!profile) return;
    async function loadMyCollector() {
      if (profile?.role_name !== 'Branch Field Collector') return;
      const { data } = await supabase.from('collectors').select('id, branch_id, area_id').eq('profile_id', profile.id).maybeSingle();
      setMyCollector(data);
    }
    loadMyCollector();
  }, [profile]);

  useEffect(() => {
    if (!profile) return;
    if (isCollector && !myCollector) return;
    loadLoans();
    loadOptions();
  }, [profile, myCollector, search, statusFilter, customerFilter, areaFilter, page]);

  async function loadOptions() {
    let customerQuery = supabase.from('customers').select('id, first_name, last_name, max_loan_limit, branch_id, area_id, collector_id').eq('status', 'active').order('first_name');
    let areaQuery = supabase.from('areas').select('id, name, branch_id').eq('status', 'active');
    if (isCollector && myCollector) {
      customerQuery = customerQuery.eq('collector_id', myCollector.id);
      areaQuery = areaQuery.eq('id', myCollector.area_id ?? '00000000-0000-0000-0000-000000000000');
    } else if (!isAdmin) {
      customerQuery = customerQuery.eq('branch_id', profile?.branch_id ?? '00000000-0000-0000-0000-000000000000');
      areaQuery = areaQuery.eq('branch_id', profile?.branch_id ?? '00000000-0000-0000-0000-000000000000');
    }
    const [c, b, a, col, lt] = await Promise.all([
      customerQuery,
      supabase.from('branches').select('id, name').eq('status', 'active'),
      areaQuery,
      supabase.from('collectors').select('id, branch_id, area_id, profiles(full_name)').eq('status', 'active'),
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
      .select('*, customers(first_name, last_name), collectors(profiles(full_name)), branches(name), areas(name), loan_types(name)', { count: 'exact' });

    if (search) {
      query = query.or(`loan_number.ilike.%${search}%`);
    }
    if (isCollector) {
      query = query.eq('collector_id', myCollector?.id ?? '00000000-0000-0000-0000-000000000000');
    } else if (!isAdmin) {
      query = query.eq('branch_id', profile?.branch_id ?? '00000000-0000-0000-0000-000000000000');
    }
    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter);
    }
    if (customerFilter !== 'all') query = query.eq('customer_id', customerFilter);
    if (areaFilter !== 'all') query = query.eq('area_id', areaFilter);

    query = query.range((page - 1) * pageSize, page * pageSize - 1).order('created_at', { ascending: false });

    const { data, count } = await query;
    setLoans((data as any) ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }

  const computed = form.amount ? computeLoanDetails(Number(form.amount), Number(form.interest_rate), Number(form.term_days)) : null;
  const dueDate = form.release_date ? new Date(new Date(form.release_date).getTime() + Number(form.term_days) * 86400000).toISOString().split('T')[0] : '';
  const dailyAmount = computed && Number(form.term_days) > 0 ? computed.totalPayable / Number(form.term_days) : 0;

  // Collection days = every day in the term except Sunday. Sunday still
  // counts toward term_days/due date — it's just not a collection day.
  const collectionDays: Date[] = (() => {
    if (!form.release_date || !dueDate) return [];
    const start = new Date(form.release_date);
    const end = new Date(dueDate);
    const days: Date[] = [];
    const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endD = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    while (cur <= endD) {
      if (cur.getDay() !== 0) days.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return days;
  })();
  const customDaily = Number(form.custom_daily_payment) || 0;
  const regularDaily = customDaily > 0 ? customDaily : dailyAmount;

  // Day-by-day schedule: each collection day pays min(regularDaily, whatever
  // is still owed) — except the last collection day of the term, which
  // always absorbs whatever balance remains, however large or small. That
  // way an early payoff shows the rest of the term as "Fully paid", while a
  // daily amount that's too small to keep pace still gets settled in full
  // by the last day instead of trailing off into the next loan.
  const schedule: { date: Date; amount: number }[] = (() => {
    if (!computed) return [];
    let remaining = computed.totalPayable;
    return collectionDays.map((date, idx) => {
      const isLast = idx === collectionDays.length - 1;
      const amount = isLast ? Math.max(0, remaining) : Math.max(0, Math.min(regularDaily, remaining));
      remaining = Math.max(0, remaining - amount);
      return { date, amount };
    });
  })();
  const firstDayAmount = schedule.length > 0 ? schedule[0].amount : 0;
  const adjustedReleaseAmount = computed ? Math.max(0, computed.releaseAmount - firstDayAmount) : 0;

  function findScheduleEntry(date: Date) {
    return schedule.find(s =>
      s.date.getFullYear() === date.getFullYear() &&
      s.date.getMonth() === date.getMonth() &&
      s.date.getDate() === date.getDate()
    );
  }

  function openSchedule() {
    setScheduleMonth(form.release_date ? new Date(form.release_date) : new Date());
    setScheduleOpen(true);
  }

  function getMonthGrid(monthDate: Date) {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const startOffset = firstDay.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: { date: Date; inCurrentMonth: boolean }[] = [];

    for (let i = 0; i < startOffset; i++) {
      cells.push({ date: new Date(year, month, i - startOffset + 1), inCurrentMonth: false });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ date: new Date(year, month, d), inCurrentMonth: true });
    }
    while (cells.length % 7 !== 0) {
      const last = cells[cells.length - 1].date;
      cells.push({ date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), inCurrentMonth: false });
    }
    return cells;
  }

  function isWithinLoanTerm(date: Date) {
    if (!form.release_date || !dueDate) return false;
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const start = new Date(form.release_date).setHours(0, 0, 0, 0);
    const end = new Date(dueDate).setHours(0, 0, 0, 0);
    return d >= start && d <= end;
  }

  function handleLoanTypeChange(id: string) {
    if (id === 'custom') {
      setForm({ ...form, loan_type_id: 'custom' });
      return;
    }
    const lt = loanTypes.find(t => t.id === id);
    if (lt) {
      setForm({ ...form, loan_type_id: id, interest_rate: String(lt.interest_rate), term_days: String(lt.term_days) });
    } else {
      setForm({ ...form, loan_type_id: id });
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const blockMessage = await checkExistingLoans(form.customer_id);
    if (blockMessage) {
      setExistingLoanBlock(blockMessage);
      toast({ title: 'Existing loan not yet eligible', description: blockMessage, variant: 'destructive' });
      return;
    }

    setSaving(true);
    const loanNumber = generateLoanNumber();
    const details = computeLoanDetails(Number(form.amount), Number(form.interest_rate), Number(form.term_days));

    const payload = {
      loan_number: loanNumber,
      customer_id: form.customer_id,
      loan_type_id: form.loan_type_id && form.loan_type_id !== 'custom' ? form.loan_type_id : null,
      amount: Number(form.amount),
      interest_rate: Number(form.interest_rate),
      interest_amount: details.interestAmount,
      service_fee: details.serviceFee,
      release_amount: adjustedReleaseAmount,
      total_payable: details.totalPayable,
      remaining_balance: details.totalPayable,
      term_days: Number(form.term_days),
      daily_payment: regularDaily,
      collector_id: form.collector_id || null,
      branch_id: form.branch_id || null,
      area_id: form.area_id || null,
      status: 'pending',
      release_date: form.release_date,
      due_date: dueDate,
    };

    const { error } = await supabase.from('loans').insert(payload);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Submitted for approval', description: `Loan ${loanNumber} is pending — a Branch Manager must approve it before it becomes active.` });
      setDialogOpen(false);
      setForm({ ...form, customer_id: '', amount: '', custom_daily_payment: '' });
      loadLoans();
    }
    setSaving(false);
  }

  async function handleReapply(l: Loan) {
    setReapplyingId(l.id);
    const newLoanNumber = generateLoanNumber();
    const releaseDate = new Date().toISOString().split('T')[0];
    const { error } = await supabase.from('loans').insert({
      loan_number: newLoanNumber,
      customer_id: l.customer_id,
      loan_type_id: l.loan_type_id,
      amount: l.amount,
      interest_rate: l.interest_rate,
      interest_amount: l.interest_amount,
      service_fee: l.service_fee,
      release_amount: l.release_amount,
      total_payable: l.total_payable,
      remaining_balance: l.total_payable,
      term_days: l.term_days,
      collector_id: l.collector_id,
      branch_id: l.branch_id,
      area_id: l.area_id,
      status: 'pending',
      release_date: releaseDate,
      due_date: new Date(Date.now() + l.term_days * 86400000).toISOString().split('T')[0],
    });

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      await supabase.from('loans').update({ reapplied: true }).eq('id', l.id);
      toast({ title: 'Re-submitted for approval', description: `New application ${newLoanNumber} is pending review.` });
      loadLoans();
    }
    setReapplyingId(null);
  }

  function openEditLoan(l: Loan) {
    setEditTarget(l);
    setEditForm({
      amount: String(l.amount),
      interest_rate: String(l.interest_rate),
      term_days: String(l.term_days),
      service_fee: String(l.service_fee),
      release_amount: String(l.release_amount),
      total_payable: String(l.total_payable),
      remaining_balance: String(l.remaining_balance),
      release_date: l.release_date ?? '',
      due_date: l.due_date ?? '',
      status: l.status,
    });
  }

  async function handleEditLoan(e: React.FormEvent) {
    e.preventDefault();
    if (!editTarget) return;
    setEditSaving(true);
    const { error } = await supabase.from('loans').update({
      amount: Number(editForm.amount),
      interest_rate: Number(editForm.interest_rate),
      term_days: Number(editForm.term_days),
      service_fee: Number(editForm.service_fee),
      release_amount: Number(editForm.release_amount),
      total_payable: Number(editForm.total_payable),
      remaining_balance: Number(editForm.remaining_balance),
      release_date: editForm.release_date || null,
      due_date: editForm.due_date || null,
      status: editForm.status,
    }).eq('id', editTarget.id);

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Loan updated' });
      setEditTarget(null);
      loadLoans();
    }
    setEditSaving(false);
  }

  async function handleDeleteLoan() {
    if (!deleteTarget) return;
    setDeleting(true);
    // cash_vouchers/receipts only SET NULL their loan_id on loan delete (they
    // don't cascade) — remove them explicitly so nothing orphaned is left
    // behind. Payments do cascade automatically via the loan delete below.
    await supabase.from('cash_vouchers').delete().eq('loan_id', deleteTarget.id);
    await supabase.from('receipts').delete().eq('loan_id', deleteTarget.id);
    const { error } = await supabase.from('loans').delete().eq('id', deleteTarget.id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Loan deleted', description: `${deleteTarget.loan_number} and its payment history were removed.` });
      setDeleteTarget(null);
      loadLoans();
    }
    setDeleting(false);
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
      case 'declined': return 'destructive';
      case 'paid': return 'secondary';
      case 'pending': return 'outline';
      case 'approved': return 'outline';
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
        {(profile?.role_name === 'Branch Field Collector' || profile?.role_name === 'Administrator') && (
          <Button size="sm" onClick={() => { setExistingLoanBlock(null); setDialogOpen(true); }}>
            <Plus className="w-4 h-4 mr-2" />
            New Loan
          </Button>
        )}
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
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="glass-card border-border">
        <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Loan #</TableHead>
                    <TableHead>
                      <DropdownMenu>
                        <DropdownMenuTrigger className="flex items-center gap-1 hover:text-foreground">
                          Customer
                          <ChevronDown className="w-3.5 h-3.5" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          <DropdownMenuItem onClick={() => { setCustomerFilter('all'); setPage(1); }} className="flex items-center justify-between">
                            All Customers
                            {customerFilter === 'all' && <Check className="w-4 h-4" />}
                          </DropdownMenuItem>
                          {customers.map(c => (
                            <DropdownMenuItem key={c.id} onClick={() => { setCustomerFilter(c.id); setPage(1); }} className="flex items-center justify-between">
                              {c.first_name} {c.last_name}
                              {customerFilter === c.id && <Check className="w-4 h-4" />}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Interest</TableHead>
                    <TableHead>Release</TableHead>
                    <TableHead>Balance</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead>
                      <DropdownMenu>
                        <DropdownMenuTrigger className="flex items-center gap-1 hover:text-foreground">
                          Status
                          <ChevronDown className="w-3.5 h-3.5" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          {[
                            ['all', 'All Status'],
                            ['pending', 'Pending'],
                            ['approved', 'Approved'],
                            ['active', 'Active'],
                            ['declined', 'Declined'],
                            ['overdue', 'Overdue'],
                            ['paid', 'Paid'],
                          ].map(([value, label]) => (
                            <DropdownMenuItem key={value} onClick={() => { setStatusFilter(value); setPage(1); }} className="flex items-center justify-between">
                              {label}
                              {statusFilter === value && <Check className="w-4 h-4" />}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableHead>
                    <TableHead>
                      <DropdownMenu>
                        <DropdownMenuTrigger className="flex items-center gap-1 hover:text-foreground">
                          Area
                          <ChevronDown className="w-3.5 h-3.5" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          <DropdownMenuItem onClick={() => { setAreaFilter('all'); setPage(1); }} className="flex items-center justify-between">
                            All Areas
                            {areaFilter === 'all' && <Check className="w-4 h-4" />}
                          </DropdownMenuItem>
                          {areas.map(a => (
                            <DropdownMenuItem key={a.id} onClick={() => { setAreaFilter(a.id); setPage(1); }} className="flex items-center justify-between">
                              {a.name}
                              {areaFilter === a.id && <Check className="w-4 h-4" />}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={10} className="py-16 text-center">
                        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto" />
                      </TableCell>
                    </TableRow>
                  ) : loans.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="py-16 text-center">
                        <Landmark className="w-12 h-12 text-muted-foreground/50 mb-3 mx-auto" />
                        <p className="text-sm text-muted-foreground">No loans found</p>
                      </TableCell>
                    </TableRow>
                  ) : loans.map((l) => (
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
                      <TableCell className="text-sm">{l.areas?.name ?? '—'}</TableCell>
                      <TableCell className="text-right">
                        {l.status === 'declined' && !l.reapplied && profile?.role_name !== 'Cashier' && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="mr-1"
                            disabled={reapplyingId === l.id}
                            onClick={(e) => { e.stopPropagation(); handleReapply(l); }}
                          >
                            {reapplyingId === l.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Re-apply'}
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); router.push(`/loans/${l.id}`); }}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        {isAdmin && (
                          <>
                            <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); openEditLoan(l); }}>
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setDeleteTarget(l); }}>
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between p-4 border-t border-border">
                <p className="text-sm text-muted-foreground">
                  Showing {total === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
                </div>
              </div>
        </CardContent>
      </Card>

      {/* Create Loan Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Loan</DialogTitle>
            <DialogDescription>Submit a new loan application — a Cashier must approve it before it becomes active</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Computation on the left */}
              <div className="rounded-xl border border-border p-4">
                {computed ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 text-sm font-medium text-primary">
                        <Calculator className="w-4 h-4" />
                        Loan Summary
                      </div>
                      <Button type="button" variant="ghost" size="sm" onClick={openSchedule} className="h-7 px-2">
                        <CalendarDays className="w-4 h-4 mr-1.5" />
                        View Schedule
                      </Button>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between"><span className="text-muted-foreground">Principal:</span><span className="font-medium">{formatCurrency(Number(form.amount))}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Interest:</span><span className="font-medium">{formatCurrency(computed.interestAmount)}</span></div>
                      <div className="flex justify-between pt-2 border-t border-border"><span className="text-muted-foreground">Total Payable:</span><span className="font-bold text-primary">{formatCurrency(computed.totalPayable)}</span></div>
                      <div className="flex justify-between pt-2 border-t border-border"><span className="text-muted-foreground">Daily Payment:</span><span className="font-medium">{formatCurrency(regularDaily)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Service Fee:</span><span className="font-medium text-warning">-{formatCurrency(computed.serviceFee)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">First Day Payment:</span><span className="font-medium text-warning">-{formatCurrency(firstDayAmount)}</span></div>
                      <div className="flex justify-between pt-2 border-t border-border"><span className="text-muted-foreground">Release:</span><span className="font-bold text-success">{formatCurrency(adjustedReleaseAmount)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Due Date:</span><span className="font-medium">{formatDate(dueDate)}</span></div>
                    </div>
                    <p className="text-xs text-muted-foreground pt-1">
                      Release = Principal - Service Fee - First Day Payment (auto-settled, so it won't show as due on the calendar).
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">Enter a loan amount to see the computation</p>
                )}
              </div>

              {/* Form fields on the right */}
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Customer *</Label>
                    <Select value={form.customer_id} onValueChange={handleCustomerChange}>
                      <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                      <SelectContent>
                        {customers.map(c => (
                          <SelectItem key={c.id} value={c.id}>{c.first_name} {c.last_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {existingLoanBlock && (
                      <p className="text-xs text-destructive">{existingLoanBlock}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Loan Type</Label>
                    <Select value={form.loan_type_id} onValueChange={handleLoanTypeChange}>
                      <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                      <SelectContent>
                        {loanTypes.map(lt => (
                          <SelectItem key={lt.id} value={lt.id}>{lt.name}</SelectItem>
                        ))}
                        <SelectItem value="custom">Custom</SelectItem>
                      </SelectContent>
                    </Select>
                    {form.loan_type_id === 'custom' && (
                      <p className="text-xs text-muted-foreground">Set your own Interest Rate and Term below.</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Loan Amount (₱) *</Label>
                    <Input type="number" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" />
                    {(() => {
                      const selectedCustomer = customers.find(c => c.id === form.customer_id);
                      if (!selectedCustomer) return null;
                      const overLimit = form.amount && Number(form.amount) > selectedCustomer.max_loan_limit;
                      return (
                        <p className={`text-xs ${overLimit ? 'text-destructive' : 'text-muted-foreground'}`}>
                          Customer's max loan limit: {formatCurrency(selectedCustomer.max_loan_limit)}
                        </p>
                      );
                    })()}
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
                  <div className="space-y-2 col-span-2">
                    <Label>Daily Payment (₱)</Label>
                    <Input
                      type="number"
                      value={form.custom_daily_payment}
                      onChange={(e) => setForm({ ...form, custom_daily_payment: e.target.value })}
                      placeholder={dailyAmount ? `Auto: ${formatCurrency(dailyAmount)}` : '0.00'}
                    />
                    <p className="text-xs text-muted-foreground">How much the customer will pay per collection day. Leave blank to split evenly — the last day absorbs any remaining balance.</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Branch</Label>
                    <div className="flex h-10 w-full items-center rounded-md border border-input bg-secondary/50 px-3 py-2 text-sm text-muted-foreground">
                      {branches.find(b => b.id === form.branch_id)?.name ?? 'Select a customer first'}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Area</Label>
                    <div className="flex h-10 w-full items-center rounded-md border border-input bg-secondary/50 px-3 py-2 text-sm text-muted-foreground">
                      {areas.find(a => a.id === form.area_id)?.name ?? 'Select a customer first'}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Collector</Label>
                    <div className="flex h-10 w-full items-center rounded-md border border-input bg-secondary/50 px-3 py-2 text-sm text-muted-foreground">
                      {collectors.find(c => c.id === form.collector_id)?.profiles?.full_name ?? 'Select a customer first'}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving || !form.customer_id || !form.amount || !!existingLoanBlock}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Submit for Approval
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Daily payment schedule calendar */}
      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl">Daily Payment Schedule</DialogTitle>
            <DialogDescription className="text-base">
              {formatCurrency(regularDaily)} per day, from {formatDate(form.release_date)} to {formatDate(dueDate)} (no collection on Sundays)
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between mb-2">
            <Button type="button" variant="outline" size="icon" className="h-10 w-10"
              onClick={() => setScheduleMonth(new Date(scheduleMonth.getFullYear(), scheduleMonth.getMonth() - 1, 1))}>
              <ChevronLeft className="w-5 h-5" />
            </Button>
            <p className="text-lg font-semibold">
              {scheduleMonth.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}
            </p>
            <Button type="button" variant="outline" size="icon" className="h-10 w-10"
              onClick={() => setScheduleMonth(new Date(scheduleMonth.getFullYear(), scheduleMonth.getMonth() + 1, 1))}>
              <ChevronRight className="w-5 h-5" />
            </Button>
          </div>

          <div className="grid grid-cols-7 gap-1.5 text-center">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
              <div key={d} className="text-sm font-medium text-muted-foreground py-1.5">{d}</div>
            ))}
            {getMonthGrid(scheduleMonth).map(({ date, inCurrentMonth }, i) => {
              const inTerm = inCurrentMonth && isWithinLoanTerm(date);
              const isSunday = date.getDay() === 0;
              const entry = inTerm && !isSunday ? findScheduleEntry(date) : undefined;
              const isFirstDay = !!entry && schedule.length > 0 &&
                entry.date.getTime() === schedule[0].date.getTime();
              return (
                <div
                  key={i}
                  className={`rounded-lg py-3 text-sm ${
                    !inCurrentMonth ? 'text-muted-foreground/30' :
                    inTerm && !isSunday ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground'
                  }`}
                >
                  <p className="text-base">{date.getDate()}</p>
                  {isFirstDay && <p className="text-[10px] leading-tight mt-0.5 text-success">Paid at release</p>}
                  {entry && !isFirstDay && entry.amount > 0 && <p className="text-xs leading-tight mt-0.5">{formatCurrency(entry.amount)}</p>}
                  {entry && !isFirstDay && entry.amount === 0 && <p className="text-[10px] leading-tight mt-0.5 text-success">Fully paid</p>}
                  {inTerm && isSunday && <p className="text-[10px] leading-tight mt-0.5">No collection</p>}
                </div>
              );
            })}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setScheduleOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Loan {editTarget?.loan_number}</DialogTitle>
            <DialogDescription>Directly overwrites this loan's stored data — use with care, this does not recompute related payment history.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditLoan} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Amount (₱)</Label><Input type="number" required value={editForm.amount} onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })} /></div>
              <div className="space-y-2"><Label>Interest Rate (%)</Label><Input type="number" value={editForm.interest_rate} onChange={(e) => setEditForm({ ...editForm, interest_rate: e.target.value })} /></div>
              <div className="space-y-2"><Label>Term (Days)</Label><Input type="number" value={editForm.term_days} onChange={(e) => setEditForm({ ...editForm, term_days: e.target.value })} /></div>
              <div className="space-y-2"><Label>Service Fee (₱)</Label><Input type="number" value={editForm.service_fee} onChange={(e) => setEditForm({ ...editForm, service_fee: e.target.value })} /></div>
              <div className="space-y-2"><Label>Release Amount (₱)</Label><Input type="number" value={editForm.release_amount} onChange={(e) => setEditForm({ ...editForm, release_amount: e.target.value })} /></div>
              <div className="space-y-2"><Label>Total Payable (₱)</Label><Input type="number" value={editForm.total_payable} onChange={(e) => setEditForm({ ...editForm, total_payable: e.target.value })} /></div>
              <div className="space-y-2"><Label>Remaining Balance (₱)</Label><Input type="number" value={editForm.remaining_balance} onChange={(e) => setEditForm({ ...editForm, remaining_balance: e.target.value })} /></div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={editForm.status} onValueChange={(v) => setEditForm({ ...editForm, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['pending', 'approved', 'active', 'overdue', 'paid', 'declined', 'renewed'].map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Release Date</Label><Input type="date" value={editForm.release_date} onChange={(e) => setEditForm({ ...editForm, release_date: e.target.value })} /></div>
              <div className="space-y-2"><Label>Due Date</Label><Input type="date" value={editForm.due_date} onChange={(e) => setEditForm({ ...editForm, due_date: e.target.value })} /></div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
              <Button type="submit" disabled={editSaving}>{editSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Loan</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {deleteTarget?.loan_number}? This permanently removes the loan and all of its payments, receipts, and cash vouchers. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteLoan} disabled={deleting}>
              {deleting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
