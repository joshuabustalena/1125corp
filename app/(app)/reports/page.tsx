'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { StatCard } from '@/components/dashboard/stat-card';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency, formatDate, exportToCSV, formatCustomerName } from '@/lib/format';
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
  'Amount', 'CashCollected', 'Offset', 'FirstPayment', 'TotalDeduction', 'TotalCollection',
  'TotalCollections', 'TotalRelease', 'TotalInterest', 'ServiceFee', 'NetProceeds',
  'OverdueAmount', 'Balance',
]);

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
  const [reportType, setReportType] = useState('daily_collection');
  const [startDate, setStartDate] = useState(new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({ total: 0, count: 0, average: 0 });
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
  // to a customer_id list first, same pattern as payment-reports/page.tsx.
  function filteredCustomerIds(): string[] | null {
    if (areaFilter !== 'all') return customers.filter(c => c.area_id === areaFilter).map(c => c.id);
    if (branchFilter !== 'all') return customers.filter(c => c.branch_id === branchFilter).map(c => c.id);
    return null;
  }

  async function generateReport() {
    setLoading(true);
    let reportData: any[] = [];
    const customerIds = filteredCustomerIds();

    switch (reportType) {
      // Collection is reported per day split into what actually came in as
      // cash (payments collected in the field) versus what was settled by
      // deduction at release — Offset Balance carried from a renewed loan,
      // plus the day-one First Payment taken out of the proceeds. Both are
      // real collection, but only the first is money that physically moved,
      // so the client wants them on separate lines rather than one figure.
      case 'daily_collection': {
        let pq = supabase.from('payments').select('amount_paid, payment_date, customer_id').gte('payment_date', startDate).lte('payment_date', endDate);
        if (customerIds) pq = pq.in('customer_id', customerIds.length > 0 ? customerIds : ['00000000-0000-0000-0000-000000000000']);
        let lq = supabase.from('loans').select('release_date, amount, release_amount, offset_balance, daily_payment, total_payable, term_days, branch_id, area_id').gte('release_date', startDate).lte('release_date', endDate);
        if (areaFilter !== 'all') lq = lq.eq('area_id', areaFilter);
        else if (branchFilter !== 'all') lq = lq.eq('branch_id', branchFilter);
        const [{ data: pays }, { data: loans }] = await Promise.all([pq, lq]);

        const byDate: Record<string, { cash: number; offset: number; firstPayment: number; deduction: number }> = {};
        const ensure = (d: string) => (byDate[d] ??= { cash: 0, offset: 0, firstPayment: 0, deduction: 0 });
        (pays ?? []).forEach((p: any) => { ensure(p.payment_date).cash += Number(p.amount_paid) || 0; });
        (loans ?? []).forEach((l: any) => {
          if (!l.release_date) return;
          const row = ensure(l.release_date);
          row.offset += Number(l.offset_balance) || 0;
          // Same auto-computed daily rate the rest of the app uses for the
          // day-one payment when no custom daily_payment is stored. Shown as
          // the scheduled figure the Loan Agreement quotes.
          row.firstPayment += Number(l.daily_payment) > 0
            ? Number(l.daily_payment)
            : (l.term_days > 0 ? Number(l.total_payable) / l.term_days : 0);
          // Total Deduction is what was ACTUALLY withheld from the proceeds,
          // which on real data does not always equal offset + first payment
          // (renewals in particular release without withholding the day-one
          // payment). Using the real figure keeps this column truthful.
          row.deduction += (Number(l.amount) || 0) - (Number(l.release_amount) || 0);
        });
        reportData = Object.entries(byDate)
          .sort((a, b) => b[0].localeCompare(a[0]))
          .map(([date, v]) => ({
            Date: date,
            CashCollected: Math.round(v.cash * 100) / 100,
            Offset: Math.round(v.offset * 100) / 100,
            FirstPayment: Math.round(v.firstPayment * 100) / 100,
            TotalDeduction: Math.round(v.deduction * 100) / 100,
            TotalCollection: Math.round((v.cash + v.deduction) * 100) / 100,
          }));
        break;
      }
      // Weekly/Monthly collection are broken down PER AREA (client request),
      // not just one lump figure per period — so a branch manager can see
      // which area brought in what over the chosen date range.
      case 'weekly_collection':
      case 'monthly_collection': {
        const isWeekly = reportType === 'weekly_collection';
        let q = supabase.from('payments').select('amount_paid, payment_date, customer_id').gte('payment_date', startDate).lte('payment_date', endDate).order('payment_date');
        if (customerIds) q = q.in('customer_id', customerIds.length > 0 ? customerIds : ['00000000-0000-0000-0000-000000000000']);
        const { data } = await q;
        const areaNameById = new Map(areas.map((a: any) => [a.id, a.name]));
        const areaIdByCustomer = new Map(customers.map((c: any) => [c.id, c.area_id]));
        const grouped: Record<string, { period: string; area: string; amount: number }> = {};
        (data ?? []).forEach((p: any) => {
          let period: string;
          if (isWeekly) {
            const d = new Date(p.payment_date);
            const weekStart = new Date(d);
            weekStart.setDate(d.getDate() - d.getDay());
            period = weekStart.toISOString().split('T')[0];
          } else {
            period = p.payment_date.substring(0, 7);
          }
          const area = areaNameById.get(areaIdByCustomer.get(p.customer_id)) ?? 'Unassigned';
          const key = `${period}|${area}`;
          if (!grouped[key]) grouped[key] = { period, area, amount: 0 };
          grouped[key].amount += Number(p.amount_paid);
        });
        reportData = Object.values(grouped)
          .sort((a, b) => a.period.localeCompare(b.period) || a.area.localeCompare(b.area))
          .map(v => (isWeekly
            ? { Week: v.period, Area: v.area, Amount: v.amount }
            : { Month: v.period, Area: v.area, Amount: v.amount }));
        break;
      }
// Client-specified column set: Total Collections, Total Release, Total
      // Interest, Service Fee, Net Proceeds, Total Deduction — replacing the
      // old generic Loans/TotalAmount/OutstandingBalance shape.
      case 'branch_performance': {
        let lq = supabase.from('loans').select('amount, interest_amount, service_fee, offset_balance, daily_payment, total_payable, term_days, release_amount, branch_id, area_id, branches(name), areas(name)').gte('release_date', startDate).lte('release_date', endDate);
        if (areaFilter !== 'all') lq = lq.eq('area_id', areaFilter);
        else if (branchFilter !== 'all') lq = lq.eq('branch_id', branchFilter);
        let pq = supabase.from('payments').select('amount_paid, customer_id').gte('payment_date', startDate).lte('payment_date', endDate);
        if (customerIds) pq = pq.in('customer_id', customerIds.length > 0 ? customerIds : ['00000000-0000-0000-0000-000000000000']);
        const [{ data: loans }, { data: pays }] = await Promise.all([lq, pq]);

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
        let q = supabase.from('loans').select('loan_number, remaining_balance, due_date, branch_id, area_id, customers(first_name, last_name), areas(name)').eq('status', 'active');
        if (areaFilter !== 'all') q = q.eq('area_id', areaFilter);
        else if (branchFilter !== 'all') q = q.eq('branch_id', branchFilter);
        const { data } = await q;
        const today = new Date();
        const all = data ?? [];
        // Rate is computed over EVERY active loan in the area (not just the
        // overdue ones), so it stays a true percentage.
        const rateByArea: Record<string, { total: number; overdue: number }> = {};
        all.forEach((l: any) => {
          const name = l.areas?.name ?? 'Unassigned';
          rateByArea[name] ??= { total: 0, overdue: 0 };
          rateByArea[name].total++;
          if (l.due_date && new Date(l.due_date) < today) rateByArea[name].overdue++;
        });
        reportData = all
          .filter((l: any) => l.due_date && new Date(l.due_date) < today)
          .map((l: any) => {
            const area = l.areas?.name ?? 'Unassigned';
            const r = rateByArea[area];
            return {
              LoanNumber: l.loan_number,
              Customer: formatCustomerName(l.customers?.first_name, l.customers?.last_name),
              Area: area,
              DueDate: l.due_date,
              DaysOverdue: Math.floor((today.getTime() - new Date(l.due_date).getTime()) / 86400000),
              OverdueAmount: l.remaining_balance,
              OverdueRate: r && r.total > 0 ? Math.round((r.overdue / r.total) * 1000) / 10 : 0,
            };
          })
          .sort((a: any, b: any) => b.DaysOverdue - a.DaysOverdue);
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
    const total = reportData.reduce((s, r) => s + (r.Amount ?? r.TotalCollection ?? r.TotalCollections ?? r.OverdueAmount ?? r.Balance ?? r.Customers ?? 0), 0);
    setStats({ total, count: reportData.length, average: reportData.length ? total / reportData.length : 0 });
    setLoading(false);
  }

  function handleExport() {
    if (data.length === 0) return;
    exportToCSV(data, `${reportType}.csv`);
    toast({ title: 'Success', description: 'Report exported' });
  }

  function handlePrint() {
    window.print();
  }

  // Weekly/Monthly rows now carry BOTH a period and an Area, so the label has
  // to combine them — keying off Area alone would print the same bar name
  // once per period and make the chart unreadable.
  const chartData = data.slice(0, 10).map((d, i) => {
    const period = d.Month ?? d.Week;
    const name = period
      ? (d.Area ? `${period} · ${d.Area}` : period)
      : (d.Branch ?? d.Area ?? d.Date ?? `Row ${i + 1}`);
    return {
      name,
      value: d.TotalCollections ?? d.TotalCollection ?? d.Amount ?? d.OverdueAmount ?? d.Customers ?? d.Balance ?? 0,
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" description="Generate and export financial reports">
        <Button variant="outline" size="sm" onClick={handlePrint}><Printer className="w-4 h-4 mr-2" />Print</Button>
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
                  <SelectItem value="daily_collection">Daily Collection</SelectItem>
                  <SelectItem value="weekly_collection">Weekly Collection (per Area)</SelectItem>
                  <SelectItem value="monthly_collection">Monthly Collection (per Area)</SelectItem>
                  <SelectItem value="branch_performance">{isFieldCollector ? 'Release (My Area)' : 'Branch Performance'}</SelectItem>
                  <SelectItem value="overdue_amount">Overdue Amount &amp; Rate</SelectItem>
                  <SelectItem value="customers_per_area">{isFieldCollector ? 'All Customers' : 'Customers per Area'}</SelectItem>
                  <SelectItem value="delinquent_customers">Delayed / Past-Due Customers</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 flex-1">
              <Label>Start Date</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-2 flex-1">
              <Label>End Date</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
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
        {/* Average is deliberately hidden on the Overdue report — client asked
            for the overdue rate to stand in its place there (the rate is on
            each row) rather than an average overdue amount. */}
        {reportType !== 'overdue_amount' && reportType !== 'customers_per_area' && (
          <StatCard title="Average" value={formatCurrency(stats.average)} icon={<Wallet className="w-5 h-5" />} />
        )}
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
                    {Object.keys(data[0]).map(key => <TableHead key={key}>{key}</TableHead>)}
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
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
