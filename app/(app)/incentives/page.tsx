'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { StatCard } from '@/components/dashboard/stat-card';
import { IncentiveDocument } from '@/components/incentive-document';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/auth-context';
import { hasPermission, isReadOnly } from '@/lib/permissions';
import { supabase } from '@/lib/supabase/client';
import { selectAllRows } from '@/lib/db-chunk';
import { RELEASED_LOAN_STATUSES } from '@/lib/collections';
import { formatCurrency, formatCustomerName, dateToStr } from '@/lib/format';
import {
  computeIncentive, prefillStatement, monthBounds, monthLabel, payslipWindowFor,
  FACTOR_TABLE_LABELS, INCENTIVE_TYPE_BY_POSITION, DEFAULT_PERFORMANCE_INCENTIVE, ONE_MILLION_DAILY_DEDUCTION,
  type FactorRow, type FactorTableName, type IncentiveInputs, type IncentiveMonthData, type IncentiveResult, type IncentiveType,
} from '@/lib/incentives';
import { Award, Download, Loader2, Plus, Printer, Settings2, Trash2, Wallet, CheckCircle } from 'lucide-react';

type Row = {
  employee: any;
  type: IncentiveType;
  branchLabel: string;
  areaLabel: string | null;
  statement: any | null;
  inputs: IncentiveInputs;
  result: IncentiveResult;
  overdueSource: string;
  branchId: string | null;
  areaId: string | null;
};

// Text form of the manual fields, so an empty box stays empty while typing.
type Form = Record<keyof IncentiveInputs, string>;

function toForm(i: IncentiveInputs): Form {
  return {
    overdue: String(i.overdue), receivable: String(i.receivable), totalRelease: String(i.totalRelease),
    collection: String(i.collection), scopeRelease: String(i.scopeRelease),
    oneMillionOverride: i.oneMillionOverride == null ? '' : String(i.oneMillionOverride),
    businessDays: String(i.businessDays),
    marketTargetRate: i.marketTargetRate ? String(i.marketTargetRate) : '',
    performanceIncentive: String(i.performanceIncentive),
    overdueCollectionIncentive: i.overdueCollectionIncentive ? String(i.overdueCollectionIncentive) : '',
  };
}

function fromForm(f: Form): IncentiveInputs {
  const n = (s: string) => Number(s) || 0;
  return {
    overdue: n(f.overdue), receivable: n(f.receivable), totalRelease: n(f.totalRelease),
    collection: n(f.collection), scopeRelease: n(f.scopeRelease),
    oneMillionOverride: f.oneMillionOverride.trim() === '' ? null : n(f.oneMillionOverride),
    businessDays: n(f.businessDays),
    marketTargetRate: n(f.marketTargetRate), performanceIncentive: n(f.performanceIncentive),
    overdueCollectionIncentive: n(f.overdueCollectionIncentive),
  };
}

function previousMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return dateToStr(d).slice(0, 7);
}

const TYPE_LABELS: Record<IncentiveType, string> = {
  collector: 'Field Collector',
  branch_manager: 'Branch Manager',
  proxy: 'Proxy Collector',
  cashier: 'Cashier',
};

