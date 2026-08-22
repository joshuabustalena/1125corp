'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { StatCard } from '@/components/dashboard/stat-card';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency, formatDate } from '@/lib/format';
import { COMPANY_NAME_DISPLAY, getDocumentBranding } from '@/lib/document-branding';
import { Banknote, Loader2, TrendingUp, Scale, Download } from 'lucide-react';

// Bill and coin denominations exactly as counted on the paper Cash Count
// Sheet. 20 appears in both lists (a ₱20 bill and a ₱20 coin both exist),
// so bills and coins are tracked as separate key spaces.
const BILL_DENOMS = [1000, 500, 200, 100, 50, 20];
const COIN_DENOMS = [20, 10, 5, 1, 0.25];

type DenomCounts = Record<string, string>;

function billKey(denom: number) { return `bill_${denom}`; }
function coinKey(denom: number) { return `coin_${denom}`; }

function denomTotal(counts: DenomCounts) {
  let total = 0;
  for (const d of BILL_DENOMS) total += d * (Number(counts[billKey(d)]) || 0);
  for (const d of COIN_DENOMS) total += d * (Number(counts[coinKey(d)]) || 0);
  return total;
}

function emptyDenomCounts(): DenomCounts {
  const counts: DenomCounts = {};
  for (const d of BILL_DENOMS) counts[billKey(d)] = '';
  for (const d of COIN_DENOMS) counts[coinKey(d)] = '';
  return counts;
}

