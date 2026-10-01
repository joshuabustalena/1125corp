'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { StatCard } from '@/components/dashboard/stat-card';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { selectAllRows } from '@/lib/db-chunk';
import { overdueOrDelayFor } from '@/lib/overdue';
import { formatCurrency, formatDate, formatTime, exportToCSV, formatCustomerName, dateToStr, todayStr } from '@/lib/format';
import { buildPrintHtml } from '@/lib/print-document';
import { COMPANY_NAME_DISPLAY } from '@/lib/document-branding';
import {
  FileBarChart, Download, Loader2, Printer, TrendingUp, Users, Wallet, Landmark,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

// Sentinel branch id that matches no real row — used to scope a non-admin
// who has no branch assigned down to nothing instead of everything.
const NO_BRANCH = '00000000-0000-0000-0000-000000000000';

// Explicit list rather than substring guessing on the column name. The old
// `key.includes('Amount') || key.includes('Pay') || …` test silently missed
// most of the money columns (CashCollected, Offset, TotalDeduction,
// TotalCollections, NetProceeds, …), printing them as bare numbers like
// 189042.71 instead of ₱189,042.71. Counts (DaysOverdue, Customers, Loans)
// are deliberately absent so they never get a peso sign.
const MONEY_COLUMNS = new Set([
  'TotalDeduction', 'TotalCollections', 'TotalRelease', 'TotalInterest', 'ServiceFee', 'NetProceeds',
  'OverdueAmount', 'Balance', 'AmountReleased', 'TotalReceivable', 'TotalCashCollected', 'TotalAmountCollected',
]);

// Friendlier header text for a column whose raw key (still used internally
// for money-formatting and CSV export) reads oddly in the table itself.
// 'AmountReleased' is unique to Monthly Release, so this only ever affects
// that report's header — no other report type uses that key.
const COLUMN_LABELS: Record<string, string> = {
  AmountReleased: 'Amount of loan (Principal)',
};
function columnLabel(key: string): string {
  return COLUMN_LABELS[key] ?? key;
}

// Same labels the Report Type dropdown shows — reused so the printed
// document's title always says which report it is, instead of the raw
// 'monthly_release' key.
function reportTypeLabel(type: string, isFieldCollector: boolean): string {
  switch (type) {
    case 'monthly_collection': return 'Monthly Collection (per Area)';
    case 'branch_performance': return isFieldCollector ? 'Release (My Area)' : 'Branch Performance';
    case 'monthly_release': return 'Monthly Release';
    case 'overdue_amount': return 'Overdue Amount & Rate';
    case 'customers_per_area': return isFieldCollector ? 'All Customers' : 'Customers per Area';
    case 'delinquent_customers': return 'Delayed / Past-Due Customers';
    default: return 'Report';
  }
}

export default function ReportsPage() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const isFieldCollector = profile?.role_name === 'Branch Field Collector';
  const isAdmin = profile?.role_name === 'Administrator';
  // Non-admins see only their own branch's reports — the Branch dropdown is
  // replaced by a fixed badge and every query is scoped to profile.branch_id.
  // branchResolved gates the first generateReport() so it can't fire once
  // with the default 'all' before the lock lands.
  const [branchResolved, setBranchResolved] = useState(false);
  const [reportType, setReportType] = useState('monthly_collection');
  const [startDate, setStartDate] = useState(dateToStr(new Date(Date.now() - 30 * 86400000)));
  const [endDate, setEndDate] = useState(todayStr());
  // Monthly Release picks one calendar month instead of a date range — Kat's
  // request: "buong September, makikita nila kung sino-sino yung narelease".
  const [monthFilter, setMonthFilter] = useState(todayStr().substring(0, 7));
  const [data, setData] = useState<any[]>([]);
  // Per-row tick-off for manual review (e.g. cross-checking each Monthly
  // Release line against a physical record) — local to this screen only,
  // not saved anywhere, so it resets with every new Generate.
  const [checkedRows, setCheckedRows] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({ total: 0, count: 0, average: 0, overdueRate: 0 });
  const [branches, setBranches] = useState<any[]>([]);
  const [areas, setAreas] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [branchFilter, setBranchFilter] = useState('all');
  const [areaFilter, setAreaFilter] = useState('all');
  const [myArea, setMyArea] = useState<{ id: string; name: string } | null>(null);
  // Every report resolves its branch/area scope through the customers and
  // areas lists, so generateReport() must not run before they've loaded —
  // otherwise filteredCustomerIds() returns an empty list (rendering an
  // empty report) and the per-area groupings all collapse to "Unassigned".
  const [filtersLoaded, setFiltersLoaded] = useState(false);
  const [printing, setPrinting] = useState(false);
  const printPageRefs = useRef<(HTMLDivElement | null)[]>([]);
  // Same-size chunks as Collection List's printable worksheet — a full table
  // with its own column headings per sheet, instead of one giant image
  // shrunk down to fit a single page.
  const ROWS_PER_PRINT_PAGE = 32;

  useEffect(() => { loadFilterOptions(); }, []);

  // Field Collectors are locked to their own assigned area — no company-wide
  // visibility. Everyone else keeps the free Branch/Area filter dropdowns.
  useEffect(() => {
    if (!profile || !isFieldCollector) return;
    supabase.from('collectors').select('area_id, areas(name)').eq('profile_id', profile.id).maybeSingle().then(({ data }) => {
      if (data?.area_id) {
        setAreaFilter(data.area_id);
        setMyArea({ id: data.area_id, name: (data as any).areas?.name ?? 'Unassigned' });
      }
    });
  }, [profile, isFieldCollector]);

  // Branch lock for everyone who isn't an Administrator. A non-admin with no
  // branch assigned falls back to a deliberately unmatchable id rather than
  // staying on 'all' — otherwise a missing branch_id would quietly grant
  // company-wide visibility, the exact opposite of the intended lock.
  useEffect(() => {
    if (!profile) return;
    if (isAdmin) { setBranchResolved(true); return; }
    setBranchFilter(profile.branch_id || NO_BRANCH);
    setBranchResolved(true);
  }, [profile, isAdmin]);

  useEffect(() => {
    if (!branchResolved || !filtersLoaded) return;
    if (isFieldCollector && !myArea) return;
    generateReport();
  }, [myArea, isFieldCollector, branchResolved, filtersLoaded]);

  async function loadFilterOptions() {
    const [b, a, c] = await Promise.all([
      supabase.from('branches').select('id, name').eq('status', 'active').order('name'),
      supabase.from('areas').select('id, name, branch_id').eq('status', 'active').order('name'),
      supabase.from('customers').select('id, branch_id, area_id'),
    ]);
    setBranches(b.data ?? []);
    setAreas(a.data ?? []);
    setCustomers(c.data ?? []);
    setFiltersLoaded(true);
  }

  // Payments don't carry branch_id/area_id directly — resolve the filter down
  // Payments don't carry branch_id/area_id directly — scoped through an
  // inner join on customers instead of an .in() over a fetched id list.
  // Balanga alone has 413 customers: passing them all as query parameters
  // builds a ~15,000 character URL and the request fails outright ('fetch
  // failed'), which silently zeroed every payments-based report for a
  // whole-branch filter.
  function scopePaymentsByCustomer(q: any) {
    if (areaFilter !== 'all') return q.eq('customers.area_id', areaFilter);
    if (branchFilter !== 'all') return q.eq('customers.branch_id', branchFilter);
    return q;
  }

  async function generateReport() {
    setLoading(true);
    let reportData: any[] = [];
    // Only the Overdue report sets this; every other report leaves it 0 so
    // the rate card stays hidden.
    let overallOverdueRate = 0;

    switch (reportType) {
      // Collection is reported per day split into what actually came in as
      // cash (payments collected in the field) versus what was settled by
      // deduction at release — Offset Balance carried from a renewed loan,
      // plus the day-one First Payment taken out of the proceeds. Both are
      // real collection, but only the first is money that physically moved,
      // so the client wants them on separate lines rather than one figure.
      // Replaces the old separate Daily/Weekly/Monthly Collection reports
      // (client request, Oct 2026 — "parang per month na lang din date na
      // seselect, same sa monthly release"): pick one month, see every day
      // within it broken out per area, each day's Cash Collected / Total
      // Deduction / Total Amount Collected — the same three figures Daily
      // Collection already computed, just scoped to a month and split by
      // area instead of lumped company-wide.
      case 'monthly_collection': {
        const [y, m] = monthFilter.split('-').map(Number);
        const monthStart = `${monthFilter}-01`;
        const monthEnd = dateToStr(new Date(y, m, 0));
        // Paginated — a wide enough range takes this past PostgREST's silent
        // 1000-row cap, which would drop payments from the totals with
        // nothing on screen to show it (see lib/db-chunk.ts).
        const paysPromise = selectAllRows<any>(() => scopePaymentsByCustomer(supabase.from('payments').select('amount_paid, payment_date, customer_id, customers!inner(branch_id, area_id)').gte('payment_date', monthStart).lte('payment_date', monthEnd)));
        let lq = supabase.from('loans').select('release_date, amount, release_amount, area_id').gte('release_date', monthStart).lte('release_date', monthEnd);
        if (areaFilter !== 'all') lq = lq.eq('area_id', areaFilter);
        else if (branchFilter !== 'all') lq = lq.eq('branch_id', branchFilter);
        const [pays, { data: loans }] = await Promise.all([paysPromise, lq]);

        const areaNameById = new Map(areas.map((a: any) => [a.id, a.name]));
        const areaIdByCustomer = new Map(customers.map((c: any) => [c.id, c.area_id]));
        const byKey: Record<string, { date: string; area: string; cash: number; deduction: number }> = {};
        const ensure = (date: string, area: string) => (byKey[`${date}|${area}`] ??= { date, area, cash: 0, deduction: 0 });
        (pays ?? []).forEach((p: any) => {
          const area = areaNameById.get(areaIdByCustomer.get(p.customer_id)) ?? 'Unassigned';
          ensure(p.payment_date, area).cash += Number(p.amount_paid) || 0;
        });
        (loans ?? []).forEach((l: any) => {
          if (!l.release_date) return;
          const area = areaNameById.get(l.area_id) ?? 'Unassigned';
          // Total Deduction is what was ACTUALLY withheld from the proceeds
          // at release (amount - release_amount) — same definition Daily
          // Collection and Branch Performance already use.
          ensure(l.release_date, area).deduction += (Number(l.amount) || 0) - (Number(l.release_amount) || 0);
        });

        reportData = Object.values(byKey)
          .sort((a, b) => a.date.localeCompare(b.date) || a.area.localeCompare(b.area))
          .map(v => ({
            Date: v.date,
            Area: v.area,
            TotalCashCollected: Math.round(v.cash * 100) / 100,
            TotalDeduction: Math.round(v.deduction * 100) / 100,
            TotalAmountCollected: Math.round((v.cash + v.deduction) * 100) / 100,
          }));
        break;
      }
// Client-specified column set: Total Collections, Total Release, Total
      // Interest, Service Fee, Net Proceeds, Total Deduction — replacing the
      // old generic Loans/TotalAmount/OutstandingBalance shape.
      case 'branch_performance': {
        let lq = supabase.from('loans').select('amount, interest_amount, service_fee, offset_balance, daily_payment, total_payable, term_days, release_amount, branch_id, area_id, branches(name), areas(name)').gte('release_date', startDate).lte('release_date', endDate);
        if (areaFilter !== 'all') lq = lq.eq('area_id', areaFilter);
        else if (branchFilter !== 'all') lq = lq.eq('branch_id', branchFilter);
        // Paginated for the same reason as monthly_collection above.
        const paysPromise = selectAllRows<any>(() => scopePaymentsByCustomer(supabase.from('payments').select('amount_paid, customer_id, customers!inner(branch_id, area_id)').gte('payment_date', startDate).lte('payment_date', endDate)));
        const [{ data: loans }, pays] = await Promise.all([lq, paysPromise]);

        const groupByArea = areaFilter !== 'all';
        const areaNameById = new Map(areas.map((a: any) => [a.id, a.name]));
        const branchNameById = new Map(branches.map((b: any) => [b.id, b.name]));
        const customerById = new Map(customers.map((c: any) => [c.id, c]));

        type Row = { collections: number; release: number; interest: number; serviceFee: number; netProceeds: number; deduction: number };
        const grouped: Record<string, Row> = {};
        const ensure = (n: string) => (grouped[n] ??= { collections: 0, release: 0, interest: 0, serviceFee: 0, netProceeds: 0, deduction: 0 });

        (loans ?? []).forEach((l: any) => {
          const name = groupByArea ? (l.areas?.name ?? 'Unassigned') : (l.branches?.name ?? 'Unassigned');
          const row = ensure(name);
          row.release += Number(l.amount) || 0;
          row.interest += Number(l.interest_amount) || 0;
          row.serviceFee += Number(l.service_fee) || 0;
          row.netProceeds += Number(l.release_amount) || 0;
          // Total Deduction is what was ACTUALLY withheld at release
          // (amount - release_amount), not offset + first payment + fee
          // recomputed from the loan's current fields. Those two disagree on
          // real data — notably on renewals, where the day-one payment turns
          // out not to have been deducted from the proceeds even though the
          // Loan Agreement lists it. Deriving from release_amount keeps the
          // report internally consistent: Total Release - Total Deduction
          // always equals Net Proceeds.
          row.deduction += (Number(l.amount) || 0) - (Number(l.release_amount) || 0);
        });
        (pays ?? []).forEach((p: any) => {
          const cust = customerById.get(p.customer_id);
          const name = groupByArea
            ? (areaNameById.get(cust?.area_id) ?? 'Unassigned')
            : (branchNameById.get(cust?.branch_id) ?? 'Unassigned');
          ensure(name).collections += Number(p.amount_paid) || 0;
        });

        const r2 = (n: number) => Math.round(n * 100) / 100;
        reportData = Object.entries(grouped)
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([name, v]) => ({
            [groupByArea ? 'Area' : 'Branch']: name,
            TotalCollections: r2(v.collections),
            TotalRelease: r2(v.release),
            TotalInterest: r2(v.interest),
            ServiceFee: r2(v.serviceFee),
            NetProceeds: r2(v.netProceeds),
            TotalDeduction: r2(v.deduction),
          }));
        break;
      }
// Overdue Rate and Overdue Amount are ONE report now (client request) —
      // the per-area overdue rate is carried on each row alongside the loan's
      // own overdue amount, instead of living in a separate report type.
      // A loan counts as overdue when it's still 'active' and past its
      // due_date — same rule the dashboard uses (status is never persisted
      // as 'overdue').
      case 'overdue_amount': {
        let q = supabase.from('loans').select('loan_number, remaining_balance, total_payable, term_days, release_date, due_date, branch_id, area_id, customers(first_name, last_name), areas(name)').eq('status', 'active');
        if (areaFilter !== 'all') q = q.eq('area_id', areaFilter);
        else if (branchFilter !== 'all') q = q.eq('branch_id', branchFilter);
        const { data } = await q;
        const today = new Date();
        const all = data ?? [];

        // Overdue Rate is a PESO ratio — overdue amount over total receivable
        // (client, Aug 2026: "overdue amount divided by total receivable").
        // It used to be a head-count ratio (overdue loans / all loans), which
        // is a different number entirely and understated the exposure
        // whenever the overdue loans were the larger ones.
        const byArea: Record<string, { overdue: number; receivable: number }> = {};
        const rows: any[] = [];
        all.forEach((l: any) => {
          const area = l.areas?.name ?? 'Unassigned';
          byArea[area] ??= { overdue: 0, receivable: 0 };
          byArea[area].receivable += Number(l.remaining_balance) || 0;
          const { amount, isPastDue, daysOverdue } = overdueOrDelayFor(l, today);
          byArea[area].overdue += amount;
          // Delayed loans still inside their term are included too, not just
          // past-due ones — that's the merge the client asked for.
          if (amount > 0) rows.push({ l, area, amount, isPastDue, daysOverdue });
        });

        const rate = (o: number, r: number) => (r > 0 ? Math.round((o / r) * 1000) / 10 : 0);
        overallOverdueRate = rate(
          Object.values(byArea).reduce((s, v) => s + v.overdue, 0),
          Object.values(byArea).reduce((s, v) => s + v.receivable, 0),
        );

        reportData = rows
          .map((r: any) => ({
            LoanNumber: r.l.loan_number,
            Customer: formatCustomerName(r.l.customers?.first_name, r.l.customers?.last_name),
            Area: r.area,
            DueDate: r.l.due_date,
            Status: r.isPastDue ? 'Past Due' : 'Delayed',
            DaysOverdue: r.daysOverdue,
            OverdueAmount: r.amount,
            OverdueRate: rate(byArea[r.area].overdue, byArea[r.area].receivable),
            TotalReceivable: byArea[r.area].receivable,
          }))
          .sort((a: any, b: any) => b.OverdueAmount - a.OverdueAmount);
        break;
      }
      // One row per released loan within the chosen calendar month — matches
      // the client's own Cash Flow/Count sheet (Date, Name, Amount Released),
      // just generated from the ledger instead of typed in by hand.
      case 'monthly_release': {
        const [y, m] = monthFilter.split('-').map(Number);
        const monthStart = `${monthFilter}-01`;
        const monthEnd = dateToStr(new Date(y, m, 0));
        // Katrina's correction (Sep 28): this counts the LOAN amount (the
        // principal actually granted), not release_amount (net proceeds
        // after deductions) — the two differ whenever a renewal's offset
        // balance or day-one payment gets withheld from what's handed over.
        //
        // Only 'active' loans (Sep 30) — a loan released this month can
        // since have moved on (renewed into a new loan, paid off, written
        // off), and this report tracks what's still actually outstanding
        // from that month's releases, not a historical log of every peso
        // that ever went out.
        let q = supabase.from('loans').select('release_date, amount, branch_id, area_id, customers(first_name, last_name)')
          .eq('status', 'active')
          .gte('release_date', monthStart).lte('release_date', monthEnd).order('release_date');
        if (areaFilter !== 'all') q = q.eq('area_id', areaFilter);
        else if (branchFilter !== 'all') q = q.eq('branch_id', branchFilter);
        const { data } = await q;
        reportData = (data ?? []).map((l: any) => ({
          Date: l.release_date,
          Name: formatCustomerName(l.customers?.first_name, l.customers?.last_name),
          AmountReleased: Number(l.amount) || 0,
        }));
        break;
      }
      case 'customers_per_area': {
        let q = supabase.from('customers').select('area_id, branch_id, areas(name)').eq('status', 'active');
        if (areaFilter !== 'all') q = q.eq('area_id', areaFilter);
        else if (branchFilter !== 'all') q = q.eq('branch_id', branchFilter);
        const { data } = await q;
        const grouped: Record<string, number> = {};
        (data ?? []).forEach((c: any) => {
          const name = c.areas?.name ?? 'Unassigned';
          grouped[name] = (grouped[name] ?? 0) + 1;
        });
        reportData = Object.entries(grouped).map(([area, count]) => ({ Area: area, Customers: count }));
        break;
      }
      // "Delayed" (1-7 days late) vs "Past Due" (8+ days late) is a common
      // grace-period convention — adjust the 7-day cutoff below if your
      // policy differs.
      case 'delinquent_customers': {
        let q = supabase.from('loans').select('loan_number, remaining_balance, due_date, branch_id, area_id, customers(first_name, last_name, phone), areas(name)').eq('status', 'active');
        if (areaFilter !== 'all') q = q.eq('area_id', areaFilter);
        else if (branchFilter !== 'all') q = q.eq('branch_id', branchFilter);
        const { data } = await q;
        const today = new Date();
        reportData = (data ?? [])
          .filter((l: any) => l.due_date && new Date(l.due_date) < today)
          .map((l: any) => {
            const daysOverdue = Math.floor((today.getTime() - new Date(l.due_date).getTime()) / 86400000);
            return {
              LoanNumber: l.loan_number,
              Customer: formatCustomerName(l.customers?.first_name, l.customers?.last_name),
              Phone: l.customers?.phone ?? '—',
              Area: l.areas?.name ?? 'Unassigned',
              DaysOverdue: daysOverdue,
              Bucket: daysOverdue <= 7 ? 'Delayed (1-7d)' : 'Past Due (8d+)',
              Balance: l.remaining_balance,
            };
          })
          .sort((a: any, b: any) => b.DaysOverdue - a.DaysOverdue);
        break;
      }
      default:
        reportData = [];
    }

    setData(reportData);
    setCheckedRows(new Set());
    const total = reportData.reduce((s, r) => s + (r.TotalAmountCollected ?? r.TotalCollections ?? r.OverdueAmount ?? r.Balance ?? r.AmountReleased ?? r.Customers ?? 0), 0);
    setStats({ total, count: reportData.length, average: reportData.length ? total / reportData.length : 0, overdueRate: overallOverdueRate });
    setLoading(false);
  }

  function handleExport() {
    if (data.length === 0) return;
    exportToCSV(data, `${reportType}.csv`);
    toast({ title: 'Success', description: 'Report exported' });
  }

  // Branch/Area/Period line shown under the report title, on-screen filter
  // card values translated to their display names.
  const branchLabel = isFieldCollector
    ? (myArea?.name ?? 'My Area')
    : (branchFilter === 'all' ? 'All Branches' : (branches.find(b => b.id === branchFilter)?.name ?? '—'));
  const areaLabel = isFieldCollector
    ? (myArea?.name ?? '—')
    : (areaFilter === 'all' ? 'All Areas' : (areas.find(a => a.id === areaFilter)?.name ?? '—'));
  const periodLabel = reportType === 'monthly_release' || reportType === 'monthly_collection'
    ? new Date(`${monthFilter}-01`).toLocaleDateString('en-US', { year: 'numeric', month: 'long' })
    : `${formatDate(startDate)} – ${formatDate(endDate)}`;

  // Same chunk-per-sheet approach as Collection List's printable worksheet —
  // each page keeps its own full-size column headings instead of one long
  // table image shrunk down to fit a single sheet (unreadable past a
  // handful of rows, which most of these reports easily exceed).
  const printPages: (typeof data)[] = [];
  for (let i = 0; i < data.length; i += ROWS_PER_PRINT_PAGE) {
    printPages.push(data.slice(i, i + ROWS_PER_PRINT_PAGE));
  }
  if (printPages.length === 0) printPages.push([]);
  const printColumns = data.length > 0 ? Object.keys(data[0]) : [];

  function formatCell(key: string, val: unknown): string {
    if (key === 'OverdueRate' && typeof val === 'number') return `${val}%`;
    if (typeof val === 'number' && MONEY_COLUMNS.has(key)) return formatCurrency(val);
    return String(val ?? '');
  }

  async function handlePrint() {
    if (data.length === 0) return;
    printPageRefs.current.length = printPages.length;
    const refs = printPageRefs.current.filter(Boolean) as HTMLDivElement[];
    if (refs.length === 0) return;
    // Opened synchronously, still inside the click's trusted-event window —
    // any `await` before window.open() (html2canvas takes a while over
    // several pages) makes some browsers no longer treat it as a direct
    // response to the click and silently block it as a pop-up. Filling in
    // the real content afterward, once it's ready, avoids that.
    const printWindow = window.open('', '_blank', 'width=900,height=1000');
    if (!printWindow) {
      toast({ title: 'Print blocked', description: 'Please allow pop-ups for this site to print the report', variant: 'destructive' });
      return;
    }
    printWindow.document.write('<html><body style="font-family:sans-serif;padding:40px;color:#666">Preparing report…</body></html>');
    setPrinting(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const pages: { url: string; width: number; height: number }[] = [];
      for (const ref of refs) {
        const canvas = await html2canvas(ref, { backgroundColor: '#ffffff', scale: 2, width: 900, windowWidth: 900 });
        pages.push({ url: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height });
      }
      printWindow.document.open();
      printWindow.document.write(buildPrintHtml(`${reportTypeLabel(reportType, isFieldCollector)} Report`, pages, 8.5, 13));
      printWindow.document.close();
      printWindow.onload = () => printWindow.print();
      printWindow.onafterprint = () => printWindow.close();
    } catch (err: any) {
      printWindow.close();
      toast({ title: 'Print failed', description: err?.message ?? 'Could not generate the report for printing', variant: 'destructive' });
    }
    setPrinting(false);
  }

  // Monthly Collection rows carry BOTH a Date and an Area, so the label has
  // to combine them — keying off Area alone would print the same bar name
  // once per day and make the chart unreadable.
  const chartData = data.slice(0, 10).map((d, i) => {
    const name = (d.Date && d.Area)
      ? `${d.Date} · ${d.Area}`
      : (d.Branch ?? d.Area ?? d.Name ?? d.Date ?? `Row ${i + 1}`);
    return {
      name,
      value: d.TotalAmountCollected ?? d.TotalCollections ?? d.OverdueAmount ?? d.Customers ?? d.Balance ?? d.AmountReleased ?? 0,
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" description="Generate and export financial reports">
        <Button variant="outline" size="sm" onClick={handlePrint} disabled={printing || data.length === 0}>
          {printing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Printer className="w-4 h-4 mr-2" />}
          Print
        </Button>
        <Button variant="outline" size="sm" onClick={handleExport} disabled={data.length === 0}><Download className="w-4 h-4 mr-2" />Export CSV</Button>
        <Button size="sm" onClick={generateReport}><FileBarChart className="w-4 h-4 mr-2" />Generate</Button>
      </PageHeader>

      {/* Report config */}
      <Card className="glass-card border-border">
        <CardContent className="p-4 space-y-4">
          {isFieldCollector ? (
            <div className="space-y-2">
              <Label>Area</Label>
              <div className="flex h-10 w-full max-w-xs items-center rounded-md border border-input bg-secondary/50 px-3 py-2 text-sm text-muted-foreground">
                {myArea?.name ?? 'Loading your area…'}
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-end">
              <div className="space-y-2 flex-1">
                <Label>Branch</Label>
                {isAdmin ? (
                  <Select value={branchFilter} onValueChange={(v) => { setBranchFilter(v); setAreaFilter('all'); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Branches</SelectItem>
                      {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  // Locked to the user's own branch — reports are per
                  // designated branch only for everyone but an Admin.
                  <div className="flex h-10 w-full items-center rounded-md border border-input bg-secondary/50 px-3 py-2 text-sm text-muted-foreground">
                    {branches.find(b => b.id === branchFilter)?.name ?? 'Your branch'}
                  </div>
                )}
              </div>
              <div className="space-y-2 flex-1">
                <Label>Area</Label>
                <Select value={areaFilter} onValueChange={setAreaFilter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Areas</SelectItem>
                    {areas.filter(a => branchFilter === 'all' || a.branch_id === branchFilter).map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-end">
            <div className="space-y-2 flex-1">
              <Label>Report Type</Label>
              <Select value={reportType} onValueChange={setReportType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly_collection">Monthly Collection (per Area)</SelectItem>
                  <SelectItem value="branch_performance">{isFieldCollector ? 'Release (My Area)' : 'Branch Performance'}</SelectItem>
                  <SelectItem value="monthly_release">Monthly Release</SelectItem>
                  <SelectItem value="overdue_amount">Overdue Amount &amp; Rate</SelectItem>
                  <SelectItem value="customers_per_area">{isFieldCollector ? 'All Customers' : 'Customers per Area'}</SelectItem>
                  <SelectItem value="delinquent_customers">Delayed / Past-Due Customers</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {reportType === 'monthly_release' || reportType === 'monthly_collection' ? (
              <div className="space-y-2 flex-1">
                <Label>Month</Label>
                <Input type="month" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} />
              </div>
            ) : (
              <>
                <div className="space-y-2 flex-1">
                  <Label>Start Date</Label>
                  <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div className="space-y-2 flex-1">
                  <Label>End Date</Label>
                  <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
              </>
            )}
            <Button onClick={generateReport}>Generate</Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title={reportType === 'customers_per_area' ? 'Total Customers' : 'Total'}
          value={reportType === 'customers_per_area' ? stats.total.toString() : formatCurrency(stats.total)}
          icon={<TrendingUp className="w-5 h-5" />}
          variant="success"
        />
        <StatCard title="Records" value={stats.count.toString()} icon={<FileBarChart className="w-5 h-5" />} />
        {/* On the Overdue report the third card is the overall Overdue Rate,
            sitting right beside Records where the client asked for it, rather
            than an average overdue amount. It's the peso ratio for the whole
            filtered scope; the per-row OverdueRate column is that same ratio
            computed within each area. */}
        {reportType === 'overdue_amount' ? (
          <StatCard
            title="Overdue Rate"
            value={`${stats.overdueRate}%`}
            icon={<TrendingUp className="w-5 h-5" />}
            variant={stats.overdueRate >= 20 ? 'danger' : stats.overdueRate >= 10 ? 'warning' : 'success'}
            subtitle="Overdue amount ÷ total receivable"
          />
        ) : reportType !== 'customers_per_area' ? (
          <StatCard title="Average" value={formatCurrency(stats.average)} icon={<Wallet className="w-5 h-5" />} />
        ) : null}
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <Card className="glass-card border-border">
          <CardHeader><CardTitle>Visualization</CardTitle><CardDescription>Top entries chart</CardDescription></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip contentStyle={{ backgroundColor: 'rgb(var(--card))', border: '1px solid rgb(var(--border))', borderRadius: '8px', fontSize: '12px' }} formatter={(v: number) => formatCurrency(v)} />
                <Bar dataKey="value" fill="#0B1F3A" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Data table */}
      <Card className="glass-card border-border">
        <CardHeader><CardTitle>Report Data</CardTitle><CardDescription>{data.length} records</CardDescription></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : data.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No data for this report</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {Object.keys(data[0]).map(key => <TableHead key={key}>{columnLabel(key)}</TableHead>)}
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((row, i) => (
                    <TableRow key={i}>
                      {Object.entries(row).map(([key, val]) => (
                        <TableCell key={key} className="text-sm">
                          {key === 'OverdueRate' && typeof val === 'number'
                            ? `${val}%`
                            : typeof val === 'number' && MONEY_COLUMNS.has(key)
                              ? formatCurrency(val)
                              : String(val ?? '')}
                        </TableCell>
                      ))}
                      <TableCell>
                        <Checkbox
                          checked={checkedRows.has(i)}
                          onCheckedChange={(checked) => setCheckedRows((prev) => {
                            const next = new Set(prev);
                            if (checked === true) next.add(i); else next.delete(i);
                            return next;
                          })}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Hidden printable copy — same letterhead (logo + company name) as
          every other printed document in the app, with the report type as
          the title so a printed page is self-explanatory on its own. */}
      {typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', top: 0, left: 0, opacity: 0, pointerEvents: 'none', zIndex: -1 }}>
          {printPages.map((pageRows, pageIndex) => {
            const now = new Date();
            return (
              <div
                key={pageIndex}
                ref={(el) => { printPageRefs.current[pageIndex] = el; }}
                style={{ width: 900, background: '#fff', color: '#111', padding: 32, fontFamily: '"Times New Roman", Calibri, serif' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '3px solid #000', paddingBottom: 10, marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <img src="/image/1125_Corp_Logo.png" alt="1125Corp" style={{ width: 52, height: 52, objectFit: 'contain' }} />
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#1F4E79' }}>{COMPANY_NAME_DISPLAY}</div>
                  </div>
                  <table style={{ fontSize: 11 }}>
                    <tbody>
                      <tr><td style={{ fontWeight: 700, paddingRight: 8 }}>Report Date:</td><td>{formatDate(now.toISOString())}</td></tr>
                      <tr><td style={{ fontWeight: 700, paddingRight: 8 }}>Report Time:</td><td>{formatTime(now.toISOString())}</td></tr>
                      <tr><td style={{ fontWeight: 700, paddingRight: 8 }}>Printed by:</td><td>{profile?.role_name ?? ''}</td></tr>
                    </tbody>
                  </table>
                </div>

                <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 18, color: '#1F4E79', letterSpacing: 0.5, marginBottom: 4 }}>
                  {reportTypeLabel(reportType, isFieldCollector).toUpperCase()} REPORT
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 24, fontSize: 12, color: '#444', marginBottom: 4 }}>
                  <span><strong>Branch:</strong> {branchLabel}</span>
                  <span><strong>Area:</strong> {areaLabel}</span>
                  <span><strong>Period:</strong> {periodLabel}</span>
                </div>
                {printPages.length > 1 && (
                  <div style={{ textAlign: 'center', fontSize: 11, color: '#666', marginBottom: 10 }}>Page {pageIndex + 1} of {printPages.length}</div>
                )}

                {/* Summary stats only on the first sheet — repeating them on
                    every page would just be noise on a multi-page report. */}
                {pageIndex === 0 && (
                  <div style={{ display: 'flex', gap: 14, marginBottom: 16, marginTop: 10 }}>
                    <div style={{ flex: 1, padding: 12, background: '#f4f6f9', borderRadius: 6, textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: '#666' }}>{reportType === 'customers_per_area' ? 'Total Customers' : 'Total'}</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: '#0B7A3D' }}>
                        {reportType === 'customers_per_area' ? stats.total : formatCurrency(stats.total)}
                      </div>
                    </div>
                    <div style={{ flex: 1, padding: 12, background: '#f4f6f9', borderRadius: 6, textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: '#666' }}>Records</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: '#1F4E79' }}>{stats.count}</div>
                    </div>
                    {reportType === 'overdue_amount' ? (
                      <div style={{ flex: 1, padding: 12, background: '#f4f6f9', borderRadius: 6, textAlign: 'center' }}>
                        <div style={{ fontSize: 10, color: '#666' }}>Overdue Rate</div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: '#B91C1C' }}>{stats.overdueRate}%</div>
                      </div>
                    ) : reportType !== 'customers_per_area' ? (
                      <div style={{ flex: 1, padding: 12, background: '#f4f6f9', borderRadius: 6, textAlign: 'center' }}>
                        <div style={{ fontSize: 10, color: '#666' }}>Average</div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: '#1F4E79' }}>{formatCurrency(stats.average)}</div>
                      </div>
                    ) : null}
                  </div>
                )}

                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                  <thead>
                    <tr style={{ background: '#0B1F3A', color: '#fff' }}>
                      {printColumns.map(key => (
                        <th key={key} style={{ textAlign: 'left', padding: '6px 8px', border: '1px solid #000' }}>{columnLabel(key)}</th>
                      ))}
                      {/* Blank tick-off box per row, matching the on-screen
                          Checkbox column — this is a static image capture,
                          so it's a drawn empty square for a physical/paper
                          check mark, not an interactive control. */}
                      <th style={{ width: 28, border: '1px solid #000' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((row, i) => {
                      // pageRows is a per-page slice of the full data array
                      // (see printPages above) — the row's real position in
                      // checkedRows is this page's offset plus its local index.
                      const globalIndex = pageIndex * ROWS_PER_PRINT_PAGE + i;
                      const isChecked = checkedRows.has(globalIndex);
                      return (
                        <tr key={i}>
                          {printColumns.map(key => (
                            <td key={key} style={{ padding: '5px 8px', border: '1px solid #000' }}>{formatCell(key, row[key])}</td>
                          ))}
                          <td style={{ border: '1px solid #000', textAlign: 'center' }}>
                            {/* Filled solid instead of a check-mark glyph —
                                the Unicode ✓ character didn't render
                                reliably through html2canvas's capture. */}
                            <span style={{
                              display: 'inline-block', width: 12, height: 12,
                              border: '1.5px solid #000',
                              backgroundColor: isChecked ? '#000' : 'transparent',
                            }} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}
