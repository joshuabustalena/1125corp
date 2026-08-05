'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency, formatDate, numberToWordsPeso } from '@/lib/format';
import { COMPANY_NAME_DISPLAY, getDocumentBranding } from '@/lib/document-branding';
import { postJournalEntry } from '@/lib/ledger';
import { getNextVoucherNumber } from '@/lib/voucher-numbers';
import { Fuel, Loader2, Download, Printer } from 'lucide-react';

const gCell: React.CSSProperties = { border: '1px solid #000', padding: '5px 8px' };
const gCellCenter: React.CSSProperties = { ...gCell, textAlign: 'center' };

export default function GasVoucherPage() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const isAdmin = profile?.role_name === 'Administrator';
  const canGenerate = isAdmin || profile?.role_name === 'Cashier';
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [branches, setBranches] = useState<any[]>([]);
  const [branchId, setBranchId] = useState('');
  const [collectors, setCollectors] = useState<any[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [voucherNumber, setVoucherNumber] = useState('—');
  const [cashAccountCode, setCashAccountCode] = useState('1000');
  const [cashierOptions, setCashierOptions] = useState<{ id: string; full_name: string }[]>([]);
  const [managerOptions, setManagerOptions] = useState<{ id: string; full_name: string }[]>([]);
  const [cashierName, setCashierName] = useState('');
  const [branchManagerName, setBranchManagerName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [historyVoucher, setHistoryVoucher] = useState<any | null>(null);
  const [printingHistoryId, setPrintingHistoryId] = useState<string | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadBranches();
    if (!isAdmin && profile?.branch_id) {
      setBranchId(profile.branch_id);
    }
  }, [profile]);

  useEffect(() => { getNextVoucherNumber().then(setVoucherNumber); }, []);

  useEffect(() => {
    if (!branchId) return;
    loadData();
  }, [branchId, date]);

  async function loadBranches() {
    const { data } = await supabase.from('branches').select('id, name').eq('status', 'active').order('name');
    setBranches(data ?? []);
    // Only auto-pick the first branch for Admin — a Cashier's branchId is
    // set from their profile in the effect above, and must not be
    // overwritten once this (slower) fetch resolves.
    if (data && data.length > 0 && isAdmin && !branchId) setBranchId(data[0].id);
  }

  async function loadData() {
    setLoading(true);
    const [{ data: cols }, { data: staff }, { data: hist }] = await Promise.all([
      supabase.from('collectors').select('id, profile_id, profiles(full_name)').eq('branch_id', branchId).eq('status', 'active').order('id'),
      // Proxy Collectors and the Branch Manager aren't in the `collectors`
      // table (that's Field Collector-only), but they can also receive a
      // gas allowance — pull them straight from profiles for this branch.
      supabase.from('profiles').select('id, full_name, roles(name)').eq('branch_id', branchId).eq('status', 'active'),
      supabase.from('gas_vouchers').select('*').eq('branch_id', branchId).order('voucher_date', { ascending: false }).order('created_at', { ascending: false }).limit(30),
    ]);

    const staffRows = (staff ?? []) as any[];
    const extraPayees = staffRows
      .filter(p => ['Branch Proxy Collector', 'Branch Manager'].includes(p.roles?.name))
      .map(p => ({ id: p.id, profile_id: p.id, profiles: { full_name: p.full_name } }));
    const merged = [...(cols ?? []), ...extraPayees];
    const sortedCollectors = merged.slice().sort((a: any, b: any) => (a.profiles?.full_name ?? '').localeCompare(b.profiles?.full_name ?? ''));
    setCollectors(sortedCollectors);
    setAmounts(prev => {
      const next: Record<string, string> = {};
      for (const c of sortedCollectors) next[c.id] = prev[c.id] ?? '';
      return next;
    });

    // Cashier/Branch Manager names for the signature block are chosen from
    // whoever actually holds that role at this branch — not freely typed —
    // per the client's request. A branch can have more than one Cashier, so
    // this is a pickable list rather than a single forced match; it
    // defaults to the first one (or the logged-in user's own name if they
    // happen to be one of the Cashiers) and re-picks only if the
    // previously-selected name isn't in the new branch's list.
    const branchCashiers = staffRows.filter(p => p.roles?.name === 'Cashier');
    const branchManagers = staffRows.filter(p => p.roles?.name === 'Branch Manager');
    setCashierOptions(branchCashiers);
    setManagerOptions(branchManagers);
    setCashierName(prev => {
      if (branchCashiers.some(p => p.full_name === prev)) return prev;
      const asSelf = branchCashiers.find(p => p.full_name === profile?.full_name);
      return (asSelf ?? branchCashiers[0])?.full_name ?? '';
    });
    setBranchManagerName(prev => {
      if (branchManagers.some(p => p.full_name === prev)) return prev;
      return branchManagers[0]?.full_name ?? '';
    });

    setHistory(hist ?? []);
    setLoading(false);
  }

  function updateAmount(collectorId: string, value: string) {
    const cleaned = value.replace(/[^0-9.]/g, '');
    setAmounts(prev => ({ ...prev, [collectorId]: cleaned }));
  }

  const grandTotal = collectors.reduce((sum, c) => sum + (Number(amounts[c.id]) || 0), 0);
  const branch = branches.find(b => b.id === branchId);
  const branding = getDocumentBranding(branch?.name);

  // Same live-vs-history swap used by the other vouchers — printed*
  // sources from the saved record when re-printing from History,
  // otherwise from the live form above.
  const printedVoucher = historyVoucher;
  const printedVoucherNumber = printedVoucher ? printedVoucher.voucher_number : voucherNumber;
  const printedDate = printedVoucher ? printedVoucher.voucher_date : date;
  const printedBranch = printedVoucher ? branches.find(b => b.id === printedVoucher.branch_id) : branch;
  const printedBranding = getDocumentBranding(printedBranch?.name);
  const printedLines: { key: string; name: string; amount: number }[] = printedVoucher
    ? (printedVoucher.lines ?? []).map((l: any) => ({ key: l.collector_id, name: l.name, amount: Number(l.amount) || 0 }))
    : collectors.map(c => ({ key: c.id, name: c.profiles?.full_name ?? '', amount: Number(amounts[c.id]) || 0 }));
  const printedTotal = printedVoucher ? Number(printedVoucher.total_amount) || 0 : grandTotal;
  const printedCashierName = printedVoucher ? (printedVoucher.cashier_name ?? '') : cashierName;
  const printedBranchManagerName = printedVoucher ? (printedVoucher.branch_manager_name ?? '') : branchManagerName;

  useEffect(() => {
    // Only auto-print when the row's Print action (not the live form) set
    // this — it stamps printingHistoryId at the same time.
    if (!historyVoucher || printingHistoryId !== historyVoucher.id) return;
    (async () => {
      await handlePrint();
      setHistoryVoucher(null);
      setPrintingHistoryId(null);
    })();
  }, [historyVoucher, printingHistoryId]);

  async function handleGenerate() {
    if (!branchId || grandTotal <= 0) return;
    setSaving(true);
    const lines = collectors.map(c => ({
      collector_id: c.id,
      name: c.profiles?.full_name ?? '',
      amount: Number(amounts[c.id]) || 0,
    }));

    const { data: voucher, error } = await supabase.from('gas_vouchers').insert({
      voucher_number: voucherNumber,
      branch_id: branchId,
      voucher_date: date,
      lines,
      total_amount: grandTotal,
      cash_account_code: cashAccountCode,
      prepared_by: profile?.id ?? null,
      cashier_name: cashierName || null,
      branch_manager_name: branchManagerName || null,
    }).select('id').single();

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      setSaving(false);
      return;
    }

    await postJournalEntry({
      entryDate: date,
      description: `Gas Allowance — ${branch?.name ?? ''} — ${formatDate(date)}`,
      reference: voucherNumber,
      source: 'gas_voucher',
      sourceId: voucher?.id ?? null,
      createdBy: profile?.id ?? null,
      lines: [
        { accountCode: '5020', debit: grandTotal, memo: 'Transportation Expense (Gas)' },
        { accountCode: cashAccountCode, credit: grandTotal, memo: cashAccountCode === '1010' ? 'Cash in Bank' : 'Cash in Vault' },
      ],
    });

    toast({ title: 'Success', description: 'Gas voucher generated and journal entry posted' });
    getNextVoucherNumber().then(setVoucherNumber);
    loadData();
    setSaving(false);
  }

  async function handlePrint() {
    if (!printRef.current) return;
    setPrinting(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(printRef.current, { backgroundColor: '#ffffff', scale: 2, width: 900, windowWidth: 900 });
      const dataUrl = canvas.toDataURL('image/png');
      const printWindow = window.open('', '_blank', 'width=900,height=1000');
      if (!printWindow) {
        toast({ title: 'Print blocked', description: 'Please allow pop-ups for this site to print the gas voucher', variant: 'destructive' });
        setPrinting(false);
        return;
      }
      printWindow.document.write(`
        <html>
          <head><title>Gas Voucher ${printedVoucherNumber}</title></head>
          <body style="margin:0;padding:0;background:#fff;">
            <img src="${dataUrl}" style="width:100%;display:block;" />
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.onload = () => printWindow.print();
      printWindow.onafterprint = () => printWindow.close();
    } catch (err: any) {
      toast({ title: 'Print failed', description: err?.message ?? 'Could not generate the gas voucher for printing', variant: 'destructive' });
    }
    setPrinting(false);
  }

  async function handleDownloadPdf() {
    if (!printRef.current) return;
    setDownloading(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const { jsPDF } = await import('jspdf');
      const canvas = await html2canvas(printRef.current, { backgroundColor: '#ffffff', scale: 2, width: 900, windowWidth: 900 });
      const imgData = canvas.toDataURL('image/png');
      const pxToPt = 0.75;
      const contentWidthPt = (canvas.width / 2) * pxToPt;
      const contentHeightPt = (canvas.height / 2) * pxToPt;
      // 8.5" x 11" (US Letter) — matches the general Cash Voucher's size.
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: [612, 792] });
      const margin = 24;
      const usableWidth = pdf.internal.pageSize.getWidth() - margin * 2;
      const imgWidth = usableWidth;
      const imgHeight = (contentHeightPt / contentWidthPt) * imgWidth;
      pdf.addImage(imgData, 'PNG', margin, margin, imgWidth, imgHeight);
      pdf.save(`gas-voucher-${voucherNumber}.pdf`);
    } catch (err: any) {
      toast({ title: 'Download failed', description: err?.message ?? 'Could not generate the gas voucher PDF', variant: 'destructive' });
    }
    setDownloading(false);
  }

  if (!canGenerate && !loading) {
    return <p className="text-center text-muted-foreground py-16">You do not have access to this page.</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Gas Voucher" description="Generate the daily gas allowance voucher per collector">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" />
        {isAdmin && (
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Select branch" /></SelectTrigger>
            <SelectContent>
              {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Button type="button" variant="outline" size="sm" onClick={handlePrint} disabled={printing || grandTotal <= 0}>
          {printing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Printer className="w-4 h-4 mr-2" />}
          Print
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={handleDownloadPdf} disabled={downloading || grandTotal <= 0}>
          {downloading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
          Download PDF
        </Button>
      </PageHeader>

      <Card className="glass-card border-border">
        <CardHeader>
          <CardTitle>Collectors — {branch?.name ?? '—'}</CardTitle>
          <CardDescription>Enter today's gas allowance per collector, then Generate to save and post the journal entry</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : collectors.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Fuel className="w-12 h-12 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">No collectors found for this branch</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="divide-y divide-border border border-border rounded-lg overflow-hidden">
                {collectors.map(c => (
                  <div key={c.id} className="flex items-center justify-between gap-4 p-3">
                    <span className="text-sm font-medium">{c.profiles?.full_name ?? '—'}</span>
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={amounts[c.id] ?? ''}
                      onChange={(e) => updateAmount(c.id, e.target.value)}
                      placeholder="0.00"
                      className="w-32 text-right"
                    />
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs">Source Cash Account *</Label>
                  <Select value={cashAccountCode} onValueChange={setCashAccountCode}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1000">Cash in Vault (Cash on Hand)</SelectItem>
                      <SelectItem value="1010">Cash in Bank</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {/* Chosen from whoever holds the Cashier/Branch Manager role
                    at this branch — not manually typed. A dropdown appears
                    only when the branch has more than one; otherwise it's
                    just the single match (or "—" if none). */}
                <div className="space-y-2">
                  <Label className="text-xs">Disbursed & Prepared by (Cashier)</Label>
                  {cashierOptions.length > 1 ? (
                    <Select value={cashierName} onValueChange={setCashierName}>
                      <SelectTrigger><SelectValue placeholder="Select cashier" /></SelectTrigger>
                      <SelectContent>{cashierOptions.map(c => <SelectItem key={c.id} value={c.full_name}>{c.full_name}</SelectItem>)}</SelectContent>
                    </Select>
                  ) : (
                    <p className="h-10 flex items-center px-3 rounded-md border border-border bg-secondary/30 text-sm">{cashierName || '—'}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Approved by (Branch Manager)</Label>
                  {managerOptions.length > 1 ? (
                    <Select value={branchManagerName} onValueChange={setBranchManagerName}>
                      <SelectTrigger><SelectValue placeholder="Select branch manager" /></SelectTrigger>
                      <SelectContent>{managerOptions.map(m => <SelectItem key={m.id} value={m.full_name}>{m.full_name}</SelectItem>)}</SelectContent>
                    </Select>
                  ) : (
                    <p className="h-10 flex items-center px-3 rounded-md border border-border bg-secondary/30 text-sm">{branchManagerName || '—'}</p>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">Grand Total: <span className="font-semibold text-foreground">{formatCurrency(grandTotal)}</span></p>
                <Button type="button" onClick={handleGenerate} disabled={saving || !branchId || grandTotal <= 0}>
                  {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Generate
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="glass-card border-border">
        <CardHeader><CardTitle>History</CardTitle><CardDescription>Last 30 gas vouchers for this branch</CardDescription></CardHeader>
        <CardContent className="p-0">
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No gas vouchers generated yet</p>
          ) : (
            <>
            <div className="md:hidden divide-y divide-border">
              {history.map(h => (
                <div key={h.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-xs text-muted-foreground">{h.voucher_number}</p>
                      <p className="font-medium text-sm">{formatDate(h.voucher_date)}</p>
                    </div>
                    <Badge variant="outline">{formatCurrency(h.total_amount)}</Badge>
                  </div>
                </div>
              ))}
            </div>
            <Table className="hidden md:table">
              <TableHeader>
                <TableRow>
                  <TableHead>Voucher #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Collectors Paid</TableHead>
                  <TableHead>Total Amount</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map(h => (
                  <TableRow key={h.id}>
                    <TableCell className="text-sm font-mono">{h.voucher_number}</TableCell>
                    <TableCell className="text-sm">{formatDate(h.voucher_date)}</TableCell>
                    <TableCell className="text-sm">{((h.lines ?? []) as any[]).filter(l => Number(l.amount) > 0).length}</TableCell>
                    <TableCell className="text-sm font-medium">{formatCurrency(h.total_amount)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Print"
                        disabled={printingHistoryId === h.id}
                        onClick={() => { setPrintingHistoryId(h.id); setHistoryVoucher(h); }}
                      >
                        {printingHistoryId === h.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </>
          )}
        </CardContent>
      </Card>

      {/* Hidden printable Gas Voucher, matching the company's paper Cash
          Voucher (Gas Allowance) form. Portaled onto <body> so no ancestor
          layout affects the html2canvas capture. */}
      {typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', top: 0, left: 0, opacity: 0, pointerEvents: 'none', zIndex: -1 }}>
          <div ref={printRef} style={{ width: 900, background: '#fff', color: '#111', padding: 40, fontFamily: '"Times New Roman", Calibri, serif' }}>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16 }}>
              <img src="/image/1125_Corp_Logo.png" alt="1125Corp" style={{ width: 64, height: 64, objectFit: 'contain' }} />
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontWeight: 700, fontSize: 16, color: '#1F4E79' }}>{COMPANY_NAME_DISPLAY}</div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#1F4E79' }}>{printedBranding.address}</div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#1F4E79' }}>Cel. No. {printedBranding.contact}</div>
              </div>
            </div>
            <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 18, color: '#1F4E79', marginTop: 8, marginBottom: 16 }}>CASH VOUCHER</div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'baseline', fontSize: 13, marginBottom: 10 }}>
              <span style={{ textDecoration: 'underline' }}><strong>PARTICULARS:</strong></span>
              <span style={{ fontWeight: 700, fontSize: 16, textAlign: 'center', whiteSpace: 'nowrap' }}>Gas Allowance</span>
              <span style={{ textAlign: 'right' }}><strong>Date</strong>&nbsp;&nbsp;&nbsp;&nbsp;{formatDate(printedDate)}</span>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <colgroup>
                <col style={{ width: '24%' }} />
                <col style={{ width: '36%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '26%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ ...gCellCenter, fontWeight: 700 }}>PAID TO:</th>
                  <th colSpan={2} style={{ ...gCellCenter, fontWeight: 700 }}>AMOUNT</th>
                  <th style={{ ...gCellCenter, fontWeight: 700 }}>
                    <div>Received by:</div>
                    <div style={{ fontWeight: 400 }}>(Signature)</div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {printedLines.map(l => (
                  <tr key={l.key}>
                    <td style={{ ...gCell, fontWeight: 700 }}>{l.name}</td>
                    <td style={gCell}>{l.amount > 0 ? numberToWordsPeso(l.amount) : ''}</td>
                    <td style={gCellCenter}>{l.amount > 0 ? l.amount.toFixed(2) : ''}</td>
                    <td style={{ ...gCell, height: 28 }}>&nbsp;</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 24, fontWeight: 700, fontSize: 13, paddingTop: 10 }}>
              <span>Grand Total:</span>
              <span style={{ minWidth: 90, textAlign: 'right' }}>{printedTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 32 }}>
              <tbody>
                <tr>
                  <td style={{ border: 'none', width: '50%', paddingBottom: 30 }}>Disbursed &amp; Prepared by:</td>
                  <td style={{ border: 'none', textAlign: 'right', paddingBottom: 30 }}>Approved by:</td>
                </tr>
                <tr>
                  <td style={{ border: 'none', textDecoration: 'underline' }}>{printedCashierName || ' '}</td>
                  <td style={{ border: 'none', textAlign: 'right', textDecoration: 'underline' }}>{printedBranchManagerName || ' '}</td>
                </tr>
                <tr>
                  <td style={{ border: 'none', paddingTop: 2 }}>Cashier</td>
                  <td style={{ border: 'none', textAlign: 'right', paddingTop: 2 }}>Branch Manager</td>
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
