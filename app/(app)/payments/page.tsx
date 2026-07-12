'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
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
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency, formatDate, generateORNumber, exportToCSV } from '@/lib/format';
import {
  Wallet, Plus, Search, Download, Eye, Loader2, MapPin, Receipt, Calculator, ChevronDown, Check,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export default function PaymentsPage() {
  const searchParams = useSearchParams();
  const { profile } = useAuth();
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
  const [printingReceipt, setPrintingReceipt] = useState(false);
  const receiptRef = useRef<HTMLDivElement>(null);
  const pageSize = 10;

  async function handlePrintReceipt() {
    if (!receiptRef.current) return;
    setPrintingReceipt(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(receiptRef.current, { backgroundColor: '#ffffff', scale: 2 });
      const dataUrl = canvas.toDataURL('image/png');
      const printWindow = window.open('', '_blank', 'width=500,height=700');
      if (!printWindow) {
        toast({ title: 'Print blocked', description: 'Please allow pop-ups for this site to print the receipt', variant: 'destructive' });
        setPrintingReceipt(false);
        return;
      }
      printWindow.document.write(`
        <html>
          <head><title>Receipt ${receiptData?.orNumber ?? ''}</title></head>
          <body style="margin:0;display:flex;justify-content:center;padding:24px;background:#fff;">
            <img src="${dataUrl}" style="max-width:100%;" onload="window.print()" />
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.onafterprint = () => printWindow.close();
    } catch (err: any) {
      toast({ title: 'Print failed', description: err?.message ?? 'Could not generate receipt for printing', variant: 'destructive' });
    }
    setPrintingReceipt(false);
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
    loadPayments();
    loadLoans();
  }, [search, page, customerFilter]);

  const autoOpenedRef = useRef(false);
  useEffect(() => {
    const loanId = searchParams.get('loan');
    if (loanId && loans.length > 0 && !autoOpenedRef.current) {
      autoOpenedRef.current = true;
      handleLoanSelect(loanId);
      setDialogOpen(true);
    }
  }, [loans]);

  async function loadLoans() {
    const { data } = await supabase
      .from('loans')
      .select('id, loan_number, remaining_balance, status, total_payable, term_days, customer_id, collector_id, customers(first_name, last_name, phone), branches(name), areas(name), collectors(profiles(full_name))')
      .in('status', ['active', 'overdue'])
      .order('loan_number');
    setLoans(data ?? []);
  }

  function handleLoanSelect(loanId: string) {
    const loan = loans.find(l => l.id === loanId);
    const dailyAmount = loan && loan.term_days > 0 ? Math.round((loan.total_payable / loan.term_days) * 100) / 100 : 0;
    setForm({ ...form, loan_id: loanId, amount_paid: dailyAmount ? String(dailyAmount) : '' });
  }

  async function loadPayments() {
    setLoading(true);
    let query = supabase
      .from('payments')
      .select('*, loans(loan_number, customers(first_name, last_name, phone), branches(name), areas(name)), collectors(profiles(full_name)), receipts(or_number)', { count: 'exact' });

    if (search) {
      query = query.or(`loans.loan_number.ilike.%${search}%`);
    }
    if (customerFilter !== 'all') {
      query = query.eq('customer_id', customerFilter);
    }

    query = query.range((page - 1) * pageSize, page * pageSize - 1).order('payment_date', { ascending: false });
    const { data, count } = await query;
    setPayments(data ?? []);
    setTotal(count ?? 0);
    setLoading(false);
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
    if (!form.loan_id || !form.amount_paid) return;
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
      gps_lat: null,
      gps_lng: null,
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

    toast({ title: 'Success', description: `Payment posted. OR: ${orNumber}` });

    const dailyDue = selectedLoan && selectedLoan.term_days > 0 ? selectedLoan.total_payable / selectedLoan.term_days : 0;
    const amountPaidNum = Number(form.amount_paid);
    const daysCovered = dailyDue > 0 ? Math.floor((amountPaidNum + 0.001) / dailyDue) : 0;
    const advanceCredit = dailyDue > 0 ? Math.round((amountPaidNum - daysCovered * dailyDue) * 100) / 100 : 0;

    setReceiptData({
      orNumber,
      loanNumber: selectedLoan?.loan_number,
      customerName: selectedLoan ? `${selectedLoan.customers?.first_name} ${selectedLoan.customers?.last_name}` : '',
      customerPhone: selectedLoan?.customers?.phone ?? null,
      branchName: selectedLoan?.branches?.name ?? null,
      areaName: selectedLoan?.areas?.name ?? null,
      collectorName: selectedLoan?.collectors?.profiles?.full_name ?? null,
      amount: amountPaidNum,
      remainingBalance: newBalance,
      date: paymentDate,
      dailyDue,
      daysCovered,
      advanceCredit,
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
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Post Collection
          </Button>
        )}
      </PageHeader>

      {/* Filters */}
      <Card className="glass-card border-border">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by loan number..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="glass-card border-border">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
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
                      {customerOptions.map(([id, name]) => (
                        <DropdownMenuItem key={id} onClick={() => { setCustomerFilter(id); setPage(1); }} className="flex items-center justify-between">
                          {name}
                          {customerFilter === id && <Check className="w-4 h-4" />}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableHead>
                <TableHead>Collector</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Balance</TableHead>
                <TableHead>OR #</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-16 text-center">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto" />
                  </TableCell>
                </TableRow>
              ) : payments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-16 text-center">
                    <Wallet className="w-12 h-12 text-muted-foreground/50 mb-3 mx-auto" />
                    <p className="text-sm text-muted-foreground">No payments recorded</p>
                  </TableCell>
                </TableRow>
              ) : (
                payments.map(p => (
                  <TableRow key={p.id} className="hover:bg-secondary/50">
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
                        onClick={() => setReceiptData({
                          orNumber: p.receipts?.or_number ?? '—',
                          loanNumber: p.loans?.loan_number ?? '—',
                          customerName: p.loans ? `${p.loans.customers?.first_name} ${p.loans.customers?.last_name}` : '—',
                          customerPhone: p.loans?.customers?.phone ?? null,
                          branchName: p.loans?.branches?.name ?? null,
                          areaName: p.loans?.areas?.name ?? null,
                          collectorName: p.collectors?.profiles?.full_name ?? null,
                          amount: Number(p.amount_paid),
                          remainingBalance: Number(p.remaining_balance),
                          date: p.payment_date,
                        })}
                      >
                        <Receipt className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {!loading && payments.length > 0 && (
            <div className="flex items-center justify-between p-4 border-t border-border">
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
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input type="date" value={form.payment_date} onChange={(e) => setForm({ ...form, payment_date: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Time</Label>
                <Input value={new Date().toLocaleTimeString('en-PH', { timeStyle: 'short' })} disabled className="bg-muted" />
              </div>
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
              <Button type="submit" disabled={saving || !form.loan_id || !form.amount_paid}>
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
                Official Receipt
              </DialogTitle>
            </DialogHeader>
            <div ref={receiptRef} className="p-6 rounded-xl border-2 border-gray-200" style={{ backgroundColor: '#ffffff', color: '#111827' }}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-white border border-gray-200 flex items-center justify-center overflow-hidden shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/image/1125_Corp_Logo.png" alt="1125Corp" width={48} height={48} style={{ objectFit: 'contain' }} />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold" style={{ color: '#0B1F3A' }}>1125Corp</h2>
                    <p className="text-xs" style={{ color: '#6B7280' }}>1125corp.org</p>
                  </div>
                </div>
                <span
                  className="text-xs font-bold px-3 py-1 rounded-full"
                  style={{ color: '#16A34A', backgroundColor: '#DCFCE7', border: '1px solid #16A34A' }}
                >
                  PAID
                </span>
              </div>

              <div className="border-t border-dashed" style={{ borderColor: '#D1D5DB' }} />

              <div className="text-sm space-y-1.5 py-4">
                <div className="flex justify-between"><span style={{ color: '#6B7280' }}>OR Number:</span><span className="font-mono font-bold">{receiptData.orNumber}</span></div>
                <div className="flex justify-between"><span style={{ color: '#6B7280' }}>Date:</span><span>{formatDate(receiptData.date)}</span></div>
                <div className="flex justify-between"><span style={{ color: '#6B7280' }}>Loan #:</span><span>{receiptData.loanNumber}</span></div>
                <div className="flex justify-between"><span style={{ color: '#6B7280' }}>Customer:</span><span className="font-medium">{receiptData.customerName}</span></div>
                {receiptData.customerPhone && (
                  <div className="flex justify-between"><span style={{ color: '#6B7280' }}>Phone:</span><span>{receiptData.customerPhone}</span></div>
                )}
                {receiptData.branchName && (
                  <div className="flex justify-between"><span style={{ color: '#6B7280' }}>Branch:</span><span>{receiptData.branchName}</span></div>
                )}
                {receiptData.areaName && (
                  <div className="flex justify-between"><span style={{ color: '#6B7280' }}>Area:</span><span>{receiptData.areaName}</span></div>
                )}
                {receiptData.collectorName && (
                  <div className="flex justify-between"><span style={{ color: '#6B7280' }}>Collector:</span><span>{receiptData.collectorName}</span></div>
                )}
              </div>

              <div className="border-t border-dashed" style={{ borderColor: '#D1D5DB' }} />

              <div className="py-4 text-center">
                <p className="text-xs" style={{ color: '#6B7280' }}>Amount Paid</p>
                <p className="text-3xl font-bold" style={{ color: '#16A34A' }}>{formatCurrency(receiptData.amount)}</p>
                {receiptData.daysCovered > 0 && (
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
              <p className="text-center text-[10px]" style={{ color: '#9CA3AF' }}>This is a system-generated receipt and is valid without a signature.</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handlePrintReceipt} disabled={printingReceipt}>
                {printingReceipt && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Print
              </Button>
              <Button variant="outline" onClick={handleDownloadReceipt} disabled={downloadingReceipt}>
                {downloadingReceipt ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                Download
              </Button>
              <Button variant="outline" onClick={handleDownloadInvoice} disabled={generatingInvoice}>
                {generatingInvoice ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Receipt className="w-4 h-4 mr-2" />}
                Invoice
              </Button>
              <Button onClick={() => setReceiptData(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
