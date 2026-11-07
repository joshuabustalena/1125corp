import { collectedAtRelease } from './collections';
import { overdueOrDelayFor } from './overdue';

// Monthly incentive computation, from Kat's spec and her sheet "Monthly
// Incentive Computation 2026". Reproduces her October statements for Carlo
// Rivera (₱8,111.88), Benjo Sibug (₱5,083.20), Rommel Matawaran (₱9,349.85, 1M
// ₱6,500), Carl Del Mundo (₱3,538.10), the Branch Manager (₱31,631.50) and the
// Cashier (₱1,765.20). Tables live in incentive_factors
// (supabase/add_incentive_statements.sql) so Kat can change them herself.

export type IncentiveType = 'collector' | 'branch_manager' | 'proxy' | 'cashier';
export type FactorTableName = 'overdue_release' | 'liquidity_collection' | 'release_bonus' | 'cashier_release';

export const INCENTIVE_TYPE_BY_POSITION: Record<string, IncentiveType> = {
  'Branch Field Collector': 'collector',
  'Branch Manager': 'branch_manager',
  'Branch Proxy Collector': 'proxy',
  Cashier: 'cashier',
};

export const FACTOR_TABLE_LABELS: Record<FactorTableName, { title: string; threshold: string; value: string }> = {
  overdue_release: { title: 'Overdue Rate → Release factor', threshold: 'Overdue rate (%)', value: 'Factor' },
  liquidity_collection: { title: 'Liquidity Rate → Collection factor', threshold: 'Liquidity rate (%)', value: 'Factor' },
  release_bonus: { title: '1M Incentive (before business days)', threshold: 'Area release at least (₱)', value: 'Incentive (₱)' },
  cashier_release: { title: 'Cashier', threshold: 'From', value: 'Factor on branch release' },
};

// Eligibility for Collectors and Branch Managers. Failing any one means no
// incentive at all (Kat, Nov 2026).
export const MIN_RELEASE = 400000;
export const MIN_LIQUIDITY_RATE = 51;
export const MAX_OVERDUE_RATE = 30.99;
export const WITHHELD_RATE = 0.25;
export const DEFAULT_PERFORMANCE_INCENTIVE = 3000;
// The 1M Incentive is a tier less ₱500 per office business day: ₱20,000 - ₱500 x
// 27 days = ₱6,500 on Rommel Matawaran's October statement, whose own daily
// rate is ₱570, so the ₱500 is fixed. It's the same whoever was absent.
export const ONE_MILLION_DAILY_DEDUCTION = 500;

export interface FactorRow {
  id?: string;
  table_name: FactorTableName;
  threshold: number;
  value: number | null;
}

// Proxy: overdue, receivable and scopeRelease are the BRANCH's figures (a proxy
// covers the whole branch when a collector is absent); totalRelease is only the
// loans they requested. Collector: scopeRelease is the area's system release,
// which decides the 1M Incentive regardless of absences, even when totalRelease
// was reduced by hand. A Branch Manager has no 1M Incentive: their sheet shows
// none, with totals under ₱40,000 on ₱4M+ releases.
export interface IncentiveInputs {
  overdue: number;
  receivable: number;
  totalRelease: number;
  collection: number;
  scopeRelease: number;
  oneMillionOverride: number | null;
  businessDays: number;
  marketTargetRate: number;
  performanceIncentive: number;
  overdueCollectionIncentive: number;
}

export interface IncentiveResult {
  overdueRate: number;
  liquidityRate: number;
  releaseFactor: number;
  collectionFactor: number;
  releaseIncentive: number;
  collectionIncentive: number;
  oneMillionIncentive: number;
  totalIncentive: number;
  withheld: number;
  netIncentive: number;
  eligible: boolean;
  ineligibleReasons: string[];
  missingFactor: boolean;
}

function money(n: number): number {
  return Math.round(Number((n * 100).toFixed(4))) / 100;
}

// Rates are rounded to the 2 decimals shown on the statement before the table
// lookup, so the row used always matches the rate printed.
function ratePercent(part: number, whole: number): number {
  return whole > 0 ? money((part / whole) * 100) : 0;
}

