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
import { formatCurrency, formatDate, exportToCSV } from '@/lib/format';
import {
  FileBarChart, Download, Loader2, Printer, TrendingUp, Users, Wallet, Landmark,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

export default function ReportsPage() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const isFieldCollector = profile?.role_name === 'Branch Field Collector';
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

  useEffect(() => {
    if (isFieldCollector && !myArea) return;
    generateReport();
  }, [myArea, isFieldCollector]);

  async function loadFilterOptions() {
    const [b, a, c] = await Promise.all([
      supabase.from('branches').select('id, name').eq('status', 'active').order('name'),
      supabase.from('areas').select('id, name, branch_id').eq('status', 'active').order('name'),
      supabase.from('customers').select('id, branch_id, area_id'),
    ]);
    setBranches(b.data ?? []);
    setAreas(a.data ?? []);
    setCustomers(c.data ?? []);
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
      case 'daily_collection': {
        let q = supabase.from('payments').select('amount_paid, payment_date, customer_id, loans(loan_number, customers(first_name, last_name))').gte('payment_date', startDate).lte('payment_date', endDate).order('payment_date', { ascending: false });
        if (customerIds) q = q.in('customer_id', customerIds.length > 0 ? customerIds : ['00000000-0000-0000-0000-000000000000']);
        const { data } = await q;
        reportData = (data ?? []).map((p: any) => ({ Date: p.payment_date, Loan: p.loans?.loan_number ?? '', Customer: p.loans ? `${p.loans.customers?.first_name} ${p.loans.customers?.last_name}` : '', Amount: p.amount_paid }));
        break;
      }
      case 'weekly_collection': {
        let q = supabase.from('payments').select('amount_paid, payment_date, customer_id').gte('payment_date', startDate).lte('payment_date', endDate).order('payment_date');
        if (customerIds) q = q.in('customer_id', customerIds.length > 0 ? customerIds : ['00000000-0000-0000-0000-000000000000']);
        const { data } = await q;
        const grouped: Record<string, number> = {};
        (data ?? []).forEach((p: any) => {
          const d = new Date(p.payment_date);
          const weekStart = new Date(d);
          weekStart.setDate(d.getDate() - d.getDay());
          const key = weekStart.toISOString().split('T')[0];
          grouped[key] = (grouped[key] ?? 0) + Number(p.amount_paid);
        });
        reportData = Object.entries(grouped).map(([week, amount]) => ({ Week: week, Amount: amount }));
        break;
      }
      case 'monthly_collection': {
        let q = supabase.from('payments').select('amount_paid, payment_date, customer_id').gte('payment_date', startDate).lte('payment_date', endDate).order('payment_date');
        if (customerIds) q = q.in('customer_id', customerIds.length > 0 ? customerIds : ['00000000-0000-0000-0000-000000000000']);
        const { data } = await q;
        const grouped: Record<string, number> = {};
        (data ?? []).forEach((p: any) => {
          const key = p.payment_date.substring(0, 7);
          grouped[key] = (grouped[key] ?? 0) + Number(p.amount_paid);
        });
        reportData = Object.entries(grouped).map(([month, amount]) => ({ Month: month, Amount: amount }));
        break;
      }
      case 'collector_performance': {
        let q = supabase.from('payments').select('amount_paid, customer_id, collectors(profiles(full_name))').gte('payment_date', startDate).lte('payment_date', endDate);
        if (customerIds) q = q.in('customer_id', customerIds.length > 0 ? customerIds : ['00000000-0000-0000-0000-000000000000']);
        const { data } = await q;
        const grouped: Record<string, number> = {};
        (data ?? []).forEach((p: any) => {
          const name = p.collectors?.profiles?.full_name ?? 'Unassigned';
          grouped[name] = (grouped[name] ?? 0) + Number(p.amount_paid);
        });
        reportData = Object.entries(grouped).map(([collector, total]) => ({ Collector: collector, TotalCollected: total }));
        break;
      }
      case 'branch_performance': {
        let q = supabase.from('loans').select('amount, remaining_balance, branch_id, area_id, branches(name), areas(name)').gte('release_date', startDate).lte('release_date', endDate);
        if (areaFilter !== 'all') q = q.eq('area_id', areaFilter);
        else if (branchFilter !== 'all') q = q.eq('branch_id', branchFilter);
        const { data } = await q;
        const grouped: Record<string, { loans: number; amount: number; balance: number }> = {};
        (data ?? []).forEach((l: any) => {
          const name = areaFilter !== 'all' ? (l.areas?.name ?? 'Unassigned') : (l.branches?.name ?? 'Unassigned');
          if (!grouped[name]) grouped[name] = { loans: 0, amount: 0, balance: 0 };
          grouped[name].loans++;
          grouped[name].amount += Number(l.amount);
          grouped[name].balance += Number(l.remaining_balance);
        });
        reportData = Object.entries(grouped).map(([branch, v]) => ({ Branch: branch, Loans: v.loans, TotalAmount: v.amount, OutstandingBalance: v.balance }));
        break;
      }
      case 'loan_receivable': {
        let q = supabase.from('loans').select('loan_number, amount, remaining_balance, status, branch_id, area_id, customers(first_name, last_name)').in('status', ['active', 'overdue']);
        if (areaFilter !== 'all') q = q.eq('area_id', areaFilter);
        else if (branchFilter !== 'all') q = q.eq('branch_id', branchFilter);
        const { data } = await q;
        reportData = (data ?? []).map((l: any) => ({ LoanNumber: l.loan_number, Customer: `${l.customers?.first_name} ${l.customers?.last_name}`, Amount: l.amount, Balance: l.remaining_balance, Status: l.status }));
        break;
      }
      // A loan counts as overdue when it's still 'active' and past its due_date —
      // same rule the dashboard uses (status is never persisted as 'overdue').
      case 'overdue_amount': {
        let q = supabase.from('loans').select('loan_number, remaining_balance, due_date, branch_id, area_id, customers(first_name, last_name), areas(name)').eq('status', 'active');
        if (areaFilter !== 'all') q = q.eq('area_id', areaFilter);
        else if (branchFilter !== 'all') q = q.eq('branch_id', branchFilter);
        const { data } = await q;
        const today = new Date();
        reportData = (data ?? [])
          .filter((l: any) => l.due_date && new Date(l.due_date) < today)
          .map((l: any) => ({
            LoanNumber: l.loan_number,
            Customer: `${l.customers?.first_name} ${l.customers?.last_name}`,
            Area: l.areas?.name ?? 'Unassigned',
            DueDate: l.due_date,
            DaysOverdue: Math.floor((today.getTime() - new Date(l.due_date).getTime()) / 86400000),
            OverdueAmount: l.remaining_balance,
          }))
          .sort((a: any, b: any) => b.DaysOverdue - a.DaysOverdue);
        break;
      }
      case 'overdue_rate': {
        let q = supabase.from('loans').select('status, due_date, branch_id, area_id, areas(name)').in('status', ['active', 'overdue']);
        if (areaFilter !== 'all') q = q.eq('area_id', areaFilter);
        else if (branchFilter !== 'all') q = q.eq('branch_id', branchFilter);
        const { data } = await q;
        const today = new Date();
        const grouped: Record<string, { total: number; overdue: number }> = {};
        (data ?? []).forEach((l: any) => {
          const name = l.areas?.name ?? 'Unassigned';
          if (!grouped[name]) grouped[name] = { total: 0, overdue: 0 };
          grouped[name].total++;
          if (l.due_date && new Date(l.due_date) < today) grouped[name].overdue++;
        });
        reportData = Object.entries(grouped).map(([area, v]) => ({
          Area: area, TotalLoans: v.total, OverdueLoans: v.overdue,
          OverdueRate: v.total > 0 ? Math.round((v.overdue / v.total) * 1000) / 10 : 0,
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
              Customer: `${l.customers?.first_name} ${l.customers?.last_name}`,
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
      case 'payroll': {
        const { data } = await supabase.from('payroll').select('basic_salary, net_pay, status, employees(first_name, last_name)').gte('pay_date', startDate).lte('pay_date', endDate);
        reportData = (data ?? []).map((p: any) => ({ Employee: `${p.employees?.first_name} ${p.employees?.last_name}`, Basic: p.basic_salary, NetPay: p.net_pay, Status: p.status }));
        break;
      }
      case 'attendance': {
        const { data } = await supabase.from('attendance').select('date, status, late_minutes, employees(first_name, last_name)').gte('date', startDate).lte('date', endDate);
        reportData = (data ?? []).map((a: any) => ({ Employee: `${a.employees?.first_name} ${a.employees?.last_name}`, Date: a.date, Status: a.status, LateMinutes: a.late_minutes }));
        break;
      }
      default:
        reportData = [];
    }

    setData(reportData);
    const total = reportType === 'overdue_rate'
      ? reportData.reduce((s, r) => s + (r.OverdueRate ?? 0), 0) / (reportData.length || 1)
      : reportData.reduce((s, r) => s + (r.Amount ?? r.TotalCollected ?? r.TotalAmount ?? r.NetPay ?? r.OverdueAmount ?? r.Balance ?? r.Customers ?? 0), 0);
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

  const chartData = data.slice(0, 10).map((d, i) => ({
    name: d.Collector ?? d.Branch ?? d.Area ?? d.Month ?? d.Week ?? d.Date ?? `Row ${i + 1}`,
    value: d.TotalCollected ?? d.TotalAmount ?? d.Amount ?? d.NetPay ?? d.OverdueAmount ?? d.OverdueRate ?? d.Customers ?? d.Balance ?? 0,
  }));

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
                <Select value={branchFilter} onValueChange={(v) => { setBranchFilter(v); setAreaFilter('all'); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Branches</SelectItem>
                    {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
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
                  <SelectItem value="weekly_collection">Weekly Collection</SelectItem>
                  <SelectItem value="monthly_collection">Monthly Collection</SelectItem>
                  {!isFieldCollector && <SelectItem value="collector_performance">Collector Performance</SelectItem>}
                  <SelectItem value="branch_performance">{isFieldCollector ? 'Release (My Area)' : 'Branch Performance'}</SelectItem>
                  <SelectItem value="loan_receivable">Loan Receivable</SelectItem>
                  <SelectItem value="overdue_amount">Overdue Amount</SelectItem>
                  <SelectItem value="overdue_rate">Overdue Rate</SelectItem>
                  <SelectItem value="customers_per_area">{isFieldCollector ? 'All Customers' : 'Customers per Area'}</SelectItem>
                  <SelectItem value="delinquent_customers">Delayed / Past-Due Customers</SelectItem>
                  {!isFieldCollector && <SelectItem value="payroll">Payroll</SelectItem>}
                  {!isFieldCollector && <SelectItem value="attendance">Attendance</SelectItem>}
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
          title={reportType === 'overdue_rate' ? 'Average Overdue Rate' : reportType === 'customers_per_area' ? 'Total Customers' : 'Total'}
          value={reportType === 'overdue_rate' ? `${stats.total.toFixed(1)}%` : reportType === 'customers_per_area' ? stats.total.toString() : formatCurrency(stats.total)}
          icon={<TrendingUp className="w-5 h-5" />}
          variant="success"
        />
        <StatCard title="Records" value={stats.count.toString()} icon={<FileBarChart className="w-5 h-5" />} />
        {reportType !== 'overdue_rate' && reportType !== 'customers_per_area' && (
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
                          {typeof val === 'number' && (key.includes('Amount') || key.includes('Pay') || key.includes('Balance') || key === 'TotalCollected' || key === 'TotalAmount')
                            ? formatCurrency(val)
                            : key === 'OverdueRate' && typeof val === 'number'
                              ? `${val}%`
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
