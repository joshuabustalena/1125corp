'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency, formatDate, generateLoanNumber, computeLoanDetails } from '@/lib/format';
import {
  ArrowLeft, ArrowRight, Landmark, Wallet, Calendar, User, MapPin, Check,
  Loader2, RefreshCw, Plus, Receipt, ChevronLeft, ChevronRight, CalendarDays,
  CheckCircle2, Circle, Upload, FileText,
} from 'lucide-react';
import Link from 'next/link';

const REQUIRED_DOCUMENTS = [
  { type: 'valid_id', label: 'Valid Government ID' },
  { type: 'clearance', label: 'Barangay Clearance' },
  { type: 'proof_of_billing', label: 'Proof of Billing' },
  { type: 'promissory_note', label: 'Promissory Note' },
];

export default function LoanDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const { profile } = useAuth();
  const canApprove = profile?.role_name === 'Administrator' || profile?.role_name === 'Cashier';
  const isCashier = profile?.role_name === 'Cashier';
  const [loan, setLoan] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [chainLoans, setChainLoans] = useState<any[]>([]);
  const [chainPayments, setChainPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [renewing, setRenewing] = useState(false);
  const [renewOpen, setRenewOpen] = useState(false);
  const [renewForm, setRenewForm] = useState({ amount: '', interest_rate: '8', term_days: '60', release_date: '' });
  const [reapplying, setReapplying] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleMonth, setScheduleMonth] = useState(new Date());
  const [approveOpen, setApproveOpen] = useState(false);
  const [approveDocs, setApproveDocs] = useState<any[]>([]);
  const [approveDocsLoading, setApproveDocsLoading] = useState(false);
  const [uploadingDocType, setUploadingDocType] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [declining, setDeclining] = useState(false);
  const [successorLoan, setSuccessorLoan] = useState<any>(null);

  async function loadLoan() {
    const id = params.id as string;
    const [l, p] = await Promise.all([
      supabase.from('loans').select('*, customers(first_name, last_name, phone, address, barangay, city, max_loan_limit), collectors(profiles(full_name)), branches(name), areas(name), loan_types(name)').eq('id', id).maybeSingle(),
      supabase.from('payments').select('*, receipts(or_number)').eq('loan_id', id).order('payment_date', { ascending: false }),
    ]);
    setLoan(l.data);
    setPayments(p.data ?? []);

    // Walk backward through renewed_from_loan_id to build the full chain of
    // renewals for this customer, oldest first, so the calendar can show one
    // continuous history even though each renewal is its own table row.
    const chain: any[] = [];
    let cursor = l.data;
    while (cursor) {
      chain.unshift(cursor);
      if (cursor.renewed_from_loan_id) {
        const { data: prev } = await supabase.from('loans').select('*').eq('id', cursor.renewed_from_loan_id).maybeSingle();
        cursor = prev;
      } else {
        cursor = null;
      }
    }
    setChainLoans(chain);

    const chainIds = chain.map(c => c.id);
    const { data: chainPaymentsData } = await supabase.from('payments').select('*').in('loan_id', chainIds.length > 0 ? chainIds : ['00000000-0000-0000-0000-000000000000']);
    setChainPayments(chainPaymentsData ?? []);

    // If this loan was renewed, find the newer loan that replaced it so we
    // can point the user there instead of letting them post payments here.
    if (l.data?.status === 'renewed') {
      const { data: successor } = await supabase.from('loans').select('id, loan_number, status').eq('renewed_from_loan_id', id).maybeSingle();
      setSuccessorLoan(successor);
    } else {
      setSuccessorLoan(null);
    }

    setLoading(false);
  }

  useEffect(() => {
    loadLoan();
  }, [params.id]);

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
  }
  if (!loan) {
    return <p className="text-center text-muted-foreground py-16">Loan not found</p>;
  }

  const offsetRequired = loan.total_payable * 0.40;
  const canRenew = loan.remaining_balance <= offsetRequired && loan.status === 'active';
  const dailyAmount = loan.term_days > 0 ? loan.total_payable / loan.term_days : 0;

  const chainPaidAmountByDate = new Map<string, number>();
  for (const p of chainPayments) {
    const key = p.payment_date;
    chainPaidAmountByDate.set(key, (chainPaidAmountByDate.get(key) ?? 0) + Number(p.amount_paid));
  }
  const dayStatuses = computeDayStatuses();
  const chainStart = chainLoans[0]?.release_date ?? loan.release_date;
  const chainEnd = chainLoans[chainLoans.length - 1]?.due_date ?? loan.due_date;

  function openSchedule() {
    setScheduleMonth(loan.release_date ? new Date(loan.release_date) : new Date());
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
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    return chainLoans.some(seg => {
      if (!seg.release_date || !seg.due_date) return false;
      const start = new Date(seg.release_date).setHours(0, 0, 0, 0);
      const end = new Date(seg.due_date).setHours(0, 0, 0, 0);
      return d >= start && d <= end;
    });
  }

  function dateKey(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  // Walks every loan in the renewal chain (oldest first) day-by-day. A
  // shortfall on a day rolls forward and compounds onto the next day's due
  // amount, and that carry crosses directly from one loan's last day into
  // the next renewal's release date — even across the gap where the old
  // loan already ended and the new one hadn't started yet. Conversely, a
  // lump-sum payment bigger than one day's due rolls forward as credit,
  // marking as many following days as it covers as Paid.
  function computeDayStatuses() {
    const map = new Map<string, { status: 'paid' | 'unpaid' | 'due'; amount: number }>();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let carry = 0; // positive = still owed rolling forward; negative = credit rolling forward
    for (const segment of chainLoans) {
      if (!segment.release_date || !segment.due_date) continue;
      const segDaily = segment.term_days > 0 ? segment.total_payable / segment.term_days : 0;
      const end = new Date(segment.due_date);
      end.setHours(0, 0, 0, 0);

      for (let d = new Date(segment.release_date); d <= end; d.setDate(d.getDate() + 1)) {
        const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const key = dateKey(day);
        const paid = chainPaidAmountByDate.get(key) ?? 0;
        const expected = segDaily + carry;

        if (paid >= expected) {
          map.set(key, { status: 'paid', amount: segDaily });
          carry = expected - paid;
        } else {
          const remainingDue = expected - paid;
          map.set(key, { status: day < today ? 'unpaid' : 'due', amount: remainingDue });
          carry = remainingDue;
        }
      }
    }
    return map;
  }

  function openRenew() {
    setRenewForm({
      amount: String(loan.amount),
      interest_rate: String(loan.interest_rate),
      term_days: String(loan.term_days),
      release_date: new Date().toISOString().split('T')[0],
    });
    setRenewOpen(true);
  }

  async function handleSubmitRenew(e: React.FormEvent) {
    e.preventDefault();
    const offsetRequired = loan.total_payable * 0.40;
    if (loan.remaining_balance > offsetRequired) {
      toast({
        title: 'Cannot renew',
        description: `Remaining balance must be at most 40% of the total payable (₱${offsetRequired.toFixed(2)}). Current balance: ₱${loan.remaining_balance.toFixed(2)}`,
        variant: 'destructive',
      });
      return;
    }

    const maxLimit = loan.customers?.max_loan_limit;
    if (maxLimit != null && Number(renewForm.amount) > maxLimit) {
      toast({
        title: 'Loan amount exceeds limit',
        description: `${loan.customers?.first_name} ${loan.customers?.last_name}'s max loan limit is ${formatCurrency(maxLimit)}.`,
        variant: 'destructive',
      });
      return;
    }

    setRenewing(true);
    const newLoanNumber = generateLoanNumber();
    const details = computeLoanDetails(Number(renewForm.amount), Number(renewForm.interest_rate), Number(renewForm.term_days));
    const dueDate = new Date(new Date(renewForm.release_date).getTime() + Number(renewForm.term_days) * 86400000).toISOString().split('T')[0];

    const { error } = await supabase.from('loans').insert({
      loan_number: newLoanNumber,
      customer_id: loan.customer_id,
      loan_type_id: loan.loan_type_id,
      amount: Number(renewForm.amount),
      interest_rate: Number(renewForm.interest_rate),
      interest_amount: details.interestAmount,
      service_fee: details.serviceFee,
      release_amount: details.releaseAmount,
      total_payable: details.totalPayable,
      remaining_balance: details.totalPayable,
      term_days: Number(renewForm.term_days),
      collector_id: loan.collector_id,
      branch_id: loan.branch_id,
      area_id: loan.area_id,
      status: 'pending',
      release_date: renewForm.release_date,
      due_date: dueDate,
      renewed_from_loan_id: loan.id,
    });

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Submitted for approval', description: `Renewal ${newLoanNumber} is pending — a Cashier must approve it before it becomes active.` });
      setRenewOpen(false);
      router.push('/loans');
    }
    setRenewing(false);
  }

  async function handleReapply() {
    setReapplying(true);
    const newLoanNumber = `LN-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
    const releaseDate = new Date().toISOString().split('T')[0];
    const { data, error } = await supabase.from('loans').insert({
      loan_number: newLoanNumber,
      customer_id: loan.customer_id,
      loan_type_id: loan.loan_type_id,
      amount: loan.amount,
      interest_rate: loan.interest_rate,
      interest_amount: loan.interest_amount,
      service_fee: loan.service_fee,
      release_amount: loan.release_amount,
      total_payable: loan.total_payable,
      remaining_balance: loan.total_payable,
      term_days: loan.term_days,
      collector_id: loan.collector_id,
      branch_id: loan.branch_id,
      area_id: loan.area_id,
      status: 'pending',
      release_date: releaseDate,
      due_date: new Date(Date.now() + loan.term_days * 86400000).toISOString().split('T')[0],
    }).select('id').single();

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      await supabase.from('loans').update({ reapplied: true }).eq('id', loan.id);
      toast({ title: 'Re-submitted for approval', description: `New application ${newLoanNumber} is pending review.` });
      router.push(`/loans/${data.id}`);
    }
    setReapplying(false);
  }

  async function openApprove() {
    setApproveOpen(true);
    setApproveDocsLoading(true);
    const { data } = await supabase
      .from('customer_documents')
      .select('*')
      .eq('customer_id', loan.customer_id);
    setApproveDocs(data ?? []);
    setApproveDocsLoading(false);
  }

  async function handleDocUpload(docType: string, file: File) {
    setUploadingDocType(docType);
    const ext = file.name.split('.').pop();
    const path = `${loan.customer_id}/${docType}-${Date.now()}.${ext}`;

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
      customer_id: loan.customer_id,
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
        .eq('customer_id', loan.customer_id);
      setApproveDocs(data ?? []);
    }
    setUploadingDocType(null);
  }

  const missingDocs = REQUIRED_DOCUMENTS.filter(rd => !approveDocs.some(d => d.document_type === rd.type));

  async function handleConfirmApprove() {
    if (missingDocs.length > 0) return;
    setApproving(true);
    const { error } = await supabase.from('loans').update({ status: 'active' }).eq('id', loan.id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      if (loan.renewed_from_loan_id) {
        await supabase.from('loans').update({ status: 'renewed' }).eq('id', loan.renewed_from_loan_id);
      }
      toast({ title: 'Loan approved', description: `${loan.loan_number} is now active.` });
      setApproveOpen(false);
      loadLoan();
    }
    setApproving(false);
  }

  async function handleDecline() {
    if (!declineReason.trim()) return;
    setDeclining(true);
    const { error } = await supabase
      .from('loans')
      .update({ status: 'declined', decline_reason: declineReason.trim() })
      .eq('id', loan.id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Loan declined', description: `${loan.loan_number} has been declined.` });
      setDeclineOpen(false);
      setDeclineReason('');
      loadLoan();
    }
    setDeclining(false);
  }

  return (
    <div className="space-y-6">
      <PageHeader title={loan.loan_number} description="Loan details and payment history">
        <Button variant="outline" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        {successorLoan && (
          <Link href={`/loans/${successorLoan.id}`}>
            <Button size="sm">
              <ArrowRight className="w-4 h-4 mr-2" />
              View Renewed Loan ({successorLoan.loan_number})
            </Button>
          </Link>
        )}
        {!isCashier && loan.status !== 'renewed' && (
          <>
            <Link href={`/payments?loan=${loan.id}`}>
              <Button size="sm">
                <Plus className="w-4 h-4 mr-2" />
                Post Payment
              </Button>
            </Link>
            <Button size="sm" variant="outline" onClick={openRenew} disabled={!canRenew}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Renew Loan
            </Button>
          </>
        )}
        {loan.status === 'pending' && canApprove && (
          <>
            <Button size="sm" onClick={openApprove}>
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Approve
            </Button>
            <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => { setDeclineOpen(true); setDeclineReason(''); }}>
              Decline
            </Button>
          </>
        )}
        {loan.status === 'declined' && !loan.reapplied && !isCashier && (
          <Button size="sm" onClick={handleReapply} disabled={reapplying}>
            {reapplying ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Re-apply
          </Button>
        )}
        {loan.status !== 'declined' && (
          <Button size="sm" variant="outline" onClick={openSchedule}>
            <CalendarDays className="w-4 h-4 mr-2" />
            Calendar
          </Button>
        )}
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Loan info */}
        <Card className="glass-card border-border lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Landmark className="w-5 h-5" />
              Loan Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Status:</span>
              <Badge variant={loan.status === 'active' ? 'default' : loan.status === 'overdue' || loan.status === 'declined' ? 'destructive' : 'secondary'}>{loan.status}</Badge>
            </div>
            {loan.status === 'declined' && loan.decline_reason && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                <p className="text-xs font-medium text-destructive mb-1">Reason for decline</p>
                <p className="text-sm">{loan.decline_reason}</p>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Loan Type:</span>
              <span className="font-medium">{loan.loan_types?.name ?? '—'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Principal:</span>
              <span className="font-medium">{formatCurrency(loan.amount)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Interest ({loan.interest_rate}%):</span>
              <span className="font-medium">{formatCurrency(loan.interest_amount)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Service Fee:</span>
              <span className="font-medium text-warning">{formatCurrency(loan.service_fee)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Release Amount:</span>
              <span className="font-medium text-success">{formatCurrency(loan.release_amount)}</span>
            </div>
            <div className="flex justify-between text-sm pt-2 border-t border-border">
              <span className="text-muted-foreground">Total Payable:</span>
              <span className="font-bold text-primary">{formatCurrency(loan.total_payable)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Remaining Balance:</span>
              <span className="font-bold text-destructive">{formatCurrency(loan.remaining_balance)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Release Date:</span>
              <span>{formatDate(loan.release_date)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Due Date:</span>
              <span>{formatDate(loan.due_date)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Term:</span>
              <span>{loan.term_days} days</span>
            </div>
          </CardContent>
        </Card>

        {/* Customer & Collector */}
        <Card className="glass-card border-border lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="w-5 h-5" />
              Customer & Assignment
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm">
              <p className="text-muted-foreground">Customer</p>
              <p className="font-medium">{loan.customers?.first_name} {loan.customers?.last_name}</p>
            </div>
            <div className="text-sm">
              <p className="text-muted-foreground">Phone</p>
              <p>{loan.customers?.phone ?? '—'}</p>
            </div>
            <div className="text-sm">
              <p className="text-muted-foreground">Address</p>
              <p>{loan.customers?.address ?? '—'}{loan.customers?.barangay ? `, Brgy. ${loan.customers.barangay}` : ''}</p>
            </div>
            <div className="text-sm">
              <p className="text-muted-foreground">Collector</p>
              <p className="font-medium">{loan.collectors?.profiles?.full_name ?? '—'}</p>
            </div>
            <div className="text-sm">
              <p className="text-muted-foreground">Branch</p>
              <p>{loan.branches?.name ?? '—'}</p>
            </div>
            <div className="text-sm">
              <p className="text-muted-foreground">Area</p>
              <p>{loan.areas?.name ?? '—'}</p>
            </div>
          </CardContent>
        </Card>

        {/* Payment history */}
        <Card className="glass-card border-border lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="w-5 h-5" />
              Payment History
            </CardTitle>
            <CardDescription>{payments.length} payments</CardDescription>
          </CardHeader>
          <CardContent>
            {payments.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No payments yet</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {payments.map(p => (
                  <div key={p.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                    <div>
                      <p className="text-sm font-medium">{formatCurrency(p.amount_paid)}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(p.payment_date)} {p.receipts?.or_number ? `• ${p.receipts.or_number}` : ''}</p>
                    </div>
                    <Badge variant="secondary" className="text-success">{formatCurrency(p.remaining_balance)}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Renewal info */}
      {loan.status === 'active' && (
        <Card className="glass-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-warning/10 flex items-center justify-center">
                <RefreshCw className="w-5 h-5 text-warning" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">Loan Renewal</p>
                <p className="text-xs text-muted-foreground">
                  Remaining balance must be at most 40% of total payable ({formatCurrency(offsetRequired)}) before renewal. Current balance: {formatCurrency(loan.remaining_balance)}
                </p>
              </div>
              <Badge variant={canRenew ? 'default' : 'secondary'}>
                {canRenew ? 'Eligible' : 'Not eligible'}
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Payment calendar */}
      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl">Payment Calendar</DialogTitle>
            <DialogDescription className="text-base">
              {formatCurrency(dailyAmount)} due per day (current loan), covering {formatDate(chainStart)} to {formatDate(chainEnd)}
              {chainLoans.length > 1 && ` across ${chainLoans.length} renewals`}
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
            <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-success/20 border border-success" /> Paid</span>
            <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-primary/10 border border-primary/30" /> Due</span>
            <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-destructive/20 border border-destructive" /> Unpaid</span>
            <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-muted" /> Outside term</span>
          </div>

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
              const info = inTerm ? dayStatuses.get(dateKey(date)) : undefined;
              return (
                <div
                  key={i}
                  className={`relative rounded-lg py-3 text-sm ${
                    !inCurrentMonth ? 'text-muted-foreground/30' :
                    info?.status === 'paid' ? 'bg-success/10 text-success font-medium' :
                    info?.status === 'unpaid' ? 'bg-destructive/10 text-destructive font-medium' :
                    info?.status === 'due' ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground'
                  }`}
                >
                  {info?.status === 'paid' && <Check className="w-3 h-3 absolute top-1 right-1" />}
                  <p className="text-base">{date.getDate()}</p>
                  {info && (
                    <p className="text-xs leading-tight mt-0.5">{formatCurrency(info.amount)}</p>
                  )}
                </div>
              );
            })}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setScheduleOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Renew loan — same pending/approve workflow as a new loan */}
      <Dialog open={renewOpen} onOpenChange={setRenewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Renew {loan.loan_number}</DialogTitle>
            <DialogDescription>Submit a renewal for {loan.customers?.first_name} {loan.customers?.last_name} — a Cashier must approve it before it becomes active</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmitRenew} className="space-y-4">
            <div className="space-y-2">
              <Label>Customer</Label>
              <div className="flex h-10 w-full items-center rounded-md border border-input bg-secondary/50 px-3 py-2 text-sm text-muted-foreground">
                {loan.customers?.first_name} {loan.customers?.last_name}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Loan Amount (₱) *</Label>
                <Input type="number" required value={renewForm.amount} onChange={(e) => setRenewForm({ ...renewForm, amount: e.target.value })} />
                {loan.customers?.max_loan_limit != null && (() => {
                  const overLimit = renewForm.amount && Number(renewForm.amount) > loan.customers.max_loan_limit;
                  return (
                    <p className={`text-xs ${overLimit ? 'text-destructive' : 'text-muted-foreground'}`}>
                      Customer's max loan limit: {formatCurrency(loan.customers.max_loan_limit)}
                    </p>
                  );
                })()}
              </div>
              <div className="space-y-2">
                <Label>Interest Rate (%)</Label>
                <Input type="number" value={renewForm.interest_rate} onChange={(e) => setRenewForm({ ...renewForm, interest_rate: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Term (Days)</Label>
                <Input type="number" value={renewForm.term_days} onChange={(e) => setRenewForm({ ...renewForm, term_days: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Release Date</Label>
                <Input type="date" value={renewForm.release_date} onChange={(e) => setRenewForm({ ...renewForm, release_date: e.target.value })} />
              </div>
            </div>

            {renewForm.amount && (() => {
              const details = computeLoanDetails(Number(renewForm.amount), Number(renewForm.interest_rate), Number(renewForm.term_days));
              return (
                <div className="p-4 rounded-xl bg-secondary/50 border border-border space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Interest:</span><span className="font-medium">{formatCurrency(details.interestAmount)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Service Fee:</span><span className="font-medium text-warning">{formatCurrency(details.serviceFee)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Release Amount:</span><span className="font-medium text-success">{formatCurrency(details.releaseAmount)}</span></div>
                  <div className="flex justify-between pt-2 border-t border-border"><span className="text-muted-foreground">Total Payable:</span><span className="font-bold text-primary">{formatCurrency(details.totalPayable)}</span></div>
                </div>
              );
            })()}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenewOpen(false)}>Cancel</Button>
              <Button
                type="submit"
                disabled={renewing || !renewForm.amount || (loan.customers?.max_loan_limit != null && Number(renewForm.amount) > loan.customers.max_loan_limit)}
              >
                {renewing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Submit for Approval
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Approve loan — requires KYC documents on file */}
      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Approve {loan.loan_number}</DialogTitle>
            <DialogDescription>
              All required documents for {loan.customers?.first_name} {loan.customers?.last_name} must be on file before this loan can be approved.
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
            <Button type="button" variant="outline" onClick={() => setApproveOpen(false)}>Cancel</Button>
            <Button type="button" disabled={missingDocs.length > 0 || approveDocsLoading || approving} onClick={handleConfirmApprove}>
              {approving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {missingDocs.length > 0 ? `${missingDocs.length} document${missingDocs.length > 1 ? 's' : ''} missing` : 'Approve Loan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Decline loan confirmation */}
      <Dialog open={declineOpen} onOpenChange={setDeclineOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Decline {loan.loan_number}</DialogTitle>
            <DialogDescription>
              Declining this loan application for {loan.customers?.first_name} {loan.customers?.last_name}. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Reason for declining *</Label>
            <Textarea
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              placeholder="Explain why this loan is being declined — the Branch Manager will see this"
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeclineOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={!declineReason.trim() || declining} onClick={handleDecline}>
              {declining && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Decline Loan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
