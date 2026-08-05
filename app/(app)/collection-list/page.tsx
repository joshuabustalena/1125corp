'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency, formatDate } from '@/lib/format';
import { ClipboardList, Loader2, Download, Printer } from 'lucide-react';

// Printable field worksheet a Cashier hands each collector every morning —
// so they still have every customer's balance/due date on paper if they
// lose signal in the field, and something to write remittance amounts on.
// Generated straight from loans/customers, no table of its own.
const lCell: React.CSSProperties = { border: '1px solid #000', padding: '5px 6px' };
const lCellCenter: React.CSSProperties = { ...lCell, textAlign: 'center' };
const lCellRight: React.CSSProperties = { ...lCell, textAlign: 'right' };

export default function CollectionListPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role_name === 'Administrator';
  const canAccess = isAdmin || profile?.role_name === 'Cashier';
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [branches, setBranches] = useState<any[]>([]);
  const [branchId, setBranchId] = useState('');
  const [collectors, setCollectors] = useState<any[]>([]);
  const [collectorId, setCollectorId] = useState('');
  const [loans, setLoans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadBranches();
    if (!isAdmin && profile?.branch_id) setBranchId(profile.branch_id);
  }, [profile]);

  useEffect(() => {
    if (!branchId) return;
    loadCollectors();
  }, [branchId]);

  useEffect(() => {
    if (!collectorId) { setLoans([]); setLoading(false); return; }
    loadLoans();
  }, [collectorId, collectors]);

  async function loadBranches() {
    const { data } = await supabase.from('branches').select('id, name').eq('status', 'active').order('name');
    setBranches(data ?? []);
    if (data && data.length > 0 && isAdmin && !branchId) setBranchId(data[0].id);
  }

  async function loadCollectors() {
    setLoading(true);
    const { data } = await supabase
      .from('collectors')
      .select('id, area_id, profile_id, profiles(full_name), areas(name)')
      .eq('branch_id', branchId)
      .eq('status', 'active');
    const sorted = (data ?? []).slice().sort((a: any, b: any) => (a.areas?.name ?? '').localeCompare(b.areas?.name ?? ''));
    setCollectors(sorted);
    if (sorted.length > 0 && !sorted.some((c: any) => c.id === collectorId)) {
      setCollectorId(sorted[0].id);
    } else if (sorted.length === 0) {
      setCollectorId('');
    }
    setLoading(false);
  }

  async function loadLoans() {
    setLoading(true);
    // Scoped by the collector's AREA (via the customer's area_id), not the
    // loan's own collector_id — same reasoning as the Customers/Loans page
    // fix earlier: a loan's collector_id isn't reliably kept in sync
    // (older loans especially), while every customer's area_id is the
    // real, trustworthy assignment.
    const currentCollector = collectors.find(c => c.id === collectorId);
    const areaId = currentCollector?.area_id;
    if (!areaId) { setLoans([]); setLoading(false); return; }
    const { data } = await supabase
      .from('loans')
      .select('*, customers!inner(first_name, last_name, area_id)')
      .eq('status', 'active')
      .eq('customers.area_id', areaId);
    const sorted = (data ?? []).slice().sort((a: any, b: any) =>
      `${a.customers?.first_name ?? ''} ${a.customers?.last_name ?? ''}`.localeCompare(`${b.customers?.first_name ?? ''} ${b.customers?.last_name ?? ''}`)
    );
    setLoans(sorted);
    setLoading(false);
  }

  const collector = collectors.find(c => c.id === collectorId);
  const today = new Date();
  const rows = loans.map(l => ({
    id: l.id,
    borrowerName: `${l.customers?.first_name ?? ''} ${l.customers?.last_name ?? ''}`.trim(),
    dateReleased: l.release_date,
    dueDate: l.due_date,
    amountRelease: Number(l.release_amount) || 0,
    // Same "past due_date" rule the Dashboard/Reports use for Overdue
    // Amount — the full remaining balance counts once the loan's due date
    // has passed, not a partial daily-arrears figure.
    amountOverdue: l.due_date && new Date(l.due_date) < today ? Number(l.remaining_balance) || 0 : 0,
    dailyPayment: Number(l.daily_payment) || 0,
    balance: Number(l.remaining_balance) || 0,
  }));
  const totalOverdue = rows.reduce((s, r) => s + r.amountOverdue, 0);
  const totalBalance = rows.reduce((s, r) => s + r.balance, 0);

  async function handleDownloadPdf() {
    if (!printRef.current) return;
    setDownloading(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const { jsPDF } = await import('jspdf');
      const canvas = await html2canvas(printRef.current, { backgroundColor: '#ffffff', scale: 2, width: 1000, windowWidth: 1000 });
      const imgData = canvas.toDataURL('image/png');
      const pxToPt = 0.75;
      const contentWidthPt = (canvas.width / 2) * pxToPt;
      const contentHeightPt = (canvas.height / 2) * pxToPt;
      // Landscape Letter (11" x 8.5") — this worksheet is a wide table, not
      // a signed paper form, so it doesn't need the folio size every other
      // document in the app uses.
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: [792, 612] });
      const margin = 24;
      const usableWidth = pdf.internal.pageSize.getWidth() - margin * 2;
      const imgWidth = usableWidth;
      const imgHeight = (contentHeightPt / contentWidthPt) * imgWidth;
      pdf.addImage(imgData, 'PNG', margin, margin, imgWidth, imgHeight);
      pdf.save(`collection-list-${collector?.areas?.name ?? ''}-${date}.pdf`);
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error(err);
    }
    setDownloading(false);
  }

  async function handlePrint() {
    if (!printRef.current) return;
    setPrinting(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(printRef.current, { backgroundColor: '#ffffff', scale: 2, width: 1000, windowWidth: 1000 });
      const dataUrl = canvas.toDataURL('image/png');
      const printWindow = window.open('', '_blank', 'width=1100,height=850');
      if (!printWindow) {
        setPrinting(false);
        return;
      }
      printWindow.document.write(`
        <html>
          <head><title>Collection List — ${collector?.areas?.name ?? ''}</title></head>
          <body style="margin:0;padding:0;background:#fff;">
            <img src="${dataUrl}" style="width:100%;display:block;" />
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.onload = () => printWindow.print();
      printWindow.onafterprint = () => printWindow.close();
    } catch {
      // no-op — same as Download, a failed capture just leaves nothing open
    }
    setPrinting(false);
  }

  if (!canAccess) {
    return <p className="text-center text-muted-foreground py-16">You do not have access to this page.</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Collection List" description="Printable per-collector worksheet to carry in the field">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" />
        {isAdmin && (
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Select branch" /></SelectTrigger>
            <SelectContent>
              {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Select value={collectorId} onValueChange={setCollectorId}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Select collector" /></SelectTrigger>
          <SelectContent>
            {collectors.map(c => <SelectItem key={c.id} value={c.id}>{c.areas?.name ?? '—'} — {c.profiles?.full_name ?? '—'}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button type="button" variant="outline" size="sm" onClick={handlePrint} disabled={printing || rows.length === 0}>
          {printing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Printer className="w-4 h-4 mr-2" />}
          Print
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={handleDownloadPdf} disabled={downloading || rows.length === 0}>
          {downloading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
          Download PDF
        </Button>
      </PageHeader>

      <Card className="glass-card border-border">
        <CardHeader>
          <CardTitle>{collector ? `${collector.areas?.name ?? ''} — ${collector.profiles?.full_name ?? ''}` : 'Select a collector'}</CardTitle>
          <CardDescription>Every active loan currently assigned to this collector, as of {formatDate(date)}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ClipboardList className="w-12 h-12 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">No active loans for this collector</p>
            </div>
          ) : (
            <div className="overflow-x-auto p-4">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ ...lCellCenter, fontWeight: 700 }}>Borrower Name</th>
                    <th style={{ ...lCellCenter, fontWeight: 700 }}>Date Released</th>
                    <th style={{ ...lCellCenter, fontWeight: 700 }}>Due Date</th>
                    <th style={{ ...lCellCenter, fontWeight: 700 }}>Amount Release</th>
                    <th style={{ ...lCellCenter, fontWeight: 700 }}>Amount Delayed/Overdue</th>
                    <th style={{ ...lCellCenter, fontWeight: 700 }}>Daily Payment</th>
                    <th style={{ ...lCellCenter, fontWeight: 700 }}>Balance</th>
                    <th style={{ ...lCellCenter, fontWeight: 700 }}>Payment Received</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id}>
                      <td style={lCell}>{r.borrowerName}</td>
                      <td style={lCellCenter}>{formatDate(r.dateReleased)}</td>
                      <td style={lCellCenter}>{formatDate(r.dueDate)}</td>
                      <td style={lCellRight}>{formatCurrency(r.amountRelease)}</td>
                      <td style={lCellRight}>{r.amountOverdue > 0 ? formatCurrency(r.amountOverdue) : ''}</td>
                      <td style={lCellRight}>{formatCurrency(r.dailyPayment)}</td>
                      <td style={lCellRight}>{formatCurrency(r.balance)}</td>
                      <td style={{ ...lCell, height: 28 }}>&nbsp;</td>
                    </tr>
                  ))}
                  <tr>
                    <td style={{ ...lCell, fontWeight: 700 }} colSpan={3}>Total</td>
                    <td style={lCell} />
                    <td style={{ ...lCellRight, fontWeight: 700 }}>{formatCurrency(totalOverdue)}</td>
                    <td style={lCell} />
                    <td style={{ ...lCellRight, fontWeight: 700 }}>{formatCurrency(totalBalance)}</td>
                    <td style={lCell} />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Hidden printable copy, matching the paper Collection List sheet. */}
      {typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', top: 0, left: 0, opacity: 0, pointerEvents: 'none', zIndex: -1 }}>
          <div ref={printRef} style={{ width: 1000, background: '#fff', color: '#111', padding: 32, fontFamily: '"Times New Roman", Calibri, serif' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 10 }}>
              <span><strong>Date:</strong> {formatDate(date)}</span>
              <span style={{ fontWeight: 700 }}>Collection List — {collector?.areas?.name ?? ''} {collector?.profiles?.full_name ?? ''}</span>
              <span>&nbsp;</span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ ...lCellCenter, fontWeight: 700 }}>Borrower Name</th>
                  <th style={{ ...lCellCenter, fontWeight: 700 }}>Date Released</th>
                  <th style={{ ...lCellCenter, fontWeight: 700 }}>Due Date</th>
                  <th style={{ ...lCellCenter, fontWeight: 700 }}>Amount Release</th>
                  <th style={{ ...lCellCenter, fontWeight: 700 }}>Amount Delayed/Over due</th>
                  <th style={{ ...lCellCenter, fontWeight: 700 }}>Daily Payment</th>
                  <th style={{ ...lCellCenter, fontWeight: 700 }}>Balance</th>
                  <th style={{ ...lCellCenter, fontWeight: 700 }}>Payment Received</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td style={lCell}>{r.borrowerName}</td>
                    <td style={lCellCenter}>{formatDate(r.dateReleased)}</td>
                    <td style={lCellCenter}>{formatDate(r.dueDate)}</td>
                    <td style={lCellRight}>{formatCurrency(r.amountRelease)}</td>
                    <td style={lCellRight}>{r.amountOverdue > 0 ? formatCurrency(r.amountOverdue) : ''}</td>
                    <td style={lCellRight}>{formatCurrency(r.dailyPayment)}</td>
                    <td style={lCellRight}>{formatCurrency(r.balance)}</td>
                    <td style={{ ...lCell, height: 28 }}>&nbsp;</td>
                  </tr>
                ))}
                <tr>
                  <td style={{ ...lCell, fontWeight: 700 }} colSpan={3}>Total</td>
                  <td style={lCell} />
                  <td style={{ ...lCellRight, fontWeight: 700 }}>{formatCurrency(totalOverdue)}</td>
                  <td style={lCell} />
                  <td style={{ ...lCellRight, fontWeight: 700 }}>{formatCurrency(totalBalance)}</td>
                  <td style={lCell} />
                </tr>
              </tbody>
            </table>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