export function lookupFactor(factors: FactorRow[], table: FactorTableName, at: number): FactorRow | null {
  let best: FactorRow | null = null;
  for (const f of factors) {
    if (f.table_name !== table || Number(f.threshold) > at) continue;
    if (!best || Number(f.threshold) > Number(best.threshold)) best = f;
  }
  return best;
}

function factorValue(row: FactorRow | null): number | null {
  return row && row.value != null ? Number(row.value) : null;
}

export function computeIncentive(type: IncentiveType, inputs: IncentiveInputs, factors: FactorRow[]): IncentiveResult {
  const finish = (r: Omit<IncentiveResult, 'withheld' | 'netIncentive'>): IncentiveResult => {
    const withheld = money(r.totalIncentive * WITHHELD_RATE);
    return { ...r, withheld, netIncentive: money(r.totalIncentive - withheld) };
  };
  const none = {
    overdueRate: 0, liquidityRate: 0, releaseFactor: 0, collectionFactor: 0,
    releaseIncentive: 0, collectionIncentive: 0, oneMillionIncentive: 0, totalIncentive: 0,
    eligible: true, ineligibleReasons: [] as string[], missingFactor: false,
  };

  if (type === 'cashier') {
    const factor = factorValue(lookupFactor(factors, 'cashier_release', 0));
    return finish({
      ...none,
      releaseFactor: factor ?? 0,
      totalIncentive: money(inputs.totalRelease * (factor ?? 0)),
      missingFactor: factor == null,
    });
  }

  if (type === 'proxy') {
    const overdueRate = ratePercent(inputs.overdue, inputs.receivable);
    const liquidityRate = ratePercent(inputs.receivable - inputs.overdue, inputs.scopeRelease);
    // The release factor follows the branch's overdue rate in the collectors'
    // table; the Market Target Rate is only shown on the statement (Kat, Nov
    // 2026: the sheet's proxy tables aren't used). Outside the tables means
    // that part earns nothing. The ₱400k minimum isn't applied: a proxy's
    // release is only what they requested, and their targets change monthly.
    const releaseRow = overdueRate > MAX_OVERDUE_RATE ? null : lookupFactor(factors, 'overdue_release', overdueRate);
    const collectionRow = lookupFactor(factors, 'liquidity_collection', liquidityRate);
    const releaseFactor = factorValue(releaseRow) ?? 0;
    const collectionFactor = factorValue(collectionRow) ?? 0;
    const releaseIncentive = money(inputs.totalRelease * releaseFactor);
    const collectionIncentive = money(inputs.collection * collectionFactor);
    return finish({
      ...none,
      overdueRate, liquidityRate, releaseFactor, collectionFactor, releaseIncentive, collectionIncentive,
      totalIncentive: money(releaseIncentive + inputs.performanceIncentive + collectionIncentive + inputs.overdueCollectionIncentive),
      missingFactor: (!!releaseRow && releaseRow.value == null) || (!!collectionRow && collectionRow.value == null),
    });
  }

  const overdueRate = ratePercent(inputs.overdue, inputs.receivable);
  const liquidityRate = ratePercent(inputs.receivable - inputs.overdue, inputs.totalRelease);
  const ineligibleReasons: string[] = [];
  if (inputs.totalRelease < MIN_RELEASE) ineligibleReasons.push('Total Release is below ₱400,000');
  if (liquidityRate < MIN_LIQUIDITY_RATE) ineligibleReasons.push('Liquidity Rate is below 51%');
  if (overdueRate > MAX_OVERDUE_RATE) ineligibleReasons.push('Overdue Rate is above 30.99%');
  if (ineligibleReasons.length > 0) {
    return finish({ ...none, overdueRate, liquidityRate, eligible: false, ineligibleReasons });
  }

  const releaseRow = lookupFactor(factors, 'overdue_release', overdueRate);
  const collectionRow = lookupFactor(factors, 'liquidity_collection', liquidityRate);
  const releaseFactor = factorValue(releaseRow) ?? 0;
  const collectionFactor = factorValue(collectionRow) ?? 0;
  const releaseIncentive = money(inputs.totalRelease * releaseFactor);
  const collectionIncentive = money(inputs.collection * collectionFactor);
  const tier = type === 'collector' ? factorValue(lookupFactor(factors, 'release_bonus', inputs.scopeRelease)) : null;
  const oneMillionIncentive = type !== 'collector'
    ? 0
    : inputs.oneMillionOverride ?? (tier == null ? 0 : Math.max(0, tier - ONE_MILLION_DAILY_DEDUCTION * inputs.businessDays));
  return finish({
    ...none,
    overdueRate, liquidityRate, releaseFactor, collectionFactor, releaseIncentive, collectionIncentive, oneMillionIncentive,
    // Whichever is higher (Kat, Nov 2026).
    totalIncentive: money(Math.max(releaseIncentive + collectionIncentive, oneMillionIncentive)),
    missingFactor: factorValue(releaseRow) == null || factorValue(collectionRow) == null,
  });
}

