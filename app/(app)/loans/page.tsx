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
  CalendarDays, ChevronLeft, ChevronRight, CheckCircle2, Circle, Upload, FileText,
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
  customer_id: string;
  customers: { first_name: string; last_name: string } | null;
  collectors: { profiles: { full_name: string } } | null;
  branches: { name: string } | null;
  loan_types: { name: string } | null;
}

const REQUIRED_DOCUMENTS = [
  { type: 'valid_id', label: 'Valid Government ID' },
  { type: 'clearance', label: 'Barangay Clearance' },
  { type: 'proof_of_billing', label: 'Proof of Billing' },
  { type: 'promissory_note', label: 'Promissory Note' },
];

export default function LoansPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { profile } = useAuth();
  const canApprove = profile?.role_name === 'Administrator' || profile?.role_name === 'Cashier';
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
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleMonth, setScheduleMonth] = useState(new Date());
  const [existingLoanBlock, setExistingLoanBlock] = useState<string | null>(null);
  const [approveLoan, setApproveLoan] = useState<Loan | null>(null);
  const [approveDocs, setApproveDocs] = useState<any[]>([]);
  const [approveDocsLoading, setApproveDocsLoading] = useState(false);
  const [uploadingDocType, setUploadingDocType] = useState<string | null>(null);
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
    loadLoans();
    loadOptions();
  }, [search, statusFilter, page]);

  async function loadOptions() {
    const [c, b, a, col, lt] = await Promise.all([
      supabase.from('customers').select('id, first_name, last_name, max_loan_limit, branch_id, area_id, collector_id').eq('status', 'active').order('first_name'),
      supabase.from('branches').select('id, name').eq('status', 'active'),
      supabase.from('areas').select('id, name, branch_id').eq('status', 'active'),
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
  const dailyAmount = computed && Number(form.term_days) > 0 ? computed.totalPayable / Number(form.term_days) : 0;

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

    const selectedCustomer = customers.find(c => c.id === form.customer_id);
    if (selectedCustomer && Number(form.amount) > selectedCustomer.max_loan_limit) {
      toast({
        title: 'Loan amount exceeds limit',
        description: `${selectedCustomer.first_name} ${selectedCustomer.last_name}'s max loan limit is ${formatCurrency(selectedCustomer.max_loan_limit)}.`,
        variant: 'destructive',
      });
      return;
    }

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
      release_amount: details.releaseAmount,
      total_payable: details.totalPayable,
      remaining_balance: details.totalPayable,
      term_days: Number(form.term_days),
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
      toast({ title: 'Submitted for approval', description: `Loan ${loanNumber} is pending — a Cashier must approve it before it becomes active.` });
      setDialogOpen(false);
      setForm({ ...form, customer_id: '', amount: '' });
      loadLoans();
    }
    setSaving(false);
  }

  async function handleApprove(loanId: string, loanNumber: string) {
    const { error } = await supabase.from('loans').update({ status: 'active' }).eq('id', loanId);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Loan approved', description: `${loanNumber} is now active.` });
      loadLoans();
    }
  }

  async function openApprove(loan: Loan) {
    setApproveLoan(loan);
    setApproveDocsLoading(true);
    const { data } = await supabase
      .from('customer_documents')
      .select('*')
      .eq('customer_id', loan.customer_id);
    setApproveDocs(data ?? []);
    setApproveDocsLoading(false);
  }

  async function handleDocUpload(docType: string, file: File) {
    if (!approveLoan) return;
    setUploadingDocType(docType);
    const ext = file.name.split('.').pop();
    const path = `${approveLoan.customer_id}/${docType}-${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage.from('customer-documents').upload(path, file, {
      contentType: file.type,
    });
    if (uploadError) {
      toast({ title: 'Upload failed', description: uploadError.message, variant: 'destructive' });
      setUploadingDocType(null);
      return;
    }

    const { data: urlData } = supabase.storage.from('customer-documents').getPublicUrl(path);
    const { error: insertError } = await supabase.from('customer_documents').insert({
      customer_id: approveLoan.customer_id,
      document_type: docType,
      file_name: file.name,
      file_url: urlData.publicUrl,
    });

    if (insertError) {
      toast({ title: 'Error', description: insertError.message, variant: 'destructive' });
    } else {
      const { data } = await supabase
        .from('customer_documents')
        .select('*')
        .eq('customer_id', approveLoan.customer_id);
      setApproveDocs(data ?? []);
    }
    setUploadingDocType(null);
  }

  const missingDocs = approveLoan
    ? REQUIRED_DOCUMENTS.filter(rd => !approveDocs.some(d => d.document_type === rd.type))
    : [];

  async function handleConfirmApprove() {
    if (!approveLoan || missingDocs.length > 0) return;
    await handleApprove(approveLoan.id, approveLoan.loan_number);
    setApproveLoan(null);
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
        <Button size="sm" onClick={() => { setExistingLoanBlock(null); setDialogOpen(true); }}>
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
                        {l.status === 'pending' && canApprove && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="mr-1"
                            onClick={(e) => { e.stopPropagation(); openApprove(l); }}
                          >
                            Approve
                          </Button>
                        )}
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
            <DialogDescription>Submit a new loan application — a Cashier must approve it before it becomes active</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
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

            {/* Computed summary */}
            {computed && (
              <div className="p-4 rounded-xl bg-secondary/50 border border-border space-y-2">
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
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Principal:</span><span className="font-medium">{formatCurrency(Number(form.amount))}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Interest:</span><span className="font-medium">{formatCurrency(computed.interestAmount)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Service Fee:</span><span className="font-medium text-warning">{formatCurrency(computed.serviceFee)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Release:</span><span className="font-medium text-success">{formatCurrency(computed.releaseAmount)}</span></div>
                  <div className="flex justify-between col-span-2 pt-2 border-t border-border"><span className="text-muted-foreground">Total Payable:</span><span className="font-bold text-primary">{formatCurrency(computed.totalPayable)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Daily Payment:</span><span className="font-medium">{formatCurrency(dailyAmount)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Due Date:</span><span className="font-medium">{formatDate(dueDate)}</span></div>
                </div>
              </div>
            )}

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
              {formatCurrency(dailyAmount)} per day, from {formatDate(form.release_date)} to {formatDate(dueDate)}
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
              return (
                <div
                  key={i}
                  className={`rounded-lg py-3 text-sm ${
                    !inCurrentMonth ? 'text-muted-foreground/30' :
                    inTerm ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground'
                  }`}
                >
                  <p className="text-base">{date.getDate()}</p>
                  {inTerm && <p className="text-xs leading-tight mt-0.5">{formatCurrency(dailyAmount)}</p>}
                </div>
              );
            })}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setScheduleOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approve loan — requires KYC documents on file */}
      <Dialog open={!!approveLoan} onOpenChange={(open) => !open && setApproveLoan(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Approve {approveLoan?.loan_number}</DialogTitle>
            <DialogDescription>
              All required documents for {approveLoan?.customers?.first_name} {approveLoan?.customers?.last_name} must be on file before this loan can be approved.
            </DialogDescription>
          </DialogHeader>

          {approveDocsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-2">
              {REQUIRED_DOCUMENTS.map(rd => {
                const doc = approveDocs.find(d => d.document_type === rd.type);
                return (
                  <div key={rd.type} className="flex items-center gap-3 p-3 rounded-lg bg-secondary/50">
                    {doc ? (
                      <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
                    ) : (
                      <Circle className="w-5 h-5 text-muted-foreground shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{rd.label}</p>
                      {doc ? (
                        <a href={doc.file_url} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:underline flex items-center gap-1">
                          <FileText className="w-3 h-3" /> {doc.file_name ?? 'View file'}
                        </a>
                      ) : (
                        <p className="text-xs text-muted-foreground">Not uploaded yet</p>
                      )}
                    </div>
                    <div>
                      <input
                        type="file"
                        id={`doc-upload-${rd.type}`}
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleDocUpload(rd.type, file);
                          e.target.value = '';
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={uploadingDocType === rd.type}
                        onClick={() => document.getElementById(`doc-upload-${rd.type}`)?.click()}
                      >
                        {uploadingDocType === rd.type ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <>
                            <Upload className="w-4 h-4 mr-1.5" />
                            {doc ? 'Replace' : 'Upload'}
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setApproveLoan(null)}>Cancel</Button>
            <Button type="button" disabled={missingDocs.length > 0 || approveDocsLoading} onClick={handleConfirmApprove}>
              {missingDocs.length > 0 ? `${missingDocs.length} document${missingDocs.length > 1 ? 's' : ''} missing` : 'Approve Loan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
