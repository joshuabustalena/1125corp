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
  const [reportType, setReportType] = useState('daily_collection');
  const [startDate, setStartDate] = useState(new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({ total: 0, count: 0, average: 0 });

  useEffect(() => { generateReport(); }, []);

  async function generateReport() {
    setLoading(true);
    let reportData: any[] = [];

    switch (reportType) {
      case 'daily_collection': {
        const { data } = await supabase.from('payments').select('amount_paid, payment_date, loans(loan_number, customers(first_name, last_name))').gte('payment_date', startDate).lte('payment_date', endDate).order('payment_date', { ascending: false });
        reportData = (data ?? []).map((p: any) => ({ Date: p.payment_date, Loan: p.loans?.loan_number ?? '', Customer: p.loans ? `${p.loans.customers?.first_name} ${p.loans.customers?.last_name}` : '', Amount: p.amount_paid }));
        break;
      }
      case 'weekly_collection': {
        const { data } = await supabase.from('payments').select('amount_paid, payment_date').gte('payment_date', startDate).lte('payment_date', endDate).order('payment_date');
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
        const { data } = await supabase.from('payments').select('amount_paid, payment_date').gte('payment_date', startDate).lte('payment_date', endDate).order('payment_date');
        const grouped: Record<string, number> = {};
        (data ?? []).forEach((p: any) => {
          const key = p.payment_date.substring(0, 7);
          grouped[key] = (grouped[key] ?? 0) + Number(p.amount_paid);
        });
        reportData = Object.entries(grouped).map(([month, amount]) => ({ Month: month, Amount: amount }));
        break;
      }
      case 'collector_performance': {
        const { data } = await supabase.from('payments').select('amount_paid, collectors(profiles(full_name))').gte('payment_date', startDate).lte('payment_date', endDate);
        const grouped: Record<string, number> = {};
        (data ?? []).forEach((p: any) => {
          const name = p.collectors?.profiles?.full_name ?? 'Unassigned';
          grouped[name] = (grouped[name] ?? 0) + Number(p.amount_paid);
        });
        reportData = Object.entries(grouped).map(([collector, total]) => ({ Collector: collector, TotalCollected: total }));
        break;
      }
      case 'branch_performance': {
        const { data } = await supabase.from('loans').select('amount, remaining_balance, branches(name)').gte('release_date', startDate).lte('release_date', endDate);
        const grouped: Record<string, { loans: number; amount: number; balance: number }> = {};
        (data ?? []).forEach((l: any) => {
          const name = l.branches?.name ?? 'Unassigned';
          if (!grouped[name]) grouped[name] = { loans: 0, amount: 0, balance: 0 };
          grouped[name].loans++;
          grouped[name].amount += Number(l.amount);
          grouped[name].balance += Number(l.remaining_balance);
        });
        reportData = Object.entries(grouped).map(([branch, v]) => ({ Branch: branch, Loans: v.loans, TotalAmount: v.amount, OutstandingBalance: v.balance }));
        break;
      }
      case 'loan_receivable': {
        const { data } = await supabase.from('loans').select('loan_number, amount, remaining_balance, status, customers(first_name, last_name)').in('status', ['active', 'overdue']);
        reportData = (data ?? []).map((l: any) => ({ LoanNumber: l.loan_number, Customer: `${l.customers?.first_name} ${l.customers?.last_name}`, Amount: l.amount, Balance: l.remaining_balance, Status: l.status }));
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
    const total = reportData.reduce((s, r) => s + (r.Amount ?? r.TotalCollected ?? r.TotalAmount ?? r.NetPay ?? 0), 0);
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
    name: d.Collector ?? d.Branch ?? d.Month ?? d.Week ?? d.Date ?? `Row ${i + 1}`,
    value: d.TotalCollected ?? d.TotalAmount ?? d.Amount ?? d.NetPay ?? 0,
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
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="space-y-2 flex-1">
              <Label>Report Type</Label>
              <Select value={reportType} onValueChange={setReportType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily_collection">Daily Collection</SelectItem>
                  <SelectItem value="weekly_collection">Weekly Collection</SelectItem>
                  <SelectItem value="monthly_collection">Monthly Collection</SelectItem>
                  <SelectItem value="collector_performance">Collector Performance</SelectItem>
                  <SelectItem value="branch_performance">Branch Performance</SelectItem>
                  <SelectItem value="loan_receivable">Loan Receivable</SelectItem>
                  <SelectItem value="payroll">Payroll</SelectItem>
                  <SelectItem value="attendance">Attendance</SelectItem>
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
        <StatCard title="Total" value={formatCurrency(stats.total)} icon={<TrendingUp className="w-5 h-5" />} variant="success" />
        <StatCard title="Records" value={stats.count.toString()} icon={<FileBarChart className="w-5 h-5" />} />
        <StatCard title="Average" value={formatCurrency(stats.average)} icon={<Wallet className="w-5 h-5" />} />
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