// ---------------------------------------------------------------------------
// Prefilling a statement from the system's own figures.
// ---------------------------------------------------------------------------

export interface IncentiveEmployee {
  id: string;
  position: string | null;
  branch_id: string | null;
  profile_id: string | null;
}

export interface IncentiveMonthData {
  releasedLoans: any[];   // released in the month: amount, area_id, branch_id, created_by + collectedAtRelease's fields
  payments: any[];        // paid in the month: amount_paid, customers(area_id, branch_id)
  activeLoans: any[];     // active now: area_id, branch_id + overdueOrDelayFor's fields
  savedOverdue: any[];    // saved Overdue Amount & Rate reports near the month end
  areas: { id: string; name: string; branch_id: string | null }[];
  collectorAreaByProfile: Record<string, string | null>;
}

export interface IncentivePrefill {
  type: IncentiveType;
  branch_id: string | null;
  area_id: string | null;
  inputs: IncentiveInputs;
  overdueSource: string;
}

// month is 'YYYY-MM'.
export function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, '0')}` };
}

// An October incentive goes on the Nov 1 payslip, every month (Kat). The 1st
// can move: Nov 1 2026 was a Sunday and that payroll is dated Nov 2 — so this
// is the range to look in, always for a period '1' payroll.
export function payslipWindowFor(month: string): { start: string; end: string; label: string } {
  const [y, m] = month.split('-').map(Number);
  const next = new Date(y, m, 1);
  const prefix = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
  return {
    start: `${prefix}-01`,
    end: `${prefix}-15`,
    label: `${next.toLocaleDateString('en-US', { month: 'short' })} 1 payslip`,
  };
}

// Monday to Saturday, the office's days. October 2026 has 27.
export function businessDaysIn(month: string): number {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  let count = 0;
  for (let d = 1; d <= last; d++) if (new Date(y, m - 1, d).getDay() !== 0) count++;
  return count;
}

export function monthLabel(month: string): string {
  return new Date(`${month.slice(0, 7)}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function localDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${a}T00:00:00`).getTime() - new Date(`${b}T00:00:00`).getTime()) / 86400000);
}

// How far from the month end a saved Overdue report can be and still stand in
// for it. Overdue is only ever "as of today", so this is the only record of
// what it was back then.
const SAVED_REPORT_DAYS_BEFORE = 1;
const SAVED_REPORT_DAYS_AFTER = 7;

function figuresFromSaved(saved: any, areaName: string | null): { overdue: number; receivable: number } | null {
  const rows: any[] = Array.isArray(saved.rows) ? saved.rows : [];
  // A save for one area: the report's own totals. Reports saved before
  // stats.totalReceivable existed carry it on each row instead.
  if (saved.area_id) {
    const receivable = saved.stats?.totalReceivable ?? rows[0]?.TotalReceivable;
    if (receivable == null) return null;
    return { overdue: Number(saved.stats?.total) || 0, receivable: Number(receivable) || 0 };
  }
  // A save for the whole branch, read for one of its areas.
  if (areaName) {
    const areaRows = rows.filter(r => r.Area === areaName);
    if (areaRows.length === 0) return null;
    return {
      overdue: areaRows.reduce((s, r) => s + (Number(r.OverdueAmount) || 0), 0),
      receivable: Number(areaRows[0].TotalReceivable) || 0,
    };
  }
  // A save for the whole branch, read for the branch.
  const byArea = new Map<string, number>();
  for (const r of rows) byArea.set(r.Area, Number(r.TotalReceivable) || 0);
  const receivable = saved.stats?.totalReceivable ?? Array.from(byArea.values()).reduce((s, v) => s + v, 0);
  if (!receivable) return null;
  return { overdue: Number(saved.stats?.total) || 0, receivable: Number(receivable) || 0 };
}

function overdueFigures(
  data: IncentiveMonthData,
  monthEnd: string,
  scope: { areaId: string | null; areaName: string | null; branchId: string | null },
  today: Date,
): { overdue: number; receivable: number; source: string } {
  const close = new Date(`${monthEnd}T23:59:59`).getTime();
  const candidates = data.savedOverdue
    .filter(s => {
      if (s.branch_id !== scope.branchId) return false;
      // An area's figures can come from its own save or its branch's; a
      // branch's only from a save covering the whole branch.
      if (s.area_id && s.area_id !== scope.areaId) return false;
      const off = daysBetween(localDate(s.created_at), monthEnd);
      return off >= -SAVED_REPORT_DAYS_BEFORE && off <= SAVED_REPORT_DAYS_AFTER;
    })
    // Closest to the moment the month closed, so of several saved the same
    // day, the last one on the 31st or the first one on the 1st.
    .sort((a, b) => Math.abs(new Date(a.created_at).getTime() - close) - Math.abs(new Date(b.created_at).getTime() - close));
  for (const s of candidates) {
    const figures = figuresFromSaved(s, scope.areaId ? scope.areaName : null);
    if (figures) return { ...figures, source: `Saved Overdue report, ${localDate(s.created_at)}` };
  }

  let overdue = 0;
  let receivable = 0;
  for (const l of data.activeLoans) {
    if (scope.areaId ? l.area_id !== scope.areaId : l.branch_id !== scope.branchId) continue;
    receivable += Number(l.remaining_balance) || 0;
    overdue += overdueOrDelayFor(l, today).amount;
  }
  return { overdue: money(overdue), receivable: money(receivable), source: 'Current system figures — no saved report near the month end' };
}

function releaseOf(data: IncentiveMonthData, match: (l: any) => boolean): number {
  return money(data.releasedLoans.filter(match).reduce((s, l) => s + (Number(l.amount) || 0), 0));
}

// Same as the Monthly Collection report's Total Amount Collected: cash payments
// plus what each release collected up front. Matches Kat's Excel exactly (Area
// 2, Oct 2026: ₱694,335 + ₱252,840 = ₱947,175).
function collectionOf(data: IncentiveMonthData, scope: { areaId: string | null; branchId: string | null }): number {
  const cash = data.payments
    .filter(p => (scope.areaId ? p.customers?.area_id === scope.areaId : p.customers?.branch_id === scope.branchId))
    .reduce((s, p) => s + (Number(p.amount_paid) || 0), 0);
  const atRelease = data.releasedLoans
    .filter(l => (scope.areaId ? l.area_id === scope.areaId : l.branch_id === scope.branchId))
    .reduce((s, l) => s + collectedAtRelease(l), 0);
  return money(cash + atRelease);
}

export function prefillStatement(emp: IncentiveEmployee, data: IncentiveMonthData, month: string, today: Date = new Date()): IncentivePrefill | null {
  const type = emp.position ? INCENTIVE_TYPE_BY_POSITION[emp.position] : undefined;
  if (!type) return null;
  const { end } = monthBounds(month);
  const blank: IncentiveInputs = {
    overdue: 0, receivable: 0, totalRelease: 0, collection: 0, scopeRelease: 0, oneMillionOverride: null,
    businessDays: businessDaysIn(month), marketTargetRate: 0, performanceIncentive: 0, overdueCollectionIncentive: 0,
  };
  const branchId = emp.branch_id;
  const inBranch = (l: any) => l.branch_id === branchId;

  if (type === 'cashier') {
    return {
      type, branch_id: branchId, area_id: null, overdueSource: '',
      inputs: { ...blank, totalRelease: releaseOf(data, inBranch) },
    };
  }

  if (type === 'proxy') {
    const branch = overdueFigures(data, end, { areaId: null, areaName: null, branchId }, today);
    return {
      type, branch_id: branchId, area_id: null, overdueSource: branch.source,
      inputs: {
        ...blank,
        overdue: branch.overdue,
        receivable: branch.receivable,
        scopeRelease: releaseOf(data, inBranch),
        totalRelease: emp.profile_id ? releaseOf(data, l => l.created_by === emp.profile_id) : 0,
        performanceIncentive: DEFAULT_PERFORMANCE_INCENTIVE,
      },
    };
  }

  if (type === 'branch_manager') {
    const branch = overdueFigures(data, end, { areaId: null, areaName: null, branchId }, today);
    const release = releaseOf(data, inBranch);
    return {
      type, branch_id: branchId, area_id: null, overdueSource: branch.source,
      inputs: {
        ...blank,
        overdue: branch.overdue,
        receivable: branch.receivable,
        totalRelease: release,
        scopeRelease: release,
        collection: collectionOf(data, { areaId: null, branchId }),
      },
    };
  }

  const areaId = emp.profile_id ? data.collectorAreaByProfile[emp.profile_id] ?? null : null;
  if (!areaId) {
    return { type, branch_id: branchId, area_id: null, overdueSource: 'This collector has no area assigned', inputs: blank };
  }
  const areaName = data.areas.find(a => a.id === areaId)?.name ?? null;
  const area = overdueFigures(data, end, { areaId, areaName, branchId }, today);
  const release = releaseOf(data, l => l.area_id === areaId);
  return {
    type, branch_id: branchId, area_id: areaId, overdueSource: area.source,
    inputs: {
      ...blank,
      overdue: area.overdue,
      receivable: area.receivable,
      totalRelease: release,
      scopeRelease: release,
      collection: collectionOf(data, { areaId, branchId }),
    },
  };
}

// ---------------------------------------------------------------------------
// The statement's lines, in the order of Kat's template.
// ---------------------------------------------------------------------------

export interface StatementLine {
  label: string;
  kind: 'money' | 'percent' | 'plain';
  value: number;
  tone?: 'bold' | 'muted' | 'accent' | 'net';
  emptyText?: string; // shown instead of a zero
}

export function statementLines(type: IncentiveType, inputs: IncentiveInputs, r: IncentiveResult): StatementLine[] {
  const money_ = (label: string, value: number, tone?: StatementLine['tone']): StatementLine => ({ label, kind: 'money', value, tone });
  const percent = (label: string, value: number, tone?: StatementLine['tone']): StatementLine => ({ label, kind: 'percent', value, tone });
  const closing = [
    money_('Withholded Income', r.withheld),
    money_('Net Incentive', r.netIncentive, 'net'),
  ];

  if (type === 'cashier') {
    return [
      money_('Total Release (Branch)', inputs.totalRelease),
      money_('Incentive', r.totalIncentive, 'bold'),
      ...closing,
    ];
  }

  if (type === 'proxy') {
    return [
      { ...percent('Market Target Rate', inputs.marketTargetRate), emptyText: 'no target' },
      money_('Total Release', inputs.totalRelease),
      money_('Release Incentive', r.releaseIncentive, 'bold'),
      money_('Performance Incentive', inputs.performanceIncentive, 'bold'),
      money_('Collection', inputs.collection),
      percent('Liquidity Rate', r.liquidityRate, 'muted'),
      money_('Collection Incentive', r.collectionIncentive, 'bold'),
      money_('Overdue Collection Incentive', inputs.overdueCollectionIncentive, 'bold'),
      money_('Total Incentive', r.totalIncentive, 'bold'),
      ...closing,
    ];
  }

  const oneMillion: StatementLine[] = type === 'collector'
    ? [{ ...money_('1M Incentive', r.oneMillionIncentive, 'accent'), emptyText: '—' }]
    : [];
  return [
    money_('Overdue', inputs.overdue),
    money_('Receivable', inputs.receivable),
    percent('Overdue Rate', r.overdueRate),
    money_('Total Release', inputs.totalRelease),
    money_('Release Incentive', r.releaseIncentive, 'bold'),
    money_('Collection', inputs.collection),
    percent('Liquidity Rate', r.liquidityRate, 'muted'),
    money_('Collection Incentive', r.collectionIncentive, 'bold'),
    money_('Total Incentive', r.totalIncentive, 'bold'),
    ...oneMillion,
    ...closing,
  ];
}