// Builds from local date parts — toISOString() converts to UTC first,
// which silently shifts the date by a day in any timezone ahead of UTC
// (e.g. PH is UTC+8).
function prevDateStr(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

const dCell: React.CSSProperties = { border: '1px solid #000', padding: '6px 10px' };
const dCellRight: React.CSSProperties = { ...dCell, textAlign: 'right' };
const dCellCenter: React.CSSProperties = { ...dCell, textAlign: 'center' };

// One side of the denomination table (Bills then Coins), used identically
// for both the Vault and PCF columns, in both the live form and the
// printable document. Declared at module scope (NOT nested inside
// CashCountPage) — a component defined inside another component's render
// body gets a new function identity every render, which made React
// remount this table (and drop the <input>'s focus) on every keystroke,
// so only the first digit you typed ever seemed to "stick".
function DenominationTable({ counts, onChange, readOnly, shortOver, shortOverLabel }: {
  counts: DenomCounts;
  onChange?: (key: string, value: string) => void;
  readOnly?: boolean;
  // Rendered as the table's own last row (print view only) so its borders
  // line up with the denomination columns. It used to be a separate
  // 3-column table stacked underneath this 4-column one, which left the
  // cell edges visibly ragged on the printed sheet.
  shortOver?: number;
  shortOverLabel?: string;
}) {
  const row = (label: string, key: string, denom: number) => {
    const qty = Number(counts[key]) || 0;
    return (
      <tr key={key}>
        <td style={dCell}>{label}</td>
        <td style={dCellCenter}>x</td>
        <td style={dCell}>
          {readOnly ? (
            <span style={{ display: 'block', textAlign: 'right' }}>{qty || ''}</span>
          ) : (
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={counts[key]}
              onChange={(e) => {
                const digitsOnly = e.target.value.replace(/[^0-9]/g, '');
                onChange?.(key, digitsOnly);
              }}
              style={{ width: '100%', border: 'none', outline: 'none', textAlign: 'right', fontSize: 15, background: 'transparent' }}
              placeholder="0"
            />
          )}
        </td>
        <td style={dCellRight}>{(denom * qty).toLocaleString('en-PH', { minimumFractionDigits: denom < 1 ? 2 : 0 })}</td>
      </tr>
    );
  };
  return (
    // table-layout: fixed + an explicit colgroup is what actually pins the
    // quantity column narrow. A plain `width` on the <td> is only a hint in
    // auto layout, so the count column kept stretching to a third of the
    // sheet no matter what width was set on it.
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 15, tableLayout: 'fixed' }}>
      <colgroup>
        <col style={{ width: '44%' }} />
        <col style={{ width: '7%' }} />
        <col style={{ width: '15%' }} />
        <col style={{ width: '34%' }} />
      </colgroup>
      <tbody>
        {BILL_DENOMS.map((d, i) => row(i === 0 ? `Bills: ${d.toFixed(2)}` : d.toFixed(2), billKey(d), d))}
        {COIN_DENOMS.map((d, i) => row(i === 0 ? `Coins: ${d.toFixed(2)}` : d.toFixed(2), coinKey(d), d))}
        <tr>
          {/* Spans all three left columns — previously the label spanned two
              and left a stray empty bordered box under the count column. */}
          <td style={{ ...dCell, fontWeight: 700 }} colSpan={3}>Total:</td>
          <td style={{ ...dCellRight, fontWeight: 700, color: '#C00000' }}>{formatCurrency(denomTotal(counts))}</td>
        </tr>
        {shortOver !== undefined && (
          <tr>
            <td style={{ ...dCell, fontWeight: 700 }} colSpan={2}>{shortOverLabel ?? 'Short/over'}</td>
            <td style={dCellCenter}>PHP</td>
            <td style={dCellRight}>{formatCurrency(shortOver)}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

export default function CashCountPage() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const isAdmin = profile?.role_name === 'Administrator';
  const canRecordCount = isAdmin || profile?.role_name === 'Cashier';
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [branches, setBranches] = useState<any[]>([]);
  const [branchId, setBranchId] = useState('');
  const [expected, setExpected] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [pendingRemittanceIds, setPendingRemittanceIds] = useState<string[]>([]);
  const printRef = useRef<HTMLDivElement>(null);

  const [vaultCounts, setVaultCounts] = useState<DenomCounts>(emptyDenomCounts());
  const [pcfCounts, setPcfCounts] = useState<DenomCounts>(emptyDenomCounts());
  const [shortOverVault, setShortOverVault] = useState('');
  const [shortOverPcf, setShortOverPcf] = useState('');
  const [totalCollections, setTotalCollections] = useState('');
  const [beginningBalance, setBeginningBalance] = useState('');
  const [endingBalance, setEndingBalance] = useState('');
  const [releaseAmount, setReleaseAmount] = useState('');
  const [totalExpenses, setTotalExpenses] = useState('');
  const [cashRelease, setCashRelease] = useState('');
  const [collectionRelease, setCollectionRelease] = useState('');
  const [cashierOptions, setCashierOptions] = useState<{ id: string; full_name: string }[]>([]);
  const [managerOptions, setManagerOptions] = useState<{ id: string; full_name: string }[]>([]);
  const [cashierName, setCashierName] = useState('');
  const [branchManagerName, setBranchManagerName] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (isAdmin) {
      loadBranches();
    } else if (profile?.branch_id) {
      setBranchId(profile.branch_id);
    }
  }, [profile]);

  useEffect(() => {
    if (!branchId) return;
    loadData();
  }, [branchId, date]);

  async function loadBranches() {
    const { data } = await supabase.from('branches').select('id, name').eq('status', 'active').order('name');
    setBranches(data ?? []);
    if (data && data.length > 0 && !branchId) setBranchId(data[0].id);
  }

  async function loadData() {
    setLoading(true);
    const { data: collectors } = await supabase.from('collectors').select('id').eq('branch_id', branchId);
    const collectorIds = (collectors ?? []).map(c => c.id);

    // Expected Cash = whatever's still sitting as "pending" remittances for
    // this branch, up through the count date — not just today's, since an
    // unreconciled remittance from an earlier day should still be expected
    // until a count actually sweeps it up. Submitting a count marks these
    // as "received" so they aren't counted again on a later day.
    const [{ data: rems }, { data: hist }] = await Promise.all([
      collectorIds.length > 0
        ? supabase.from('remittances').select('id, amount').eq('status', 'pending').lte('remittance_date', date).in('collector_id', collectorIds)
        : Promise.resolve({ data: [] as any[] }),
      supabase.from('cash_counts').select('*').eq('branch_id', branchId).order('count_date', { ascending: false }).limit(30),
    ]);

    setPendingRemittanceIds((rems ?? []).map((r: any) => r.id));
    setExpected((rems ?? []).reduce((s: number, r: any) => s + Number(r.amount), 0));
    setHistory(hist ?? []);
    setLoading(false);

    loadLockedFields();
    loadStaffNames();
  }

  // Beginning/Ending Cash Balance and Cash Release should not be manually
  // typed — they're pulled straight from real records so the sheet can't
  // drift from what actually happened. Note: the general ledger
  // (journal_entries) has no branch_id column, so these Cash-on-Hand
  // balances are company-wide, matching the same figure shown on the
  // Accounting dashboard — not split per branch.
  async function loadLockedFields() {
    const { data: cashAccount } = await supabase.from('chart_of_accounts').select('id').eq('code', '1000').maybeSingle();
    if (cashAccount) {
      const { data: lines } = await supabase.from('journal_entry_lines').select('debit, credit, journal_entries(entry_date)').eq('account_id', cashAccount.id);
      const prevDay = prevDateStr(date);
      let beginning = 0, ending = 0;
      for (const l of (lines ?? []) as any[]) {
        const net = (Number(l.debit) || 0) - (Number(l.credit) || 0);
        const entryDate = l.journal_entries?.entry_date;
        if (entryDate <= prevDay) beginning += net;
        if (entryDate <= date) ending += net;
      }
      setBeginningBalance(String(beginning));
      setEndingBalance(String(ending));
    }

    // Cash Release = total of this branch's loan release cash vouchers for
    // the day (client's own words: "total ng cash voucher ng loan for the
    // day"), joined through loans for the branch scope since cash_vouchers
    // itself has no branch_id.
    const { data: vouchers } = await supabase
      .from('cash_vouchers')
      .select('amount, loans!inner(branch_id)')
      .eq('voucher_date', date)
      .eq('loans.branch_id', branchId);
    setCashRelease(String((vouchers ?? []).reduce((s: number, v: any) => s + Number(v.amount), 0)));
  }

  // Cashier/Branch Manager names are chosen from whoever holds that role at
  // this branch — not typed — same as the Gas Voucher. A branch can have
  // more than one Cashier, so this builds a pickable list rather than
  // forcing a single match.
  async function loadStaffNames() {
    const { data: staff } = await supabase.from('profiles').select('id, full_name, roles(name)').eq('branch_id', branchId).eq('status', 'active');
    const rows = (staff ?? []) as any[];
    const branchCashiers = rows.filter(p => p.roles?.name === 'Cashier');
    const branchManagers = rows.filter(p => p.roles?.name === 'Branch Manager');
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
  }

  const vaultTotal = denomTotal(vaultCounts);
  const pcfTotal = denomTotal(pcfCounts);
  const countedTotal = vaultTotal + pcfTotal;
  const variancePreview = countedTotal > 0 ? countedTotal - expected : null;

  function resetForm() {
    setVaultCounts(emptyDenomCounts());
    setPcfCounts(emptyDenomCounts());
    setShortOverVault('');
    setShortOverPcf('');
    setTotalCollections('');
    setBeginningBalance('');
    setEndingBalance('');
    setReleaseAmount('');
    setTotalExpenses('');
    setCashRelease('');
    setCollectionRelease('');
    setBranchManagerName('');
    setNotes('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!branchId || countedTotal <= 0) return;
    setSaving(true);
    const variance = countedTotal - expected;
    const { error } = await supabase.from('cash_counts').insert({
      branch_id: branchId,
      count_date: date,
      expected_amount: expected,
      // Kept populated for the existing Expected/Variance stat cards and
      // any older history rows' shape — vault_amount/petty_cash_amount now
      // mirror the new denomination totals, bank_amount isn't part of this
      // process so it's just 0.
      counted_amount: countedTotal,
      vault_amount: vaultTotal,
      bank_amount: 0,
      petty_cash_amount: pcfTotal,
      variance,
      vault_denominations: vaultCounts,
      vault_total: vaultTotal,
      pcf_denominations: pcfCounts,
      pcf_total: pcfTotal,
      short_over_vault: Number(shortOverVault) || 0,
      short_over_pcf: Number(shortOverPcf) || 0,
      total_collections: Number(totalCollections) || 0,
      beginning_balance: Number(beginningBalance) || 0,
      ending_balance: Number(endingBalance) || 0,
      release_amount: Number(releaseAmount) || 0,
      total_expenses: Number(totalExpenses) || 0,
      cash_release: Number(cashRelease) || 0,
      collection_release: Number(collectionRelease) || 0,
      cashier_name: cashierName || null,
      branch_manager_name: branchManagerName || null,
      counted_by: profile?.id ?? null,
      notes: notes || null,
    });
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      // This count just reconciled these remittances — mark them received
      // so they don't get counted as "pending" (and re-expected) again.
      if (pendingRemittanceIds.length > 0) {
        await supabase.from('remittances').update({ status: 'received', received_by: profile?.id ?? null }).in('id', pendingRemittanceIds);
      }
      toast({ title: 'Success', description: 'Cash count recorded' });
      resetForm();
      loadData();
    }
    setSaving(false);
  }

  async function handleDownloadPdf() {
    if (!printRef.current) return;
    setDownloading(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const { jsPDF } = await import('jspdf');
      const canvas = await html2canvas(printRef.current, { backgroundColor: '#ffffff', scale: 2, width: 950, windowWidth: 950 });
      const imgData = canvas.toDataURL('image/png');
      const pxToPt = 0.75;
      const contentWidthPt = canvas.width / 2 * pxToPt;
      const contentHeightPt = canvas.height / 2 * pxToPt;
      // 8.5" x 13" (Philippine "folio"/long bond paper), in points (72pt/in).
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: [612, 936] });
      const margin = 24;
      const usableWidth = pdf.internal.pageSize.getWidth() - margin * 2;
      const imgWidth = usableWidth;
      const imgHeight = (contentHeightPt / contentWidthPt) * imgWidth;
      pdf.addImage(imgData, 'PNG', margin, margin, imgWidth, imgHeight);
      pdf.save(`cash-count-${date}.pdf`);
    } catch (err: any) {
      toast({ title: 'Download failed', description: err?.message ?? 'Could not generate the cash count PDF', variant: 'destructive' });
    }
    setDownloading(false);
  }

  const branding = getDocumentBranding(branches.find(b => b.id === branchId)?.name);

  return (
    <div className="space-y-6">
      <PageHeader title="Daily Cash Count" description="Cash Count Sheet — count bills/coins in the vault and petty cash fund">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" />
        {isAdmin && (
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Select branch" /></SelectTrigger>
            <SelectContent>
              {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatCard title="Expected Cash" value={formatCurrency(expected)} icon={<TrendingUp className="w-5 h-5" />} subtitle="Total pending remittances not yet reconciled" />
        <StatCard
          title="Variance"
          value={variancePreview !== null ? formatCurrency(variancePreview) : '—'}
          icon={<Scale className="w-5 h-5" />}
          variant={variancePreview === null ? 'default' : variancePreview === 0 ? 'success' : variancePreview > 0 ? 'warning' : 'danger'}
        />
      </div>

      {canRecordCount && (
        <Card className="glass-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Cash Count Sheet</CardTitle>
              <CardDescription>Count every bill and coin for {formatDate(date)}</CardDescription>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={handleDownloadPdf} disabled={downloading}>
              {downloading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
              Download PDF
            </Button>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                  <p className="text-sm font-semibold mb-2">Cash in Vault</p>
                  <div className="border border-border rounded-lg overflow-hidden">
                    <DenominationTable counts={vaultCounts} onChange={(k, v) => setVaultCounts(prev => ({ ...prev, [k]: v }))} />
                  </div>
                  <div className="mt-3 space-y-2">
                    <Label className="text-xs">Short/Over (₱)</Label>
                    <Input type="number" value={shortOverVault} onChange={(e) => setShortOverVault(e.target.value)} placeholder="0.00" />
                  </div>
                </div>
                <div>
                  <p className="text-sm font-semibold mb-2">Petty Cash Fund</p>
                  <div className="border border-border rounded-lg overflow-hidden">
                    <DenominationTable counts={pcfCounts} onChange={(k, v) => setPcfCounts(prev => ({ ...prev, [k]: v }))} />
                  </div>
                  <div className="mt-3 space-y-2">
                    <Label className="text-xs">Short/Over PCF (₱)</Label>
                    <Input type="number" value={shortOverPcf} onChange={(e) => setShortOverPcf(e.target.value)} placeholder="0.00" />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2"><Label className="text-xs">Total Cash Collections for the Day (₱)</Label><Input type="number" value={totalCollections} onChange={(e) => setTotalCollections(e.target.value)} placeholder="0.00" /></div>
                {/* Locked/auto-computed from real records, not typed — see
                    loadLockedFields(). Beginning/Ending are the ledger's
                    Cash-on-Hand balance as of end of the previous day / this
                    day; Cash Release is the day's loan cash vouchers total. */}
                <div className="space-y-2">
                  <Label className="text-xs">Beginning Cash Balance (₱)</Label>
                  <p className="h-10 flex items-center px-3 rounded-md border border-border bg-secondary/30 text-sm">{formatCurrency(Number(beginningBalance) || 0)}</p>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Ending Cash Balance (₱)</Label>
                  <p className="h-10 flex items-center px-3 rounded-md border border-border bg-secondary/30 text-sm">{formatCurrency(Number(endingBalance) || 0)}</p>
                </div>
                <div className="space-y-2"><Label className="text-xs">Release (₱)</Label><Input type="number" value={releaseAmount} onChange={(e) => setReleaseAmount(e.target.value)} placeholder="0.00" /></div>
                <div className="space-y-2"><Label className="text-xs">Total Expenses for the Day (₱)</Label><Input type="number" value={totalExpenses} onChange={(e) => setTotalExpenses(e.target.value)} placeholder="0.00" /></div>
                <div className="space-y-2">
                  <Label className="text-xs">Cash Release (₱)</Label>
                  <p className="h-10 flex items-center px-3 rounded-md border border-border bg-secondary/30 text-sm">{formatCurrency(Number(cashRelease) || 0)}</p>
                </div>
                <div className="space-y-2"><Label className="text-xs">Collection Release (₱)</Label><Input type="number" value={collectionRelease} onChange={(e) => setCollectionRelease(e.target.value)} placeholder="0.00" /></div>
                {/* Chosen from whoever holds that role at this branch, not
                    typed. A dropdown appears only when the branch has more
                    than one Cashier/Branch Manager. */}
                <div className="space-y-2">
                  <Label className="text-xs">Cashier Name</Label>
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
                  <Label className="text-xs">Branch Manager Name</Label>
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

              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={1} placeholder="Explain any variance" />
              </div>

              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">Vault + PCF Total: <span className="font-medium text-foreground">{formatCurrency(countedTotal)}</span></p>
                <Button type="submit" disabled={saving || loading || !branchId || countedTotal <= 0}>
                  {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Submit Count
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card className="glass-card border-border">
        <CardHeader><CardTitle>History</CardTitle><CardDescription>Last 30 counts for this branch</CardDescription></CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : history.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Banknote className="w-12 h-12 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">No cash counts recorded yet</p>
            </div>
          ) : (
            <>
            {/* Mobile card list */}
            <div className="md:hidden divide-y divide-border">
              {history.map(h => (
                <div key={h.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium text-sm">{formatDate(h.count_date)}</p>
                    <Badge variant={Number(h.variance) === 0 ? 'default' : 'destructive'} className="shrink-0">
                      {Number(h.variance) === 0 ? 'Balanced' : formatCurrency(h.variance)}
                    </Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div><p className="text-xs text-muted-foreground">Vault Total</p><p>{formatCurrency(h.vault_total ?? h.vault_amount ?? 0)}</p></div>
                    <div><p className="text-xs text-muted-foreground">PCF Total</p><p>{formatCurrency(h.pcf_total ?? h.petty_cash_amount ?? 0)}</p></div>
                    <div><p className="text-xs text-muted-foreground">Short/Over (Vault)</p><p>{formatCurrency(h.short_over_vault ?? 0)}</p></div>
                    <div><p className="text-xs text-muted-foreground">Ending Balance</p><p>{formatCurrency(h.ending_balance ?? 0)}</p></div>
                  </div>
                </div>
              ))}
            </div>

            <Table className="hidden md:table">
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Vault Total</TableHead>
                  <TableHead>PCF Total</TableHead>
                  <TableHead>Short/Over (Vault)</TableHead>
                  <TableHead>Ending Balance</TableHead>
                  <TableHead>Variance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map(h => (
                  <TableRow key={h.id}>
                    <TableCell className="text-sm">{formatDate(h.count_date)}</TableCell>
                    <TableCell className="text-sm">{formatCurrency(h.vault_total ?? h.vault_amount ?? 0)}</TableCell>
                    <TableCell className="text-sm">{formatCurrency(h.pcf_total ?? h.petty_cash_amount ?? 0)}</TableCell>
                    <TableCell className="text-sm">{formatCurrency(h.short_over_vault ?? 0)}</TableCell>
                    <TableCell className="text-sm">{formatCurrency(h.ending_balance ?? 0)}</TableCell>
                    <TableCell className="text-sm">
                      <Badge variant={Number(h.variance) === 0 ? 'default' : 'destructive'}>
                        {Number(h.variance) === 0 ? 'Balanced' : formatCurrency(h.variance)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </>
          )}
        </CardContent>
      </Card>

      {/* Hidden printable Cash Count Sheet, matching the company's paper form.
          Portaled onto <body> so no ancestor layout affects the capture. */}
      {typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', top: 0, left: 0, opacity: 0, pointerEvents: 'none', zIndex: -1 }}>
          <div ref={printRef} style={{ width: 950, background: '#fff', color: '#111', padding: 36, fontFamily: '"Times New Roman", Calibri, serif' }}>
            <div style={{ textAlign: 'center', borderBottom: '3px solid #000', paddingBottom: 10, marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 20, color: '#1F4E79' }}>{COMPANY_NAME_DISPLAY}</div>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#1F4E79' }}>{branding.headerAddress.toUpperCase()}</div>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#1F4E79' }}>CELL PHONE NUMBER: {branding.contact}</div>
              <div style={{ fontWeight: 700, fontSize: 22, marginTop: 12 }}>Cash Count Sheet</div>
            </div>
            <div style={{ textAlign: 'right', fontSize: 15, marginBottom: 10 }}>Date: {formatDate(date)}</div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
              <div>
                <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Cash in Vault</p>
                <DenominationTable counts={vaultCounts} readOnly shortOver={Number(shortOverVault) || 0} />
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 15, marginTop: 8 }}>
                  <tbody>
                    <tr><td colSpan={2} style={{ ...dCell, textAlign: 'center', fontWeight: 700 }}>Total Cash Collections for the day</td></tr>
                    <tr><td style={dCell}>PHP</td><td style={dCellRight}>{formatCurrency(Number(totalCollections) || 0)}</td></tr>
                    <tr><td colSpan={2} style={{ ...dCell, textAlign: 'center', fontWeight: 700 }}>Beginning Cash Balance</td></tr>
                    <tr><td colSpan={2} style={dCellRight}>{formatCurrency(Number(beginningBalance) || 0)}</td></tr>
                    <tr><td colSpan={2} style={{ ...dCell, textAlign: 'center', fontWeight: 700 }}>Ending Cash Balance</td></tr>
                    <tr><td colSpan={2} style={{ ...dCellRight, fontWeight: 700, color: '#C00000' }}>{formatCurrency(Number(endingBalance) || 0)}</td></tr>
                  </tbody>
                </table>
              </div>
              <div>
                <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Petty Cash Fund</p>
                <DenominationTable counts={pcfCounts} readOnly shortOver={Number(shortOverPcf) || 0} shortOverLabel="Short/over PCF" />
                <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 26, color: '#C00000', margin: '10px 0' }}>
                  RELEASE&nbsp;&nbsp;{formatCurrency(Number(releaseAmount) || 0)}
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 15 }}>
                  <tbody>
                    <tr><td colSpan={2} style={{ ...dCell, textAlign: 'center', fontWeight: 700 }}>Total Expenses for the day</td></tr>
                    <tr><td style={dCell}>PHP</td><td style={dCellRight}>{formatCurrency(Number(totalExpenses) || 0)}</td></tr>
                    <tr><td style={{ ...dCell, fontWeight: 700 }}>Cash Release</td><td style={dCellRight}>{formatCurrency(Number(cashRelease) || 0)}</td></tr>
                    <tr><td style={{ ...dCell, fontWeight: 700 }}>Collection Release</td><td style={dCellRight}>{formatCurrency(Number(collectionRelease) || 0)}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>

            <p style={{ fontSize: 14, marginTop: 20, borderTop: '1px solid #000', paddingTop: 10 }}>
              The amounts above are true and correct to the best of my knowledge.
            </p>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginTop: 10 }}>
              <tbody>
                <tr>
                  <td style={{ ...dCell, fontWeight: 700, width: '20%' }}>Date</td>
                  <td style={{ ...dCell, fontWeight: 700, width: '35%' }}>Cashier</td>
                  <td style={{ ...dCell, fontWeight: 700 }}>Signature</td>
                </tr>
                <tr>
                  <td style={dCell}>{formatDate(date)}</td>
                  <td style={dCell}>{cashierName || '—'}</td>
                  <td style={{ ...dCell, height: 36 }}>&nbsp;</td>
                </tr>
                <tr>
                  <td style={{ ...dCell, fontWeight: 700 }}>Date</td>
                  <td style={{ ...dCell, fontWeight: 700 }}>Branch Manager</td>
                  <td style={{ ...dCell, fontWeight: 700 }}>Signature</td>
                </tr>
                <tr>
                  <td style={dCell}>{formatDate(date)}</td>
                  <td style={dCell}>{branchManagerName || '—'}</td>
                  <td style={{ ...dCell, height: 36 }}>&nbsp;</td>
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