// A document shown in a Dialog with its Download PDF and Print, shared by the
// employee's view and the editor's preview.
function useDocumentActions(title: () => string) {
  const { toast } = useToast();
  const docRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);

  async function downloadPdf() {
    if (!docRef.current) return;
    setDownloading(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const { jsPDF } = await import('jspdf');
      const canvas = await html2canvas(docRef.current, { backgroundColor: '#ffffff', scale: 2 });
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: [612, 792] });
      const margin = 36;
      const usableWidth = pdf.internal.pageSize.getWidth() - margin * 2;
      const usableHeight = pdf.internal.pageSize.getHeight() - margin * 2;
      const scale = Math.min(usableWidth / canvas.width, usableHeight / canvas.height, 0.75);
      const w = canvas.width * scale;
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin + (usableWidth - w) / 2, margin, w, canvas.height * scale);
      pdf.save(`${title().replace(/\s+/g, '-').toLowerCase()}.pdf`);
    } catch (err: any) {
      toast({ title: 'Download failed', description: err?.message ?? 'Could not generate the PDF', variant: 'destructive' });
    }
    setDownloading(false);
  }

  function print() {
    if (!docRef.current) return;
    const w = window.open('', '_blank', 'width=600,height=800');
    if (!w) {
      toast({ title: 'Print blocked', description: 'Please allow pop-ups for this site to print the statement', variant: 'destructive' });
      return;
    }
    const html = docRef.current.outerHTML.replace(/src="\//g, `src="${window.location.origin}/`);
    w.document.write(`<html><head><title>Incentive Statement</title><style>body { margin: 0; } * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }</style></head><body>${html}</body></html>`);
    w.document.close();
    w.onload = () => w.print();
    w.onafterprint = () => w.close();
  }

  return { docRef, downloading, downloadPdf, print };
}

export default function IncentivesPage() {
  const { profile } = useAuth();
  const readOnly = isReadOnly(profile?.permissions, 'payroll');
  const canManage = hasPermission(profile?.permissions, 'payroll') && !readOnly;
  if (!profile) return null;
  return canManage || readOnly ? <ManageIncentives canManage={canManage} /> : <MyIncentives />;
}

// Everyone else: their own approved statements. RLS is what limits this to
// their own (supabase/add_incentive_statements.sql).
function MyIncentives() {
  const { toast } = useToast();
  const [statements, setStatements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState<any | null>(null);
  const actions = useDocumentActions(() => `incentive-${viewing?.results?.employeeName ?? ''}-${viewing?.month?.slice(0, 7) ?? ''}`);

  useEffect(() => {
    supabase
      .from('incentive_statements')
      .select('*')
      .eq('status', 'approved')
      .order('month', { ascending: false })
      .then(({ data, error }) => {
        if (error) toast({ title: 'Could not load your statements', description: error.message, variant: 'destructive' });
        setStatements(data ?? []);
        setLoading(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader title="My Incentives" description="Your monthly incentive computation, once approved" />
      <Card className="glass-card border-border">
        <CardContent className="p-4">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : statements.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No approved incentive statements yet</p>
          ) : (
            <div className="divide-y divide-border">
              {statements.map(s => (
                <button key={s.id} type="button" onClick={() => setViewing(s)} className="w-full flex items-center justify-between gap-4 p-3 text-left hover:bg-secondary/50 rounded-lg">
                  <div>
                    <p className="font-medium">{monthLabel(s.month)}</p>
                    <p className="text-sm text-muted-foreground">Total {formatCurrency(s.total_incentive)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Net Incentive</p>
                    <p className="font-semibold text-success">{formatCurrency(s.net_incentive)}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!viewing} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Incentive Statement</DialogTitle>
            <DialogDescription>{viewing ? monthLabel(viewing.month) : ''}</DialogDescription>
          </DialogHeader>
          {viewing && (
            <IncentiveDocument
              ref={actions.docRef}
              type={viewing.statement_type}
              month={viewing.month}
              employeeName={viewing.results?.employeeName ?? ''}
              position={viewing.results?.position ?? ''}
              branchLabel={viewing.results?.branchLabel ?? ''}
              areaLabel={viewing.results?.areaLabel ?? null}
              inputs={viewing.inputs}
              result={viewing.results}
            />
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={actions.print}><Printer className="w-4 h-4 mr-2" />Print</Button>
            <Button onClick={actions.downloadPdf} disabled={actions.downloading}>
              {actions.downloading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
              Download PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ManageIncentives({ canManage }: { canManage: boolean }) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [month, setMonth] = useState(previousMonth());
  const [branchFilter, setBranchFilter] = useState('all');
  const [branches, setBranches] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [factors, setFactors] = useState<FactorRow[]>([]);
  const [statements, setStatements] = useState<any[]>([]);
  const [monthData, setMonthData] = useState<IncentiveMonthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [factorsOpen, setFactorsOpen] = useState(false);
  const actions = useDocumentActions(() => `incentive-${editing ? editing.employee.first_name : ''}-${month}`);

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [month]);

  async function load() {
    setLoading(true);
    setLoadError(null);
    const { start, end } = monthBounds(month);
    // Saved Overdue reports around the month end — the only record of what
    // Overdue was then, since the live figure is always "as of today".
    const after = new Date(`${end}T00:00:00`);
    after.setDate(after.getDate() + 8);
    const before = new Date(`${end}T00:00:00`);
    before.setDate(before.getDate() - 1);
    try {
      const [emp, br, ar, col, fac, st, released, pays, active, saved] = await Promise.all([
        supabase.from('employees').select('id, first_name, last_name, position, branch_id, profile_id, branches(name)').eq('status', 'active'),
        supabase.from('branches').select('id, name').eq('status', 'active').order('name'),
        supabase.from('areas').select('id, name, branch_id'),
        supabase.from('collectors').select('profile_id, area_id').eq('status', 'active'),
        supabase.from('incentive_factors').select('*'),
        supabase.from('incentive_statements').select('*').eq('month', start),
        selectAllRows<any>(() => supabase.from('loans')
          .select('amount, area_id, branch_id, created_by, offset_balance, daily_payment, total_payable, term_days')
          .in('status', RELEASED_LOAN_STATUSES).gte('release_date', start).lte('release_date', end).order('id')),
        selectAllRows<any>(() => supabase.from('payments')
          .select('amount_paid, customers!inner(area_id, branch_id)')
          .gte('payment_date', start).lte('payment_date', end).order('id')),
        selectAllRows<any>(() => supabase.from('loans')
          .select('remaining_balance, total_payable, term_days, release_date, due_date, area_id, branch_id')
          .eq('status', 'active').order('id')),
        supabase.from('saved_reports').select('created_at, branch_id, area_id, stats, rows')
          .eq('report_type', 'overdue_amount')
          .gte('created_at', before.toISOString()).lte('created_at', after.toISOString()),
      ]);
      const firstError = [emp, br, ar, col, fac, st, saved].find(r => r.error)?.error;
      if (firstError) throw firstError;
      const collectorAreaByProfile: Record<string, string | null> = {};
      for (const c of col.data ?? []) if (c.profile_id) collectorAreaByProfile[c.profile_id] = c.area_id;
      setEmployees((emp.data ?? []).filter((e: any) => e.position && INCENTIVE_TYPE_BY_POSITION[e.position]));
      setBranches(br.data ?? []);
      setFactors((fac.data ?? []) as FactorRow[]);
      setStatements(st.data ?? []);
      setMonthData({
        releasedLoans: released, payments: pays, activeLoans: active, savedOverdue: saved.data ?? [],
        areas: ar.data ?? [], collectorAreaByProfile,
      });
    } catch (err: any) {
      setLoadError(err?.message ?? 'Could not load this month');
    }
    setLoading(false);
  }

  const rows: Row[] = useMemo(() => {
    if (!monthData) return [];
    return employees
      .map((employee): Row | null => {
        const prefill = prefillStatement(employee, monthData, month);
        if (!prefill) return null;
        const statement = statements.find(s => s.employee_id === employee.id) ?? null;
        const inputs: IncentiveInputs = statement ? statement.inputs : prefill.inputs;
        const areaId: string | null = statement?.area_id ?? prefill.area_id;
        return {
          employee,
          type: prefill.type,
          branchLabel: employee.branches?.name ?? '—',
          areaLabel: areaId ? monthData.areas.find(a => a.id === areaId)?.name ?? null : null,
          statement,
          inputs,
          // An approved statement shows what was approved, even if a factor
          // has changed since; anything else follows the current tables.
          result: statement?.status === 'approved' ? statement.results : computeIncentive(prefill.type, inputs, factors),
          overdueSource: prefill.overdueSource,
          branchId: employee.branch_id,
          areaId,
        };
      })
      .filter((r): r is Row => !!r)
      .sort((a, b) =>
        a.branchLabel.localeCompare(b.branchLabel)
        || a.type.localeCompare(b.type)
        || (a.areaLabel ?? '').localeCompare(b.areaLabel ?? '')
        || a.employee.last_name.localeCompare(b.employee.last_name));
  }, [employees, statements, monthData, factors, month]);

  const visibleRows = rows.filter(r => branchFilter === 'all' || r.branchId === branchFilter);
  const approved = visibleRows.filter(r => r.statement?.status === 'approved');
  const payslip = payslipWindowFor(month);

  function openEditor(row: Row) {
    setEditing(row);
    setForm(toForm(row.inputs));
  }

  const liveInputs = form ? fromForm(form) : null;
  const liveResult = editing && liveInputs
    ? (editing.statement?.status === 'approved' ? editing.result : computeIncentive(editing.type, liveInputs, factors))
    : null;
  const isApproved = editing?.statement?.status === 'approved';
  const formLocked = !canManage || isApproved;

  // Fills a payslip's Incentive as a total: the payslip takes its own 25%
  // retention, so writing the net here would withhold it twice. Only a pending
  // payslip changes — a paid one has already gone out. net_pay moves by the
  // difference, so every other figure on it stays as it was.
  async function setPayslipIncentive(employeeId: string, incentive: number, onlyIfCurrently?: number): Promise<string> {
    const { start, end, label } = payslip;
    const { data, error } = await supabase
      .from('payroll')
      .select('id, status, incentive, incentive_retention, net_pay')
      .eq('employee_id', employeeId)
      .eq('period', '1')
      .gte('pay_date', start)
      .lte('pay_date', end)
      .maybeSingle();
    if (error) return `Could not check the ${label}: ${error.message}`;
    if (!data) return `It will fill the ${label} when that payroll is generated.`;
    if (data.status === 'paid') return `The ${label} is already paid, so it was not changed.`;
    const current = Number(data.incentive) || 0;
    if (onlyIfCurrently != null && Math.abs(current - onlyIfCurrently) > 0.005) {
      return `The ${label} was edited by hand, so it was left as it is.`;
    }
    const retention = Math.round(incentive * 0.25 * 100) / 100;
    const net = Math.round((Number(data.net_pay) - current + (Number(data.incentive_retention) || 0) + incentive - retention) * 100) / 100;
    const { error: updateError } = await supabase
      .from('payroll')
      .update({ incentive, incentive_retention: retention, net_pay: net })
      .eq('id', data.id)
      .neq('status', 'paid');
    if (updateError) return `Could not update the ${label}: ${updateError.message}`;
    return `The ${label} Incentive is now ${formatCurrency(incentive)}.`;
  }

  async function saveStatement(status: 'draft' | 'approved') {
    if (!editing || !liveInputs || !liveResult) return;
    if (status === 'approved' && liveResult.missingFactor) {
      toast({ title: 'Factor missing', description: 'This rate has no factor in the tables yet. Add it under Factor Tables before approving.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const now = new Date().toISOString();
    const payload = {
      employee_id: editing.employee.id,
      month: monthBounds(month).start,
      statement_type: editing.type,
      branch_id: editing.branchId,
      area_id: editing.areaId,
      inputs: liveInputs,
      results: {
        ...liveResult,
        employeeName: formatCustomerName(editing.employee.first_name, editing.employee.last_name),
        position: editing.employee.position,
        branchLabel: editing.branchLabel,
        areaLabel: editing.areaLabel,
      },
      total_incentive: liveResult.totalIncentive,
      withheld: liveResult.withheld,
      net_incentive: liveResult.netIncentive,
      status,
      approved_by: status === 'approved' ? profile?.id ?? null : null,
      approved_at: status === 'approved' ? now : null,
      updated_at: now,
    };
    const { error } = editing.statement
      ? await supabase.from('incentive_statements').update(payload).eq('id', editing.statement.id)
      : await supabase.from('incentive_statements').insert({ ...payload, created_by: profile?.id ?? null });
    if (error) {
      setSaving(false);
      toast({ title: 'Not saved', description: error.message, variant: 'destructive' });
      return;
    }
    const note = status === 'approved' ? await setPayslipIncentive(editing.employee.id, liveResult.totalIncentive) : '';
    setSaving(false);
    toast({ title: status === 'approved' ? 'Statement approved' : 'Draft saved', description: note || undefined });
    setEditing(null);
    load();
  }

  async function unapprove() {
    if (!editing?.statement) return;
    setSaving(true);
    const { error } = await supabase
      .from('incentive_statements')
      .update({ status: 'draft', approved_by: null, approved_at: null, updated_at: new Date().toISOString() })
      .eq('id', editing.statement.id);
    if (error) {
      setSaving(false);
      toast({ title: 'Not changed', description: error.message, variant: 'destructive' });
      return;
    }
    const note = await setPayslipIncentive(editing.employee.id, 0, Number(editing.statement.total_incentive) || 0);
    setSaving(false);
    toast({ title: 'Back to draft', description: `The employee can no longer see it. ${note}` });
    setEditing(null);
    load();
  }

  async function discardDraft() {
    if (!editing?.statement) return;
    setSaving(true);
    const { error } = await supabase.from('incentive_statements').delete().eq('id', editing.statement.id).eq('status', 'draft');
    setSaving(false);
    if (error) {
      toast({ title: 'Not deleted', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Draft discarded', description: 'It goes back to the system figures.' });
    setEditing(null);
    load();
  }

  function fillFromSystem() {
    if (!editing || !monthData) return;
    const prefill = prefillStatement(editing.employee, monthData, month);
    if (prefill) setForm(toForm(prefill.inputs));
  }

  const field = (key: keyof IncentiveInputs, label: string, hint?: string) => (
    <div className="space-y-1.5" key={key}>
      <Label htmlFor={`inc-${key}`}>{label}</Label>
      <Input
        id={`inc-${key}`}
        type="number"
        step="any"
        value={form?.[key] ?? ''}
        disabled={formLocked}
        onChange={(e) => setForm(prev => prev && { ...prev, [key]: e.target.value })}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Incentives" description={`Prepare and approve each employee's monthly incentive. ${monthLabel(month)} goes on the ${payslip.label}.`}>
        <Button variant="outline" size="sm" onClick={() => setFactorsOpen(true)}><Settings2 className="w-4 h-4 mr-2" />Factor Tables</Button>
      </PageHeader>

      <Card className="glass-card border-border">
        <CardContent className="p-4 flex flex-col sm:flex-row gap-4 sm:items-end">
          <div className="space-y-2 sm:w-56">
            <Label htmlFor="inc-month">Month</Label>
            <Input id="inc-month" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          </div>
          <div className="space-y-2 sm:w-64">
            <Label>Branch</Label>
            <Select value={branchFilter} onValueChange={setBranchFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Branches</SelectItem>
                {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard title="Approved" value={`${approved.length} of ${visibleRows.length}`} icon={<CheckCircle className="w-5 h-5" />} />
        <StatCard title="Total Incentive" value={formatCurrency(visibleRows.reduce((s, r) => s + r.result.totalIncentive, 0))} icon={<Award className="w-5 h-5" />} subtitle="Approved and not yet approved" />
        <StatCard title="Net Incentive" value={formatCurrency(visibleRows.reduce((s, r) => s + r.result.netIncentive, 0))} icon={<Wallet className="w-5 h-5" />} variant="success" subtitle="After 25% withheld" />
      </div>

      <Card className="glass-card border-border">
        <CardHeader>
          <CardTitle>{monthLabel(month)}</CardTitle>
          <CardDescription>Figures come from the system until a statement is saved. Open one to review, edit and approve it.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : loadError ? (
            <p className="text-sm text-destructive text-center py-8">{loadError}</p>
          ) : visibleRows.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No employees with an incentive here</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Position</TableHead>
                    <TableHead>Branch / Area</TableHead>
                    <TableHead className="text-right">Total Release</TableHead>
                    <TableHead className="text-right">Total Incentive</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map(r => (
                    <TableRow key={r.employee.id}>
                      <TableCell className="font-medium whitespace-nowrap">{formatCustomerName(r.employee.first_name, r.employee.last_name)}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{TYPE_LABELS[r.type]}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{r.branchLabel}{r.areaLabel ? ` · ${r.areaLabel}` : ''}</TableCell>
                      <TableCell className="text-sm text-right">{formatCurrency(r.inputs.totalRelease)}</TableCell>
                      <TableCell className="text-sm text-right">{formatCurrency(r.result.totalIncentive)}</TableCell>
                      <TableCell className="text-sm text-right font-medium">{formatCurrency(r.result.netIncentive)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <div className="flex flex-wrap gap-1">
                          {r.statement?.status === 'approved'
                            ? <Badge className="bg-success/15 text-success border-success/30">Approved</Badge>
                            : r.statement
                              ? <Badge variant="secondary">Draft</Badge>
                              : <Badge variant="outline">Not started</Badge>}
                          {!r.result.eligible && <Badge variant="outline" className="text-warning border-warning/40">Not eligible</Badge>}
                          {r.result.missingFactor && <Badge variant="outline" className="text-destructive border-destructive/40">Factor missing</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" onClick={() => openEditor(r)}>{canManage && r.statement?.status !== 'approved' ? 'Review' : 'View'}</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-4xl w-[calc(100vw-2rem)] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? `${formatCustomerName(editing.employee.first_name, editing.employee.last_name)} — ${monthLabel(month)}` : ''}</DialogTitle>
            <DialogDescription>
              {editing ? `${TYPE_LABELS[editing.type]} · ${editing.branchLabel}${editing.areaLabel ? ` · ${editing.areaLabel}` : ''}` : ''}
            </DialogDescription>
          </DialogHeader>
          {editing && form && liveInputs && liveResult && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-4">
                {editing.type === 'cashier' && field('totalRelease', 'Total Release (Branch)')}

                {(editing.type === 'collector' || editing.type === 'branch_manager') && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      {field('overdue', 'Overdue')}
                      {field('receivable', 'Receivable')}
                    </div>
                    {editing.overdueSource && <p className="text-xs text-muted-foreground -mt-2">{editing.overdueSource}</p>}
                    {field('totalRelease', 'Total Release', 'Reduce it when releases were handled by someone else, e.g. while the collector was absent.')}
                    {field('collection', 'Collection', 'Cash payments plus what each release collected up front.')}
                    {editing.type === 'collector' && (
                      <div className="rounded-lg border border-border p-3 space-y-3">
                        <p className="text-sm font-medium">1M Incentive</p>
                        <p className="text-xs text-muted-foreground -mt-2">Table amount less {formatCurrency(ONE_MILLION_DAILY_DEDUCTION)} per business day. The higher of this and the computed incentive is paid.</p>
                        <div className="grid grid-cols-2 gap-3">
                          {field('scopeRelease', 'Area Release', 'Regardless of absences.')}
                          {field('businessDays', 'Business Days', 'Monday to Saturday.')}
                        </div>
                        {field('oneMillionOverride', 'Amount', 'Leave blank to compute it.')}
                      </div>
                    )}
                  </>
                )}

                {editing.type === 'proxy' && (
                  <>
                    {field('marketTargetRate', 'Market Target Rate (%)', 'Shown on the statement only. Leave blank for no target.')}
                    {field('totalRelease', 'Total Release', 'The loans this proxy requested.')}
                    {field('performanceIncentive', 'Performance Incentive', `Usually ${formatCurrency(DEFAULT_PERFORMANCE_INCENTIVE)}.`)}
                    {field('collection', 'Collection')}
                    {field('overdueCollectionIncentive', 'Overdue Collection Incentive')}
                    <div className="rounded-lg border border-border p-3 space-y-3">
                      <p className="text-sm font-medium">Branch figures</p>
                      <p className="text-xs text-muted-foreground -mt-2">The factors follow the whole branch&apos;s rates. {editing.overdueSource}</p>
                      <div className="grid grid-cols-2 gap-3">
                        {field('overdue', 'Branch Overdue')}
                        {field('receivable', 'Branch Receivable')}
                      </div>
                      {field('scopeRelease', 'Branch Release')}
                    </div>
                  </>
                )}

                {liveResult.missingFactor && (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                    This rate has no factor in the tables yet ({liveResult.overdueRate.toFixed(2)}% overdue, {liveResult.liquidityRate.toFixed(2)}% liquidity). Add it under Factor Tables to approve this statement.
                  </div>
                )}
                {canManage && !isApproved && (
                  <Button type="button" variant="ghost" size="sm" onClick={fillFromSystem}>Use system figures</Button>
                )}
              </div>
              <div className="rounded-lg border border-border bg-white overflow-hidden self-start">
                <IncentiveDocument
                  ref={actions.docRef}
                  type={editing.type}
                  month={monthBounds(month).start}
                  employeeName={formatCustomerName(editing.employee.first_name, editing.employee.last_name)}
                  position={editing.employee.position}
                  branchLabel={editing.branchLabel}
                  areaLabel={editing.areaLabel}
                  inputs={liveInputs}
                  result={liveResult}
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 flex-wrap">
            <Button variant="outline" onClick={actions.print}><Printer className="w-4 h-4 mr-2" />Print</Button>
            <Button variant="outline" onClick={actions.downloadPdf} disabled={actions.downloading}>
              {actions.downloading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
              PDF
            </Button>
            {canManage && editing?.statement?.status === 'draft' && (
              <Button variant="outline" className="text-destructive hover:text-destructive" onClick={discardDraft} disabled={saving}>Discard Draft</Button>
            )}
            {canManage && isApproved && (
              <Button variant="outline" onClick={unapprove} disabled={saving}>Back to Draft</Button>
            )}
            {canManage && !isApproved && (
              <>
                <Button variant="outline" onClick={() => saveStatement('draft')} disabled={saving}>Save Draft</Button>
                <Button onClick={() => saveStatement('approved')} disabled={saving || !!liveResult?.missingFactor}>
                  {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Approve
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FactorTablesDialog
        open={factorsOpen}
        onOpenChange={setFactorsOpen}
        factors={factors}
        canManage={canManage}
        onSaved={load}
      />
    </div>
  );
}

function FactorTablesDialog({ open, onOpenChange, factors, canManage, onSaved }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  factors: FactorRow[];
  canManage: boolean;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  type EditRow = { key: string; id?: string; table_name: FactorTableName; threshold: string; value: string };
  const [rows, setRows] = useState<EditRow[]>([]);
  const [activeTable, setActiveTable] = useState<FactorTableName>('overdue_release');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRows(factors.map(f => ({
      key: f.id ?? `${f.table_name}-${f.threshold}`,
      id: f.id,
      table_name: f.table_name,
      threshold: String(f.threshold),
      value: f.value == null ? '' : String(f.value),
    })));
  }, [open, factors]);

  const tableRows = rows
    .filter(r => r.table_name === activeTable)
    .sort((a, b) => (Number(a.threshold) || 0) - (Number(b.threshold) || 0));
  const labels = FACTOR_TABLE_LABELS[activeTable];

  function update(key: string, patch: Partial<EditRow>) {
    setRows(prev => prev.map(r => (r.key === key ? { ...r, ...patch } : r)));
  }

  async function save() {
    const seen = new Set<string>();
    for (const r of rows) {
      const id = `${r.table_name}|${Number(r.threshold)}`;
      if (r.threshold.trim() === '' || Number.isNaN(Number(r.threshold)) || seen.has(id)) {
        toast({ title: 'Check the table', description: `${FACTOR_TABLE_LABELS[r.table_name].title}: every row needs its own number on the left.`, variant: 'destructive' });
        return;
      }
      seen.add(id);
    }
    setSaving(true);
    const toValue = (s: string) => (s.trim() === '' ? null : Number(s));
    const keptIds = new Set(rows.map(r => r.id).filter(Boolean));
    const removed = factors.filter(f => f.id && !keptIds.has(f.id)).map(f => f.id as string);
    let failure: string | null = null;
    // Removals first: a row retyped to a threshold just freed would otherwise
    // hit the unique (table_name, threshold) constraint.
    if (removed.length > 0) {
      const { error } = await supabase.from('incentive_factors').delete().in('id', removed);
      if (error) failure = error.message;
    }
    const changed = rows.filter(r => {
      if (!r.id) return false;
      const was = factors.find(f => f.id === r.id);
      return !was || Number(was.threshold) !== Number(r.threshold) || (was.value == null ? null : Number(was.value)) !== toValue(r.value);
    });
    for (const r of changed) {
      if (failure) break;
      const { error } = await supabase.from('incentive_factors').update({ threshold: Number(r.threshold), value: toValue(r.value) }).eq('id', r.id as string);
      if (error) failure = error.message;
    }
    const added = rows.filter(r => !r.id);
    if (!failure && added.length > 0) {
      const { error } = await supabase.from('incentive_factors').insert(added.map(r => ({ table_name: r.table_name, threshold: Number(r.threshold), value: toValue(r.value) })));
      if (error) failure = error.message;
    }
    setSaving(false);
    if (failure) {
      toast({ title: 'Not all saved', description: failure, variant: 'destructive' });
    } else {
      toast({ title: 'Factor tables saved', description: 'Approved statements keep the factors they were approved with.' });
      onOpenChange(false);
    }
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Factor Tables</DialogTitle>
          <DialogDescription>A rate uses the row at or just below it: 7.75% overdue uses the 7.50% row. A blank factor shows as &quot;Factor missing&quot; and blocks approval.</DialogDescription>
        </DialogHeader>
        <Select value={activeTable} onValueChange={(v) => setActiveTable(v as FactorTableName)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(FACTOR_TABLE_LABELS) as FactorTableName[]).map(t => (
              <SelectItem key={t} value={t}>{FACTOR_TABLE_LABELS[t].title}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex-1 overflow-y-auto min-h-0 space-y-2 pr-1">
          <div className="grid grid-cols-[1fr_1fr_2.25rem] gap-2 text-xs font-medium text-muted-foreground px-1">
            <span>{labels.threshold}</span>
            <span>{labels.value}</span>
            <span />
          </div>
          {tableRows.map(r => (
            <div key={r.key} className="grid grid-cols-[1fr_1fr_2.25rem] gap-2 items-center">
              <Input type="number" step="any" aria-label={labels.threshold} value={r.threshold} disabled={!canManage} onChange={(e) => update(r.key, { threshold: e.target.value })} />
              <Input type="number" step="any" aria-label={labels.value} value={r.value} placeholder="Missing" disabled={!canManage} onChange={(e) => update(r.key, { value: e.target.value })} />
              {canManage ? (
                <Button type="button" variant="ghost" size="icon" title="Remove row" onClick={() => setRows(prev => prev.filter(x => x.key !== r.key))}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              ) : <span />}
            </div>
          ))}
        </div>
        <DialogFooter className="gap-2">
          {canManage && (
            <Button
              type="button"
              variant="outline"
              className="sm:mr-auto"
              onClick={() => setRows(prev => [...prev, { key: `new-${Date.now()}`, table_name: activeTable, threshold: '', value: '' }])}
            >
              <Plus className="w-4 h-4 mr-2" />Add Row
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {canManage && (
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
