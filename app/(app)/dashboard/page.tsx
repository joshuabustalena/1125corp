'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { StatCard } from '@/components/dashboard/stat-card';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/lib/auth-context';
import { formatCurrency, formatDate } from '@/lib/format';
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
import { checkDueDateAlerts } from '@/lib/due-date-alerts';

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
  monthlyCollections: number;
  lastMonthCollections: number;
  outstandingBalance: number;
  totalCash: number;
  netCashFlowMonth: number;
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
  monthlyCollections: 0,
  lastMonthCollections: 0,
  outstandingBalance: 0,
  totalCash: 0,
  netCashFlowMonth: 0,
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

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}
function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

export default function DashboardPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role_name === 'Administrator';
  const [stats, setStats] = useState<DashboardStats>(emptyStats);
  const [recentPayments, setRecentPayments] = useState<any[]>([]);
  const [upcomingDues, setUpcomingDues] = useState<any[]>([]);
  const [dailyData, setDailyData] = useState<{ name: string; collections: number; revenue: number }[]>([]);
  const [loanStatusData, setLoanStatusData] = useState<{ name: string; value: number; color: string }[]>([]);
  const [areaData, setAreaData] = useState<{ name: string; customers: number }[]>([]);
  const [cashFlowData, setCashFlowData] = useState<{ name: string; inflow: number; outflow: number }[]>([]);
  const [attendanceData, setAttendanceData] = useState<{ name: string; value: number; color: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState<any[]>([]);
  const [branchFilter, setBranchFilter] = useState('all');
  const [branchResolved, setBranchResolved] = useState(false);

  useEffect(() => {
    supabase.from('branches').select('id, name').eq('status', 'active').order('name').then(({ data }) => setBranches(data ?? []));
  }, []);

  // Administrator keeps the free Branch filter dropdown (defaults to "All
  // Branches"); everyone else is locked to their own branch, same pattern
  // already used on /reports and /payment-reports.
  useEffect(() => {
    if (!profile) return;
    if (!isAdmin && profile.branch_id) setBranchFilter(profile.branch_id);
    setBranchResolved(true);
  }, [profile, isAdmin]);

  useEffect(() => {
    if (!branchResolved) return;
    checkDueDateAlerts();
    async function load() {
      const now = new Date();
      const today = toDateStr(now);
      const yesterday = toDateStr(daysAgo(1));
      const monthStart = toDateStr(new Date(now.getFullYear(), now.getMonth(), 1));
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
      const scopeByCustomerIds = (q: any) => branchCustomerIds === null ? q : q.in('customer_id', branchCustomerIds.length > 0 ? branchCustomerIds : NO_MATCH);
      const scopeByEmployeeIds = (q: any) => branchEmployeeIds === null ? q : q.in('employee_id', branchEmployeeIds.length > 0 ? branchEmployeeIds : NO_MATCH);

      const [
        customers, newCustomers, loans, allLoanStatuses,
        paymentsToday, paymentsYesterday, paymentsMonth, paymentsLastMonth,
        recentPays, upcoming, paymentsWeek, journalWeek,
        customersByArea, paymentsFourWeeks, disbursedFourWeeks, gasVouchersFourWeeks, cashVouchersFourWeeks,
        attendanceMonth, employees, attendanceToday, payrollMonth,
      ] = await Promise.all([
        scopeByBranch(supabase.from('customers').select('id', { count: 'exact', head: true })),
        scopeByBranch(supabase.from('customers').select('id', { count: 'exact', head: true }).gte('created_at', monthStart)),
        scopeByBranch(supabase.from('loans').select('id, remaining_balance, due_date').eq('status', 'active')),
        scopeByBranch(supabase.from('loans').select('status')),
        scopeByCustomerIds(supabase.from('payments').select('amount_paid').gte('payment_date', today)),
        scopeByCustomerIds(supabase.from('payments').select('amount_paid').eq('payment_date', yesterday)),
        scopeByCustomerIds(supabase.from('payments').select('amount_paid').gte('payment_date', monthStart)),
        scopeByCustomerIds(supabase.from('payments').select('amount_paid').gte('payment_date', lastMonthStart).lte('payment_date', lastMonthEnd)),
        scopeByCustomerIds(supabase.from('payments').select('*, customers(first_name, last_name), loans(loan_number)').order('created_at', { ascending: false }).limit(5)),
        scopeByBranch(supabase.from('loans').select('*, customers(first_name, last_name)').eq('status', 'active').order('due_date', { ascending: true }).limit(5)),
        scopeByCustomerIds(supabase.from('payments').select('amount_paid, payment_date').gte('payment_date', sevenDaysAgo)),
        supabase.from('journal_entries').select('entry_date, journal_entry_lines(credit, chart_of_accounts(account_type))').gte('entry_date', sevenDaysAgo),
        scopeByBranch(supabase.from('customers').select('area_id, areas(name)').eq('status', 'active')),
        scopeByCustomerIds(supabase.from('payments').select('amount_paid, payment_date').gte('payment_date', fourWeeksAgo)),
        scopeByBranch(supabase.from('loans').select('release_amount, disbursed_at').not('disbursed_at', 'is', null).gte('disbursed_at', fourWeeksAgo)),
        scopeByBranch(supabase.from('gas_vouchers').select('total_amount, voucher_date').gte('voucher_date', fourWeeksAgo)),
        scopeByBranch(supabase.from('general_cash_vouchers').select('total_amount, voucher_date').gte('voucher_date', fourWeeksAgo)),
        scopeByEmployeeIds(supabase.from('attendance').select('status').gte('date', monthStart)),
        scopeByBranch(supabase.from('employees').select('id, position').eq('status', 'active')),
        scopeByEmployeeIds(supabase.from('attendance').select('employee_id, employees(position)').eq('date', today)),
        scopeByEmployeeIds(supabase.from('payroll').select('net_pay').gte('pay_date', monthStart)),
      ]);

      const activeLoans: any[] = loans.data ?? [];
      const overdue = activeLoans.filter((l: any) => l.due_date && new Date(l.due_date) < new Date());
      const outstandingBalance = activeLoans.reduce((s: number, l: any) => s + Number(l.remaining_balance), 0);
      // Overdue Rate = portfolio at risk — the share of the whole
      // receivable that's currently overdue, not just a share of loan
      // count (which "Overdue Loans" already shows).
      const overdueAmount = overdue.reduce((s: number, l: any) => s + Number(l.remaining_balance), 0);
      const overdueRate = outstandingBalance > 0 ? (overdueAmount / outstandingBalance) * 100 : 0;

      const statusCounts = (allLoanStatuses.data ?? []).reduce((acc: Record<string, number>, l: any) => {
        acc[l.status] = (acc[l.status] ?? 0) + 1;
        return acc;
      }, {});
      const paidLoans = statusCounts['paid'] ?? 0;
      const pendingLoans = statusCounts['pending'] ?? 0;

      const monthlyCollections = (paymentsMonth.data ?? []).reduce((s: number, p: any) => s + Number(p.amount_paid), 0);
      const lastMonthCollections = (paymentsLastMonth.data ?? []).reduce((s: number, p: any) => s + Number(p.amount_paid), 0);

      const disbursedTotal = (disbursedFourWeeks.data ?? []).reduce((s: number, l: any) => s + Number(l.release_amount), 0);
      const expensesTotal = [...(gasVouchersFourWeeks.data ?? []), ...(cashVouchersFourWeeks.data ?? [])]
        .reduce((s: number, v: any) => s + Number(v.total_amount), 0);
      const collectionsFourWeeksTotal = (paymentsFourWeeks.data ?? []).reduce((s: number, p: any) => s + Number(p.amount_paid), 0);
      // "This month" net cash flow, for the Cash Flow stat card — reuses
      // the same four-week collections figure since that window
      // approximates a month; disbursements/expenses are the outflow side.
      const netCashFlowMonth = collectionsFourWeeksTotal - disbursedTotal - expensesTotal;

      const employeeRows = employees.data ?? [];
      const collectorsTotal = employeeRows.filter((e: any) => e.position === 'Branch Field Collector').length;
      const employeesTotal = employeeRows.length;
      const presentTodayRows = attendanceToday.data ?? [];
      const collectorsPresentToday = presentTodayRows.filter((a: any) => a.employees?.position === 'Branch Field Collector').length;
      const employeesPresentToday = presentTodayRows.length;

      const payrollThisMonth = (payrollMonth.data ?? []).reduce((s: number, p: any) => s + Number(p.net_pay), 0);

      setStats({
        totalCustomers: customers.count ?? 0,
        newCustomersThisMonth: newCustomers.count ?? 0,
        activeLoans: activeLoans.length,
        overdueLoans: overdue.length,
        overdueAmount,
        overdueRate,
        todayCollections: (paymentsToday.data ?? []).reduce((s: number, p: any) => s + Number(p.amount_paid), 0),
        yesterdayCollections: (paymentsYesterday.data ?? []).reduce((s: number, p: any) => s + Number(p.amount_paid), 0),
        monthlyCollections,
        lastMonthCollections,
        outstandingBalance,
        totalCash: monthlyCollections,
        netCashFlowMonth,
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
      for (const p of (paymentsWeek.data ?? [])) {
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
      for (const c of (customersByArea.data ?? []) as any[]) {
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
        const inflow = (paymentsFourWeeks.data ?? [])
          .filter((p: any) => inRange(p.payment_date, wk.start, wk.end))
          .reduce((s: number, p: any) => s + Number(p.amount_paid), 0);
        const disbursed = (disbursedFourWeeks.data ?? [])
          .filter((l: any) => inRange(l.disbursed_at, wk.start, wk.end))
          .reduce((s: number, l: any) => s + Number(l.release_amount), 0);
        const expenses = [...(gasVouchersFourWeeks.data ?? []), ...(cashVouchersFourWeeks.data ?? [])]
          .filter((v: any) => inRange(v.voucher_date, wk.start, wk.end))
          .reduce((s: number, v: any) => s + Number(v.total_amount), 0);
        return { name: `Week ${i + 1}`, inflow, outflow: disbursed + expenses };
      }));

      const attendanceCounts = (attendanceMonth.data ?? []).reduce((acc: Record<string, number>, a: any) => {
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
        {isAdmin ? (
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
        <StatCard
          title="Total Cash"
          value={formatCurrency(stats.totalCash)}
          icon={<Banknote className="w-5 h-5" />}
          variant="success"
          subtitle="Available funds"
        />
        <StatCard
          title="Cash Flow"
          value={`${stats.netCashFlowMonth >= 0 ? '+' : '-'}${formatCurrency(Math.abs(stats.netCashFlowMonth))}`}
          icon={<Activity className="w-5 h-5" />}
          variant={stats.netCashFlowMonth >= 0 ? 'success' : 'danger'}
          trend={{ value: stats.netCashFlowMonth >= 0 ? 'Net positive' : 'Net negative', positive: stats.netCashFlowMonth >= 0 }}
          subtitle="Collections less disbursements/expenses, this month"
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
            <CardDescription>This month's breakdown</CardDescription>
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
                          {p.customers?.first_name} {p.customers?.last_name}
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
                          {l.customers?.first_name} {l.customers?.last_name}
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
