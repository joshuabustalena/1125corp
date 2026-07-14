'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
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
import {
  ArrowLeft, Landmark, Wallet, Receipt, Download, Loader2, ExternalLink,
} from 'lucide-react';

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
  const receiptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadData();
  }, [loanId]);

  async function loadData() {
    setLoading(true);
    const { data: loanData } = await supabase
      .from('loans')
      .select('id, loan_number, status, remaining_balance, total_payable, customer_id, customers(first_name, last_name, phone), branches(name), areas(name), collectors(profiles(full_name))')
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
        <Button size="sm" onClick={handleExport} disabled={payments.length === 0}>
          <Download className="w-4 h-4 mr-2" />
          Export CSV
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
    </div>
  );
}
