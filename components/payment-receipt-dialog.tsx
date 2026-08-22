'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency, formatDate, formatTime } from '@/lib/format';
import { connectThermalPrinter, buildPaymentReceiptLines, buildReceiptBytes, writeToPrinter } from '@/lib/thermal-printer';
import { cacheReceiptForOffline } from '@/lib/offline-receipts';
import { Receipt, Download, Bluetooth, Loader2 } from 'lucide-react';

export interface PaymentReceiptData {
  orNumber: string;
  loanNumber: string;
  releaseDate?: string | null;
  dueDate?: string | null;
  customerName: string;
  customerPhone?: string | null;
  currentAddress?: string | null;
  branchName?: string | null;
  areaName?: string | null;
  collectorName?: string | null;
  amount: number;
  // null = collected offline, not yet synced — the true balance can't be
  // known until the atomic apply_loan_payment RPC actually runs, which
  // only happens once signal is back and this gets synced.
  remainingBalance: number | null;
  date: string;
  time?: string | null;
  isFullyPaid?: boolean;
  daysCovered?: number;
  advanceCredit?: number;
}

// Builds the same receiptData shape from a `payments` row (with its
// embedded loans/customers/collectors/receipts) regardless of which page is
// showing it — Payments' own history list, or a loan's Payment History card.
// isFullyPaid/daysCovered/advanceCredit are intentionally left unset here:
// those only make sense at the moment a payment is actually being posted,
// not when re-viewing an already-settled historical record.
export function buildReceiptDataFromPayment(p: any): PaymentReceiptData {
  return {
    orNumber: p.receipts?.or_number ?? '—',
    loanNumber: p.loans?.loan_number ?? '—',
    releaseDate: p.loans?.release_date ?? null,
    dueDate: p.loans?.due_date ?? null,
    customerName: p.loans ? `${p.loans.customers?.first_name ?? ''} ${p.loans.customers?.last_name ?? ''}`.trim() : '—',
    customerPhone: p.loans?.customers?.phone ?? null,
    currentAddress: p.location_address ?? null,
    branchName: p.loans?.branches?.name ?? null,
    areaName: p.loans?.areas?.name ?? null,
    collectorName: p.collectors?.profiles?.full_name ?? null,
    amount: Number(p.amount_paid),
    remainingBalance: Number(p.remaining_balance),
    date: p.payment_date,
    time: p.payment_time ?? null,
  };
}

// Shared "Acknowledgement Receipt" preview + print/download — used by both
// the Payments page (right after posting a collection, or from its history
// list) and a loan's own Payment History card, so the two never drift out
// of sync with each other.
export function PaymentReceiptDialog({ receiptData, onClose }: { receiptData: PaymentReceiptData | null; onClose: () => void }) {
  const { toast } = useToast();
  const receiptRef = useRef<HTMLDivElement>(null);
  const [printingThermal, setPrintingThermal] = useState(false);
  const [downloadingReceipt, setDownloadingReceipt] = useState(false);
  const [generatingInvoice, setGeneratingInvoice] = useState(false);

  // Every receipt that gets shown here, from anywhere in the app, is
  // opportunistically cached to this device while signal is up — so a
  // collector who loses signal in the field can still reprint whatever
  // they already looked at (see lib/offline-receipts.ts).
  useEffect(() => {
    if (receiptData) cacheReceiptForOffline(receiptData);
  }, [receiptData]);

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
        daysCoveredText: isPending
          ? 'PENDING SYNC — not yet confirmed'
          : (receiptData.isFullyPaid
            ? 'Loan fully paid'
            : receiptData.daysCovered === 0
              ? 'Partial Payment'
              : ((receiptData.daysCovered ?? 0) > 0
                ? `Covers ${receiptData.daysCovered} day${(receiptData.daysCovered ?? 0) > 1 ? 's' : ''} of payment`
                : undefined)),
        remainingBalance: isPending ? 'Pending confirmation' : formatCurrency(receiptData.remainingBalance),
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
      toast({ title: 'Download failed', description: err?.message ?? 'Could not generate invoice PDF', variant: 'destructive' });
    }
    setGeneratingInvoice(false);
  }

  if (!receiptData) return null;

  // No remainingBalance means this payment was collected offline and
  // hasn't synced yet — the true balance genuinely isn't known until it
  // does, so this must never claim "PAID" the way a confirmed receipt does.
  const isPending = receiptData.remainingBalance === null;

  return (
    <Dialog open={!!receiptData} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="w-5 h-5" />
            Acknowledgement Receipt
          </DialogTitle>
          <div className="flex justify-center">
            <span
              className="text-xs font-bold px-3 py-1 rounded-full"
              style={isPending
                ? { color: '#B45309', backgroundColor: '#FEF3C7', border: '1px solid #B45309' }
                : { color: '#16A34A', backgroundColor: '#DCFCE7', border: '1px solid #16A34A' }}
            >
              {isPending ? 'PENDING SYNC — NOT YET CONFIRMED' : 'PAID'}
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
            {/* Each branch here must resolve to an actual boolean before the
                final `&&` — `0 && <jsx/>` evaluates to 0, and React renders
                a bare number 0 as literal text "0" (unlike false/null/
                undefined, which render as nothing). That's what caused a
                stray "0" to show up after an underpaid or exact-1-day
                payment. daysCovered === undefined (a reopened historical
                receipt, not a fresh post) still correctly shows nothing. */}
            {!isPending && (receiptData.isFullyPaid ? (
              <p className="text-xs mt-1 font-medium" style={{ color: '#16A34A' }}>Loan fully paid</p>
            ) : receiptData.daysCovered === 0 ? (
              <p className="text-xs mt-1" style={{ color: '#6B7280' }}>Partial Payment</p>
            ) : (receiptData.daysCovered ?? 0) > 0 && (
              <p className="text-xs mt-1" style={{ color: '#6B7280' }}>
                Covers {receiptData.daysCovered} day{(receiptData.daysCovered ?? 0) > 1 ? 's' : ''} of payment
                {(receiptData.advanceCredit ?? 0) > 0.009 && ` + ${formatCurrency(receiptData.advanceCredit!)} advance toward the next day`}
              </p>
            ))}
          </div>

          <div className="rounded-lg p-3 flex justify-between text-sm" style={{ backgroundColor: isPending ? '#FEF3C7' : '#F3F4F6' }}>
            <span style={{ color: '#6B7280' }}>Remaining Balance:</span>
            <span className="font-bold" style={isPending ? { color: '#B45309' } : undefined}>
              {isPending ? 'Pending confirmation' : formatCurrency(receiptData.remainingBalance)}
            </span>
          </div>
          {isPending && (
            <p className="text-xs text-center pt-2" style={{ color: '#B45309' }}>
              Collected without signal — this will be confirmed once synced. Ask the office to confirm the exact balance if needed.
            </p>
          )}

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
          <Button size="sm" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
