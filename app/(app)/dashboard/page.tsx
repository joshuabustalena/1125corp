'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { StatCard } from '@/components/dashboard/stat-card';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/lib/auth-context';
import { seesAllBranches } from '@/lib/permissions';
import { formatCurrency, formatDate, formatCustomerName } from '@/lib/format';
import {
  Users, Landmark, AlertCircle, Wallet, TrendingUp, Banknote,
  Activity, UserCheck, ScrollText, Calendar, ArrowRight, Download, Loader2,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { selectAllRows } from '@/lib/db-chunk';
import { overdueOrDelayFor } from '@/lib/overdue';
import { checkDueDateAlerts } from '@/lib/due-date-alerts';
import { CASH_BUCKETS, cashBucketFor, isSpendableCashAccount } from '@/lib/cash-buckets';

function formatCompact(value: number): string {
  if (value >= 1000) return `₱${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}K`;
  return `₱${value}`;
}

interface DashboardStats {
  totalCustomers: number;
  newCustomersThisMonth: number;
  activeLoans: number;
  overdueLoans: number;
  overdueAmount: number;
  overdueRate: number;
  todayCollections: number;
  yesterdayCollections: number;
  weeklyCollections: number;
  monthlyCollections: number;
  lastMonthCollections: number;
  outstandingBalance: number;
  // Real ledger cash position, split per cash location (Vault, BPI,
  // Producers, …) — see lib/cash-buckets.
  cashByBucket: Record<string, number>;
  // Today's loan-release cash vouchers, this branch (or all, for Admin) —
  // replaces the Cash Flow stat card per Kat's Sep 8 request: that card
  // read as confusing/unnecessary ("Net negative" every month by nature,
  // since disbursements + expenses routinely exceed collections), and what
  // she actually wanted visible here was the same "how much cash went out
  // the door today for releases" figure as Cash Count's Cash Release field.
  todayRelease: number;
  paidLoans: number;
  pendingLoans: number;
  collectorsPresentToday: number;
  collectorsTotal: number;
  employeesPresentToday: number;
  employeesTotal: number;
  payrollThisMonth: number;
}

const emptyStats: DashboardStats = {
  totalCustomers: 0,
  newCustomersThisMonth: 0,
  activeLoans: 0,
  overdueLoans: 0,
  overdueAmount: 0,
  overdueRate: 0,
  todayCollections: 0,
  yesterdayCollections: 0,
  weeklyCollections: 0,
  monthlyCollections: 0,
  lastMonthCollections: 0,
  outstandingBalance: 0,
  cashByBucket: {},
  todayRelease: 0,
  paidLoans: 0,
  pendingLoans: 0,
  collectorsPresentToday: 0,
  collectorsTotal: 0,
  employeesPresentToday: 0,
  employeesTotal: 0,
  payrollThisMonth: 0,
};

function pctChange(current: number, previous: number): string | null {
  if (previous <= 0) return null;
  const pct = ((current - previous) / previous) * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(0)}%`;
}

// Local calendar date, NOT toISOString() (which converts to UTC first —
// the Philippines is UTC+8, so that read every one of today/yesterday/
// monthStart/etc below as a day early for the first 8 hours of each
// Philippine day, quietly pulling the wrong day's data into every stat
// card. See lib/format.ts's dateToStr for the fuller writeup — this was
// its own separately-broken copy of the same fix.
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

// One row of the per-area dashboard (Kat, Oct 2026). Each figure uses the
// same definition as the matching card/report, just grouped by area:
// collections by the paying customer's area (as Monthly Collection report),
// release/receivable/overdue by the loan's area (as Monthly Release and
// Overdue reports).
type AreaSummaryRow = {
  areaId: string;
  name: string;
  monthlyRelease: number;
  todayCollection: number;
  weeklyCollection: number;
  monthlyCollection: number;
  receivable: number;
  overdueAmount: number;
  overdueRate: number;
};

export default function DashboardPage() {
  const { profile } = useAuth();
  const allBranches = seesAllBranches(profile?.role_name);
  // Area Summary (below) is deliberately narrower than the rest of this
  // dashboard — Kat's Sep 8 request named exactly these three: each
  // collector (their own area only), the branch manager, and admin (plus
  // Admin Staff, who sees both branches like admin). Cashier
  // and Accounting, who otherwise see this whole page, do not get this card.
  const isBranchManager = profile?.role_name === 'Branch Manager';
  const isFieldCollector = profile?.role_name === 'Branch Field Collector';
  const canSeeAreaOverdue = allBranches || isBranchManager || isFieldCollector;
  const [stats, setStats] = useState<DashboardStats>(emptyStats);
  const [recentPayments, setRecentPayments] = useState<any[]>([]);
  const [upcomingDues, setUpcomingDues] = useState<any[]>([]);
  const [dailyData, setDailyData] = useState<{ name: string; collections: number; revenue: number }[]>([]);
  const [loanStatusData, setLoanStatusData] = useState<{ name: string; value: number; color: string }[]>([]);
  const [areaData, setAreaData] = useState<{ name: string; customers: number }[]>([]);
  const [areaSummary, setAreaSummary] = useState<AreaSummaryRow[]>([]);
  const [cashFlowData, setCashFlowData] = useState<{ name: string; inflow: number; outflow: number }[]>([]);
  const [attendanceData, setAttendanceData] = useState<{ name: string; value: number; color: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState<any[]>([]);
  const [branchFilter, setBranchFilter] = useState('all');
  const [branchResolved, setBranchResolved] = useState(false);
  // A Field Collector only ever sees their own assigned area's row below —
  // same lookup/lock already used on /reports.
  const [myAreaId, setMyAreaId] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('branches').select('id, name').eq('status', 'active').order('name').then(({ data }) => setBranches(data ?? []));
  }, []);

  useEffect(() => {
    if (!profile || !isFieldCollector) return;
    supabase.from('collectors').select('area_id').eq('profile_id', profile.id).maybeSingle()
      .then(({ data }) => setMyAreaId(data?.area_id ?? null));
  }, [profile, isFieldCollector]);

  // Administrator keeps the free Branch filter dropdown (defaults to "All
  // Branches"); everyone else is locked to their own branch, same pattern
  // already used on /reports and /payment-reports.
  useEffect(() => {
    if (!profile) return;
    if (!allBranches && profile.branch_id) setBranchFilter(profile.branch_id);
    setBranchResolved(true);
  }, [profile, allBranches]);

  useEffect(() => {
    if (!branchResolved) return;
    checkDueDateAlerts();
    async function load() {
      const now = new Date();
      const today = toDateStr(now);
      const yesterday = toDateStr(daysAgo(1));
      const monthStart = toDateStr(new Date(now.getFullYear(), now.getMonth(), 1));
      const monthEnd = toDateStr(new Date(now.getFullYear(), now.getMonth() + 1, 0));
      const lastMonthStart = toDateStr(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      const lastMonthEnd = toDateStr(new Date(now.getFullYear(), now.getMonth(), 0));
      const sevenDaysAgo = toDateStr(daysAgo(6));
      const fourWeeksAgo = toDateStr(daysAgo(27));

      // Payments/attendance/payroll don't carry branch_id directly — resolve
      // which customers/employees belong to the selected branch first, then
      // scope those tables by the resulting id list. journal_entries has no
      // branch_id at all yet (a separate, larger gap — see docs/notes-to-website-prd.md
      // item 5), so the Revenue line on the daily chart stays company-wide
      // even when a specific branch is selected.
      let branchCustomerIds: string[] | null = null;
      let branchEmployeeIds: string[] | null = null;
      if (branchFilter !== 'all') {
        const [{ data: bc }, { data: be }] = await Promise.all([
          supabase.from('customers').select('id').eq('branch_id', branchFilter),
          supabase.from('employees').select('id').eq('branch_id', branchFilter),
        ]);
        branchCustomerIds = (bc ?? []).map((c: any) => c.id);
        branchEmployeeIds = (be ?? []).map((e: any) => e.id);
      }
      const NO_MATCH = ['00000000-0000-0000-0000-000000000000'];
      const scopeByBranch = (q: any) => branchFilter === 'all' ? q : q.eq('branch_id', branchFilter);
      // Joined, NOT an .in() over the branch's customer ids. Balanga has 413
      // customers; passing them all as query parameters builds a ~15,000
      // character URL and the request fails outright ("fetch failed"), so
      // every payment figure here came back empty for a non-admin there.
      const scopeByCustomerIds = (q: any) => branchFilter === 'all' ? q : q.eq('customers.branch_id', branchFilter);
      const scopeByEmployeeIds = (q: any) => branchEmployeeIds === null ? q : q.in('employee_id', branchEmployeeIds.length > 0 ? branchEmployeeIds : NO_MATCH);
      // cash_vouchers has no branch_id of its own (only via the loan it
      // released against) — same join cash-count/page.tsx uses for the
      // identical "today's loan-release vouchers" total.
      const scopeByLoanBranch = (q: any) => branchFilter === 'all' ? q : q.eq('loans.branch_id', branchFilter);

      // Real cash position per location, straight from the ledger — the old
      // "Total Cash" card reused monthlyCollections, which isn't cash on
      // hand at all. Scoped the same way Accounting scopes it: this branch's
      // cash accounts plus any shared/company-wide one.
      let cashAcctQuery = supabase.from('chart_of_accounts').select('id, name').ilike('name', '%cash%');
      if (branchFilter !== 'all') cashAcctQuery = cashAcctQuery.or(`branch_id.eq.${branchFilter},branch_id.is.null`);
      const { data: cashAccountsRaw } = await cashAcctQuery;
      // Drop Cash Short/Over — named like cash and typed as an asset, but
      // it's a variance account, not spendable cash. See lib/cash-buckets.
      const cashAccounts = (cashAccountsRaw ?? []).filter((a: any) => isSpendableCashAccount(a.name));
      const cashAccountIds = cashAccounts.map((a: any) => a.id);
      const bucketByAccountId = new Map<string, string>(
        cashAccounts.map((a: any) => [a.id, cashBucketFor(a.name)])
      );

      // Payments alone are now 4,770/month and 1,502/week company-wide — any
      // of these unpaginated .select() calls that sum/count over a real date
      // range (not a single day, and not the deliberately small .limit(5)
      // widgets below) silently drops whatever falls past PostgREST's 1000-
      // row cap. Confirmed live: Monthly Collections was reading ₱1.70M
      // against a true ₱4.94M, Weekly Collections ₱647K against a true
      // ₱1.00M. selectAllRows pages through every matching row instead.
      const [
        customers, newCustomers, loans, allLoanStatuses,
        paymentsToday, paymentsYesterday, paymentsMonth, paymentsLastMonth,
        recentPays, upcoming, paymentsWeek, journalWeek,
        customersByArea, paymentsFourWeeks, disbursedFourWeeks, gasVouchersFourWeeks, cashVouchersFourWeeks,
        attendanceMonth, employees, attendanceToday, payrollMonth, cashLines, releaseVouchersToday,
        releasesMonth, areaList,
      ] = await Promise.all([
        scopeByBranch(supabase.from('customers').select('id', { count: 'exact', head: true })),
        scopeByBranch(supabase.from('customers').select('id', { count: 'exact', head: true }).gte('created_at', monthStart)),
        selectAllRows<any>(() => scopeByBranch(supabase.from('loans').select('id, remaining_balance, due_date, total_payable, term_days, release_date, area_id, areas(name)').eq('status', 'active'))),
        selectAllRows<any>(() => scopeByBranch(supabase.from('loans').select('status'))),
        selectAllRows<any>(() => scopeByCustomerIds(supabase.from('payments').select('amount_paid, customers!inner(branch_id, area_id)').gte('payment_date', today))),
        scopeByCustomerIds(supabase.from('payments').select('amount_paid, customers!inner(branch_id)').eq('payment_date', yesterday)),
        selectAllRows<any>(() => scopeByCustomerIds(supabase.from('payments').select('amount_paid, customers!inner(branch_id, area_id)').gte('payment_date', monthStart))),
        selectAllRows<any>(() => scopeByCustomerIds(supabase.from('payments').select('amount_paid, customers!inner(branch_id)').gte('payment_date', lastMonthStart).lte('payment_date', lastMonthEnd))),
        scopeByCustomerIds(supabase.from('payments').select('*, customers!inner(branch_id), customers(first_name, last_name), loans(loan_number)').order('created_at', { ascending: false }).limit(5)),
        scopeByBranch(supabase.from('loans').select('*, customers(first_name, last_name)').eq('status', 'active').order('due_date', { ascending: true }).limit(5)),
        selectAllRows<any>(() => scopeByCustomerIds(supabase.from('payments').select('amount_paid, payment_date, customers!inner(branch_id, area_id)').gte('payment_date', sevenDaysAgo))),
        supabase.from('journal_entries').select('entry_date, journal_entry_lines(credit, chart_of_accounts(account_type))').gte('entry_date', sevenDaysAgo),
        selectAllRows<any>(() => scopeByBranch(supabase.from('customers').select('area_id, areas(name)').eq('status', 'active'))),
        selectAllRows<any>(() => scopeByCustomerIds(supabase.from('payments').select('amount_paid, payment_date, customers!inner(branch_id)').gte('payment_date', fourWeeksAgo))),
        selectAllRows<any>(() => scopeByBranch(supabase.from('loans').select('release_amount, disbursed_at').not('disbursed_at', 'is', null).gte('disbursed_at', fourWeeksAgo))),
        selectAllRows<any>(() => scopeByBranch(supabase.from('gas_vouchers').select('total_amount, voucher_date').gte('voucher_date', fourWeeksAgo))),
        selectAllRows<any>(() => scopeByBranch(supabase.from('general_cash_vouchers').select('total_amount, voucher_date').gte('voucher_date', fourWeeksAgo))),
        selectAllRows<any>(() => scopeByEmployeeIds(supabase.from('attendance').select('status').gte('date', monthStart))),
        scopeByBranch(supabase.from('employees').select('id, position').eq('status', 'active')),
        scopeByEmployeeIds(supabase.from('attendance').select('employee_id, employees(position)').eq('date', today)),
        scopeByEmployeeIds(supabase.from('payroll').select('net_pay').gte('pay_date', monthStart)),
        // Balanga alone now has 1,175 journal_entry_lines across its cash
        // accounts — past PostgREST's silent 1000-row cap, which was
        // making this sum drop ~46K off Cash in Vault with no error at
        // all (same failure the Trial Balance page already guards
        // against; see lib/db-chunk.ts). selectAllRows pages through
        // every matching row instead of taking whatever fits in one
        // response.
        cashAccountIds.length > 0
          ? selectAllRows<any>(() => {
              let q = supabase.from('journal_entry_lines').select('account_id, debit, credit, journal_entries!inner(branch_id)').in('account_id', cashAccountIds);
              if (branchFilter !== 'all') q = q.or(`branch_id.eq.${branchFilter},branch_id.is.null`, { foreignTable: 'journal_entries' });
              return q;
            })
          : Promise.resolve([] as any[]),
        scopeByLoanBranch(supabase.from('cash_vouchers').select('amount, loans!inner(branch_id)').eq('voucher_date', today)),
        // Same set and amount as the Monthly Release report: every loan
        // released this month (principal), whatever its status since.
        selectAllRows<any>(() => scopeByBranch(supabase.from('loans').select('amount, area_id').in('status', ['active', 'renewed', 'paid', 'written_off']).gte('release_date', monthStart).lte('release_date', monthEnd))),
        scopeByBranch(supabase.from('areas').select('id, name, branches(name)')),
      ]);

      const cashByBucket: Record<string, number> = {};
      for (const l of cashLines as any[]) {
        const bucket = bucketByAccountId.get(l.account_id) ?? 'other';
        cashByBucket[bucket] = (cashByBucket[bucket] ?? 0) + (Number(l.debit) || 0) - (Number(l.credit) || 0);
      }

      const activeLoans: any[] = loans;
      // "Overdue Loans" (the count) stays past-due-only — a loan either has
      // crossed its formal due date or it hasn't. The AMOUNT/RATE below is
      // the separate, wider figure Katrina flagged (Sep 29): Reports' own
      // Overdue Amount & Rate report already merged past-due with loans
      // still inside their term but behind the daily schedule (client
      // request, Aug 2026), but this card kept the narrower past-due-only
      // sum, so the two disagreed. Both now go through the same
      // lib/overdue.ts function so they can't drift apart again.
      const overdue = activeLoans.filter((l: any) => l.due_date && new Date(l.due_date) < new Date());
      const outstandingBalance = activeLoans.reduce((s: number, l: any) => s + Number(l.remaining_balance), 0);
      const loanExposures = activeLoans.map((l: any) => ({ l, exposure: overdueOrDelayFor(l, now) }));

      // Same overdue-amount/overdue-rate math as above, broken out per area
      // instead of one branch-wide figure — Kat's Sep 8 request. Grouped
      // straight off activeLoans (already scoped to the selected branch),
      // not a separate query.
      const areaTotals = new Map<string, { name: string; receivable: number; overdue: number }>();
      for (const { l, exposure } of loanExposures) {
        const areaId = l.area_id ?? 'unassigned';
        const entry = areaTotals.get(areaId) ?? { name: l.areas?.name ?? 'Unassigned', receivable: 0, overdue: 0 };
        entry.receivable += Number(l.remaining_balance);
        entry.overdue += exposure.amount;
        areaTotals.set(areaId, entry);
      }
      // Per-area dashboard: the overdue/receivable totals above plus this
      // month's releases and today's/7-day/this-month collections, each
      // grouped by area. Every area that shows up in any of them gets a row.
      // Area names repeat across branches (both have an "Area 1"), so the
      // all-branches view labels each row with its branch too.
      const areaNameById = new Map<string, string>(((areaList.data ?? []) as any[]).map(a => [
        a.id,
        branchFilter === 'all' && a.branches?.name ? `${a.name} · ${String(a.branches.name).replace(/\s+Branch$/i, '')}` : a.name,
      ]));
      const areaBranchById = new Map<string, string>(((areaList.data ?? []) as any[]).map(a => [a.id, a.branches?.name ?? '']));
      const summaryByArea = new Map<string, AreaSummaryRow>();
      const rowFor = (areaId: string | null | undefined): AreaSummaryRow => {
        const key = areaId ?? 'unassigned';
        let row = summaryByArea.get(key);
        if (!row) {
          row = {
            areaId: key,
            name: areaId ? (areaNameById.get(areaId) ?? areaTotals.get(areaId)?.name ?? 'Unknown area') : 'Unassigned',
            monthlyRelease: 0, todayCollection: 0, weeklyCollection: 0, monthlyCollection: 0,
            receivable: 0, overdueAmount: 0, overdueRate: 0,
          };
          summaryByArea.set(key, row);
        }
        return row;
      };
      for (const [areaId, v] of Array.from(areaTotals.entries())) {
        const row = rowFor(areaId === 'unassigned' ? null : areaId);
        row.receivable = v.receivable;
        row.overdueAmount = v.overdue;
        row.overdueRate = v.receivable > 0 ? (v.overdue / v.receivable) * 100 : 0;
      }
      for (const l of releasesMonth as any[]) rowFor(l.area_id).monthlyRelease += Number(l.amount) || 0;
      for (const p of paymentsToday as any[]) rowFor(p.customers?.area_id).todayCollection += Number(p.amount_paid) || 0;
      for (const p of paymentsWeek as any[]) rowFor(p.customers?.area_id).weeklyCollection += Number(p.amount_paid) || 0;
      for (const p of paymentsMonth as any[]) rowFor(p.customers?.area_id).monthlyCollection += Number(p.amount_paid) || 0;
      // Grouped by branch first, then area number; Unassigned always last.
      const areaSummaryRows = Array.from(summaryByArea.values()).sort((a, b) => {
        if (a.areaId === 'unassigned') return 1;
        if (b.areaId === 'unassigned') return -1;
        return (areaBranchById.get(a.areaId) ?? '').localeCompare(areaBranchById.get(b.areaId) ?? '')
          || a.name.localeCompare(b.name, undefined, { numeric: true });
      });
      // Overdue Rate = portfolio at risk — the share of the whole
      // receivable that's currently overdue OR falling behind schedule,
      // not just a share of loan count (which "Overdue Loans" already
      // shows) and not just the narrower past-due slice.
      const overdueAmount = loanExposures.reduce((s: number, { exposure }) => s + exposure.amount, 0);
      const overdueRate = outstandingBalance > 0 ? (overdueAmount / outstandingBalance) * 100 : 0;

      const statusCounts = (allLoanStatuses as any[]).reduce((acc: Record<string, number>, l: any) => {
        acc[l.status] = (acc[l.status] ?? 0) + 1;
        return acc;
      }, {});
      const paidLoans = statusCounts['paid'] ?? 0;
      const pendingLoans = statusCounts['pending'] ?? 0;

      const monthlyCollections = (paymentsMonth as any[]).reduce((s: number, p: any) => s + Number(p.amount_paid), 0);
      const lastMonthCollections = (paymentsLastMonth as any[]).reduce((s: number, p: any) => s + Number(p.amount_paid), 0);

      const employeeRows = employees.data ?? [];
      const collectorsTotal = employeeRows.filter((e: any) => e.position === 'Branch Field Collector').length;
      const employeesTotal = employeeRows.length;
      const presentTodayRows = attendanceToday.data ?? [];
      const collectorsPresentToday = presentTodayRows.filter((a: any) => a.employees?.position === 'Branch Field Collector').length;
      const employeesPresentToday = presentTodayRows.length;

      const payrollThisMonth = (payrollMonth.data ?? []).reduce((s: number, p: any) => s + Number(p.net_pay), 0);

      const todayRelease = (releaseVouchersToday.data ?? []).reduce((s: number, v: any) => s + Number(v.amount), 0);

      setStats({
        totalCustomers: customers.count ?? 0,
        newCustomersThisMonth: newCustomers.count ?? 0,
        activeLoans: activeLoans.length,
        overdueLoans: overdue.length,
        overdueAmount,
        overdueRate,
        todayCollections: (paymentsToday as any[]).reduce((s: number, p: any) => s + Number(p.amount_paid), 0),
        yesterdayCollections: (paymentsYesterday.data ?? []).reduce((s: number, p: any) => s + Number(p.amount_paid), 0),
        weeklyCollections: (paymentsWeek as any[]).reduce((s: number, p: any) => s + Number(p.amount_paid), 0),
        monthlyCollections,
        lastMonthCollections,
        outstandingBalance,
        cashByBucket,
        todayRelease,
        paidLoans,
        pendingLoans,
        collectorsPresentToday,
        collectorsTotal,
        employeesPresentToday,
        employeesTotal,
        payrollThisMonth,
      });

      setRecentPayments(recentPays.data ?? []);
      setUpcomingDues((upcoming.data ?? []).filter((l: any) => l.due_date));

      // Daily Collections & Revenue — last 7 calendar days. Collections =
      // actual cash received (payments); Revenue = ledger credits to
      // revenue-type accounts (interest/service fee/etc income) that same
      // day, so the two lines can genuinely diverge.
      const dayLabels = Array.from({ length: 7 }, (_, i) => daysAgo(6 - i));
      const paymentsByDay = new Map<string, number>();
      for (const p of (paymentsWeek as any[])) {
        const key = p.payment_date;
        paymentsByDay.set(key, (paymentsByDay.get(key) ?? 0) + Number(p.amount_paid));
      }
      const revenueByDay = new Map<string, number>();
      for (const je of (journalWeek.data ?? []) as any[]) {
        const revenueCredit = (je.journal_entry_lines ?? [])
          .filter((l: any) => l.chart_of_accounts?.account_type === 'revenue')
          .reduce((s: number, l: any) => s + Number(l.credit ?? 0), 0);
        if (revenueCredit > 0) revenueByDay.set(je.entry_date, (revenueByDay.get(je.entry_date) ?? 0) + revenueCredit);
      }
      setDailyData(dayLabels.map(d => {
        const key = toDateStr(d);
        return {
          name: d.toLocaleDateString('en-US', { weekday: 'short' }),
          collections: paymentsByDay.get(key) ?? 0,
          revenue: revenueByDay.get(key) ?? 0,
        };
      }));

      setLoanStatusData([
        { name: 'Active', value: Math.max(0, activeLoans.length - overdue.length), color: '#0B1F3A' },
        { name: 'Overdue', value: overdue.length, color: '#EF4444' },
        { name: 'Paid', value: paidLoans, color: '#16A34A' },
        { name: 'Pending', value: pendingLoans, color: '#F97316' },
      ]);

      const areaCounts = new Map<string, number>();
      for (const c of customersByArea as any[]) {
        const name = c.areas?.name;
        if (!name) continue;
        areaCounts.set(name, (areaCounts.get(name) ?? 0) + 1);
      }
      setAreaData(
        Array.from(areaCounts.entries())
          .map(([name, customers]) => ({ name, customers }))
          .sort((a, b) => b.customers - a.customers)
          .slice(0, 6)
      );
      setAreaSummary(areaSummaryRows);

      // Cash Flow — last 4 calendar weeks, oldest first. Inflow = collections;
      // outflow = loan disbursements + gas/cash voucher expenses.
      const weekBuckets = [0, 1, 2, 3].map(w => ({
        start: daysAgo(27 - w * 7),
        end: daysAgo(27 - w * 7 - 6),
      }));
      function inRange(dateStr: string, start: Date, end: Date): boolean {
        const t = new Date(dateStr).getTime();
        return t >= new Date(toDateStr(start)).getTime() && t <= new Date(toDateStr(end)).getTime();
      }
      setCashFlowData(weekBuckets.map((wk, i) => {
        const inflow = (paymentsFourWeeks as any[])
          .filter((p: any) => inRange(p.payment_date, wk.start, wk.end))
          .reduce((s: number, p: any) => s + Number(p.amount_paid), 0);
        const disbursed = (disbursedFourWeeks as any[])
          .filter((l: any) => inRange(l.disbursed_at, wk.start, wk.end))
          .reduce((s: number, l: any) => s + Number(l.release_amount), 0);
        const expenses = [...(gasVouchersFourWeeks as any[]), ...(cashVouchersFourWeeks as any[])]
          .filter((v: any) => inRange(v.voucher_date, wk.start, wk.end))
          .reduce((s: number, v: any) => s + Number(v.total_amount), 0);
        return { name: `Week ${i + 1}`, inflow, outflow: disbursed + expenses };
      }));

      const attendanceCounts = (attendanceMonth as any[]).reduce((acc: Record<string, number>, a: any) => {
        acc[a.status] = (acc[a.status] ?? 0) + 1;
        return acc;
      }, {});
      setAttendanceData([
        { name: 'Present', value: attendanceCounts['present'] ?? 0, color: '#16A34A' },
        { name: 'Late', value: attendanceCounts['late'] ?? 0, color: '#F97316' },
        { name: 'Absent', value: attendanceCounts['absent'] ?? 0, color: '#EF4444' },
        { name: 'Leave', value: attendanceCounts['leave'] ?? 0, color: '#3B82F6' },
      ]);

      setLoading(false);
    }
    load();
  }, [branchResolved, branchFilter]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading your dashboard...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description="Welcome back to 1125Corp — here's your lending overview">
        {allBranches ? (
          <Select value={branchFilter} onValueChange={setBranchFilter}>
            <SelectTrigger className="w-full sm:w-48"><SelectValue placeholder="All Branches" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Branches</SelectItem>
              {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : (
          <Badge variant="outline" className="h-9 px-3 flex items-center">
            {branches.find(b => b.id === branchFilter)?.name ?? '—'}
          </Badge>
        )}
        <Button variant="outline" size="sm">
          <Download className="w-4 h-4 mr-2" />
          Export
        </Button>
        <Link href="/loans">
          <Button size="sm">
            New Loan
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </Link>
      </PageHeader>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Customers"
          value={stats.totalCustomers.toString()}
          icon={<Users className="w-5 h-5" />}
          subtitle={`${stats.newCustomersThisMonth} new this month`}
        />
        <StatCard
          title="Active Loans"
          value={stats.activeLoans.toString()}
          icon={<Landmark className="w-5 h-5" />}
          variant="default"
          subtitle="Currently disbursed"
        />
        <StatCard
          title="Overdue Loans"
          value={stats.overdueLoans.toString()}
          icon={<AlertCircle className="w-5 h-5" />}
          variant="danger"
          subtitle="Past due date"
        />
        <StatCard
          title="Overdue Amount"
          value={formatCurrency(stats.overdueAmount)}
          icon={<AlertCircle className="w-5 h-5" />}
          variant="danger"
          subtitle="Balance past due date"
        />
        <StatCard
          title="Overdue Rate"
          value={`${stats.overdueRate.toFixed(1)}%`}
          icon={<AlertCircle className="w-5 h-5" />}
          variant={stats.overdueRate > 10 ? 'danger' : 'warning'}
          subtitle="Share of receivable overdue"
        />
        <StatCard
          title="Today's Collections"
          value={formatCurrency(stats.todayCollections)}
          icon={<Wallet className="w-5 h-5" />}
          variant="success"
          {...(pctChange(stats.todayCollections, stats.yesterdayCollections)
            ? { trend: { value: `${pctChange(stats.todayCollections, stats.yesterdayCollections)} vs yesterday`, positive: stats.todayCollections >= stats.yesterdayCollections } }
            : {})}
        />
        <StatCard
          title="Weekly Collections"
          value={formatCurrency(stats.weeklyCollections)}
          icon={<TrendingUp className="w-5 h-5" />}
          variant="success"
          subtitle="Last 7 days"
        />
        <StatCard
          title="Monthly Collections"
          value={formatCurrency(stats.monthlyCollections)}
          icon={<TrendingUp className="w-5 h-5" />}
          variant="success"
          {...(pctChange(stats.monthlyCollections, stats.lastMonthCollections)
            ? { trend: { value: `${pctChange(stats.monthlyCollections, stats.lastMonthCollections)} vs last month`, positive: stats.monthlyCollections >= stats.lastMonthCollections } }
            : {})}
        />
        <StatCard
          title="Receivable"
          value={formatCurrency(stats.outstandingBalance)}
          icon={<Banknote className="w-5 h-5" />}
          variant="warning"
          subtitle="Total receivables"
        />
        {/* Each cash location on its own card (client request) — the old
            single "Total Cash" card actually showed monthly collections,
            not cash on hand. Only buckets that exist in this branch's Chart
            of Accounts render, so an unused one doesn't show a stray ₱0.00. */}
        {CASH_BUCKETS.filter(b => stats.cashByBucket[b.key] !== undefined).map(b => (
          <StatCard
            key={b.key}
            title={b.label}
            value={formatCurrency(stats.cashByBucket[b.key] ?? 0)}
            icon={<Banknote className="w-5 h-5" />}
            variant="success"
          />
        ))}
        <StatCard
          title="Total Release"
          value={formatCurrency(stats.todayRelease)}
          icon={<Activity className="w-5 h-5" />}
          variant="default"
          subtitle="Loan releases today"
        />
      </div>

      {/* Secondary stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Collector Attendance" value={`${stats.collectorsPresentToday}/${stats.collectorsTotal}`} icon={<UserCheck className="w-5 h-5" />} variant="success" subtitle="Active today" />
        <StatCard title="Employee Attendance" value={`${stats.employeesPresentToday}/${stats.employeesTotal}`} icon={<UserCheck className="w-5 h-5" />} variant="default" subtitle="Present today" />
        <StatCard title="Payroll Summary" value={formatCurrency(stats.payrollThisMonth)} icon={<ScrollText className="w-5 h-5" />} variant="warning" subtitle="This month" />
        <StatCard title="Upcoming Dues" value={upcomingDues.length.toString()} icon={<Calendar className="w-5 h-5" />} variant="warning" subtitle="Next 7 days" />
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="glass-card border-border lg:col-span-2 animate-slide-up">
          <CardHeader>
            <CardTitle>Daily Collections & Revenue</CardTitle>
            <CardDescription>Collection amounts and revenue over the past week</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={dailyData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorCollections" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0B1F3A" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#0B1F3A" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#16A34A" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#16A34A" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                <XAxis dataKey="name" className="text-xs" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} interval={0} />
                <YAxis className="text-xs" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={formatCompact} width={48} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgb(var(--card))',
                    border: '1px solid rgb(var(--border))',
                    borderRadius: '8px',
                    fontSize: '12px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                  }}
                  formatter={(value: number) => formatCurrency(value)}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                <Area
                  type="monotone" dataKey="collections" name="Collections" stroke="#0B1F3A" strokeWidth={2.5}
                  fill="url(#colorCollections)" dot={{ r: 3, fill: '#0B1F3A', strokeWidth: 0 }} activeDot={{ r: 5 }}
                />
                <Area
                  type="monotone" dataKey="revenue" name="Revenue" stroke="#16A34A" strokeWidth={2.5}
                  fill="url(#colorRevenue)" dot={{ r: 3, fill: '#16A34A', strokeWidth: 0 }} activeDot={{ r: 5 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="glass-card border-border animate-slide-up">
          <CardHeader>
            <CardTitle>Loan Status</CardTitle>
            <CardDescription>Distribution of loan statuses</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={loanStatusData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={3}>
                  {loanStatusData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgb(var(--card))',
                    border: '1px solid rgb(var(--border))',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="glass-card border-border animate-slide-up">
          <CardHeader>
            <CardTitle>Cash Flow</CardTitle>
            <CardDescription>Weekly inflow vs outflow</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={cashFlowData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barGap={4} barCategoryGap="25%">
                <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} interval={0} />
                <YAxis tick={{ fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={formatCompact} width={48} />
                <Tooltip
                  cursor={{ fill: 'rgb(var(--secondary))' }}
                  contentStyle={{
                    backgroundColor: 'rgb(var(--card))',
                    border: '1px solid rgb(var(--border))',
                    borderRadius: '8px',
                    fontSize: '12px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                  }}
                  formatter={(value: number) => formatCurrency(value)}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                <Bar dataKey="inflow" name="Inflow" fill="#16A34A" radius={[4, 4, 0, 0]} maxBarSize={40} />
                <Bar dataKey="outflow" name="Outflow" fill="#EF4444" radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="glass-card border-border animate-slide-up">
          <CardHeader>
            <CardTitle>Customers per Area</CardTitle>
            <CardDescription>Top areas by customer count</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={areaData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis type="number" tick={{ fontSize: 12 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={100} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgb(var(--card))',
                    border: '1px solid rgb(var(--border))',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="customers" fill="#0B1F3A" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="glass-card border-border animate-slide-up">
          <CardHeader>
            <CardTitle>Employee Attendance</CardTitle>
            <CardDescription>This month&apos;s breakdown</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={attendanceData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90}>
                  {attendanceData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgb(var(--card))',
                    border: '1px solid rgb(var(--border))',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Area Summary — started as Overdue by Area (Kat, Sep 8), widened
          to a per-area dashboard (Oct 2026). Visible only to each
          collector (their own area, filtered below), the branch manager,
          and admin; Cashier/Accounting don't get this card even though they
          see the rest of this page. */}
      {canSeeAreaOverdue && (() => {
        const rows = isFieldCollector
          ? areaSummary.filter(a => a.areaId === myAreaId)
          : areaSummary;
        const sum = (k: keyof AreaSummaryRow) => rows.reduce((s, r) => s + (r[k] as number), 0);
        const totalReceivable = sum('receivable');
        const totalOverdue = sum('overdueAmount');
        return (
          <Card className="glass-card border-border animate-slide-up">
            <CardHeader>
              <CardTitle>Area Summary</CardTitle>
              <CardDescription>
                Each area&apos;s release, collections, receivable and overdue{isFieldCollector ? ' (your area)' : ''} · this month, today, last 7 days
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {rows.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <p className="text-sm text-muted-foreground">No area activity to report on yet</p>
                </div>
              ) : (
                <>
                  {/* Mobile: one card per area */}
                  <div className="md:hidden divide-y divide-border">
                    {rows.map(a => (
                      <div key={a.areaId} className="p-4">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-semibold">{a.name}</p>
                          <p className={`text-xs font-medium ${a.overdueRate > 10 ? 'text-destructive' : 'text-muted-foreground'}`}>{a.overdueRate.toFixed(1)}% overdue</p>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                          <div><p className="text-muted-foreground">Monthly Release</p><p className="text-sm font-medium">{formatCurrency(a.monthlyRelease)}</p></div>
                          <div><p className="text-muted-foreground">Daily Collection</p><p className="text-sm font-medium">{formatCurrency(a.todayCollection)}</p></div>
                          <div><p className="text-muted-foreground">Weekly Collection</p><p className="text-sm font-medium">{formatCurrency(a.weeklyCollection)}</p></div>
                          <div><p className="text-muted-foreground">Monthly Collection</p><p className="text-sm font-medium">{formatCurrency(a.monthlyCollection)}</p></div>
                          <div><p className="text-muted-foreground">Total Receivable</p><p className="text-sm font-medium">{formatCurrency(a.receivable)}</p></div>
                          <div><p className="text-muted-foreground">Overdue Amount</p><p className="text-sm font-medium">{formatCurrency(a.overdueAmount)}</p></div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="hidden md:block overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Area</TableHead>
                          <TableHead className="text-right">Monthly Release</TableHead>
                          <TableHead className="text-right">Daily Collection</TableHead>
                          <TableHead className="text-right">Weekly Collection</TableHead>
                          <TableHead className="text-right">Monthly Collection</TableHead>
                          <TableHead className="text-right">Total Receivable</TableHead>
                          <TableHead className="text-right">Overdue Rate</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map(a => (
                          <TableRow key={a.areaId}>
                            <TableCell className="text-sm font-medium">{a.name}</TableCell>
                            <TableCell className="text-sm text-right">{formatCurrency(a.monthlyRelease)}</TableCell>
                            <TableCell className="text-sm text-right">{formatCurrency(a.todayCollection)}</TableCell>
                            <TableCell className="text-sm text-right">{formatCurrency(a.weeklyCollection)}</TableCell>
                            <TableCell className="text-sm text-right">{formatCurrency(a.monthlyCollection)}</TableCell>
                            <TableCell className="text-sm text-right">{formatCurrency(a.receivable)}</TableCell>
                            <TableCell className="text-sm text-right">
                              <span className={a.overdueRate > 10 ? 'text-destructive font-semibold' : 'font-medium'}>{a.overdueRate.toFixed(1)}%</span>
                              <p className="text-xs text-muted-foreground">{formatCurrency(a.overdueAmount)}</p>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      {rows.length > 1 && (
                        <TableFooter>
                          <TableRow>
                            <TableCell className="text-sm font-semibold">Total</TableCell>
                            <TableCell className="text-sm text-right font-semibold">{formatCurrency(sum('monthlyRelease'))}</TableCell>
                            <TableCell className="text-sm text-right font-semibold">{formatCurrency(sum('todayCollection'))}</TableCell>
                            <TableCell className="text-sm text-right font-semibold">{formatCurrency(sum('weeklyCollection'))}</TableCell>
                            <TableCell className="text-sm text-right font-semibold">{formatCurrency(sum('monthlyCollection'))}</TableCell>
                            <TableCell className="text-sm text-right font-semibold">{formatCurrency(totalReceivable)}</TableCell>
                            <TableCell className="text-sm text-right">
                              <span className="font-semibold">{(totalReceivable > 0 ? (totalOverdue / totalReceivable) * 100 : 0).toFixed(1)}%</span>
                              <p className="text-xs text-muted-foreground">{formatCurrency(totalOverdue)}</p>
                            </TableCell>
                          </TableRow>
                        </TableFooter>
                      )}
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {/* Recent payments & upcoming dues */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="glass-card border-border animate-slide-up">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Recent Payments</CardTitle>
                <CardDescription>Latest collection transactions</CardDescription>
              </div>
              <Link href="/payments">
                <Button variant="ghost" size="sm">
                  View all
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {recentPayments.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No recent payments</p>
            ) : (
              <div className="space-y-3">
                {recentPayments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center">
                        <Wallet className="w-5 h-5 text-success" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">
                          {formatCustomerName(p.customers?.first_name, p.customers?.last_name)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {p.loans?.loan_number} • {formatDate(p.payment_date)}
                        </p>
                      </div>
                    </div>
                    <Badge variant="secondary" className="text-success">
                      {formatCurrency(p.amount_paid)}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="glass-card border-border animate-slide-up">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Upcoming Due Dates</CardTitle>
                <CardDescription>Loans due soon</CardDescription>
              </div>
              <Link href="/loans">
                <Button variant="ghost" size="sm">
                  View all
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {upcomingDues.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No upcoming dues</p>
            ) : (
              <div className="space-y-3">
                {upcomingDues.map((l) => (
                  <div key={l.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-warning/10 flex items-center justify-center">
                        <Calendar className="w-5 h-5 text-warning" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">
                          {formatCustomerName(l.customers?.first_name, l.customers?.last_name)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {l.loan_number} • Due {formatDate(l.due_date)}
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-warning border-warning/30">
                      {formatCurrency(l.remaining_balance)}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
