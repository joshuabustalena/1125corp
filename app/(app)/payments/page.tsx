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
import { formatCurrency, formatDate, generateORNumber, exportToCSV, formatCustomerName } from '@/lib/format';
import { PaymentReceiptDialog, buildReceiptDataFromPayment } from '@/components/payment-receipt-dialog';
import { getStoredReceipts, cacheReceiptForOffline, type CachedReceipt } from '@/lib/offline-receipts';
import {
  getPendingPayments, queuePendingPayment, updatePendingPayment, removePendingPayment,
  type PendingPayment,
} from '@/lib/offline-payment-queue';
import {
  Wallet, Plus, Search, Download, Loader2, MapPin, Receipt, Calculator, Pencil, Trash2, WifiOff, CloudUpload, X,
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
  // Reads straight from this device's local cache — no network call, so it
  // still works with zero signal. Only ever populated from receipts this
  // device has actually shown before (see lib/offline-receipts.ts).
  const [offlineReceiptsOpen, setOfflineReceiptsOpen] = useState(false);
  const [offlineReceipts, setOfflineReceipts] = useState<CachedReceipt[]>([]);
  // Payments collected with zero signal — queued here instead of posted,
  // synced to the real database (via the same atomic RPC a normal online
  // payment uses) once a "Sync" is actually tapped. See
  // lib/offline-payment-queue.ts for why this is safe.
  const [pendingPayments, setPendingPayments] = useState<PendingPayment[]>([]);
  const [pendingPaymentsOpen, setPendingPaymentsOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);
  const [isOnline, setIsOnline] = useState(true);
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

  useEffect(() => {
    setPendingPayments(getPendingPayments());
    if (typeof navigator !== 'undefined') setIsOnline(navigator.onLine);
    function goOnline() { setIsOnline(true); }
    function goOffline() { setIsOnline(false); }
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

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

  // Debounced so every keystroke doesn't fire its own query — without this,
  // a slower earlier request can resolve after a faster later one and
  // silently overwrite it with stale results (one of the causes behind
  // "search sometimes doesn't work").
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!profile) return;
    if (isCollector && !myCollector) return;
    loadPayments();
    loadLoans();
  }, [profile, myCollector, debouncedSearch, page, customerFilter]);

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

  // Guards against a slow earlier request resolving after a faster later
  // one and clobbering its results — the other half of the search fix,
  // alongside the debounce above.
  const loadPaymentsRequestRef = useRef(0);

  async function loadPayments() {
    setLoading(true);
    const requestId = ++loadPaymentsRequestRef.current;

    let query = supabase
      .from('payments')
      .select('*, loans(loan_number, release_date, due_date, customers(first_name, last_name, phone), branches(name), areas(name)), collectors(profiles(full_name)), receipts(or_number)');

    if (debouncedSearch) {
      // PostgREST's .or() can't filter on an embedded/joined table's
      // columns directly — resolve matching loans (by number or customer
      // name) first, then filter payments by those loan ids. Mirrors the
      // same fix already applied to the Loans page search.
      const { data: matchedCustomers } = await supabase
        .from('customers')
        .select('id')
        .or(`first_name.ilike.%${debouncedSearch}%,last_name.ilike.%${debouncedSearch}%`);
      const customerIds = (matchedCustomers ?? []).map((c: any) => c.id);
      const { data: matchedLoans } = await supabase
        .from('loans')
        .select('id')
        .or(customerIds.length > 0
          ? `loan_number.ilike.%${debouncedSearch}%,customer_id.in.(${customerIds.join(',')})`
          : `loan_number.ilike.%${debouncedSearch}%`);
      const loanIds = (matchedLoans ?? []).map((l: any) => l.id);
      if (loanIds.length === 0) {
        // No possible match — short-circuit instead of running an
        // unfiltered query that would return everything.
        if (requestId === loadPaymentsRequestRef.current) {
          setTotal(0);
          setPayments([]);
          setLoading(false);
        }
        return;
      }
      query = query.in('loan_id', loanIds);
    }
    if (isCollector) {
      query = query.eq('collector_id', myCollector?.id ?? '00000000-0000-0000-0000-000000000000');
    }
    if (customerFilter !== 'all') {
      query = query.eq('customer_id', customerFilter);
    }

    query = query.order('created_at', { ascending: false });
    const { data, error } = await query;

    // A response for a since-superseded request — drop it, the newer
    // request's result (or one still in flight) is what should win.
    if (requestId !== loadPaymentsRequestRef.current) return;

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      setLoading(false);
      return;
    }

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

    // Row-locked, atomic — same reasoning as apply_loan_payment: computing
    // the new balance from whatever's in local/React state instead of a
    // fresh locked read is exactly the bug that corrupted balances before.
    const { data, error } = await supabase
      .rpc('edit_loan_payment', {
        p_payment_id: editTarget.id,
        p_new_amount: Number(editForm.amount_paid),
        p_new_date: editForm.payment_date,
      })
      .single();

    if (error || !data) {
      toast({ title: 'Error', description: error?.message ?? 'Could not update the payment', variant: 'destructive' });
      setEditSaving(false);
      return;
    }

    toast({ title: 'Payment updated' });
    setEditTarget(null);
    setEditSaving(false);
    loadPayments();
    loadLoans();
  }

  async function handleDeletePayment() {
    if (!deleteTarget) return;
    setDeleting(true);

    const { data, error } = await supabase.rpc('delete_loan_payment', { p_payment_id: deleteTarget.id }).single();

    if (error || !data) {
      toast({ title: 'Error', description: error?.message ?? 'Could not delete the payment', variant: 'destructive' });
      setDeleting(false);
      return;
    }

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
        .map(l => [l.customer_id, formatCustomerName(l.customers?.first_name, l.customers?.last_name)])
    ).entries()
  );

  const selectedLoan = loans.find(l => l.id === form.loan_id);
  const newBalance = selectedLoan ? Math.max(0, Number(selectedLoan.remaining_balance) - Number(form.amount_paid || 0)) : 0;

  // Builds and queues an offline payment — no RPC, no balance, nothing
  // written to the database yet. Just enough to (a) print a receipt that
  // honestly says "pending" instead of a real balance, and (b) let Sync
  // apply it for real once signal is back.
  function queueOfflinePayment() {
    const orNumber = generateORNumber();
    const paymentDate = form.payment_date || new Date().toISOString().split('T')[0];
    const now = new Date();
    const amountPaidNum = Number(form.amount_paid);

    const pending = queuePendingPayment({
      loanId: form.loan_id,
      loanNumber: selectedLoan?.loan_number ?? '—',
      customerId: selectedLoan?.customer_id ?? null,
      customerName: selectedLoan ? `${selectedLoan.customers?.first_name ?? ''} ${selectedLoan.customers?.last_name ?? ''}`.trim() : '',
      customerPhone: selectedLoan?.customers?.phone ?? null,
      collectorId: selectedLoan?.collector_id ?? null,
      collectorName: selectedLoan?.collectors?.profiles?.full_name ?? null,
      branchName: selectedLoan?.branches?.name ?? null,
      areaName: selectedLoan?.areas?.name ?? null,
      releaseDate: selectedLoan?.release_date ?? null,
      dueDate: selectedLoan?.due_date ?? null,
      amount: amountPaidNum,
      paymentDate,
      paymentTime: now.toTimeString().split(' ')[0],
      gpsLat: location?.lat ?? null,
      gpsLng: location?.lng ?? null,
      locationAddress: locationAddress ?? (location ? `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}` : null),
      orNumber,
    });
    setPendingPayments(getPendingPayments());

    toast({ title: 'Saved offline', description: `Naka-queue na ang payment na ito. I-Sync kapag may signal na. OR: ${orNumber}` });

    setReceiptData({
      orNumber,
      loanNumber: pending.loanNumber,
      releaseDate: pending.releaseDate,
      dueDate: pending.dueDate,
      customerName: pending.customerName,
      customerPhone: pending.customerPhone,
      currentAddress: pending.locationAddress,
      branchName: pending.branchName,
      areaName: pending.areaName,
      collectorName: pending.collectorName,
      amount: amountPaidNum,
      remainingBalance: null,
      date: paymentDate,
      time: pending.paymentTime,
    });

    setForm({ ...form, loan_id: '', amount_paid: '', payment_date: new Date().toISOString().split('T')[0], notes: '' });
    setDialogOpen(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.loan_id || !form.amount_paid || !location) return;

    // A REAL post (one that actually updates the balance) can't happen
    // without signal — it has to go through the atomic apply_loan_payment
    // RPC to get a correct, race-condition-safe balance (this is the whole
    // reason that RPC exists — see its migration comment). Offline, queue
    // it instead of blocking the collector entirely. navigator.onLine isn't
    // 100% reliable (a device can report "online" with no real signal), so
    // the RPC failure below still falls back to queuing too, as a second
    // line of defense.
    if (!isOnline) {
      queueOfflinePayment();
      return;
    }

    setSaving(true);

    const orNumber = generateORNumber();
    const paymentDate = form.payment_date || new Date().toISOString().split('T')[0];
    const now = new Date();

    // Decrement the loan's balance atomically in the database, not from
    // whatever remaining_balance happens to be sitting in this browser's
    // local `loans` state (which only refreshed once when the page opened
    // — if this collector, or anyone else, already posted a payment
    // against this loan since then, that local number is stale). The RPC
    // reads-and-writes as one row-locked operation, so the balance it
    // returns is always correct regardless of how old the local state is.
    const { data: rpcResult, error: rpcError } = await supabase
      .rpc('apply_loan_payment', { p_loan_id: form.loan_id, p_amount: Number(form.amount_paid) })
      .single();
    if (rpcError || !rpcResult) {
      // A network-level failure (no signal, timed out mid-request, etc.)
      // doesn't come back as a normal Postgres error — it has no `code`.
      // Treat that case as "actually offline" and queue it instead of just
      // failing — navigator.onLine can say "online" while there's no real
      // signal, so this is the second line of defense the check at the top
      // of this function can't always catch.
      const looksLikeNetworkFailure = !!rpcError && !(rpcError as any).code;
      if (looksLikeNetworkFailure) {
        setSaving(false);
        queueOfflinePayment();
        return;
      }
      toast({ title: 'Error', description: rpcError?.message ?? 'Could not update the loan balance', variant: 'destructive' });
      setSaving(false);
      return;
    }
    const balanceBeforePayment = Number((rpcResult as any).previous_balance);
    const authoritativeNewBalance = Number((rpcResult as any).new_balance);

    // Create receipt first
    const { data: receipt, error: receiptError } = await supabase.from('receipts').insert({
      or_number: orNumber,
      loan_id: form.loan_id,
      customer_id: selectedLoan?.customer_id ?? null,
      collector_id: selectedLoan?.collector_id ?? null,
      amount: Number(form.amount_paid),
      remaining_balance: authoritativeNewBalance,
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
      remaining_balance: authoritativeNewBalance,
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

    // No journal entry here on purpose — the cash a collector receives in
    // the field isn't in the company's vault/bank yet, so it isn't posted
    // to the ledger until the Cashier actually records the Remittance
    // (Debit the real cash account, Credit Loans Receivable happens there).
    // Posting it again here would double-count it.

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
    // payment (from the RPC above, so it's the real figure, not a stale
    // local one), and treat anything beyond that as the loan being settled.
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
    const isFullyPaid = authoritativeNewBalance <= 0.009;

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
      remainingBalance: authoritativeNewBalance,
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
    // The database's balance is now correct either way (the RPC above is
    // authoritative), but this also refreshes the local `loans` list so
    // the next payment's live preview isn't showing a stale figure either.
    loadLoans();
  }

  // Applies every still-queued offline payment for real, oldest first —
  // FIFO matters here since two queued payments against the same loan must
  // apply in the order they actually happened. Each item goes through the
  // exact same atomic RPC an online payment uses, so the resulting balance
  // is correct no matter how long it sat in the queue. balanceApplied is
  // persisted right after the RPC succeeds, before the follow-up
  // receipt/payment inserts — so if THIS sync run gets interrupted (app
  // closed, tab closed) partway through one item, retrying never re-runs
  // the RPC for that item a second time; it only resumes the bookkeeping.
  async function handleSyncPendingPayments() {
    // The button's disabled={syncing} state depends on a React re-render,
    // which isn't necessarily instant — a fast enough double-tap could fire
    // this twice before that commits, running two sync loops over the same
    // queue at once and double-applying a payment's balance deduction. A
    // ref is checked/set synchronously, immune to render timing, so it
    // can't be raced the same way.
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    const queue = getPendingPayments();
    let succeeded = 0;
    let failed = 0;

    for (const item of queue) {
      let newBalance = item.appliedBalance;

      if (!item.balanceApplied) {
        const { data: rpcResult, error: rpcError } = await supabase
          .rpc('apply_loan_payment', { p_loan_id: item.loanId, p_amount: item.amount })
          .single();
        if (rpcError || !rpcResult) {
          failed++;
          updatePendingPayment(item.id, { syncError: rpcError?.message ?? 'Could not update the loan balance' });
          continue;
        }
        newBalance = Number((rpcResult as any).new_balance);
        updatePendingPayment(item.id, { balanceApplied: true, appliedBalance: newBalance, syncError: null });
      }

      const { data: receipt, error: receiptError } = await supabase.from('receipts').insert({
        or_number: item.orNumber,
        loan_id: item.loanId,
        customer_id: item.customerId,
        collector_id: item.collectorId,
        amount: item.amount,
        remaining_balance: newBalance,
        payment_date: item.paymentDate,
        qr_data: JSON.stringify({ or: item.orNumber, loan: item.loanNumber, amount: item.amount }),
      }).select().single();

      if (receiptError) {
        failed++;
        updatePendingPayment(item.id, { syncError: receiptError.message });
        continue;
      }

      const { error: payError } = await supabase.from('payments').insert({
        loan_id: item.loanId,
        customer_id: item.customerId,
        collector_id: item.collectorId,
        receipt_id: receipt.id,
        amount_paid: item.amount,
        principal: 0,
        interest: 0,
        penalty: 0,
        remaining_balance: newBalance,
        payment_date: item.paymentDate,
        payment_time: item.paymentTime,
        gps_lat: item.gpsLat,
        gps_lng: item.gpsLng,
        location_address: item.locationAddress,
        notes: null,
      });

      if (payError) {
        failed++;
        updatePendingPayment(item.id, { syncError: payError.message });
        continue;
      }

      removePendingPayment(item.id);
      // Overwrites the "pending" version this OR number was cached under
      // (see PaymentReceiptDialog's auto-cache) with the now-confirmed
      // balance, so Recent Receipts stops showing it as unconfirmed.
      cacheReceiptForOffline({
        orNumber: item.orNumber,
        loanNumber: item.loanNumber,
        releaseDate: item.releaseDate,
        dueDate: item.dueDate,
        customerName: item.customerName,
        customerPhone: item.customerPhone,
        currentAddress: item.locationAddress,
        branchName: item.branchName,
        areaName: item.areaName,
        collectorName: item.collectorName,
        amount: item.amount,
        remainingBalance: newBalance,
        date: item.paymentDate,
        time: item.paymentTime,
      });
      succeeded++;
    }

    setPendingPayments(getPendingPayments());
    syncingRef.current = false;
    setSyncing(false);
    loadPayments();
    loadLoans();

    if (failed === 0) {
      toast({ title: 'Na-sync lahat', description: `${succeeded} payment(s) na-post na sa database.` });
    } else {
      toast({
        title: 'May hindi na-sync',
        description: `${succeeded} successful, ${failed} may error pa. Manatili sila sa Pending list — subukan ulit mamaya.`,
        variant: 'destructive',
      });
    }
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
        {pendingPayments.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="text-warning border-warning/40 hover:text-warning"
            onClick={() => setPendingPaymentsOpen(true)}
          >
            <CloudUpload className="w-4 h-4 mr-2" />
            Pending ({pendingPayments.length})
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => { setOfflineReceipts(getStoredReceipts()); setOfflineReceiptsOpen(true); }}>
          <WifiOff className="w-4 h-4 mr-2" />
          Recent Receipts
        </Button>
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
              placeholder="Search by loan number or customer name..."
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
                    <p className="text-xs text-muted-foreground truncate">{p.loans ? formatCustomerName(p.loans.customers?.first_name, p.loans.customers?.last_name) : '—'}</p>
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
                    onClick={() => setReceiptData(buildReceiptDataFromPayment(p))}
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
                  <TableCell className="text-sm">{p.loans ? formatCustomerName(p.loans.customers?.first_name, p.loans.customers?.last_name) : '—'}</TableCell>
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
                        setReceiptData(buildReceiptDataFromPayment(p));
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
                      {l.loan_number} — {formatCustomerName(l.customers?.first_name, l.customers?.last_name)} (Bal: {formatCurrency(l.remaining_balance)})
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
                {locating
                  ? 'Capturing current location…'
                  : locationAddress
                    ? locationAddress
                    : location
                      ? `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)} (address unavailable — no signal to look it up)`
                      : (locationError ?? 'Location is required before posting a payment.')}
              </span>
              {!locating && (
                <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs shrink-0" onClick={requestLocation}>
                  Retry
                </Button>
              )}
            </div>

            {!isOnline && (
              <div className="flex items-start gap-2 p-3 rounded-lg text-xs" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
                <WifiOff className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Walang signal — mase-save muna ito bilang <strong>pending</strong> sa device na ito. Pwede mo nang i-print ang resibo (walang balance pa), pero kailangan mo pang i-Sync sa Payments page kapag may signal na.
                </span>
              </div>
            )}

            {form.amount_paid && selectedLoan && (
              <div className="p-3 rounded-lg bg-primary/5 border border-border">
                <div className="flex items-center gap-2 text-sm font-medium text-primary mb-1">
                  <Calculator className="w-4 h-4" />
                  New Remaining Balance: {formatCurrency(newBalance)}
                  {!isOnline && <span className="text-xs text-muted-foreground font-normal">(estimate — hindi pa ito confirmed)</span>}
                </div>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving || !form.loan_id || !form.amount_paid || !location}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {isOnline ? 'Post & Generate Receipt' : 'Save Offline & Print'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Receipt preview */}
      <PaymentReceiptDialog receiptData={receiptData} onClose={() => setReceiptData(null)} />

      {/* Recent Receipts — reads from this device's local cache only, so it
          still opens with zero signal. Tap one to reprint/redownload it. */}
      <Dialog open={offlineReceiptsOpen} onOpenChange={setOfflineReceiptsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <WifiOff className="w-5 h-5" />
              Recent Receipts
            </DialogTitle>
            <DialogDescription>
              Saved on this device — reprint or download these even without signal.
            </DialogDescription>
          </DialogHeader>
          {offlineReceipts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No receipts saved on this device yet. A receipt gets saved here automatically the moment it's shown on screen.
            </p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {offlineReceipts.map(r => (
                <button
                  key={r.orNumber}
                  type="button"
                  className="w-full text-left p-3 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors"
                  onClick={() => { setReceiptData(r); setOfflineReceiptsOpen(false); }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium truncate">{r.customerName}</p>
                    <p className="text-sm font-medium text-success shrink-0">{formatCurrency(r.amount)}</p>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="truncate">{r.loanNumber} • OR# {r.orNumber}</span>
                    <span className="shrink-0">{formatDate(r.date)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Pending (offline) Payments — collected with zero signal, not yet
          posted to the database. Sync applies them for real, oldest first. */}
      <Dialog open={pendingPaymentsOpen} onOpenChange={setPendingPaymentsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CloudUpload className="w-5 h-5" />
              Pending Payments
            </DialogTitle>
            <DialogDescription>
              Collected offline, not yet in the database. {isOnline ? 'May signal ka na — pwede nang i-Sync.' : 'Kailangan ng signal bago ma-Sync.'}
            </DialogDescription>
          </DialogHeader>
          {pendingPayments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Wala pang pending na payment.</p>
          ) : (
            <>
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {pendingPayments.map(p => (
                  <div key={p.id} className="p-3 rounded-lg bg-secondary/50">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium truncate">{p.customerName || p.loanNumber}</p>
                      <div className="flex items-center gap-1 shrink-0">
                        <p className="text-sm font-medium text-warning">{formatCurrency(p.amount)}</p>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          title="Remove from queue"
                          onClick={() => { removePendingPayment(p.id); setPendingPayments(getPendingPayments()); }}
                        >
                          <X className="w-3.5 h-3.5 text-destructive" />
                        </Button>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{p.loanNumber} • OR# {p.orNumber} • {formatDate(p.paymentDate)}</p>
                    {p.syncError && (
                      <p className="text-xs mt-1 text-destructive">Sync error: {p.syncError}</p>
                    )}
                  </div>
                ))}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPendingPaymentsOpen(false)}>Close</Button>
                <Button onClick={handleSyncPendingPayments} disabled={syncing || !isOnline}>
                  {syncing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  {isOnline ? `Sync ${pendingPayments.length} Payment${pendingPayments.length > 1 ? 's' : ''}` : 'Kailangan ng signal'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

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
