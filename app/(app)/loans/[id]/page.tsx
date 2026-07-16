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

function formatVoucherDate(date: string | Date | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}`;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

// "24th day of June" style, used in the Loan Agreement's opening clause.
function formatOrdinalDate(date: string | Date | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  const month = d.toLocaleDateString('en-US', { month: 'long' });
  return `${ordinal(d.getDate())} day of ${month}`;
}

function formatLongDate(date: string | Date | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

// Loan Agreement & Disclosure Statement clauses — the exact 8-clause wording
// provided. Clause 8 is followed by a trailing unnumbered closing paragraph
// (AGREEMENT_CLOSING_PARAGRAPH) rendered right after the numbered list.
const AGREEMENT_CLAUSES = [
  {
    n: 1, title: 'Disclosure of Loan Terms',
    en: 'The Borrower certifies that prior to the release of the loan proceeds, the Borrower was fully informed and provided with the following information: a. Principal loan amount; b. Interest rate and method of computation; c. Service fees, processing fees, and other charges, if any; d. Documentary Stamp Tax and other government charges, if applicable; e. Penalty charges and surcharges for late payment; f. Payment schedule and maturity date; g. Total amount payable during the loan term; h. Net loan proceeds actually receivable by the Borrower. The Borrower confirms that the foregoing disclosures comply with the requirements of Republic Act No. 3765, otherwise known as the Truth in Lending Act.',
  },
  {
    n: 2, title: 'Receipt of Loan Proceeds',
    en: 'The Borrower acknowledges having personally received the net loan proceeds stated in the Cash Voucher and other loan documents. The Borrower certifies that the amount received is complete, correct, and satisfactory. The Cash Voucher, Loan Agreement, Kasunduan, and related loan documents shall constitute sufficient proof of the release and receipt of the loan proceeds.',
  },
  {
    n: 3, title: 'Verification of Amount Received',
    en: 'The Borrower agrees to immediately verify the amount of cash received upon release thereof. Upon signing the Cash Voucher and related loan documents, the Borrower confirms that no shortage, deficiency, or discrepancy exists in the amount received.',
  },
  {
    n: 4, title: 'Waiver of False or Fraudulent Claims',
    en: 'The Borrower agrees not to make any false, fraudulent, or misleading claim against the Corporation concerning the release, receipt, or amount of the loan proceeds after the execution of the loan documents. Any claim of non-receipt, shortage, or deficiency made after the signing of the loan documents shall be presumed invalid unless supported by clear and convincing evidence of fraud, bad faith, or willful misconduct on the part of the Corporation or its authorized representatives.',
  },
  {
    n: 5, title: 'Authority of Collectors and Representatives',
    en: 'The Borrower acknowledges that only duly authorized employees, collectors, or representatives of the Corporation may release loan proceeds and receive payments on behalf of the Corporation. The Borrower agrees to transact only with authorized personnel and to request official receipts or payment records for every payment made with existing VALID COMPANY ID.',
  },
  {
    n: 6, title: "Borrower's Duty to Keep Records",
    en: 'The Borrower agrees to keep copies of the Loan Agreement, Cash Voucher, Kasunduan, Acknowledgement Receipts, and other loan documents for future reference.',
  },
  {
    n: 7, title: 'Voluntary Execution',
    en: 'The Borrower certifies that the Borrower has read and understood the contents of the loan documents, had the opportunity to ask questions regarding the loan transaction, and voluntarily signed the same without force, intimidation, or undue influence.',
  },
  {
    n: 8, title: 'Entire Agreement',
    en: 'The Borrower acknowledges that the Loan Agreement, Cash Voucher, Kasunduan, and related documents constitute the complete agreement between the parties concerning the loan transaction.',
  },
];

const AGREEMENT_CLOSING_PARAGRAPH = 'The Borrower affirms that all information and documents submitted to the Corporation are true and correct. Any material misrepresentation or falsification shall constitute a ground for acceleration of the loan and the exercise of all legal remedies available to the Corporation. I acknowledge that my signature herein constitutes my conformity to all the terms and conditions stated in the loan documents and serves as evidence of my receipt of the loan proceeds and disclosure of all applicable charges and obligations.';

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
  const [renewForm, setRenewForm] = useState({ amount: '', interest_rate: '8', term_days: '60', release_date: '', first_payment: '' });
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
  const [voucherData, setVoucherData] = useState<any>(null);
  const [downloadingVoucher, setDownloadingVoucher] = useState(false);
  const [printingVoucher, setPrintingVoucher] = useState(false);
  const voucherPage1Ref = useRef<HTMLDivElement>(null);
  const voucherPage2Ref = useRef<HTMLDivElement>(null);
  const voucherPage3Ref = useRef<HTMLDivElement>(null);
  const [agreementData, setAgreementData] = useState<any>(null);
  const [printingAgreement, setPrintingAgreement] = useState(false);
  const [downloadingAgreement, setDownloadingAgreement] = useState(false);
  const agreementPage1Ref = useRef<HTMLDivElement>(null);
  const agreementPage2Ref = useRef<HTMLDivElement>(null);
  const [undertakingData, setUndertakingData] = useState<any>(null);
  const [printingUndertaking, setPrintingUndertaking] = useState(false);
  const [downloadingUndertaking, setDownloadingUndertaking] = useState(false);
  const undertakingPage1Ref = useRef<HTMLDivElement>(null);
  const undertakingPage2Ref = useRef<HTMLDivElement>(null);
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
        const isLast = i === collectionDays.length - 1;
        const scheduled = isLast ? Math.max(0, scheduledRemaining) : Math.min(segDaily, scheduledRemaining);
        scheduledRemaining = Math.max(0, scheduledRemaining - scheduled);

        const key = dateKey(day);
        const paid = chainPaidAmountByDate.get(key) ?? 0;

        if (day > today) {
          // Future day: always show the flat scheduled amount, never pre-stacked.
          map.set(key, { status: 'due', amount: scheduled });
          return;
        }

        // Today or past: apply carry so missed days stack forward.
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
      first_payment: '',
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
      offset_balance: Number(loan.remaining_balance) - Number(renewForm.first_payment || 0),
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

  // Builds the Loan Agreement & Disclosure Statement. "Collection Charges
  // (2%/month)" and the resulting "Total Amount Payable" are computed here
  // only for this document — they are NOT part of loan.total_payable or
  // any other calculation elsewhere in the app (which only adds interest,
  // not collection charges, to the principal). Flag if these should become
  // a real system-wide fee instead of a display-only figure.
  function buildAgreementData(approvedAtIso: string, approverName: string) {
    const isRenewal = !!loan.renewed_from_loan_id;
    const previousLoan = isRenewal ? chainLoans[chainLoans.length - 2] : null;
    const actualBalance = previousLoan ? Number(previousLoan.remaining_balance) : 0;
    const offsetBalance = Number(loan.offset_balance) || 0;
    // First Payment = the day-one collection, auto-settled out of the loan
    // proceeds at release. For a new loan that's the daily payment amount;
    // for a renewal it's the carried-over balance from the previous loan.
    const firstPayment = isRenewal ? actualBalance - offsetBalance : (Number(loan.daily_payment) || 0);
    const serviceFee = Number(loan.service_fee) || 0;

    const termMonths = Math.round((loan.term_days / 30) * 10) / 10;
    const collectionChargeRate = 2;
    const collectionCharges = Math.round(Number(loan.amount) * (collectionChargeRate / 100) * termMonths * 100) / 100;
    const totalAmountPayable = Number(loan.amount) + Number(loan.interest_amount) + collectionCharges;
    const totalDeduction = firstPayment + serviceFee + offsetBalance;
    const loanProceeds = Number(loan.amount) - totalDeduction;

    const addressParts = [loan.customers?.address, loan.customers?.barangay, loan.customers?.city, loan.customers?.province].filter(Boolean);
    const fullAddress = addressParts.join(', ');

    return {
      date: approvedAtIso,
      borrowerName: `${loan.customers?.first_name ?? ''} ${loan.customers?.last_name ?? ''}`.trim(),
      idNo: loan.customers?.government_id ?? '',
      residenceAddress: fullAddress,
      businessAddress: fullAddress,
      dueDate: loan.due_date,
      termMonths,
      amount: Number(loan.amount),
      interestRate: Number(loan.interest_rate),
      interestAmount: Number(loan.interest_amount),
      collectionChargeRate,
      collectionCharges,
      totalAmountPayable,
      firstPayment,
      serviceFee,
      offsetBalance,
      totalDeduction,
      loanProceeds,
      branchManagerName: approverName,
      branchName: loan.branches?.name ?? '',
      collectorName: loan.collectors?.profiles?.full_name ?? '',
    };
  }

  function openAgreement() {
    setAgreementData(buildAgreementData(loan.approved_at ?? new Date().toISOString(), loan.approved_by_profile?.full_name ?? ''));
  }

  async function handlePrintAgreement() {
    const refs = [agreementPage1Ref, agreementPage2Ref].filter(r => r.current);
    if (refs.length === 0) return;
    setPrintingAgreement(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const dataUrls: string[] = [];
      for (const ref of refs) {
        const canvas = await html2canvas(ref.current as HTMLDivElement, { backgroundColor: '#ffffff', scale: 2 });
        dataUrls.push(canvas.toDataURL('image/png'));
      }
      const printWindow = window.open('', '_blank', 'width=900,height=1000');
      if (!printWindow) {
        toast({ title: 'Print blocked', description: 'Please allow pop-ups for this site to print the agreement', variant: 'destructive' });
        setPrintingAgreement(false);
        return;
      }
      printWindow.document.write(`
        <html>
          <head><title>Loan Agreement ${loan.loan_number}</title></head>
          <body style="margin:0;padding:0;background:#fff;">
            ${dataUrls.map((url, i) => `<img src="${url}" style="width:100%;display:block;${i < dataUrls.length - 1 ? 'page-break-after:always;' : ''}" />`).join('')}
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.onload = () => printWindow.print();
      printWindow.onafterprint = () => printWindow.close();
    } catch (err: any) {
      toast({ title: 'Print failed', description: err?.message ?? 'Could not generate agreement for printing', variant: 'destructive' });
    }
    setPrintingAgreement(false);
  }

  async function handleDownloadAgreement() {
    const refs = [agreementPage1Ref, agreementPage2Ref].filter(r => r.current);
    if (refs.length === 0) return;
    setDownloadingAgreement(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const margin = 24;
      const usableWidth = pdf.internal.pageSize.getWidth() - margin * 2;
      const pxToPt = 0.75;

      for (let i = 0; i < refs.length; i++) {
        const canvas = await html2canvas(refs[i].current as HTMLDivElement, { backgroundColor: '#ffffff', scale: 2 });
        const imgData = canvas.toDataURL('image/png');
        const imgWidth = usableWidth;
        const imgHeight = ((canvas.height / 2) * pxToPt / ((canvas.width / 2) * pxToPt)) * imgWidth;
        if (i > 0) pdf.addPage();
        pdf.addImage(imgData, 'PNG', margin, margin, imgWidth, imgHeight);
      }
      pdf.save(`loan-agreement-${loan.loan_number}.pdf`);
    } catch (err: any) {
      toast({ title: 'Download failed', description: err?.message ?? 'Could not generate agreement PDF', variant: 'destructive' });
    }
    setDownloadingAgreement(false);
  }

  // Builds the data for the Borrower's Undertaking. This document is almost
  // entirely fixed legal text — only the borrower's name, address, and
  // signing date are dynamic.
  function buildUndertakingData(approvedAtIso: string) {
    const addressParts = [loan.customers?.address, loan.customers?.barangay, loan.customers?.city, loan.customers?.province].filter(Boolean);
    return {
      date: approvedAtIso,
      borrowerName: `${loan.customers?.first_name ?? ''} ${loan.customers?.last_name ?? ''}`.trim(),
      residenceAddress: addressParts.join(', '),
      branchManagerName: loan.approved_by_profile?.full_name ?? '',
      branchName: loan.branches?.name ?? '',
      collectorName: loan.collectors?.profiles?.full_name ?? '',
    };
  }

  function openUndertaking() {
    setUndertakingData(buildUndertakingData(loan.approved_at ?? new Date().toISOString()));
  }

  async function handlePrintUndertaking() {
    const refs = [undertakingPage1Ref, undertakingPage2Ref].filter(r => r.current);
    if (refs.length === 0) return;
    setPrintingUndertaking(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const dataUrls: string[] = [];
      for (const ref of refs) {
        const canvas = await html2canvas(ref.current as HTMLDivElement, { backgroundColor: '#ffffff', scale: 2 });
        dataUrls.push(canvas.toDataURL('image/png'));
      }
      const printWindow = window.open('', '_blank', 'width=900,height=1000');
      if (!printWindow) {
        toast({ title: 'Print blocked', description: 'Please allow pop-ups for this site to print the undertaking', variant: 'destructive' });
        setPrintingUndertaking(false);
        return;
      }
      printWindow.document.write(`
        <html>
          <head><title>Borrower's Undertaking ${loan.loan_number}</title></head>
          <body style="margin:0;padding:0;background:#fff;">
            ${dataUrls.map((url, i) => `<img src="${url}" style="width:100%;display:block;${i < dataUrls.length - 1 ? 'page-break-after:always;' : ''}" />`).join('')}
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.onload = () => printWindow.print();
      printWindow.onafterprint = () => printWindow.close();
    } catch (err: any) {
      toast({ title: 'Print failed', description: err?.message ?? 'Could not generate undertaking for printing', variant: 'destructive' });
    }
    setPrintingUndertaking(false);
  }

  async function handleDownloadUndertaking() {
    const refs = [undertakingPage1Ref, undertakingPage2Ref].filter(r => r.current);
    if (refs.length === 0) return;
    setDownloadingUndertaking(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const margin = 24;
      const usableWidth = pdf.internal.pageSize.getWidth() - margin * 2;
      const pxToPt = 0.75;

      for (let i = 0; i < refs.length; i++) {
        const canvas = await html2canvas(refs[i].current as HTMLDivElement, { backgroundColor: '#ffffff', scale: 2 });
        const imgData = canvas.toDataURL('image/png');
        const imgWidth = usableWidth;
        const imgHeight = ((canvas.height / 2) * pxToPt / ((canvas.width / 2) * pxToPt)) * imgWidth;
        if (i > 0) pdf.addPage();
        pdf.addImage(imgData, 'PNG', margin, margin, imgWidth, imgHeight);
      }
      pdf.save(`borrowers-undertaking-${loan.loan_number}.pdf`);
    } catch (err: any) {
      toast({ title: 'Download failed', description: err?.message ?? 'Could not generate undertaking PDF', variant: 'destructive' });
    }
    setDownloadingUndertaking(false);
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
      setAgreementData(buildAgreementData(now, profile?.full_name ?? ''));
      loadLoan();
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
      setAgreementData(buildAgreementData(now, profile?.full_name ?? ''));
      loadLoan();
    }
    setApproving(false);
  }

  // Builds the data for the 3-page Loan Release Cash Voucher / Cash Voucher /
  // Acknowledgement Receipt document. Works both right after disbursing
  // (loan.*_profile joins aren't reloaded yet, so falls back to the acting
  // profile) and later when reprinting (joins are populated from the DB).
  function buildVoucherData(voucherNumber: string, disbursedAtIso: string) {
    const isRenewal = !!loan.renewed_from_loan_id;
    const previousLoan = isRenewal ? chainLoans[chainLoans.length - 2] : null;
    const actualBalance = previousLoan ? Number(previousLoan.remaining_balance) : 0;
    const beginningBalance = Number(loan.offset_balance) || 0;
    const firstPayment = isRenewal ? actualBalance - beginningBalance : 0;

    return {
      voucherNumber,
      date: disbursedAtIso,
      isRenewal,
      loanNumber: loan.loan_number,
      borrowerName: `${loan.customers?.first_name ?? ''} ${loan.customers?.last_name ?? ''}`.trim(),
      netProceeds: Number(loan.release_amount),
      fieldCollectorName: loan.collectors?.profiles?.full_name ?? '',
      branchCashierName: loan.disbursed_by_profile?.full_name ?? profile?.full_name ?? '',
      branchManagerName: loan.approved_by_profile?.full_name ?? '',
      branchEncoderName: loan.created_by_profile?.full_name ?? '',
      branchName: loan.branches?.name ?? '',
      actualBalance,
      firstPayment,
      beginningBalance,
    };
  }

  async function openVoucher() {
    const { data: voucher } = await supabase.from('cash_vouchers').select('voucher_number').eq('loan_id', loan.id).maybeSingle();
    setVoucherData(buildVoucherData(voucher?.voucher_number ?? '—', loan.disbursed_at ?? new Date().toISOString()));
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
    } else {
      setVoucherData(buildVoucherData(voucherNumber, now));
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
    loadLoan();
    setDisbursing(false);
  }

  async function handlePrintVoucher() {
    const refs = [voucherPage1Ref, voucherPage2Ref, voucherPage3Ref].filter(r => r.current);
    if (refs.length === 0) return;
    setPrintingVoucher(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const dataUrls: string[] = [];
      for (const ref of refs) {
        const canvas = await html2canvas(ref.current as HTMLDivElement, { backgroundColor: '#ffffff', scale: 2 });
        dataUrls.push(canvas.toDataURL('image/png'));
      }
      const printWindow = window.open('', '_blank', 'width=900,height=1000');
      if (!printWindow) {
        toast({ title: 'Print blocked', description: 'Please allow pop-ups for this site to print the voucher', variant: 'destructive' });
        setPrintingVoucher(false);
        return;
      }
      printWindow.document.write(`
        <html>
          <head><title>Voucher ${voucherData?.voucherNumber ?? ''}</title></head>
          <body style="margin:0;padding:0;background:#fff;">
            ${dataUrls.map((url, i) => `<img src="${url}" style="width:100%;display:block;${i < dataUrls.length - 1 ? 'page-break-after:always;' : ''}" />`).join('')}
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.onload = () => printWindow.print();
      printWindow.onafterprint = () => printWindow.close();
    } catch (err: any) {
      toast({ title: 'Print failed', description: err?.message ?? 'Could not generate voucher for printing', variant: 'destructive' });
    }
    setPrintingVoucher(false);
  }

  async function handleDownloadVoucher() {
    const refs = [voucherPage1Ref, voucherPage2Ref, voucherPage3Ref].filter(r => r.current);
    if (refs.length === 0) return;
    setDownloadingVoucher(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const margin = 24;
      const usableWidth = pdf.internal.pageSize.getWidth() - margin * 2;
      const pxToPt = 0.75;

      for (let i = 0; i < refs.length; i++) {
        const canvas = await html2canvas(refs[i].current as HTMLDivElement, { backgroundColor: '#ffffff', scale: 2 });
        const imgData = canvas.toDataURL('image/png');
        const imgWidth = usableWidth;
        const imgHeight = ((canvas.height / 2) * pxToPt / ((canvas.width / 2) * pxToPt)) * imgWidth;
        if (i > 0) pdf.addPage();
        pdf.addImage(imgData, 'PNG', margin, margin, imgWidth, imgHeight);
      }
      pdf.save(`voucher-${voucherData?.voucherNumber ?? 'disbursement'}.pdf`);
    } catch (err: any) {
      toast({ title: 'Download failed', description: err?.message ?? 'Could not generate voucher PDF', variant: 'destructive' });
    }
    setDownloadingVoucher(false);
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
        {!isCashier && loan.status !== 'renewed' && loan.status !== 'declined' && (
          <Link href={`/payments?loan=${loan.id}`}>
            <Button size="sm">
              <Plus className="w-4 h-4 mr-2" />
              Post Payment
            </Button>
          </Link>
        )}
        {!isCashier && !isCollector && loan.status !== 'renewed' && (
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
          <Button size="sm" variant="outline" onClick={openVoucher}>
            <Banknote className="w-4 h-4 mr-2" />
            View Voucher
          </Button>
        )}
        {loan.approved_at && (
          <Button size="sm" variant="outline" onClick={openAgreement}>
            <FileText className="w-4 h-4 mr-2" />
            View Agreement
          </Button>
        )}
        {loan.approved_at && (
          <Button size="sm" variant="outline" onClick={openUndertaking}>
            <FileText className="w-4 h-4 mr-2" />
            View Undertaking
          </Button>
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
                <Label>First Payment Collected Now (₱)</Label>
                <Input type="number" value={renewForm.first_payment} onChange={(e) => setRenewForm({ ...renewForm, first_payment: e.target.value })} placeholder="0.00" />
                <p className="text-xs text-muted-foreground">
                  Old balance {formatCurrency(loan.remaining_balance)} minus this payment ={' '}
                  {formatCurrency(Number(loan.remaining_balance) - Number(renewForm.first_payment || 0))} beginning balance carried into the renewal — shown on the disbursement voucher.
                </p>
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

      {/* Loan disbursement documents: Loan Release Cash Voucher, Cash Voucher
          (Cashier -> Collector), Acknowledgement Receipt of Loan */}
      {voucherData && (() => {
        const vTable: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 12 };
        const vCell: React.CSSProperties = { border: '1px solid #000', padding: '6px 10px', verticalAlign: 'middle' };
        const vCellCenter: React.CSSProperties = { ...vCell, textAlign: 'center' };
        const vHeader: React.CSSProperties = { ...vCellCenter, fontWeight: 700 };
        const vItalic: React.CSSProperties = { ...vCellCenter, fontStyle: 'italic' };
        const vCheckbox = (checked: boolean) => (
          <span style={{ display: 'inline-block', width: 13, height: 13, border: '1px solid #000', textAlign: 'center', lineHeight: '12px', fontSize: 11, marginRight: 6 }}>
            {checked ? '✓' : ''}
          </span>
        );
        const pageStyle: React.CSSProperties = { width: 780, background: '#fff', color: '#111', padding: 32, fontFamily: 'Georgia, "Times New Roman", serif' };

        return (
          <Dialog open={!!voucherData} onOpenChange={(open) => !open && setVoucherData(null)}>
            <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Banknote className="w-5 h-5" />
                  Loan Disbursement Documents — {voucherData.voucherNumber}
                </DialogTitle>
                <DialogDescription>3 pages: Loan Release Cash Voucher, Cash Voucher, Acknowledgement Receipt of Loan</DialogDescription>
              </DialogHeader>

              <div className="space-y-6 flex flex-col items-center bg-secondary/30 p-4 rounded-lg">
                {/* PAGE 1 — Loan Release Cash Voucher */}
                <div ref={voucherPage1Ref} style={pageStyle}>
                  <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 18, color: '#0B1F3A', marginBottom: 12, textDecoration: 'underline' }}>
                    LOAN RELEASE CASH VOUCHER
                  </div>
                  <div style={{ display: 'flex', gap: 24, marginBottom: 10, fontSize: 13 }}>
                    <span>{vCheckbox(voucherData.isRenewal)}Renewal</span>
                    <span>{vCheckbox(!voucherData.isRenewal)}New Loan Account</span>
                  </div>
                  <table style={vTable}>
                    <tbody>
                      <tr><td style={vCell}>Date:</td><td style={vCell}>{formatVoucherDate(voucherData.date)}</td></tr>
                      <tr><td style={vHeader}>Name of Borrower</td><td style={vHeader}>Net Loan Proceeds</td></tr>
                      <tr><td style={vCellCenter}>{voucherData.borrowerName}</td><td style={vCellCenter}>{formatCurrency(voucherData.netProceeds)}</td></tr>
                      <tr><td style={vCell}>Disbursed by:</td><td style={vCell}>Received by:</td></tr>
                      <tr style={{ height: 40 }}><td style={vCell}>&nbsp;</td><td style={vCell}>&nbsp;</td></tr>
                      <tr><td style={vCellCenter}>{voucherData.fieldCollectorName}</td><td style={vCellCenter}>{voucherData.borrowerName}</td></tr>
                      <tr><td style={vItalic}>Field Collector</td><td style={vItalic}>Borrower</td></tr>
                    </tbody>
                  </table>

                  <p style={{ fontWeight: 700, fontSize: 12, marginTop: 16, textAlign: 'justify' }}>
                    I further certify that this Cash Voucher constitutes sufficient proof and evidence of my receipt of the net loan proceeds. I hereby waive any claim, demand, complaint, or action against 1125 Lending Corporation for any alleged cash shortage, deficiency, or non-receipt of the loan proceeds after the execution and signing of this document.
                  </p>
                  <p style={{ fontStyle: 'italic', fontSize: 11, textAlign: 'justify', color: '#333' }}>
                    (Pinatutunayan ko na ang Cash Voucher na ito ay sapat na katibayan at patunay na aking natanggap ang nitong halaga ng aking loan. Nauunawaan ko na hindi maari ang anumang paghahabol, reklamo, demanda, o anumang aksyon laban sa 1125 Lending Corporation kaugnay ng anumang kakulangan sa salapi, diperensya, o hindi pagtanggap ng loan proceeds matapos kong lagdaan at […])
                  </p>

                  <p style={{ fontWeight: 700, fontSize: 12, textAlign: 'justify' }}>
                    The amount of my loan shall be reflected in the Field Collector's Customer List together with the corresponding beginning balance. Attached hereto are copies of the Loan Agreement and Kasunduan, which shall serve as proof of the proper and lawful release of the loan proceeds by the duly authorized collectors of 1125 Lending Corporation.
                  </p>
                  <p style={{ fontStyle: 'italic', fontSize: 11, textAlign: 'justify', color: '#333' }}>
                    (Ang halaga ng aking loan ay makikita sa Customer List ng Field Collector kasama ang kaukulang panimulang balanse. Nakalakip dito ang mga kopya ng Loan Agreement at Kasunduan na magsisilbing patunay ng maayos, tama, at naaayon sa batas na pagpapalabas ng loan proceeds ng mga awtorisadong kolektor ng 1125 Lending Corporation.)
                  </p>

                  {voucherData.isRenewal && (
                    <table style={{ ...vTable, marginTop: 8 }}>
                      <tbody>
                        <tr><td colSpan={2} style={vHeader}>Amount of Loan</td></tr>
                        <tr>
                          <td style={{ ...vCell, fontStyle: 'italic' }}>Actual balance from the date of loan</td>
                          <td style={{ ...vCell, fontStyle: 'italic', textAlign: 'right' }}>{formatCurrency(voucherData.actualBalance)}</td>
                        </tr>
                        <tr>
                          <td style={vCell}>Less: First Payment</td>
                          <td style={{ ...vCell, textAlign: 'right' }}>{formatCurrency(voucherData.firstPayment)}</td>
                        </tr>
                        <tr>
                          <td style={{ ...vCell, fontWeight: 700 }}>Beginning Balance</td>
                          <td style={{ ...vCell, fontWeight: 700, textAlign: 'right' }}>{formatCurrency(voucherData.beginningBalance)}</td>
                        </tr>
                      </tbody>
                    </table>
                  )}

                  <p style={{ color: '#C00000', fontWeight: 700, fontSize: 12, marginTop: 14 }}>
                    Paalala sa mga customers ng 1125 Credit Collection Services:
                  </p>
                  <p style={{ fontSize: 11, textAlign: 'justify' }}>
                    Mangyaring itago ang Cash Voucher na ito at lahat ng kaugnay na dokumento ng inyong loan bilang inyong opisyal na rekord. Ugaliing humingi at suriin ang inyong resibo at kasaysayan ng pagbabayad mula sa inyong nakatalagang kolektor. Ang inyong lagda sa dokumentong ito ay nagpapatunay na natanggap ninyo ang netong halaga ng inyong loan proceeds.
                  </p>
                  <p style={{ fontSize: 11, textAlign: 'justify' }}>
                    Mahalagang humingi ng resibo sa bawat bayad na ginagawa para sa iyong loan upang maiwasan ang […]
                  </p>
                </div>

                {/* PAGE 2 — Cash Voucher (Branch Cashier -> Field Collector) */}
                <div ref={voucherPage2Ref} style={pageStyle}>
                  <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 18, color: '#0B1F3A', marginBottom: 16 }}>
                    1125 LENDING CORPORATION
                  </div>
                  <table style={vTable}>
                    <tbody>
                      <tr><td style={vCell}>Date:</td><td style={vCell}>{formatVoucherDate(voucherData.date)}</td></tr>
                      <tr><td style={vHeader}>Name of Borrower</td><td style={vHeader}>Net Proceeds</td></tr>
                      <tr><td style={vCellCenter}>{voucherData.borrowerName}</td><td style={vCellCenter}>{formatCurrency(voucherData.netProceeds)}</td></tr>
                      <tr><td style={vCell}>Disbursed by:</td><td style={vCell}>Received by:</td></tr>
                      <tr style={{ height: 40 }}><td style={vCell}>&nbsp;</td><td style={vCell}>&nbsp;</td></tr>
                      <tr><td style={vCellCenter}>{voucherData.branchCashierName}</td><td style={vCellCenter}>{voucherData.fieldCollectorName}</td></tr>
                      <tr><td style={vItalic}>Branch Cashier</td><td style={vItalic}>Field Collector</td></tr>
                    </tbody>
                  </table>
                </div>

                {/* PAGE 3 — Acknowledgement Receipt of Loan */}
                <div ref={voucherPage3Ref} style={pageStyle}>
                  <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 18, color: '#0B1F3A' }}>1125 LENDING CORPORATION</div>
                  <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 15, color: '#0B1F3A', marginBottom: 16 }}>ACKNOWLEDGEMENT RECEIPT OF LOAN</div>
                  <table style={vTable}>
                    <tbody>
                      <tr><td style={vCell}>Date of Receipt:</td><td style={vCell}>{formatVoucherDate(voucherData.date)}</td></tr>
                      <tr><td style={vCell}>Loan Received at:</td><td style={vCell}>{voucherData.branchName}</td></tr>
                      <tr><td style={vCell}>Assigned Field Collector:</td><td style={vCell}>{voucherData.fieldCollectorName}</td></tr>
                    </tbody>
                  </table>

                  <table style={{ ...vTable, marginTop: 8 }}>
                    <thead>
                      <tr>
                        <th style={vHeader}>Amount of Loan Proceeds Delivered</th>
                        <th style={vHeader}>Borrower's Name</th>
                        <th style={vHeader}>Signature</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td style={vCellCenter}>{formatCurrency(voucherData.netProceeds)}</td>
                        <td style={vCellCenter}>{voucherData.borrowerName}</td>
                        <td style={{ ...vCell, height: 40 }}>&nbsp;</td>
                      </tr>
                    </tbody>
                  </table>

                  <table style={{ ...vTable, marginTop: 8 }}>
                    <tbody>
                      <tr><td style={vCell}>Delivered by:</td><td style={vCell}>Verified by:</td><td style={vCell}>Prepared by</td></tr>
                      <tr>
                        <td style={vCellCenter}>{voucherData.fieldCollectorName}</td>
                        <td style={vCellCenter}>{voucherData.branchManagerName}</td>
                        <td style={vCellCenter}>{voucherData.branchEncoderName}</td>
                      </tr>
                      <tr><td style={vItalic}>Assigned Field Collector</td><td style={vItalic}>Branch Manager</td><td style={vItalic}>Branch Encoder</td></tr>
                    </tbody>
                  </table>

                  <p style={{ fontWeight: 700, fontSize: 12, marginTop: 16, textAlign: 'justify' }}>
                    I further certify that this Cash Voucher constitutes sufficient proof and evidence of my receipt of the net loan proceeds. I hereby waive any claim, demand, complaint, or action against 1125 Lending Corporation for any alleged cash shortage, deficiency, or non-receipt of the loan proceeds after the execution and signing of this document.
                  </p>
                  <p style={{ fontStyle: 'italic', fontSize: 11, textAlign: 'justify', color: '#333' }}>
                    (Pinatutunayan ko na ang Cash Voucher na ito ay sapat na katibayan at patunay na aking natanggap ang nitong halaga ng aking loan. Nauunawaan ko na hindi maari ang anumang paghahabol, reklamo, demanda, o anumang aksyon laban sa 1125 Lending Corporation kaugnay ng anumang kakulangan sa salapi, diperensya, o hindi pagtanggap ng loan proceeds matapos kong lagdaan at […])
                  </p>

                  <p style={{ fontWeight: 700, fontSize: 12, textAlign: 'justify' }}>
                    The amount of my loan shall be reflected in the Field Collector's Customer List together with the corresponding beginning balance. Attached hereto are copies of the Loan Agreement and Kasunduan, which shall serve as proof of the proper and lawful release of the loan proceeds by the duly authorized collectors of 1125 Lending Corporation.
                  </p>
                  <p style={{ fontStyle: 'italic', fontSize: 11, textAlign: 'justify', color: '#333' }}>
                    (Ang halaga ng aking loan ay makikita sa Customer List ng Field Collector kasama ang kaukulang panimulang balanse. Nakalakip dito ang mga kopya ng Loan Agreement at Kasunduan na magsisilbing patunay ng maayos, tama, at naaayon sa batas na pagpapalabas ng loan proceeds ng mga awtorisadong kolektor ng 1125 Lending Corporation.)
                  </p>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={handlePrintVoucher} disabled={printingVoucher}>
                  {printingVoucher && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Print
                </Button>
                <Button variant="outline" onClick={handleDownloadVoucher} disabled={downloadingVoucher}>
                  {downloadingVoucher ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                  Download PDF
                </Button>
                <Button onClick={() => setVoucherData(null)}>Close</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}

      {/* Loan Agreement & Disclosure Statement */}
      {agreementData && (() => {
        const aRow = (label: React.ReactNode, value: React.ReactNode, bold = true) => (
          <div style={{ display: 'flex', gap: 8, marginBottom: 2 }}>
            <span style={{ fontWeight: bold ? 700 : 400, minWidth: 190 }}>{label}</span>
            <span>{value}</span>
          </div>
        );
        const dTable: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8 };
        const dCell: React.CSSProperties = { padding: '3px 6px' };

        return (
          <Dialog open={!!agreementData} onOpenChange={(open) => !open && setAgreementData(null)}>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <FileText className="w-5 h-5" />
                  Loan Agreement & Disclosure Statement
                </DialogTitle>
                <DialogDescription>Generated automatically when a Branch Manager approves the loan</DialogDescription>
              </DialogHeader>

              <div className="flex flex-col items-center gap-4 bg-secondary/30 p-4 rounded-lg overflow-x-auto">
                <div ref={agreementPage1Ref} style={{ width: 780, minHeight: 1010, background: '#fff', color: '#111', padding: 32, fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 13 }}>
                  <div style={{ textAlign: 'center', borderBottom: '3px solid #0B7A3D', paddingBottom: 10, marginBottom: 16 }}>
                    <div style={{ fontWeight: 700, fontSize: 17, color: '#1F4E79' }}>1125 LENDING CORPORATION</div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#1F4E79' }}>NATIONAL HIWAY, LAYAC, DINALUPIHAN, BATAAN</div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#1F4E79' }}>CEL NO: 0950-931-9848</div>
                  </div>

                  <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 15, marginBottom: 16 }}>
                    LOAN AGREEMENT &amp; DISCLOSURE STATEMENT
                  </div>

                  <p style={{ textAlign: 'justify', marginBottom: 10 }}>
                    This Loan Agreement executed on the {formatOrdinalDate(agreementData.date)} by 1125 LENDING CORPORATION located at{' '}
                    <span style={{ textDecoration: 'underline' }}>155 National Hiway, Dinalupihan, Bataan</span> hereinafter referred to as the <strong>LENDER</strong>;
                  </p>
                  <p style={{ textAlign: 'center', fontWeight: 700, marginBottom: 10 }}>- AND -</p>

                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                    {aRow('Name of BORROWER', <span style={{ textDecoration: 'underline' }}>{agreementData.borrowerName}</span>)}
                    <span style={{ display: 'flex', gap: 8 }}><strong>ID NO:</strong> <span>{agreementData.idNo || '—'}</span></span>
                  </div>
                  {aRow('Residence Address:', agreementData.residenceAddress || '—')}
                  {aRow('Business Address:', agreementData.businessAddress || '—')}

                  <p style={{ fontWeight: 700, marginTop: 12, marginBottom: 2 }}>Loan Details:</p>
                  {aRow('Date of Loan:', formatLongDate(agreementData.date))}
                  {aRow(<>Loan Due Date: <em>({agreementData.termMonths}-month term)</em></>, formatLongDate(agreementData.dueDate))}

                  <table style={dTable}>
                    <tbody>
                      <tr><td style={{ ...dCell, fontWeight: 700 }}>Amount of Loan</td><td style={dCell} /><td style={{ ...dCell, textAlign: 'right' }} /><td style={{ ...dCell, textAlign: 'right', fontWeight: 700 }}>{formatCurrency(agreementData.amount)}</td></tr>
                      <tr>
                        <td style={{ ...dCell, fontWeight: 700 }}>Interest</td>
                        <td style={{ ...dCell, fontStyle: 'italic' }}>(with an interest rate of {agreementData.interestRate}% /month)</td>
                        <td style={{ ...dCell, textAlign: 'right' }}>{formatCurrency(agreementData.interestAmount)}</td>
                        <td style={dCell} />
                      </tr>
                      <tr>
                        <td style={{ ...dCell, fontWeight: 700 }}>Collection Charges</td>
                        <td style={{ ...dCell, fontStyle: 'italic' }}>({agreementData.collectionChargeRate}% per month)</td>
                        <td style={{ ...dCell, textAlign: 'right' }}>{formatCurrency(agreementData.collectionCharges)}</td>
                        <td style={dCell} />
                      </tr>
                      <tr>
                        <td style={{ ...dCell, fontWeight: 700, borderTop: '1px solid #000' }}>Total Amount Payable</td>
                        <td style={{ ...dCell, borderTop: '1px solid #000' }} />
                        <td style={{ ...dCell, textAlign: 'right', borderTop: '1px solid #000' }}>{formatCurrency(agreementData.totalAmountPayable)}</td>
                        <td style={{ ...dCell, borderTop: '1px solid #000' }} />
                      </tr>
                      <tr>
                        <td style={dCell} />
                        <td style={{ ...dCell, fontWeight: 700 }}>Less: First Payment</td>
                        <td style={{ ...dCell, textAlign: 'right' }}>{formatCurrency(agreementData.firstPayment)}</td>
                        <td style={dCell} />
                      </tr>
                      <tr>
                        <td style={dCell} />
                        <td style={{ ...dCell, fontWeight: 700, fontStyle: 'italic' }}>Service Fee (inclusive of DST)</td>
                        <td style={{ ...dCell, textAlign: 'right' }}>{formatCurrency(agreementData.serviceFee)}</td>
                        <td style={dCell} />
                      </tr>
                      <tr>
                        <td style={dCell} />
                        <td style={{ ...dCell, fontWeight: 700 }}>Offset Balance from previous loan</td>
                        <td style={{ ...dCell, textAlign: 'right' }}>{formatCurrency(agreementData.offsetBalance)}</td>
                        <td style={dCell} />
                      </tr>
                      <tr>
                        <td style={dCell} />
                        <td style={{ ...dCell, fontWeight: 700, borderTop: '1px solid #000' }}>Total Deduction</td>
                        <td style={dCell} />
                        <td style={{ ...dCell, textAlign: 'right', borderTop: '1px solid #000', fontWeight: 700 }}>{formatCurrency(agreementData.totalDeduction)}</td>
                      </tr>
                      <tr>
                        <td style={{ ...dCell, fontWeight: 700, borderTop: '2px solid #000' }}>Loan Proceeds:</td>
                        <td style={{ ...dCell, borderTop: '2px solid #000' }} />
                        <td style={{ ...dCell, borderTop: '2px solid #000' }} />
                        <td style={{ ...dCell, textAlign: 'right', borderTop: '2px solid #000', fontWeight: 700 }}>{formatCurrency(agreementData.loanProceeds)}</td>
                      </tr>
                    </tbody>
                  </table>

                  <p style={{ fontWeight: 700, marginTop: 16, marginBottom: 6 }}>The Borrower hereby represents, warrants, acknowledges, and agrees as follows:</p>

                  {AGREEMENT_CLAUSES.slice(0, 4).map(c => (
                    <p key={c.n} style={{ textAlign: 'justify', fontSize: 12, marginBottom: 10 }}>
                      <strong>{c.n}. {c.title}</strong> - {c.en}
                    </p>
                  ))}
                </div>

                <div ref={agreementPage2Ref} style={{ width: 780, minHeight: 1010, background: '#fff', color: '#111', padding: 32, fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 13 }}>
                  {AGREEMENT_CLAUSES.slice(4).map(c => (
                    <p key={c.n} style={{ textAlign: 'justify', fontSize: 12, marginBottom: 10 }}>
                      <strong>{c.n}. {c.title}</strong> - {c.en}
                    </p>
                  ))}

                  <p style={{ textAlign: 'justify', fontSize: 12, marginTop: 4, marginBottom: 40 }}>
                    {AGREEMENT_CLOSING_PARAGRAPH}
                  </p>

                  <div style={{ display: 'flex', justifyContent: 'space-between', textAlign: 'center', fontSize: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ textDecoration: 'underline', marginBottom: 4 }}>{agreementData.branchManagerName || ' '}</div>
                      <div style={{ fontStyle: 'italic' }}>Branch Manager{agreementData.branchName ? ` - ${agreementData.branchName} Branch` : ''}</div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ textDecoration: 'underline', marginBottom: 4 }}>{agreementData.collectorName || ' '}</div>
                      <div style={{ fontStyle: 'italic' }}>Assigned Collector</div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ textDecoration: 'underline', marginBottom: 4 }}>{agreementData.borrowerName || ' '}</div>
                      <div style={{ fontStyle: 'italic' }}>Borrower</div>
                    </div>
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={handlePrintAgreement} disabled={printingAgreement}>
                  {printingAgreement && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Print
                </Button>
                <Button variant="outline" onClick={handleDownloadAgreement} disabled={downloadingAgreement}>
                  {downloadingAgreement ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                  Download PDF
                </Button>
                <Button onClick={() => setAgreementData(null)}>Close</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}

      {/* Borrower's Undertaking */}
      {undertakingData && (
        <Dialog open={!!undertakingData} onOpenChange={(open) => !open && setUndertakingData(null)}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Borrower's Undertaking
              </DialogTitle>
              <DialogDescription>Kasunduan sa Pagkakautang bilang Borrower</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col items-center gap-4 bg-secondary/30 p-4 rounded-lg">
              <div ref={undertakingPage1Ref} style={{ width: 780, minHeight: 1010, background: '#fff', color: '#111', padding: 32, fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 13 }}>
                <div style={{ textAlign: 'center', borderBottom: '3px solid #0B7A3D', paddingBottom: 10, marginBottom: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: 17, color: '#1F4E79' }}>1125 LENDING CORPORATION</div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#1F4E79' }}>NATIONAL HIWAY, LAYAC, DINALUPIHAN, BATAAN</div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#1F4E79' }}>CEL NO: 0950-931-9848</div>
                </div>

                <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 15 }}>BORROWER'S UNDERTAKING</div>
                <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 13, marginBottom: 16 }}>(KASUNDUAN SA PAGKAKAUTANG BILANG BORROWER)</div>

                <p style={{ textAlign: 'justify', marginBottom: 12 }}>
                  I <span style={{ textDecoration: 'underline' }}>{undertakingData.borrowerName}</span> of legal age, residing at{' '}
                  <span style={{ textDecoration: 'underline' }}>{undertakingData.residenceAddress || '—'}</span> voluntarily agree to the following terms and conditions as a borrower of 1125 Lending Corporation.
                </p>

                {AGREEMENT_CLAUSES.slice(0, 5).map(c => (
                  <p key={c.n} style={{ textAlign: 'justify', fontSize: 12, marginBottom: 10 }}>
                    <strong>{c.n}. {c.title}</strong> - {c.en}
                  </p>
                ))}
              </div>

              <div ref={undertakingPage2Ref} style={{ width: 780, minHeight: 1010, background: '#fff', color: '#111', padding: 32, fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 13 }}>
                {AGREEMENT_CLAUSES.slice(5).map(c => (
                  <p key={c.n} style={{ textAlign: 'justify', fontSize: 12, marginBottom: 10 }}>
                    <strong>{c.n}. {c.title}</strong> - {c.en}
                  </p>
                ))}

                <p style={{ textAlign: 'justify', fontSize: 12, marginTop: 4, marginBottom: 20 }}>
                  {AGREEMENT_CLOSING_PARAGRAPH}
                </p>

                <p style={{ fontSize: 13, marginBottom: 32 }}>
                  IN WITNESS WHEREOF, the parties hereunto affix their signatures this <span style={{ textDecoration: 'underline' }}>{formatLongDate(undertakingData.date)}</span>
                </p>

                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                  <div style={{ width: 200, textAlign: 'center' }}>
                    <div style={{ textDecoration: 'underline', marginBottom: 4 }}>{undertakingData.branchManagerName || '—'}</div>
                    <div style={{ fontStyle: 'italic', fontSize: 12 }}>Branch Manager{undertakingData.branchName ? ` - ${undertakingData.branchName} Branch` : ''}</div>
                  </div>
                  <div style={{ width: 200, textAlign: 'center' }}>
                    <div style={{ textDecoration: 'underline', marginBottom: 4 }}>{undertakingData.collectorName || '—'}</div>
                    <div style={{ fontStyle: 'italic', fontSize: 12 }}>Assigned Collector</div>
                  </div>
                  <div style={{ width: 200, textAlign: 'center' }}>
                    <div style={{ textDecoration: 'underline', marginBottom: 4 }}>{undertakingData.borrowerName}</div>
                    <div style={{ fontStyle: 'italic', fontSize: 12 }}>Borrower</div>
                  </div>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handlePrintUndertaking} disabled={printingUndertaking}>
                {printingUndertaking && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Print
              </Button>
              <Button variant="outline" onClick={handleDownloadUndertaking} disabled={downloadingUndertaking}>
                {downloadingUndertaking ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                Download PDF
              </Button>
              <Button onClick={() => setUndertakingData(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

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
