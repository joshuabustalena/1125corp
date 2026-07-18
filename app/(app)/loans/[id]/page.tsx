'use client';

import { useEffect, useRef, useState } from 'react';
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
import { formatCurrency, formatDate, generateLoanNumber, generateVoucherNumber, computeLoanDetails } from '@/lib/format';
import { postJournalEntry } from '@/lib/ledger';
import {
  ArrowLeft, ArrowRight, Landmark, Wallet, Calendar, User, MapPin, Check,
  Loader2, RefreshCw, Plus, Receipt, ChevronLeft, ChevronRight, CalendarDays,
  CheckCircle2, FileText, Banknote, Download, ShieldCheck, AlertTriangle,
} from 'lucide-react';
import Link from 'next/link';

export default function LoanDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const { profile } = useAuth();
  const canApprove = profile?.role_name === 'Administrator' || profile?.role_name === 'Branch Manager';
  const canDisburse = profile?.role_name === 'Administrator' || profile?.role_name === 'Cashier';
  const canManageCollateral = profile?.role_name === 'Administrator' || profile?.role_name === 'Cashier';
  const isCashier = profile?.role_name === 'Cashier';
  const isCollector = profile?.role_name === 'Branch Field Collector';
  const [loan, setLoan] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [chainLoans, setChainLoans] = useState<any[]>([]);
  const [chainPayments, setChainPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [renewing, setRenewing] = useState(false);
  const [renewOpen, setRenewOpen] = useState(false);
  const [renewForm, setRenewForm] = useState({ amount: '', interest_rate: '8', term_days: '60', release_date: '', daily_payment: '' });
  const [reapplying, setReapplying] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleMonth, setScheduleMonth] = useState(new Date());
  const [approveOpen, setApproveOpen] = useState(false);
  const [approving, setApproving] = useState(false);
  const [bumpingLimit, setBumpingLimit] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [declining, setDeclining] = useState(false);
  const [successorLoan, setSuccessorLoan] = useState<any>(null);
  const [disbursing, setDisbursing] = useState(false);
  const [collateral, setCollateral] = useState<any[]>([]);
  const [collateralDialogOpen, setCollateralDialogOpen] = useState(false);
  const [savingCollateral, setSavingCollateral] = useState(false);
  const [collateralForm, setCollateralForm] = useState({ collateral_type: 'orcr', reference_number: '', description: '', notes: '' });
  const [releaseTarget, setReleaseTarget] = useState<any>(null);
  const [releasedTo, setReleasedTo] = useState('');
  const [releasingCollateral, setReleasingCollateral] = useState(false);

  async function loadLoan() {
    const id = params.id as string;
    const [l, p] = await Promise.all([
      supabase.from('loans').select('*, customers(first_name, last_name, phone, address, barangay, city, province, government_id, max_loan_limit), collectors(profiles(full_name)), branches(name), areas(name), loan_types(name), created_by_profile:profiles!created_by(full_name), approved_by_profile:profiles!approved_by(full_name), disbursed_by_profile:profiles!disbursed_by(full_name)').eq('id', id).maybeSingle(),
      supabase.from('payments').select('*, receipts(or_number)').eq('loan_id', id).order('payment_date', { ascending: false }),
    ]);
    setLoan(l.data);
    setPayments(p.data ?? []);

    const { data: collateralData } = await supabase.from('collateral').select('*').eq('loan_id', id).order('created_at', { ascending: false });
    setCollateral(collateralData ?? []);

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
  const dailyAmount = loan.daily_payment != null && Number(loan.daily_payment) > 0
    ? Number(loan.daily_payment)
    : (loan.term_days > 0 ? loan.total_payable / loan.term_days : 0);

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

  // Walks every loan in the renewal chain (oldest first) day-by-day.
  //
  // Each collection day is scheduled at the flat daily payment amount; the
  // LAST collection day of a segment absorbs whatever balance is left, so if
  // the daily amount doesn't divide the total evenly the final day settles
  // the remainder (however large). Sundays are not collection days (shown as
  // "No collection") but still count toward the term.
  //
  // Stacking ("patong") only happens for genuinely MISSED past days: an
  // unpaid past day rolls its shortfall onto the next day. Future days always
  // show the flat scheduled amount — they don't pre-stack. Any accumulated
  // past debt lands on today (the first day that isn't already in the past).
  function computeDayStatuses() {
    const map = new Map<string, { status: 'paid' | 'unpaid' | 'due' | 'nocollect'; amount: number }>();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let carry = 0; // positive = missed debt rolling forward; negative = credit rolling forward
    for (const segment of chainLoans) {
      if (!segment.release_date || !segment.due_date) continue;
      const segDaily = segment.daily_payment != null && Number(segment.daily_payment) > 0
        ? Number(segment.daily_payment)
        : (segment.term_days > 0 ? segment.total_payable / segment.term_days : 0);
      const total = Number(segment.total_payable) || 0;
      const end = new Date(segment.due_date);
      end.setHours(0, 0, 0, 0);

      // Collection days = every day in [release, due] except Sundays.
      const collectionDays: Date[] = [];
      for (let d = new Date(segment.release_date); d <= end; d.setDate(d.getDate() + 1)) {
        const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        if (day.getDay() === 0) {
          map.set(dateKey(day), { status: 'nocollect', amount: 0 });
        } else {
          collectionDays.push(day);
        }
      }

      let scheduledRemaining = total;
      collectionDays.forEach((day, i) => {
        const isFirstDay = i === 0;
        const isLast = i === collectionDays.length - 1;
        const scheduled = isLast ? Math.max(0, scheduledRemaining) : Math.min(segDaily, scheduledRemaining);
        scheduledRemaining = Math.max(0, scheduledRemaining - scheduled);

        const key = dateKey(day);

        if (isFirstDay) {
          // Auto-settled out of the release proceeds — never shown as due.
          // Any real payment recorded on release day is a pure advance
          // credit that should roll forward onto the following days.
          const paidOnRelease = chainPaidAmountByDate.get(key) ?? 0;
          map.set(key, { status: 'paid', amount: scheduled });
          carry = -paidOnRelease;
          return;
        }

        const paid = chainPaidAmountByDate.get(key) ?? 0;

        if (day > today) {
          // Future day: an existing advance credit still applies (the
          // customer already paid ahead), but unpaid past debt never
          // projects forward speculatively onto future days.
          if (carry < 0) {
            const expected = scheduled + carry;
            if (expected <= 0) {
              map.set(key, { status: 'paid', amount: scheduled });
              carry = expected;
            } else {
              map.set(key, { status: 'due', amount: expected });
              carry = 0;
            }
          } else {
            map.set(key, { status: 'due', amount: scheduled });
          }
          return;
        }

        // Today or past: apply carry so missed days (or remaining credit) stack forward.
        const expected = scheduled + carry;
        if (paid >= expected) {
          map.set(key, { status: 'paid', amount: scheduled });
          carry = expected - paid; // negative = credit rolling forward
        } else {
          const remainingDue = expected - paid;
          map.set(key, { status: day < today ? 'unpaid' : 'due', amount: remainingDue });
          carry = remainingDue;
        }
      });
    }
    return map;
  }

  function openRenew() {
    setRenewForm({
      amount: String(loan.amount),
      interest_rate: String(loan.interest_rate),
      term_days: String(loan.term_days),
      release_date: new Date().toISOString().split('T')[0],
      daily_payment: String(Number(loan.daily_payment) || 0),
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

    setRenewing(true);
    const newLoanNumber = generateLoanNumber();
    const details = computeLoanDetails(Number(renewForm.amount), Number(renewForm.interest_rate), Number(renewForm.term_days));
    const dueDate = new Date(new Date(renewForm.release_date).getTime() + Number(renewForm.term_days) * 86400000).toISOString().split('T')[0];
    const autoDaily = Number(renewForm.term_days) > 0 ? details.totalPayable / Number(renewForm.term_days) : 0;
    const regularDaily = Number(renewForm.daily_payment) > 0 ? Number(renewForm.daily_payment) : autoDaily;
    // The old loan's full remaining balance carries into this renewal rather
    // than being paid out in cash — it comes straight out of what's actually
    // released to the customer. Daily Payment is a separate, independent
    // figure (the new loan's own payment schedule) and does not reduce it.
    const offsetBalance = Number(loan.remaining_balance);
    const adjustedReleaseAmount = Math.max(0, details.releaseAmount - offsetBalance);

    const { error } = await supabase.from('loans').insert({
      loan_number: newLoanNumber,
      customer_id: loan.customer_id,
      loan_type_id: loan.loan_type_id,
      amount: Number(renewForm.amount),
      interest_rate: Number(renewForm.interest_rate),
      interest_amount: details.interestAmount,
      service_fee: details.serviceFee,
      release_amount: adjustedReleaseAmount,
      total_payable: details.totalPayable,
      remaining_balance: details.totalPayable,
      term_days: Number(renewForm.term_days),
      daily_payment: regularDaily,
      collector_id: loan.collector_id,
      branch_id: loan.branch_id,
      area_id: loan.area_id,
      status: 'pending',
      release_date: renewForm.release_date,
      due_date: dueDate,
      renewed_from_loan_id: loan.id,
      offset_balance: offsetBalance,
    });

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Submitted for approval', description: `Renewal ${newLoanNumber} is pending — a Branch Manager must approve it before it becomes active.` });
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
      daily_payment: loan.daily_payment ?? null,
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

  function openApprove() {
    setApproveOpen(true);
  }

  const overLimit = loan.customers?.max_loan_limit != null && Number(loan.amount) > Number(loan.customers.max_loan_limit);

  async function handleBumpLimit() {
    setBumpingLimit(true);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/customers/bump-loan-limit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ customer_id: loan.customer_id, new_limit: Number(loan.amount) }),
    });
    const result = await res.json();
    if (!res.ok) {
      toast({ title: 'Error', description: result.error ?? 'Failed to update max loan limit', variant: 'destructive' });
    } else {
      toast({ title: 'Max loan limit updated', description: `${loan.customers?.first_name}'s max loan limit is now ${formatCurrency(Number(loan.amount))}.` });
      await loadLoan();
    }
    setBumpingLimit(false);
  }

  async function handleConfirmApprove() {
    if (overLimit) return;
    setApproving(true);
    const now = new Date().toISOString();
    const { error } = await supabase.from('loans').update({
      status: 'approved',
      approved_by: profile?.id ?? null,
      approved_at: now,
    }).eq('id', loan.id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Loan approved', description: `${loan.loan_number} is awaiting disbursement by a Cashier.` });
      setApproveOpen(false);
      router.push(`/loans/${loan.id}/agreement`);
    }
    setApproving(false);
  }

  async function handleApproveAtLimit() {
    if (!loan.customers?.max_loan_limit) return;
    setApproving(true);
    const now = new Date().toISOString();
    const newAmount = Number(loan.customers.max_loan_limit);
    const details = computeLoanDetails(newAmount, Number(loan.interest_rate), Number(loan.term_days));
    const { error } = await supabase.from('loans').update({
      amount: newAmount,
      interest_amount: details.interestAmount,
      service_fee: details.serviceFee,
      release_amount: details.releaseAmount,
      total_payable: details.totalPayable,
      remaining_balance: details.totalPayable,
      status: 'approved',
      approved_by: profile?.id ?? null,
      approved_at: now,
    }).eq('id', loan.id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Loan approved at max limit', description: `Loan amount adjusted to ${formatCurrency(newAmount)} and approved.` });
      setApproveOpen(false);
      router.push(`/loans/${loan.id}/agreement`);
    }
    setApproving(false);
  }

  async function handleDisburse() {
    setDisbursing(true);
    const voucherNumber = generateVoucherNumber();
    const now = new Date().toISOString();

    const { error: loanError } = await supabase.from('loans').update({
      status: 'active',
      disbursed_by: profile?.id ?? null,
      disbursed_at: now,
    }).eq('id', loan.id);

    if (loanError) {
      toast({ title: 'Error', description: loanError.message, variant: 'destructive' });
      setDisbursing(false);
      return;
    }

    if (loan.renewed_from_loan_id) {
      await supabase.from('loans').update({ status: 'renewed' }).eq('id', loan.renewed_from_loan_id);
    }

    const { error: voucherError } = await supabase.from('cash_vouchers').insert({
      voucher_number: voucherNumber,
      loan_id: loan.id,
      customer_id: loan.customer_id,
      amount: loan.release_amount,
      prepared_by: profile?.id ?? null,
      voucher_date: now.split('T')[0],
    });

    if (voucherError) {
      toast({ title: 'Loan disbursed, but voucher failed', description: voucherError.message, variant: 'destructive' });
    }

    // Auto-post to the general ledger: the full loan amount becomes
    // receivable, cash goes out net of the service fee we keep as income.
    postJournalEntry({
      entryDate: now.split('T')[0],
      description: `Loan disbursement — ${loan.loan_number}`,
      reference: voucherNumber,
      source: 'disbursement',
      sourceId: loan.id,
      createdBy: profile?.id ?? null,
      lines: [
        { accountCode: '1100', debit: Number(loan.amount), memo: 'Loans Receivable' },
        { accountCode: '1000', credit: Number(loan.release_amount), memo: 'Cash released to borrower' },
        { accountCode: '4010', credit: Number(loan.service_fee), memo: 'Service fee income' },
      ],
    });

    toast({ title: 'Loan disbursed', description: `${loan.loan_number} is now active.` });
    setDisbursing(false);
    router.push(`/loans/${loan.id}/voucher`);
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

  async function handleAddCollateral(e: React.FormEvent) {
    e.preventDefault();
    setSavingCollateral(true);
    const { error } = await supabase.from('collateral').insert({
      loan_id: loan.id,
      customer_id: loan.customer_id,
      collateral_type: collateralForm.collateral_type,
      reference_number: collateralForm.reference_number || null,
      description: collateralForm.description || null,
      notes: collateralForm.notes || null,
      created_by: profile?.id ?? null,
    });
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: 'Collateral item recorded' });
      setCollateralDialogOpen(false);
      setCollateralForm({ collateral_type: 'orcr', reference_number: '', description: '', notes: '' });
      loadLoan();
    }
    setSavingCollateral(false);
  }

  function openRelease(item: any) {
    setReleaseTarget(item);
    setReleasedTo('');
  }

  async function handleConfirmRelease() {
    if (!releaseTarget || !releasedTo.trim()) return;
    setReleasingCollateral(true);
    const { error } = await supabase.from('collateral').update({
      status: 'released',
      released_date: new Date().toISOString().split('T')[0],
      released_to: releasedTo.trim(),
    }).eq('id', releaseTarget.id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: 'Collateral marked as released' });
      setReleaseTarget(null);
      loadLoan();
    }
    setReleasingCollateral(false);
  }

  const collateralTypeLabel = (t: string) => t === 'orcr' ? 'ORCR' : t === 'bank_check' ? 'Bank Check' : 'Other';

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
        {!isCashier && (loan.status === 'active' || loan.status === 'overdue') && (
          <Link href={`/payments?loan=${loan.id}`}>
            <Button size="sm">
              <Plus className="w-4 h-4 mr-2" />
              Post Payment
            </Button>
          </Link>
        )}
        {!isCashier && loan.status !== 'renewed' && (
          <Button size="sm" variant="outline" onClick={openRenew} disabled={!canRenew}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Renew Loan
          </Button>
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
        {loan.status === 'approved' && canDisburse && (
          <Button size="sm" onClick={handleDisburse} disabled={disbursing}>
            {disbursing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Banknote className="w-4 h-4 mr-2" />}
            Disburse
          </Button>
        )}
        {loan.disbursed_at && (
          <Link href={`/loans/${loan.id}/voucher`}>
            <Button size="sm" variant="outline">
              <Banknote className="w-4 h-4 mr-2" />
              View Voucher
            </Button>
          </Link>
        )}
        {loan.approved_at && (
          <Link href={`/loans/${loan.id}/agreement`}>
            <Button size="sm" variant="outline">
              <FileText className="w-4 h-4 mr-2" />
              View Agreement
            </Button>
          </Link>
        )}
        {loan.approved_at && (
          <Link href={`/loans/${loan.id}/undertaking`}>
            <Button size="sm" variant="outline">
              <FileText className="w-4 h-4 mr-2" />
              View Undertaking
            </Button>
          </Link>
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
              <span className="font-medium">{loan.loan_types?.name ?? 'Custom'}</span>
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
              <span className="text-muted-foreground">First Payment (deducted):</span>
              <span className="font-medium text-warning">{formatCurrency(dailyAmount)}</span>
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
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Daily Payment:</span>
              <span className="font-medium">{formatCurrency(dailyAmount)}</span>
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

      {/* Collateral */}
      <Card className="glass-card border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5" />
              Collateral
            </CardTitle>
            <CardDescription>{collateral.length} item{collateral.length !== 1 ? 's' : ''} on file (ORCR / Bank Checks)</CardDescription>
          </div>
          {canManageCollateral && (
            <Button size="sm" variant="outline" onClick={() => setCollateralDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Collateral
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {collateral.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No collateral recorded for this loan</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Reference #</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Held Date</TableHead>
                  {canManageCollateral && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {collateral.map(c => (
                  <TableRow key={c.id}>
                    <TableCell className="text-sm font-medium">{collateralTypeLabel(c.collateral_type)}</TableCell>
                    <TableCell className="text-sm">{c.reference_number ?? '—'}</TableCell>
                    <TableCell className="text-sm">{c.description ?? '—'}</TableCell>
                    <TableCell><Badge variant={c.status === 'released' ? 'secondary' : 'default'} className="capitalize">{c.status}</Badge></TableCell>
                    <TableCell className="text-sm">{formatDate(c.held_date)}</TableCell>
                    {canManageCollateral && (
                      <TableCell className="text-right">
                        {c.status === 'held' && (
                          <Button variant="outline" size="sm" onClick={() => openRelease(c)}>Release</Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Renewal info */}
      {loan.status === 'active' && !isCollector && (
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
                  {info?.status === 'nocollect' ? (
                    <p className="text-[10px] leading-tight mt-0.5">No collection</p>
                  ) : info && (
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
            <DialogDescription>Submit a renewal for {loan.customers?.first_name} {loan.customers?.last_name} — a Branch Manager must approve it before it becomes active</DialogDescription>
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
              <div className="space-y-2 col-span-2">
                <Label>Daily Payment (₱)</Label>
                {(() => {
                  const details = renewForm.amount ? computeLoanDetails(Number(renewForm.amount), Number(renewForm.interest_rate), Number(renewForm.term_days)) : null;
                  const autoDaily = details && Number(renewForm.term_days) > 0 ? details.totalPayable / Number(renewForm.term_days) : 0;
                  return (
                    <>
                      <Input
                        type="number"
                        value={renewForm.daily_payment}
                        onChange={(e) => setRenewForm({ ...renewForm, daily_payment: e.target.value })}
                        placeholder={autoDaily ? `Auto: ${formatCurrency(autoDaily)}` : '0.00'}
                      />
                      <p className="text-xs text-muted-foreground">
                        How much the customer will pay per collection day on this renewed loan. The Offset Balance ({formatCurrency(loan.remaining_balance)} — the previous loan's full remaining balance) is carried in separately below and is automatically deducted from the Release Amount.
                      </p>
                    </>
                  );
                })()}
              </div>
            </div>

            {renewForm.amount && (() => {
              const details = computeLoanDetails(Number(renewForm.amount), Number(renewForm.interest_rate), Number(renewForm.term_days));
              const autoDaily = Number(renewForm.term_days) > 0 ? details.totalPayable / Number(renewForm.term_days) : 0;
              const regularDaily = Number(renewForm.daily_payment) > 0 ? Number(renewForm.daily_payment) : autoDaily;
              const offsetBalance = Number(loan.remaining_balance);
              const adjustedReleaseAmount = Math.max(0, details.releaseAmount - offsetBalance);
              const totalDeduction = details.serviceFee + offsetBalance;
              return (
                <div className="p-4 rounded-xl bg-secondary/50 border border-border space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Loan Amount:</span><span className="font-medium">{formatCurrency(Number(renewForm.amount))}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Interest:</span><span className="font-medium">{formatCurrency(details.interestAmount)}</span></div>
                  <div className="flex justify-between pt-2 border-t border-border"><span className="text-muted-foreground">Total Payable:</span><span className="font-bold text-primary">{formatCurrency(details.totalPayable)}</span></div>
                  <div className="flex justify-between pt-2 border-t border-border"><span className="text-muted-foreground">Daily Payment:</span><span className="font-medium">{formatCurrency(regularDaily)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Service Fee:</span><span className="font-medium text-warning">-{formatCurrency(details.serviceFee)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Offset Balance:</span><span className="font-medium text-warning">-{formatCurrency(offsetBalance)}</span></div>
                  <div className="flex justify-between pt-2 border-t border-border"><span className="text-muted-foreground">Total Deduction:</span><span className="font-medium">-{formatCurrency(totalDeduction)}</span></div>
                  <div className="flex justify-between pt-2 border-t border-border"><span className="text-muted-foreground">Release Amount:</span><span className="font-bold text-success">{formatCurrency(adjustedReleaseAmount)}</span></div>
                </div>
              );
            })()}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenewOpen(false)}>Cancel</Button>
              <Button
                type="submit"
                disabled={renewing || !renewForm.amount}
              >
                {renewing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Submit for Approval
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Approve loan — simple confirmation, with a max-loan-limit check */}
      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Approve {loan.loan_number}</DialogTitle>
            <DialogDescription>
              Are you sure you want to approve this loan for {loan.customers?.first_name} {loan.customers?.last_name}?
            </DialogDescription>
          </DialogHeader>

          {overLimit && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/30">
              <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0 space-y-2">
                <p className="text-sm text-destructive">
                  This loan ({formatCurrency(loan.amount)}) exceeds {loan.customers?.first_name}'s max loan limit of {formatCurrency(loan.customers?.max_loan_limit ?? 0)}.
                  Either raise the customer's limit to match, or approve the loan capped at their current limit instead.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" disabled={bumpingLimit || approving} onClick={handleBumpLimit}>
                    {bumpingLimit && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Set max loan limit to {formatCurrency(loan.amount)}
                  </Button>
                  <Button type="button" size="sm" disabled={bumpingLimit || approving} onClick={handleApproveAtLimit}>
                    {approving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Approve at max limit ({formatCurrency(loan.customers?.max_loan_limit ?? 0)})
                  </Button>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setApproveOpen(false)}>Cancel</Button>
            <Button type="button" disabled={overLimit || approving} onClick={handleConfirmApprove}>
              {approving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Approve Loan
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

      {/* Add collateral */}
      <Dialog open={collateralDialogOpen} onOpenChange={setCollateralDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Collateral</DialogTitle>
            <DialogDescription>Record an item held against {loan.customers?.first_name} {loan.customers?.last_name}'s loan</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddCollateral} className="space-y-4">
            <div className="space-y-2">
              <Label>Type *</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={collateralForm.collateral_type}
                onChange={(e) => setCollateralForm({ ...collateralForm, collateral_type: e.target.value })}
                required
              >
                <option value="orcr">ORCR</option>
                <option value="bank_check">Bank Check</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Reference Number</Label>
              <Input value={collateralForm.reference_number} onChange={(e) => setCollateralForm({ ...collateralForm, reference_number: e.target.value })} placeholder="e.g. plate/chassis number or check number" />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input value={collateralForm.description} onChange={(e) => setCollateralForm({ ...collateralForm, description: e.target.value })} placeholder="e.g. 2019 Honda Click 125i, red" />
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea value={collateralForm.notes} onChange={(e) => setCollateralForm({ ...collateralForm, notes: e.target.value })} rows={3} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCollateralDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={savingCollateral}>
                {savingCollateral && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Release collateral */}
      <Dialog open={!!releaseTarget} onOpenChange={(open) => !open && setReleaseTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Release Collateral</DialogTitle>
            <DialogDescription>
              Confirm release of {releaseTarget ? collateralTypeLabel(releaseTarget.collateral_type) : ''} {releaseTarget?.reference_number ? `(${releaseTarget.reference_number})` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Released To *</Label>
            <Input value={releasedTo} onChange={(e) => setReleasedTo(e.target.value)} placeholder="Name of person receiving the item" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReleaseTarget(null)}>Cancel</Button>
            <Button disabled={!releasedTo.trim() || releasingCollateral} onClick={handleConfirmRelease}>
              {releasingCollateral && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Confirm Release
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
