'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
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
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency, formatDate, formatTime, generateORNumber, exportToCSV } from '@/lib/format';
import { postJournalEntry } from '@/lib/ledger';
import { connectThermalPrinter, buildPaymentReceiptLines, buildReceiptBytes, writeToPrinter } from '@/lib/thermal-printer';
import {
  Wallet, Plus, Search, Download, Loader2, MapPin, Receipt, Calculator, Bluetooth, Pencil, Trash2,
} from 'lucide-react';

// Collection days = every day in [releaseDate, dueDate] except Sunday —
// matches the same convention used for the loan's own payment calendar.
function countCollectionDays(releaseDate: string | null, dueDate: string | null): number {
  if (!releaseDate || !dueDate) return 0;
  const start = new Date(releaseDate);
  const end = new Date(dueDate);
  let count = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (d.getDay() !== 0) count++;
  }
  return count;
}

export default function PaymentsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { profile } = useAuth();
  const isAdmin = profile?.role_name === 'Administrator';
  const isCollector = profile?.role_name === 'Branch Field Collector';
  const [editTarget, setEditTarget] = useState<any>(null);
  const [editForm, setEditForm] = useState({ amount_paid: '', payment_date: '' });
  const [editSaving, setEditSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [deleting, setDeleting] = useState(false);
  const [myCollector, setMyCollector] = useState<{ id: string; branch_id: string | null; area_id: string | null } | null>(null);
  const { toast } = useToast();
  const [payments, setPayments] = useState<any[]>([]);
  const [loans, setLoans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [customerFilter, setCustomerFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [receiptData, setReceiptData] = useState<any>(null);
  const [downloadingReceipt, setDownloadingReceipt] = useState(false);
  const [generatingInvoice, setGeneratingInvoice] = useState(false);
  const [printingThermal, setPrintingThermal] = useState(false);
  const receiptRef = useRef<HTMLDivElement>(null);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationAddress, setLocationAddress] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const pageSize = 10;

  // Same GPS + reverse-geocode pattern as Attendance — captures where the
  // payment was actually collected, using the free Nominatim (OSM) API.
  function requestLocation() {
    setLocationError(null);
    if (!navigator.geolocation) {
      setLocationError('This browser does not support location capture.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setLocation(coords);
        const address = await reverseGeocode(coords.lat, coords.lng);
        setLocationAddress(address);
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        if (err.code === err.PERMISSION_DENIED) {
          setLocationError('Location permission denied — enable it in your browser\'s site settings to include location on receipts.');
        } else if (err.code === err.TIMEOUT) {
          setLocationError('Location request timed out. Try again.');
        } else {
          setLocationError('Could not determine your location.');
        }
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14&addressdetails=1`,
        { headers: { 'Accept-Language': 'en' } }
      );
      if (!res.ok) return null;
      const data = await res.json();
      const addr = data.address ?? {};
      const city = addr.city ?? addr.town ?? addr.municipality ?? addr.village ?? addr.city_district ?? null;
      const province = addr.province ?? addr.state ?? addr.state_district ?? addr.county ?? null;
      const parts = [city, province].filter(Boolean);
      return parts.length > 0 ? parts.join(', ') : (data.display_name ?? null);
    } catch {
      return null;
    }
  }

  function openPostCollection() {
    setLocation(null);
    setLocationAddress(null);
    requestLocation();
    setDialogOpen(true);
  }

  async function handlePrintThermal() {
    if (!receiptData) return;
    setPrintingThermal(true);
    try {
      const characteristic = await connectThermalPrinter();
      const lines = buildPaymentReceiptLines({
        orNumber: receiptData.orNumber,
        dateText: formatDate(receiptData.date),
        timeText: receiptData.time ? formatTime(new Date(`${receiptData.date}T${receiptData.time}`)) : undefined,
        loanNumber: receiptData.loanNumber,
        releaseDateText: receiptData.releaseDate ? formatDate(receiptData.releaseDate) : undefined,
        dueDateText: receiptData.dueDate ? formatDate(receiptData.dueDate) : undefined,
        customerName: receiptData.customerName,
        branchName: receiptData.branchName ?? undefined,
        locationText: receiptData.currentAddress ?? undefined,
        collectorName: receiptData.collectorName ?? undefined,
        amountPaid: formatCurrency(receiptData.amount),
        daysCoveredText: receiptData.isFullyPaid
          ? 'Loan fully paid'
          : (receiptData.daysCovered > 0
            ? `Covers ${receiptData.daysCovered} day${receiptData.daysCovered > 1 ? 's' : ''} of payment`
            : undefined),
        remainingBalance: formatCurrency(receiptData.remainingBalance),
      });
      await writeToPrinter(characteristic, buildReceiptBytes(lines));
      toast({ title: 'Sent to printer', description: 'Receipt sent to the Bluetooth thermal printer.' });
    } catch (err: any) {
      toast({ title: 'Bluetooth print failed', description: err?.message ?? 'Could not print to the Bluetooth printer', variant: 'destructive' });
    }
    setPrintingThermal(false);
  }

  async function handleDownloadReceipt() {
    if (!receiptRef.current) return;
    setDownloadingReceipt(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(receiptRef.current, { backgroundColor: '#ffffff', scale: 2 });
      const link = document.createElement('a');
      link.download = `receipt-${receiptData?.orNumber ?? 'payment'}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err: any) {
      toast({ title: 'Download failed', description: err?.message ?? 'Could not generate receipt image', variant: 'destructive' });
    }
    setDownloadingReceipt(false);
  }

  async function handleDownloadInvoice() {
    if (!receiptRef.current) return;
    setGeneratingInvoice(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const { jsPDF } = await import('jspdf');
      const canvas = await html2canvas(receiptRef.current, { backgroundColor: '#ffffff', scale: 2 });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: [canvas.width, canvas.height] });
      pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
      pdf.save(`invoice-${receiptData?.orNumber ?? 'payment'}.pdf`);
    } catch (err: any) {
      toast({ title: 'Invoice generation failed', description: err?.message ?? 'Could not generate invoice PDF', variant: 'destructive' });
    }
    setGeneratingInvoice(false);
  }

  const [form, setForm] = useState({
    loan_id: searchParams.get('loan') ?? '',
    amount_paid: '',
    payment_date: new Date().toISOString().split('T')[0],
    notes: '',
  });

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
    loadPayments();
    loadLoans();
  }, [profile, myCollector, search, page, customerFilter]);

  const autoOpenedRef = useRef(false);
  useEffect(() => {
    const loanId = searchParams.get('loan');
    if (loanId && loans.length > 0 && !autoOpenedRef.current) {
      autoOpenedRef.current = true;
      if (loans.some(l => l.id === loanId)) {
        handleLoanSelect(loanId);
        setDialogOpen(true);
      } else {
        toast({
          title: 'Loan not ready for payment',
          description: 'This loan must be disbursed by a Cashier before payments can be posted.',
          variant: 'destructive',
        });
      }
    }
  }, [loans]);

  async function loadLoans() {
    let query = supabase
      .from('loans')
      .select('id, loan_number, remaining_balance, status, total_payable, term_days, daily_payment, release_date, due_date, customer_id, collector_id, customers(first_name, last_name, phone), branches(name), areas(name), collectors(profiles(full_name))')
      .in('status', ['active', 'overdue'])
      .order('loan_number');
    if (isCollector) {
      query = query.eq('collector_id', myCollector?.id ?? '00000000-0000-0000-0000-000000000000');
    }
    const { data } = await query;
    setLoans(data ?? []);
  }

  function handleLoanSelect(loanId: string) {
    const loan = loans.find(l => l.id === loanId);
    const dailyAmount = loan
      ? (loan.daily_payment != null && Number(loan.daily_payment) > 0
          ? Number(loan.daily_payment)
          : (loan.term_days > 0 ? Math.round((loan.total_payable / loan.term_days) * 100) / 100 : 0))
      : 0;
    setForm({ ...form, loan_id: loanId, amount_paid: dailyAmount ? String(dailyAmount) : '' });
  }

  async function loadPayments() {
    setLoading(true);
    let query = supabase
      .from('payments')
      .select('*, loans(loan_number, release_date, due_date, customers(first_name, last_name, phone), branches(name), areas(name)), collectors(profiles(full_name)), receipts(or_number)');

    if (search) {
      query = query.or(`loans.loan_number.ilike.%${search}%`);
    }
    if (isCollector) {
      query = query.eq('collector_id', myCollector?.id ?? '00000000-0000-0000-0000-000000000000');
    }
    if (customerFilter !== 'all') {
      query = query.eq('customer_id', customerFilter);
    }

    query = query.order('created_at', { ascending: false });
    const { data } = await query;

    // Collapse to one row per loan (its most recent payment) — the full
    // history for a loan is available by clicking into its row.
    const seenLoans = new Set<string>();
    const latestPerLoan: any[] = [];
    for (const p of data ?? []) {
      if (p.loan_id) {
        if (seenLoans.has(p.loan_id)) continue;
        seenLoans.add(p.loan_id);
      }
      latestPerLoan.push(p);
    }

    setTotal(latestPerLoan.length);
    setPayments(latestPerLoan.slice((page - 1) * pageSize, page * pageSize));
    setLoading(false);
  }

  function openEditPayment(p: any) {
    setEditTarget(p);
    setEditForm({ amount_paid: String(p.amount_paid), payment_date: p.payment_date });
  }

  // This table only ever shows the most recent payment per loan (see the
  // collapse above), so editing/deleting the row shown here can never
  // desync an older payment's stored "balance after" snapshot — there is no
  // later payment on the loan whose numbers would be invalidated.
  async function handleEditPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!editTarget) return;
    setEditSaving(true);

    const { data: loan } = await supabase.from('loans').select('remaining_balance, status').eq('id', editTarget.loan_id).maybeSingle();
    const oldAmount = Number(editTarget.amount_paid);
    const newAmount = Number(editForm.amount_paid);
    const delta = newAmount - oldAmount;
    const currentBalance = Number(loan?.remaining_balance ?? 0);
    const newLoanBalance = Math.max(0, currentBalance - delta);

    const { error: payError } = await supabase.from('payments').update({
      amount_paid: newAmount,
      payment_date: editForm.payment_date,
      remaining_balance: newLoanBalance,
    }).eq('id', editTarget.id);

    if (payError) {
      toast({ title: 'Error', description: payError.message, variant: 'destructive' });
      setEditSaving(false);
      return;
    }

    if (editTarget.receipt_id) {
      await supabase.from('receipts').update({
        amount: newAmount,
        payment_date: editForm.payment_date,
        remaining_balance: newLoanBalance,
      }).eq('id', editTarget.receipt_id);
    }

    await supabase.from('loans').update({
      remaining_balance: newLoanBalance,
      status: newLoanBalance === 0 ? 'paid' : (loan?.status === 'paid' ? 'active' : loan?.status),
    }).eq('id', editTarget.loan_id);

    toast({ title: 'Payment updated' });
    setEditTarget(null);
    setEditSaving(false);
    loadPayments();
    loadLoans();
  }

  async function handleDeletePayment() {
    if (!deleteTarget) return;
    setDeleting(true);

    const { data: loan } = await supabase.from('loans').select('remaining_balance, status').eq('id', deleteTarget.loan_id).maybeSingle();
    const restoredBalance = Number(loan?.remaining_balance ?? 0) + Number(deleteTarget.amount_paid);

    const { error } = await supabase.from('payments').delete().eq('id', deleteTarget.id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      setDeleting(false);
      return;
    }

    if (deleteTarget.receipt_id) {
      await supabase.from('receipts').delete().eq('id', deleteTarget.receipt_id);
    }

    await supabase.from('loans').update({
      remaining_balance: restoredBalance,
      status: loan?.status === 'paid' ? 'active' : loan?.status,
    }).eq('id', deleteTarget.loan_id);

    toast({ title: 'Payment deleted' });
    setDeleteTarget(null);
    setDeleting(false);
    loadPayments();
    loadLoans();
  }

  const customerOptions = Array.from(
    new Map(
      loans
        .filter(l => l.customer_id)
        .map(l => [l.customer_id, `${l.customers?.first_name} ${l.customers?.last_name}`])
    ).entries()
  );

  const selectedLoan = loans.find(l => l.id === form.loan_id);
  const newBalance = selectedLoan ? Math.max(0, Number(selectedLoan.remaining_balance) - Number(form.amount_paid || 0)) : 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.loan_id || !form.amount_paid || !locationAddress) return;
    setSaving(true);

    const orNumber = generateORNumber();
    const paymentDate = form.payment_date || new Date().toISOString().split('T')[0];
    const now = new Date();

    // Create receipt first
    const { data: receipt, error: receiptError } = await supabase.from('receipts').insert({
      or_number: orNumber,
      loan_id: form.loan_id,
      customer_id: selectedLoan?.customer_id ?? null,
      collector_id: selectedLoan?.collector_id ?? null,
      amount: Number(form.amount_paid),
      remaining_balance: newBalance,
      payment_date: paymentDate,
      qr_data: JSON.stringify({ or: orNumber, loan: selectedLoan?.loan_number, amount: form.amount_paid }),
    }).select().single();

    if (receiptError) {
      toast({ title: 'Error', description: receiptError.message, variant: 'destructive' });
      setSaving(false);
      return;
    }

    // Create payment
    const { error: payError } = await supabase.from('payments').insert({
      loan_id: form.loan_id,
      customer_id: selectedLoan?.customer_id ?? null,
      collector_id: selectedLoan?.collector_id ?? null,
      receipt_id: receipt.id,
      amount_paid: Number(form.amount_paid),
      principal: 0,
      interest: 0,
      penalty: 0,
      remaining_balance: newBalance,
      payment_date: paymentDate,
      payment_time: now.toTimeString().split(' ')[0],
      gps_lat: location?.lat ?? null,
      gps_lng: location?.lng ?? null,
      location_address: locationAddress ?? null,
      notes: form.notes || null,
    });

    if (payError) {
      toast({ title: 'Error', description: payError.message, variant: 'destructive' });
      setSaving(false);
      return;
    }

    // Update loan balance
    await supabase.from('loans').update({
      remaining_balance: newBalance,
      status: newBalance === 0 ? 'paid' : selectedLoan?.status,
    }).eq('id', form.loan_id);

    // Auto-post to the general ledger. Simplified: the whole payment reduces
    // the receivable — the split into principal/interest/penalty isn't
    // tracked at post time yet (those columns are always inserted as 0
    // above), so this doesn't separately credit Interest/Penalty Income.
    postJournalEntry({
      entryDate: paymentDate,
      description: `Payment received — ${selectedLoan?.loan_number ?? ''} (OR ${orNumber})`,
      reference: orNumber,
      source: 'payment',
      sourceId: receipt.id,
      createdBy: profile?.id ?? null,
      lines: [
        { accountCode: '1000', debit: Number(form.amount_paid), memo: 'Cash collected' },
        { accountCode: '1100', credit: Number(form.amount_paid), memo: 'Loans Receivable reduced' },
      ],
    });

    toast({ title: 'Success', description: `Payment posted. OR: ${orNumber}` });

    const dailyDue = selectedLoan
      ? (selectedLoan.daily_payment != null && Number(selectedLoan.daily_payment) > 0
          ? Number(selectedLoan.daily_payment)
          : (selectedLoan.term_days > 0 ? selectedLoan.total_payable / selectedLoan.term_days : 0))
      : 0;
    const amountPaidNum = Number(form.amount_paid);
    // "Days covered" only makes sense up to what was actually still owed —
    // dividing the raw amount paid by the daily rate could claim far more
    // days than the loan's own term once the loan is at or near payoff
    // (e.g. a final lump-sum payment reads as "98 days" on a 30-day loan).
    // Cap the days/credit math at the balance that existed before this
    // payment, and treat anything beyond that as the loan being settled.
    const balanceBeforePayment = selectedLoan ? Number(selectedLoan.remaining_balance) : 0;
    const appliedTowardSchedule = Math.min(amountPaidNum, balanceBeforePayment);
    const rawDaysCovered = dailyDue > 0 ? Math.floor((appliedTowardSchedule + 0.001) / dailyDue) : 0;
    // A lump-sum payment can be large enough that amount/dailyRate works out
    // to more days than the loan's own term even has — dividing pesos by
    // the daily rate alone doesn't know the term has an upper bound (e.g. a
    // 30-day loan showing "covers 98 days"). Cap it at however many actual
    // collection days (every day except Sunday) exist in the term.
    const totalCollectionDays = selectedLoan ? countCollectionDays(selectedLoan.release_date, selectedLoan.due_date) : 0;
    const daysCovered = totalCollectionDays > 0 ? Math.min(rawDaysCovered, totalCollectionDays) : rawDaysCovered;
    const advanceCredit = dailyDue > 0 ? Math.max(0, Math.round((appliedTowardSchedule - daysCovered * dailyDue) * 100) / 100) : 0;
    const isFullyPaid = newBalance <= 0.009;

    setReceiptData({
      orNumber,
      loanNumber: selectedLoan?.loan_number,
      releaseDate: selectedLoan?.release_date ?? null,
      dueDate: selectedLoan?.due_date ?? null,
      customerName: selectedLoan ? `${selectedLoan.customers?.first_name} ${selectedLoan.customers?.last_name}` : '',
      customerPhone: selectedLoan?.customers?.phone ?? null,
      currentAddress: locationAddress,
      gpsLat: location?.lat ?? null,
      gpsLng: location?.lng ?? null,
      branchName: selectedLoan?.branches?.name ?? null,
      areaName: selectedLoan?.areas?.name ?? null,
      collectorName: selectedLoan?.collectors?.profiles?.full_name ?? null,
      amount: amountPaidNum,
      remainingBalance: newBalance,
      date: paymentDate,
      time: now.toTimeString().split(' ')[0],
      dailyDue,
      daysCovered,
      advanceCredit,
      isFullyPaid,
    });

    setForm({ ...form, loan_id: '', amount_paid: '', payment_date: new Date().toISOString().split('T')[0], notes: '' });
    setDialogOpen(false);
    setSaving(false);
    loadPayments();
  }

  function handleExport() {
    exportToCSV(
      payments.map(p => ({
        Date: p.payment_date,
        LoanNumber: p.loans?.loan_number ?? '',
        Customer: p.loans ? `${p.loans.customers?.first_name} ${p.loans.customers?.last_name}` : '',
        Amount: p.amount_paid,
        Principal: p.principal,
        Interest: p.interest,
        Penalty: p.penalty,
        Balance: p.remaining_balance,
        OR: p.receipts?.or_number ?? '',
      })),
      'payments.csv'
    );
  }

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-6">
      <PageHeader title="Payment Collection" description="Post collections and generate official receipts">
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="w-4 h-4 mr-2" />
          Export
        </Button>
        {profile?.role_name !== 'Cashier' && (
          <Button size="sm" onClick={openPostCollection}>
            <Plus className="w-4 h-4 mr-2" />
            Post Collection
          </Button>
        )}
      </PageHeader>

      {/* Filters */}
      <Card className="glass-card border-border">
        <CardContent className="p-4 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by loan number..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="pl-10"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Customer</Label>
            <Select value={customerFilter} onValueChange={(v) => { setCustomerFilter(v); setPage(1); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Customers</SelectItem>
                {customerOptions.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="glass-card border-border">
        <CardContent className="p-0">
          {loading ? (
            <div className="py-16 text-center"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto" /></div>
          ) : payments.length === 0 ? (
            <div className="py-16 text-center">
              <Wallet className="w-12 h-12 text-muted-foreground/50 mb-3 mx-auto" />
              <p className="text-sm text-muted-foreground">No payments recorded</p>
            </div>
          ) : (
          <>
          {/* Mobile card list */}
          <div className="md:hidden divide-y divide-border">
            {payments.map(p => (
              <div key={p.id} className="p-4 active:bg-secondary/50 cursor-pointer" onClick={() => router.push(`/payments/${p.loan_id}`)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{p.loans?.loan_number ?? '—'}</p>
                    <p className="text-xs text-muted-foreground truncate">{p.loans ? `${p.loans.customers?.first_name} ${p.loans.customers?.last_name}` : '—'}</p>
                  </div>
                  <p className="text-sm font-medium text-success shrink-0">{formatCurrency(p.amount_paid)}</p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div><p className="text-xs text-muted-foreground">Date</p><p>{formatDate(p.payment_date)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Collector</p><p className="truncate">{p.collectors?.profiles?.full_name ?? '—'}</p></div>
                  <div><p className="text-xs text-muted-foreground">Balance</p><p>{formatCurrency(p.remaining_balance)}</p></div>
                  <div><p className="text-xs text-muted-foreground">OR #</p><p>{p.receipts?.or_number ?? '—'}</p></div>
                </div>
                <div className="mt-3 flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setReceiptData({
                        orNumber: p.receipts?.or_number ?? '—',
                        loanNumber: p.loans?.loan_number ?? '—',
                        releaseDate: p.loans?.release_date ?? null,
                        dueDate: p.loans?.due_date ?? null,
                        customerName: p.loans ? `${p.loans.customers?.first_name} ${p.loans.customers?.last_name}` : '—',
                        customerPhone: p.loans?.customers?.phone ?? null,
                        currentAddress: p.location_address ?? null,
                        gpsLat: p.gps_lat ?? null,
                        gpsLng: p.gps_lng ?? null,
                        branchName: p.loans?.branches?.name ?? null,
                        areaName: p.loans?.areas?.name ?? null,
                        collectorName: p.collectors?.profiles?.full_name ?? null,
                        amount: Number(p.amount_paid),
                        remainingBalance: Number(p.remaining_balance),
                        date: p.payment_date,
                        time: p.payment_time ?? null,
                      });
                    }}
                  >
                    <Receipt className="w-3.5 h-3.5 mr-1.5" />Receipt
                  </Button>
                  {isAdmin && (
                    <>
                      <Button variant="outline" size="sm" onClick={() => openEditPayment(p)}>
                        <Pencil className="w-3.5 h-3.5 mr-1.5" />Edit
                      </Button>
                      <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteTarget(p)}>
                        <Trash2 className="w-3.5 h-3.5 mr-1.5" />Delete
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          <Table className="hidden md:table">
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Loan #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Collector</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Balance</TableHead>
                <TableHead>OR #</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map(p => (
                <TableRow key={p.id} className="hover:bg-secondary/50 cursor-pointer" onClick={() => router.push(`/payments/${p.loan_id}`)}>
                  <TableCell className="text-sm">{formatDate(p.payment_date)}</TableCell>
                  <TableCell className="font-medium text-sm">{p.loans?.loan_number ?? '—'}</TableCell>
                  <TableCell className="text-sm">{p.loans ? `${p.loans.customers?.first_name} ${p.loans.customers?.last_name}` : '—'}</TableCell>
                  <TableCell className="text-sm">{p.collectors?.profiles?.full_name ?? '—'}</TableCell>
                  <TableCell className="text-sm font-medium text-success">{formatCurrency(p.amount_paid)}</TableCell>
                  <TableCell className="text-sm">{formatCurrency(p.remaining_balance)}</TableCell>
                  <TableCell className="text-sm">{p.receipts?.or_number ?? '—'}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        setReceiptData({
                          orNumber: p.receipts?.or_number ?? '—',
                          loanNumber: p.loans?.loan_number ?? '—',
                          releaseDate: p.loans?.release_date ?? null,
                          dueDate: p.loans?.due_date ?? null,
                          customerName: p.loans ? `${p.loans.customers?.first_name} ${p.loans.customers?.last_name}` : '—',
                          customerPhone: p.loans?.customers?.phone ?? null,
                          currentAddress: p.location_address ?? null,
                          gpsLat: p.gps_lat ?? null,
                          gpsLng: p.gps_lng ?? null,
                          branchName: p.loans?.branches?.name ?? null,
                          areaName: p.loans?.areas?.name ?? null,
                          collectorName: p.collectors?.profiles?.full_name ?? null,
                          amount: Number(p.amount_paid),
                          remainingBalance: Number(p.remaining_balance),
                          date: p.payment_date,
                          time: p.payment_time ?? null,
                        });
                      }}
                    >
                      <Receipt className="w-4 h-4" />
                    </Button>
                    {isAdmin && (
                      <>
                        <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); openEditPayment(p); }}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setDeleteTarget(p); }}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </>
          )}
          {!loading && payments.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 border-t border-border">
              <p className="text-sm text-muted-foreground">
                Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Post Collection Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Post Collection</DialogTitle>
            <DialogDescription>Record a payment and generate an official receipt</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Loan *</Label>
              <Select value={form.loan_id} onValueChange={handleLoanSelect} required>
                <SelectTrigger><SelectValue placeholder="Select loan" /></SelectTrigger>
                <SelectContent>
                  {loans.map(l => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.loan_number} — {l.customers?.first_name} {l.customers?.last_name} (Bal: {formatCurrency(l.remaining_balance)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedLoan && (
              <div className="p-3 rounded-lg bg-secondary/50 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Current Balance:</span><span className="font-medium">{formatCurrency(selectedLoan.remaining_balance)}</span></div>
              </div>
            )}

            <div className="space-y-2">
              <Label>Amount Paid (₱) *</Label>
              <Input type="number" required value={form.amount_paid} onChange={(e) => setForm({ ...form, amount_paid: e.target.value })} placeholder="0.00" />
              {selectedLoan && (
                <p className="text-xs text-muted-foreground">Defaulted to the daily payment amount — adjust if the customer paid a different amount.</p>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input type="date" value={form.payment_date} disabled className="bg-muted" />
              </div>
              <div className="space-y-2">
                <Label>Time</Label>
                <Input value={new Date().toLocaleTimeString('en-PH', { timeStyle: 'short' })} disabled className="bg-muted" />
              </div>
            </div>

            <div className={`flex items-center gap-2 text-xs ${locationError ? 'text-destructive' : 'text-muted-foreground'}`}>
              <MapPin className="w-3.5 h-3.5 shrink-0" />
              <span className="flex-1">
                {locating ? 'Capturing current location…' : locationAddress ? locationAddress : (locationError ?? 'Location is required before posting a payment.')}
              </span>
              {!locating && (
                <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs shrink-0" onClick={requestLocation}>
                  Retry
                </Button>
              )}
            </div>

            {form.amount_paid && selectedLoan && (
              <div className="p-3 rounded-lg bg-primary/5 border border-border">
                <div className="flex items-center gap-2 text-sm font-medium text-primary mb-1">
                  <Calculator className="w-4 h-4" />
                  New Remaining Balance: {formatCurrency(newBalance)}
                </div>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving || !form.loan_id || !form.amount_paid || !locationAddress}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Post & Generate Receipt
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Receipt preview */}
      {receiptData && (
        <Dialog open={!!receiptData} onOpenChange={(open) => !open && setReceiptData(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Receipt className="w-5 h-5" />
                Acknowledgement Receipt
              </DialogTitle>
              <div className="flex justify-center">
                <span
                  className="text-xs font-bold px-3 py-1 rounded-full"
                  style={{ color: '#16A34A', backgroundColor: '#DCFCE7', border: '1px solid #16A34A' }}
                >
                  PAID
                </span>
              </div>
            </DialogHeader>
            <div ref={receiptRef} className="p-6 rounded-xl border-2 border-gray-200" style={{ backgroundColor: '#ffffff', color: '#111827' }}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-xl bg-white border border-gray-200 flex items-center justify-center overflow-hidden shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/image/1125_Corp_Logo.png" alt="1125Corp" width={48} height={48} style={{ objectFit: 'contain' }} />
                </div>
                <h2 className="text-lg font-bold" style={{ color: '#0B1F3A' }}>1125Corp</h2>
              </div>

              <div className="border-t border-dashed" style={{ borderColor: '#D1D5DB' }} />

              <div className="text-sm space-y-1.5 py-4">
                {receiptData.branchName && (
                  <div className="flex justify-between"><span style={{ color: '#6B7280' }}>Branch:</span><span>{receiptData.branchName}</span></div>
                )}
                <div className="flex justify-between"><span style={{ color: '#6B7280' }}>OR Number:</span><span className="font-mono font-bold">{receiptData.orNumber}</span></div>
                <div className="flex justify-between"><span style={{ color: '#6B7280' }}>Date:</span><span>{formatDate(receiptData.date)}</span></div>
                {receiptData.time && (
                  <div className="flex justify-between"><span style={{ color: '#6B7280' }}>Time:</span><span>{formatTime(new Date(`${receiptData.date}T${receiptData.time}`))}</span></div>
                )}
                <div className="flex justify-between"><span style={{ color: '#6B7280' }}>Loan #:</span><span>{receiptData.loanNumber}</span></div>
                {receiptData.releaseDate && (
                  <div className="flex justify-between"><span style={{ color: '#6B7280' }}>Release Date:</span><span>{formatDate(receiptData.releaseDate)}</span></div>
                )}
                {receiptData.dueDate && (
                  <div className="flex justify-between"><span style={{ color: '#6B7280' }}>Due Date:</span><span>{formatDate(receiptData.dueDate)}</span></div>
                )}
                <div className="flex justify-between"><span style={{ color: '#6B7280' }}>Customer:</span><span className="font-medium">{receiptData.customerName}</span></div>
                {receiptData.customerPhone && (
                  <div className="flex justify-between"><span style={{ color: '#6B7280' }}>Phone:</span><span>{receiptData.customerPhone}</span></div>
                )}
                {receiptData.currentAddress && (
                  <div className="flex justify-between gap-3"><span style={{ color: '#6B7280', whiteSpace: 'nowrap' }}>Location:</span><span className="text-right">{receiptData.currentAddress}</span></div>
                )}
                {receiptData.collectorName && (
                  <div className="flex justify-between"><span style={{ color: '#6B7280' }}>Collector:</span><span>{receiptData.collectorName}</span></div>
                )}
              </div>

              <div className="border-t border-dashed" style={{ borderColor: '#D1D5DB' }} />

              <div className="py-4 text-center">
                <p className="text-xs mb-1" style={{ color: '#6B7280' }}>Amount Paid</p>
                <p className="text-3xl font-bold" style={{ color: '#16A34A' }}>{formatCurrency(receiptData.amount)}</p>
                {receiptData.isFullyPaid ? (
                  <p className="text-xs mt-1 font-medium" style={{ color: '#16A34A' }}>Loan fully paid</p>
                ) : receiptData.daysCovered > 0 && (
                  <p className="text-xs mt-1" style={{ color: '#6B7280' }}>
                    Covers {receiptData.daysCovered} day{receiptData.daysCovered > 1 ? 's' : ''} of payment
                    {receiptData.advanceCredit > 0.009 && ` + ${formatCurrency(receiptData.advanceCredit)} advance toward the next day`}
                  </p>
                )}
              </div>

              <div className="rounded-lg p-3 flex justify-between text-sm" style={{ backgroundColor: '#F3F4F6' }}>
                <span style={{ color: '#6B7280' }}>Remaining Balance:</span>
                <span className="font-bold">{formatCurrency(receiptData.remainingBalance)}</span>
              </div>

              <p className="text-center text-xs pt-4" style={{ color: '#6B7280' }}>Thank you for your payment!</p>
              <p className="text-center text-[10px]" style={{ color: '#9CA3AF' }}>System-generated receipt</p>
            </div>
            <DialogFooter className="flex-row flex-wrap justify-center gap-2 space-x-0 sm:justify-center">
              <Button variant="outline" size="sm" onClick={handlePrintThermal} disabled={printingThermal}>
                {printingThermal ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Bluetooth className="w-4 h-4 mr-2" />}
                Print
              </Button>
              <Button variant="outline" size="sm" onClick={handleDownloadReceipt} disabled={downloadingReceipt}>
                {downloadingReceipt ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                Download
              </Button>
              <Button variant="outline" size="sm" onClick={handleDownloadInvoice} disabled={generatingInvoice}>
                {generatingInvoice ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Receipt className="w-4 h-4 mr-2" />}
                Invoice
              </Button>
              <Button size="sm" onClick={() => setReceiptData(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Payment</DialogTitle>
            <DialogDescription>
              Changing the amount will adjust the loan's remaining balance to match.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditPayment} className="space-y-4">
            <div className="space-y-2">
              <Label>Amount Paid (₱)</Label>
              <Input type="number" required value={editForm.amount_paid} onChange={(e) => setEditForm({ ...editForm, amount_paid: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Payment Date</Label>
              <Input type="date" required value={editForm.payment_date} onChange={(e) => setEditForm({ ...editForm, payment_date: e.target.value })} />
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
            <DialogTitle>Delete Payment</DialogTitle>
            <DialogDescription>
              This will remove the payment of {deleteTarget && formatCurrency(deleteTarget.amount_paid)} and restore it to the loan's remaining balance. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeletePayment} disabled={deleting}>
              {deleting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
