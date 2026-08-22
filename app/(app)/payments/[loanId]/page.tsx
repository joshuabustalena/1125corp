'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { StatCard } from '@/components/dashboard/stat-card';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency, formatDate, exportToCSV } from '@/lib/format';
import { COMPANY_NAME, getDocumentBranding } from '@/lib/document-branding';
import { buildPrintHtml } from '@/lib/print-document';
import {
  ArrowLeft, Landmark, Wallet, Receipt, Download, Loader2, ExternalLink, Printer, FileText,
} from 'lucide-react';

// "06/04/2026" — matches the client's own legacy Payment History report
// exactly, unlike formatDate's "Jun 4, 2026" house style used elsewhere.
function formatMDY(date: string | Date | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}`;
}

// Plain 2-decimal number, no currency symbol — the per-row ledger columns in
// the legacy report ("215.08", "34.93") are unlike the ₱-prefixed summary
// fields above them ("Loan Amount: ₱10,000.00").
function formatPlainNumber(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const REPORT_ROWS_PER_PAGE = 28;

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  active: 'default',
  pending: 'secondary',
  paid: 'default',
  overdue: 'destructive',
  declined: 'destructive',
  renewed: 'outline',
};

export default function LoanPaymentHistoryPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const loanId = params.loanId as string;

  const [loading, setLoading] = useState(true);
  const [loan, setLoan] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [receiptData, setReceiptData] = useState<any>(null);
  const [downloadingReceipt, setDownloadingReceipt] = useState(false);
  const [generatingInvoice, setGeneratingInvoice] = useState(false);
  const [printingReceipt, setPrintingReceipt] = useState(false);
  const [printingHistory, setPrintingHistory] = useState(false);
  const [downloadingHistory, setDownloadingHistory] = useState(false);
  const receiptRef = useRef<HTMLDivElement>(null);
  const historyPageRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    loadData();
  }, [loanId]);

  async function loadData() {
    setLoading(true);
    const { data: loanData } = await supabase
      .from('loans')
      .select('id, loan_number, status, remaining_balance, total_payable, amount, interest_rate, interest_amount, term_days, release_date, service_fee, created_at, customer_id, customers(first_name, last_name, phone), branches(name), areas(name), collectors(profiles(full_name))')
      .eq('id', loanId)
      .maybeSingle();

    setLoan(loanData);

    const { data: history } = await supabase
      .from('payments')
      .select('*, receipts(or_number), collectors(profiles(full_name))')
      .eq('loan_id', loanId)
      .order('created_at', { ascending: false });

    setPayments(history ?? []);
    setLoading(false);
  }

  const totalPaid = payments.reduce((s, p) => s + Number(p.amount_paid), 0);

  // Payment History report — matches the client's own legacy report layout
  // exactly. Principal/Interest per row are NOT stored anywhere (payments
  // only record amount_paid) — client confirmed (Aug 2026): split the
  // loan's total principal and total interest evenly across the term, the
  // same fixed figure every regular day, matching how the legacy report's
  // own numbers repeat unchanged row to row. Co-Maker, Reference No., Check
  // No., and Notarial Fee have no equivalent in this system at all, so they
  // print blank/0.00 — the columns stay, matching the template's layout,
  // just with nothing to fill them yet. Service Fee is a one-time charge
  // (loan.service_fee), so it only appears on the earliest payment, same as
  // the legacy report shows it once on day one and 0.00 afterward.
  const termDays = Number(loan?.term_days) || 0;
  const dailyPrincipal = termDays > 0 ? Number(loan?.amount ?? 0) / termDays : 0;
  const dailyInterest = termDays > 0 ? Number(loan?.interest_amount ?? 0) / termDays : 0;
  const historyRowsAsc = payments.slice().sort((a, b) => (a.payment_date ?? '').localeCompare(b.payment_date ?? '') || (a.created_at ?? '').localeCompare(b.created_at ?? ''));
  const historyRows = historyRowsAsc.map((p, i) => ({
    date: p.payment_date,
    principal: dailyPrincipal,
    interest: dailyInterest,
    penalty: 0,
    deductions: 0,
    notarialFee: 0,
    serviceFee: i === 0 ? Number(loan?.service_fee ?? 0) : 0,
    totalAmount: Number(p.amount_paid),
    receiptNo: p.receipts?.or_number ?? '',
  }));
  const historyTotals = historyRows.reduce((acc, r) => ({
    principal: acc.principal + r.principal,
    interest: acc.interest + r.interest,
    penalty: acc.penalty + r.penalty,
    deductions: acc.deductions + r.deductions,
    notarialFee: acc.notarialFee + r.notarialFee,
    serviceFee: acc.serviceFee + r.serviceFee,
    totalAmount: acc.totalAmount + r.totalAmount,
  }), { principal: 0, interest: 0, penalty: 0, deductions: 0, notarialFee: 0, serviceFee: 0, totalAmount: 0 });
  const historyPages: (typeof historyRows)[] = [];
  for (let i = 0; i < historyRows.length; i += REPORT_ROWS_PER_PAGE) {
    historyPages.push(historyRows.slice(i, i + REPORT_ROWS_PER_PAGE));
  }
  if (historyPages.length === 0) historyPages.push([]);
  const reportGeneratedAt = new Date();

  function handleExport() {
    exportToCSV(
      payments.map(p => ({
        Date: p.payment_date,
        Amount: p.amount_paid,
        Balance: p.remaining_balance,
        OR: p.receipts?.or_number ?? '',
      })),
      `${loan?.loan_number ?? 'loan'}-payments.csv`
    );
  }

  async function handlePrintHistory() {
    // Trimmed to the current page count first — the ref array is written by
    // index and never shrinks on its own, so a loan whose history got shorter
    // (a payment was deleted) would otherwise still carry detached nodes from
    // the previous render and print phantom extra pages.
    historyPageRefs.current.length = historyPages.length;
    const refs = historyPageRefs.current.filter(Boolean) as HTMLDivElement[];
    if (refs.length === 0) return;
    setPrintingHistory(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const pages: { url: string; width: number; height: number }[] = [];
      for (const ref of refs) {
        const canvas = await html2canvas(ref, { backgroundColor: '#ffffff', scale: 2 });
        pages.push({ url: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height });
      }
      const printWindow = window.open('', '_blank', 'width=1100,height=850');
      if (!printWindow) {
        toast({ title: 'Print blocked', description: 'Please allow pop-ups for this site to print the payment history', variant: 'destructive' });
        setPrintingHistory(false);
        return;
      }
      // 11"x8.5" landscape — this report has too many columns (Date through
      // Check No.) to read comfortably on a portrait page.
      printWindow.document.write(buildPrintHtml(`Payment History ${loan?.loan_number ?? ''}`, pages, 11, 8.5));
      printWindow.document.close();
      printWindow.onload = () => printWindow.print();
      printWindow.onafterprint = () => printWindow.close();
    } catch (err: any) {
      toast({ title: 'Print failed', description: err?.message ?? 'Could not generate payment history for printing', variant: 'destructive' });
    }
    setPrintingHistory(false);
  }

  async function handleDownloadHistory() {
    // Trimmed to the current page count first — the ref array is written by
    // index and never shrinks on its own, so a loan whose history got shorter
    // (a payment was deleted) would otherwise still carry detached nodes from
    // the previous render and print phantom extra pages.
    historyPageRefs.current.length = historyPages.length;
    const refs = historyPageRefs.current.filter(Boolean) as HTMLDivElement[];
    if (refs.length === 0) return;
    setDownloadingHistory(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const { jsPDF } = await import('jspdf');
      // 11"x8.5" landscape, matching the print flow.
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: [792, 612] });
      const margin = 24;
      const usableWidth = pdf.internal.pageSize.getWidth() - margin * 2;

      for (let i = 0; i < refs.length; i++) {
        const canvas = await html2canvas(refs[i], { backgroundColor: '#ffffff', scale: 2 });
        const imgData = canvas.toDataURL('image/png');
        const imgHeight = (canvas.height / canvas.width) * usableWidth;
        if (i > 0) pdf.addPage();
        pdf.addImage(imgData, 'PNG', margin, margin, usableWidth, imgHeight);
      }
      pdf.save(`payment-history-${loan?.loan_number ?? 'loan'}.pdf`);
    } catch (err: any) {
      toast({ title: 'Download failed', description: err?.message ?? 'Could not generate payment history PDF', variant: 'destructive' });
    }
    setDownloadingHistory(false);
  }

  function openReceipt(p: any) {
    setReceiptData({
      orNumber: p.receipts?.or_number ?? '—',
      loanNumber: loan?.loan_number ?? '—',
      customerName: loan?.customers ? `${loan.customers.first_name} ${loan.customers.last_name}` : '—',
      customerPhone: loan?.customers?.phone ?? null,
      branchName: loan?.branches?.name ?? null,
      areaName: loan?.areas?.name ?? null,
      collectorName: p.collectors?.profiles?.full_name ?? loan?.collectors?.profiles?.full_name ?? null,
      amount: Number(p.amount_paid),
      remainingBalance: Number(p.remaining_balance),
      date: p.payment_date,
    });
  }

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
          <head><title>Receipt ${receiptData?.orNumber ?? ''}</title><style>@page { size: auto; margin: 0; }</style></head>
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!loan) {
    return (
      <div className="space-y-6">
        <PageHeader title="Loan not found" description="">
          <Button variant="outline" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
        </PageHeader>
      </div>
    );
  }

  const customerName = loan.customers ? `${loan.customers.first_name} ${loan.customers.last_name}` : '—';
  const branding = getDocumentBranding(loan.branches?.name);

  return (
    <div className="space-y-6">
      <PageHeader title={loan.loan_number} description={`Payment history — ${customerName}`}>
        <Badge variant={STATUS_VARIANT[loan.status] ?? 'secondary'} className="capitalize self-center mr-2">{loan.status}</Badge>
        <Button variant="outline" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <Link href={`/loans/${loan.id}`}>
          <Button variant="outline" size="sm">
            <ExternalLink className="w-4 h-4 mr-2" />
            View Loan Details
          </Button>
        </Link>
        <Button variant="outline" size="sm" onClick={handleExport} disabled={payments.length === 0}>
          <Download className="w-4 h-4 mr-2" />
          Export CSV
        </Button>
        <Button variant="outline" size="sm" onClick={handlePrintHistory} disabled={printingHistory || payments.length === 0}>
          {printingHistory ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Printer className="w-4 h-4 mr-2" />}
          Print
        </Button>
        <Button size="sm" onClick={handleDownloadHistory} disabled={downloadingHistory || payments.length === 0}>
          {downloadingHistory ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileText className="w-4 h-4 mr-2" />}
          Download PDF
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard title="Total Collected" value={formatCurrency(totalPaid)} icon={<Wallet className="w-5 h-5" />} variant="success" />
        <StatCard title="Payments Made" value={payments.length.toString()} icon={<Receipt className="w-5 h-5" />} />
        <StatCard title="Remaining Balance" value={formatCurrency(loan.remaining_balance)} icon={<Landmark className="w-5 h-5" />} />
      </div>

      <Card className="glass-card border-border">
        <CardHeader>
          <CardTitle>Payments on this loan</CardTitle>
          <CardDescription>{payments.length} payment{payments.length !== 1 ? 's' : ''} recorded</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No payments recorded on this loan yet</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Balance</TableHead>
                    <TableHead>OR #</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map(p => (
                    <TableRow key={p.id}>
                      <TableCell className="text-sm">{formatDate(p.payment_date)}</TableCell>
                      <TableCell className="text-sm font-medium text-success">{formatCurrency(p.amount_paid)}</TableCell>
                      <TableCell className="text-sm">{formatCurrency(p.remaining_balance)}</TableCell>
                      <TableCell className="text-sm">{p.receipts?.or_number ?? '—'}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => openReceipt(p)}>
                          <Receipt className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

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

      {/* Payment History report — off-screen, only ever captured for
          print/download, never shown in the normal page flow. One div per
          chunk of REPORT_ROWS_PER_PAGE rows so a long-running loan's
          history paginates properly instead of overflowing one page. */}
      {typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', top: 0, left: 0, opacity: 0, pointerEvents: 'none', zIndex: -1 }}>
          {historyPages.map((rows, pageIndex) => {
            const isLastPage = pageIndex === historyPages.length - 1;
            const infoLabel: React.CSSProperties = { border: '1px solid #000', padding: '5px 8px', fontWeight: 700, background: '#F2F4F7', whiteSpace: 'nowrap' };
            const infoValue: React.CSSProperties = { border: '1px solid #000', padding: '5px 8px' };
            const thStyle: React.CSSProperties = { border: '1px solid #000', padding: '6px 6px', fontWeight: 700, color: '#fff', whiteSpace: 'nowrap' };
            const tdStyle: React.CSSProperties = { border: '1px solid #000', padding: '4px 6px' };
            return (
              <div
                key={pageIndex}
                ref={(el) => { historyPageRefs.current[pageIndex] = el; }}
                style={{ width: 1150, background: '#fff', color: '#111', padding: '30px 36px', fontFamily: '"Times New Roman", Calibri, serif', fontSize: 12 }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '3px solid #000', paddingBottom: 10, marginBottom: 14 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 20, color: '#1F4E79' }}>{COMPANY_NAME}</div>
                    <div style={{ fontWeight: 700, fontSize: 12, color: '#1F4E79' }}>{branding.headerAddress.toUpperCase()}</div>
                    <div style={{ fontWeight: 700, fontSize: 12, color: '#1F4E79' }}>CELL PHONE NUMBER: {branding.contact}</div>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: 11 }}>
                    <div><strong>Report Date:</strong> {formatMDY(reportGeneratedAt)}</div>
                    <div><strong>Report Time:</strong> {reportGeneratedAt.toLocaleTimeString('en-US')}</div>
                    <div style={{ marginTop: 4 }}><strong>Loan No.:</strong> {loan.loan_number}</div>
                  </div>
                </div>

                <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 16, color: '#1F4E79', letterSpacing: 0.5, marginBottom: 14 }}>
                  PAYMENT HISTORY REPORT
                </div>

                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, marginBottom: 16 }}>
                  <tbody>
                    <tr>
                      <td style={infoLabel}>Client Name</td><td style={infoValue}>{customerName}</td>
                      <td style={infoLabel}>Co-Maker</td><td style={infoValue}></td>
                      <td style={infoLabel}>Application Date</td><td style={infoValue}>{formatMDY(loan.created_at)}</td>
                    </tr>
                    <tr>
                      <td style={infoLabel}>Loan Amount</td><td style={infoValue}>{formatCurrency(loan.amount)}</td>
                      <td style={infoLabel}>Loan Collector</td><td style={infoValue}>{loan.collectors?.profiles?.full_name ?? ''}</td>
                      <td style={infoLabel}>Date of Release</td><td style={infoValue}>{formatMDY(loan.release_date)}</td>
                    </tr>
                    <tr>
                      <td style={infoLabel}>Interest</td>
                      {/* Guarded — a loan with no stored rate would otherwise
                          print the literal "NaN %" on the report. */}
                      <td style={infoValue} colSpan={3}>{(Number(loan.interest_rate) || 0).toFixed(6)} % &mdash; Monthly Interest Rate, Flat Rate</td>
                      <td style={infoLabel}>Group Name</td><td style={infoValue}>{loan.areas?.name ?? ''}</td>
                    </tr>
                    <tr>
                      <td style={infoLabel}>Loan Term</td>
                      <td style={infoValue} colSpan={3}>{termDays} &mdash; Daily Installments</td>
                      <td style={infoLabel}>Loan Balance</td><td style={{ ...infoValue, fontWeight: 700 }}>{formatCurrency(loan.remaining_balance)}</td>
                    </tr>
                  </tbody>
                </table>

                <div style={{ fontWeight: 700, fontSize: 13, color: '#1F4E79', marginBottom: 6 }}>Loan Repayments</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10.5 }}>
                  <thead>
                    <tr style={{ background: '#1F4E79' }}>
                      {['Date', 'Principal', 'Interest', 'Penalty', 'Deductions', 'Notarial Fee', 'Service Fee', 'Total Amount', 'Reference No.', 'Receipt No.', 'Check No.'].map((h, i) => (
                        <th key={h} style={{ ...thStyle, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} style={{ background: i % 2 === 1 ? '#F7F8FA' : '#fff' }}>
                        <td style={tdStyle}>{formatMDY(r.date)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{formatPlainNumber(r.principal)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{formatPlainNumber(r.interest)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{formatPlainNumber(r.penalty)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{formatPlainNumber(r.deductions)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{formatPlainNumber(r.notarialFee)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{formatPlainNumber(r.serviceFee)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700 }}>{formatPlainNumber(r.totalAmount)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}></td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{r.receiptNo}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}></td>
                      </tr>
                    ))}
                    {isLastPage && (
                      <tr style={{ fontWeight: 700, background: '#EAEEF3' }}>
                        <td style={tdStyle}>Totals:</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{formatPlainNumber(historyTotals.principal)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{formatPlainNumber(historyTotals.interest)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{formatPlainNumber(historyTotals.penalty)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{formatPlainNumber(historyTotals.deductions)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{formatPlainNumber(historyTotals.notarialFee)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{formatPlainNumber(historyTotals.serviceFee)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{formatPlainNumber(historyTotals.totalAmount)}</td>
                        <td style={tdStyle} /><td style={tdStyle} /><td style={tdStyle} />
                      </tr>
                    )}
                  </tbody>
                </table>

                <div style={{ textAlign: 'center', fontSize: 10.5, fontStyle: 'italic', color: '#555', marginTop: 20 }}>
                  Page {pageIndex + 1} of {historyPages.length}
                </div>
              </div>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}
