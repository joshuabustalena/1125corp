'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { DocumentScaler } from '@/components/document-scaler';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency, formatDate, formatTime, numberToWordsPeso } from '@/lib/format';
import { getNextVoucherNumber } from '@/lib/voucher-numbers';
import { postJournalEntry } from '@/lib/ledger';
import { Wallet2, Plus, Trash2, Download, Loader2, Eye, Printer } from 'lucide-react';

// Every journal entry that credits a Cash account (Cash on Hand a.k.a.
// "Cash in Vault", or Cash in Bank) needs a voucher as proof of
// disbursement, per the client's rule. Gas Voucher, Payroll Voucher, and
// 13th Month Voucher already cover their own specific cases with their own
// auto journal entry — this is the catch-all for everything else (repairs,
// one-off cash expenses, an employee loan payout recorded directly, etc).
type CashVoucherLine = { account_code: string; amount: string };

export default function CashVouchersPage() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const isAdmin = profile?.role_name === 'Administrator';
  const canGenerate = isAdmin || profile?.role_name === 'Cashier';

  const [branches, setBranches] = useState<any[]>([]);
  const [branchId, setBranchId] = useState('');
  const [accounts, setAccounts] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [voucherNumber, setVoucherNumber] = useState('—');
  const [payee, setPayee] = useState('');
  const [particulars, setParticulars] = useState('');
  const [voucherDate, setVoucherDate] = useState(new Date().toISOString().split('T')[0]);
  const [cashAccountCode, setCashAccountCode] = useState('1000');
  const [lines, setLines] = useState<CashVoucherLine[]>([{ account_code: '', amount: '' }]);
  const [preparedByName, setPreparedByName] = useState('');
  const [approvedByName, setApprovedByName] = useState('');
  const [cashierOptions, setCashierOptions] = useState<{ id: string; full_name: string }[]>([]);
  const [managerOptions, setManagerOptions] = useState<{ id: string; full_name: string }[]>([]);

  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [historyPreview, setHistoryPreview] = useState<any | null>(null);
  const [downloadingHistoryId, setDownloadingHistoryId] = useState<string | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadAccounts();
    loadBranches();
    loadHistory();
    getNextVoucherNumber().then(setVoucherNumber);
  }, []);

  useEffect(() => {
    if (!isAdmin && profile?.branch_id) setBranchId(profile.branch_id);
    if (profile?.full_name) setPreparedByName(profile.full_name);
  }, [profile]);

  useEffect(() => {
    if (!branchId) return;
    loadStaffOptions();
  }, [branchId]);

  // Approved By is chosen from whoever holds the Branch Manager role at the
  // selected branch — not freely typed — same pattern as Gas Voucher and
  // Cash Count. Prepared By works differently here: an Admin generating a
  // voucher IS the one preparing it (they aren't a branch Cashier), so it's
  // always just their own name, no picking; only when the logged-in user is
  // the Cashier themselves does Prepared By pick from that branch's actual
  // Cashiers (in case there's more than one).
  async function loadStaffOptions() {
    const { data: staff } = await supabase.from('profiles').select('id, full_name, roles(name)').eq('branch_id', branchId).eq('status', 'active');
    const rows = (staff ?? []) as any[];
    const branchCashiers = rows.filter(p => p.roles?.name === 'Cashier');
    const branchManagers = rows.filter(p => p.roles?.name === 'Branch Manager');
    setManagerOptions(branchManagers);
    if (isAdmin) {
      setCashierOptions([]);
      setPreparedByName(profile?.full_name ?? '');
    } else {
      setCashierOptions(branchCashiers);
      setPreparedByName(prev => {
        if (branchCashiers.some(p => p.full_name === prev)) return prev;
        const asSelf = branchCashiers.find(p => p.full_name === profile?.full_name);
        return (asSelf ?? branchCashiers[0])?.full_name ?? profile?.full_name ?? '';
      });
    }
    setApprovedByName(prev => {
      if (branchManagers.some(p => p.full_name === prev)) return prev;
      return branchManagers[0]?.full_name ?? '';
    });
  }

  async function loadAccounts() {
    const { data } = await supabase.from('chart_of_accounts').select('*').order('code');
    setAccounts(data ?? []);
  }

  async function loadBranches() {
    const { data } = await supabase.from('branches').select('id, name').eq('status', 'active').order('name');
    setBranches(data ?? []);
    // Only auto-pick the first branch for Admin — a Cashier's branchId is
    // set from their profile in the effect above, and must not be
    // overwritten once this (slower) fetch resolves.
    if (data && data.length > 0 && isAdmin && !branchId) setBranchId(data[0].id);
  }

  async function loadHistory() {
    setLoading(true);
    const { data } = await supabase.from('general_cash_vouchers').select('*').order('voucher_date', { ascending: false }).order('created_at', { ascending: false }).limit(30);
    setHistory(data ?? []);
    setLoading(false);
  }

  // Every cash-on-hand/in-bank account is a valid voucher source, except
  // Petty Cash Fund — same rule as Remittance's Cash Account picker.
  const cashAccounts = accounts.filter(a =>
    a.name.toLowerCase().includes('cash') && !a.name.toLowerCase().includes('petty cash')
  );
  // Petty Cash Fund specifically is also off-limits on the debit
  // ("Account - Description") side — every other account (including other
  // cash accounts) is still selectable there.
  const debitableAccounts = accounts.filter(a => !a.name.toLowerCase().includes('petty cash'));

  function addLine() {
    setLines(prev => [...prev, { account_code: '', amount: '' }]);
  }
  function removeLine(i: number) {
    setLines(prev => prev.filter((_, idx) => idx !== i));
  }
  function updateLine(i: number, field: keyof CashVoucherLine, value: string) {
    setLines(prev => prev.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)));
  }

  const resolvedLines = lines
    .filter(l => l.account_code && Number(l.amount) > 0)
    .map(l => {
      const acct = accounts.find(a => a.code === l.account_code);
      return { account_code: l.account_code, account_name: acct?.name ?? '', amount: Number(l.amount) };
    });
  const totalAmount = resolvedLines.reduce((sum, l) => sum + l.amount, 0);

  function resetForm() {
    setPayee('');
    setParticulars('');
    setLines([{ account_code: '', amount: '' }]);
    setApprovedByName('');
  }

  async function handleGenerate() {
    if (!payee || !particulars || resolvedLines.length === 0 || !branchId) return;
    setSaving(true);

    const { data: voucher, error } = await supabase.from('general_cash_vouchers').insert({
      voucher_number: voucherNumber,
      payee,
      particulars,
      voucher_date: voucherDate,
      cash_account_code: cashAccountCode,
      lines: resolvedLines,
      total_amount: totalAmount,
      prepared_by_name: preparedByName || null,
      approved_by_name: approvedByName || null,
      branch_id: branchId || null,
      created_by: profile?.id ?? null,
    }).select('id').single();

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      setSaving(false);
      return;
    }

    await postJournalEntry({
      entryDate: voucherDate,
      description: `Cash Voucher — ${particulars}`,
      reference: voucherNumber,
      source: 'general_cash_voucher',
      sourceId: voucher?.id ?? null,
      createdBy: profile?.id ?? null,
      lines: [
        ...resolvedLines.map(l => ({ accountCode: l.account_code, debit: l.amount, memo: particulars })),
        { accountCode: cashAccountCode, credit: totalAmount, memo: `Cash Voucher — ${payee}` },
      ],
    });

    toast({ title: 'Success', description: 'Cash voucher generated and journal entry posted' });
    await handleDownloadPdf(voucherNumber);
    getNextVoucherNumber().then(setVoucherNumber);
    resetForm();
    loadHistory();
    setSaving(false);
  }

  async function handleDownloadPdf(voucherNumberOverride?: string) {
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
      // 8.5" x 11" (US Letter) — this voucher is the exception to the
      // 8.5x13 "folio" size every other document in the app uses.
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: [612, 792] });
      const margin = 24;
      const usableWidth = pdf.internal.pageSize.getWidth() - margin * 2;
      const imgWidth = usableWidth;
      const imgHeight = (contentHeightPt / contentWidthPt) * imgWidth;
      pdf.addImage(imgData, 'PNG', margin, margin, imgWidth, imgHeight);
      pdf.save(`cash-voucher-${voucherNumberOverride ?? voucherNumber}.pdf`);
    } catch (err: any) {
      toast({ title: 'Download failed', description: err?.message ?? 'Could not generate the cash voucher PDF', variant: 'destructive' });
    }
    setDownloading(false);
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
        toast({ title: 'Print blocked', description: 'Please allow pop-ups for this site to print the cash voucher', variant: 'destructive' });
        setPrinting(false);
        return;
      }
      printWindow.document.write(`
        <html>
          <head><title>Cash Voucher ${voucherNumber}</title></head>
          <body style="margin:0;padding:0;background:#fff;">
            <img src="${dataUrl}" style="width:100%;display:block;" />
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.onload = () => printWindow.print();
      printWindow.onafterprint = () => printWindow.close();
    } catch (err: any) {
      toast({ title: 'Print failed', description: err?.message ?? 'Could not generate the cash voucher for printing', variant: 'destructive' });
    }
    setPrinting(false);
  }

  useEffect(() => {
    if (!historyPreview) return;
    (async () => {
      await handleDownloadPdf(historyPreview.voucher_number);
      setHistoryPreview(null);
      setDownloadingHistoryId(null);
    })();
  }, [historyPreview]);

  // Same live-vs-history swap used by the Payroll/13th Month vouchers —
  // printed* sources from the saved record when re-downloading from
  // History, otherwise from the live form above.
  const printedVoucher = historyPreview;
  const printedVoucherNumber = printedVoucher ? printedVoucher.voucher_number : voucherNumber;
  const printedPayee = printedVoucher ? printedVoucher.payee : payee;
  const printedParticulars = printedVoucher ? printedVoucher.particulars : particulars;
  const printedDate = printedVoucher ? printedVoucher.voucher_date : voucherDate;
  const printedLines: { account_name: string; amount: number }[] = printedVoucher ? (printedVoucher.lines ?? []) : resolvedLines;
  const printedTotal = printedVoucher ? Number(printedVoucher.total_amount) || 0 : totalAmount;
  const printedPreparedBy = printedVoucher ? (printedVoucher.prepared_by_name ?? '') : preparedByName;
  const printedApprovedBy = printedVoucher ? (printedVoucher.approved_by_name ?? '') : approvedByName;

  // Matches the client's actual system-generated Cash Voucher report
  // exactly (plain black text, Report Date/Time/Printed by metadata block)
  // — a different look from the blue "CASH VOUCHER" paper form template
  // shared by Gas/Payroll/13th Month vouchers, since this one is itself a
  // printed accounting report, not a hand-filled paper form.
  function renderVoucherCopy() {
    const now = new Date();
    return (
      <>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <img src="/image/1125_Corp_Logo.png" alt="1125Corp" style={{ width: 56, height: 56, objectFit: 'contain' }} />
            <div style={{ fontSize: 22, fontWeight: 700 }}>1125 CREDIT COLLECTION SERVICES</div>
          </div>
          <table style={{ fontSize: 11 }}>
            <tbody>
              <tr><td style={{ fontWeight: 700, paddingRight: 8 }}>Report Date:</td><td>{formatDate(now.toISOString())}</td></tr>
              <tr><td style={{ fontWeight: 700, paddingRight: 8 }}>Report Time:</td><td>{formatTime(now.toISOString())}</td></tr>
              <tr><td style={{ fontWeight: 700, paddingRight: 8 }}>Printed by:</td><td>{profile?.role_name ?? ''}</td></tr>
            </tbody>
          </table>
        </div>

        <div style={{ fontWeight: 700, fontSize: 15, marginTop: 14, marginBottom: 10 }}>Cash Voucher</div>

        <table style={{ width: '100%', fontSize: 12, marginBottom: 6, borderCollapse: 'collapse' }}>
          <tbody>
            <tr>
              <td style={{ width: '11%', fontWeight: 700, padding: '2px 0' }}>Payee:</td>
              <td style={{ borderBottom: '1px solid #000', padding: '2px 0 6px' }}>{printedPayee}</td>
              <td style={{ width: '15%', fontWeight: 700, textAlign: 'right', paddingRight: 6 }}>Voucher Number:</td>
              <td style={{ width: '16%', borderBottom: '1px solid #000', fontWeight: 700, paddingBottom: 6 }}>{printedVoucherNumber}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700, padding: '2px 0' }}>Particulars:</td>
              <td style={{ borderBottom: '1px solid #000', padding: '2px 0 6px' }}>{printedParticulars}</td>
              <td style={{ fontWeight: 700, textAlign: 'right', paddingRight: 6 }}>Date:</td>
              <td style={{ borderBottom: '1px solid #000', paddingBottom: 6 }}>{formatDate(printedDate)}</td>
            </tr>
          </tbody>
        </table>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 10 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', borderBottom: '1px solid #000', borderTop: '1px solid #000', padding: '4px 4px' }}>Account - Description</th>
              <th style={{ textAlign: 'right', borderBottom: '1px solid #000', borderTop: '1px solid #000', padding: '4px 4px', width: '20%' }}>Debit Amount</th>
              <th style={{ textAlign: 'right', borderBottom: '1px solid #000', borderTop: '1px solid #000', padding: '4px 4px', width: '20%' }}>Credit Amount</th>
            </tr>
          </thead>
          <tbody>
            {printedLines.map((l, i) => (
              <tr key={i}>
                <td style={{ padding: '3px 4px', textTransform: 'uppercase' }}>{l.account_name}</td>
                <td style={{ padding: '3px 4px', textAlign: 'right' }}>{Number(l.amount).toFixed(2)}</td>
                <td style={{ padding: '3px 4px', textAlign: 'right' }}>0.00</td>
              </tr>
            ))}
            <tr>
              <td style={{ borderTop: '1px solid #000' }}>&nbsp;</td>
              <td style={{ borderTop: '1px solid #000', textAlign: 'right', fontWeight: 700, padding: '4px 4px' }}>{printedTotal.toFixed(2)}</td>
              <td style={{ borderTop: '1px solid #000', textAlign: 'right', fontWeight: 700, padding: '4px 4px' }}>0.00</td>
            </tr>
          </tbody>
        </table>

        <table style={{ width: '100%', fontSize: 12, marginTop: 40 }}>
          <tbody>
            <tr>
              <td style={{ textAlign: 'center', width: '50%' }}><span style={{ display: 'inline-block', minWidth: 220, borderBottom: '1px solid #000', paddingBottom: 6 }}>{printedPreparedBy || ' '}</span></td>
              <td style={{ textAlign: 'center' }}><span style={{ display: 'inline-block', minWidth: 220, borderBottom: '1px solid #000', paddingBottom: 6 }}>{printedApprovedBy || ' '}</span></td>
            </tr>
            <tr>
              <td style={{ textAlign: 'center', fontWeight: 700, paddingTop: 2 }}>Prepared By</td>
              <td style={{ textAlign: 'center', fontWeight: 700, paddingTop: 2 }}>Approved By</td>
            </tr>
          </tbody>
        </table>

        <table style={{ width: '100%', fontSize: 12, marginTop: 30 }}>
          <tbody>
            <tr>
              <td style={{ fontWeight: 700, width: '65%' }}>Received from 1125 CREDIT COLLECTION SERVICES the sum of</td>
              <td style={{ fontWeight: 700 }}>Payee:</td>
              <td style={{ borderBottom: '1px solid #000', paddingBottom: 6 }}>{printedPayee}</td>
            </tr>
            <tr>
              <td style={{ textAlign: 'center', fontWeight: 700, paddingTop: 6 }}>** {numberToWordsPeso(printedTotal).toUpperCase()} **</td>
              <td />
              <td />
            </tr>
            <tr>
              <td style={{ fontStyle: 'italic', paddingTop: 6 }}>in Full / Partial Payment of the above mentioned account</td>
              <td style={{ fontWeight: 700, paddingTop: 6 }}>Date Received:</td>
              <td style={{ borderBottom: '1px solid #000', paddingTop: 6, paddingBottom: 6 }}>{formatDate(printedDate)}</td>
            </tr>
          </tbody>
        </table>

        <div style={{ textAlign: 'right', fontSize: 11, marginTop: 40 }}>Page 1 of 1</div>
      </>
    );
  }

  if (!canGenerate && !loading) {
    return <p className="text-center text-muted-foreground py-16">You do not have access to this page.</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Cash Vouchers" description="General-purpose voucher for any cash disbursement not already covered by a specialized voucher">
        {isAdmin && (
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Select branch" /></SelectTrigger>
            <SelectContent>
              {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </PageHeader>

      <Card className="glass-card border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Wallet2 className="w-5 h-5" />New Cash Voucher</CardTitle>
          <CardDescription>Whenever cash goes out for something with no voucher of its own (repairs, misc. expenses, etc.) — generating posts the journal entry automatically</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Payee *</Label><Input value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="Name of person/entity receiving cash" /></div>
            <div className="space-y-2"><Label>Date *</Label><Input type="date" value={voucherDate} onChange={(e) => setVoucherDate(e.target.value)} /></div>
            <div className="space-y-2 sm:col-span-2"><Label>Particulars *</Label><Input value={particulars} onChange={(e) => setParticulars(e.target.value)} placeholder="e.g. Payment for Employee Loan, Office Repairs" /></div>
            <div className="space-y-2">
              <Label>Cash Account *</Label>
              <Select value={cashAccountCode} onValueChange={setCashAccountCode}>
                <SelectTrigger><SelectValue placeholder="Select cash account" /></SelectTrigger>
                <SelectContent>
                  {cashAccounts.map(a => <SelectItem key={a.id} value={a.code}>{a.code} — {a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Account - Description</Label>
            {lines.map((line, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-7">
                  <Select value={line.account_code} onValueChange={(v) => updateLine(i, 'account_code', v)}>
                    <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                    <SelectContent>{debitableAccounts.map(a => <SelectItem key={a.id} value={a.code}>{a.code} — {a.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="col-span-4">
                  <Input type="number" value={line.amount} onChange={(e) => updateLine(i, 'amount', e.target.value)} placeholder="Debit Amount" />
                </div>
                <div className="col-span-1">
                  <Button type="button" variant="ghost" size="icon" onClick={() => removeLine(i)} disabled={lines.length <= 1}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={addLine}>
              <Plus className="w-4 h-4 mr-2" />Add Line
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Chosen from whoever holds the role at this branch, not typed
                — a dropdown appears only once the branch has more than one
                Cashier/Branch Manager. */}
            <div className="space-y-2">
              <Label className="text-xs">Prepared By</Label>
              {isAdmin ? (
                // An Admin generating this IS the one preparing it — always
                // their own name, no Cashier list to pick from.
                <p className="h-10 flex items-center px-3 rounded-md border border-border bg-secondary/30 text-sm">{preparedByName || '—'}</p>
              ) : cashierOptions.length > 1 ? (
                <Select value={preparedByName} onValueChange={setPreparedByName}>
                  <SelectTrigger><SelectValue placeholder="Select cashier" /></SelectTrigger>
                  <SelectContent>{cashierOptions.map(c => <SelectItem key={c.id} value={c.full_name}>{c.full_name}</SelectItem>)}</SelectContent>
                </Select>
              ) : (
                <Input value={preparedByName} onChange={(e) => setPreparedByName(e.target.value)} />
              )}
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Approved By</Label>
              {managerOptions.length > 1 ? (
                <Select value={approvedByName} onValueChange={setApprovedByName}>
                  <SelectTrigger><SelectValue placeholder="Select branch manager" /></SelectTrigger>
                  <SelectContent>{managerOptions.map(m => <SelectItem key={m.id} value={m.full_name}>{m.full_name}</SelectItem>)}</SelectContent>
                </Select>
              ) : (
                <Input value={approvedByName} onChange={(e) => setApprovedByName(e.target.value)} />
              )}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Total: <span className="font-semibold text-foreground">{formatCurrency(totalAmount)}</span></p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setPreviewOpen(true)} disabled={resolvedLines.length === 0}>
                <Eye className="w-4 h-4 mr-2" />Preview
              </Button>
              <Button type="button" variant="outline" onClick={handlePrint} disabled={printing || resolvedLines.length === 0}>
                {printing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Printer className="w-4 h-4 mr-2" />}
                Print
              </Button>
              <Button type="button" variant="outline" onClick={() => handleDownloadPdf()} disabled={downloading || resolvedLines.length === 0}>
                {downloading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                Download PDF
              </Button>
              <Button type="button" onClick={handleGenerate} disabled={saving || !payee || !particulars || resolvedLines.length === 0 || !branchId}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Generate
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card border-border">
        <CardHeader><CardTitle>History</CardTitle><CardDescription>Last 30 cash vouchers</CardDescription></CardHeader>
        <CardContent className="p-0">
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No cash vouchers generated yet</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Voucher #</TableHead>
                  <TableHead>Payee</TableHead>
                  <TableHead>Particulars</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map(v => (
                  <TableRow key={v.id}>
                    <TableCell className="text-sm font-mono">{v.voucher_number}</TableCell>
                    <TableCell className="text-sm">{v.payee}</TableCell>
                    <TableCell className="text-sm">{v.particulars}</TableCell>
                    <TableCell className="text-sm">{formatDate(v.voucher_date)}</TableCell>
                    <TableCell className="text-sm font-medium">{formatCurrency(v.total_amount)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Download PDF"
                        disabled={downloadingHistoryId === v.id}
                        onClick={() => { setDownloadingHistoryId(v.id); setHistoryPreview(v); }}
                      >
                        {downloadingHistoryId === v.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Cash Voucher Preview</DialogTitle>
            <DialogDescription>{payee} — {particulars}</DialogDescription>
          </DialogHeader>
          <div className="bg-secondary/30 p-4 rounded-lg">
            <DocumentScaler width={900}>
              <div style={{ width: 900, background: '#fff', color: '#111', padding: 40, fontFamily: '"Times New Roman", Calibri, serif' }}>
                {renderVoucherCopy()}
              </div>
            </DocumentScaler>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>Close</Button>
            <Button onClick={() => handleDownloadPdf()} disabled={downloading}>
              {downloading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
              Download PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hidden printable Cash Voucher */}
      {typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', top: 0, left: 0, opacity: 0, pointerEvents: 'none', zIndex: -1 }}>
          <div ref={printRef} style={{ width: 900, background: '#fff', color: '#111', padding: 40, fontFamily: '"Times New Roman", Calibri, serif' }}>
            {renderVoucherCopy()}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
