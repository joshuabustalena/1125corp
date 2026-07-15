'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { StatCard } from '@/components/dashboard/stat-card';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

interface DashboardStats {
  totalCustomers: number;
  activeLoans: number;
  overdueLoans: number;
  todayCollections: number;
  monthlyCollections: number;
  outstandingBalance: number;
  totalCash: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    totalCustomers: 0,
    activeLoans: 0,
    overdueLoans: 0,
    todayCollections: 0,
    monthlyCollections: 0,
    outstandingBalance: 0,
    totalCash: 0,
  });
  const [recentPayments, setRecentPayments] = useState<any[]>([]);
  const [upcomingDues, setUpcomingDues] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkDueDateAlerts();
    async function load() {
      const today = new Date().toISOString().split('T')[0];
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];

      const [customers, loans, paymentsToday, paymentsMonth, recentPays, upcoming] = await Promise.all([
        supabase.from('customers').select('id', { count: 'exact', head: true }),
        supabase.from('loans').select('id, remaining_balance, due_date').eq('status', 'active'),
        supabase.from('payments').select('amount_paid').gte('payment_date', today),
        supabase.from('payments').select('amount_paid').gte('payment_date', monthStart),
        supabase.from('payments').select('*, customers(first_name, last_name), loans(loan_number)').order('created_at', { ascending: false }).limit(5),
        supabase.from('loans').select('*, customers(first_name, last_name)').eq('status', 'active').order('due_date', { ascending: true }).limit(5),
      ]);

      const activeLoans = loans.data ?? [];
      const overdue = activeLoans.filter(l => l.due_date && new Date(l.due_date) < new Date());

      setStats({
        totalCustomers: customers.count ?? 0,
        activeLoans: activeLoans.length,
        overdueLoans: overdue.length,
        todayCollections: (paymentsToday.data ?? []).reduce((s, p) => s + Number(p.amount_paid), 0),
        monthlyCollections: (paymentsMonth.data ?? []).reduce((s, p) => s + Number(p.amount_paid), 0),
        outstandingBalance: activeLoans.reduce((s, l) => s + Number(l.remaining_balance), 0),
        totalCash: (paymentsMonth.data ?? []).reduce((s, p) => s + Number(p.amount_paid), 0),
      });

      setRecentPayments(recentPays.data ?? []);
      setUpcomingDues((upcoming.data ?? []).filter(l => l.due_date));
      setLoading(false);
    }
    load();
  }, []);

  const dailyData = [
    { name: 'Mon', collections: 12500, revenue: 8200 },
    { name: 'Tue', collections: 18000, revenue: 11500 },
    { name: 'Wed', collections: 9500, revenue: 6800 },
    { name: 'Thu', collections: 22000, revenue: 14200 },
    { name: 'Fri', collections: 28500, revenue: 19000 },
    { name: 'Sat', collections: 31000, revenue: 21500 },
    { name: 'Sun', collections: 4500, revenue: 3200 },
  ];

  const loanStatusData = [
    { name: 'Active', value: stats.activeLoans, color: '#0B1F3A' },
    { name: 'Overdue', value: stats.overdueLoans, color: '#EF4444' },
    { name: 'Paid', value: 45, color: '#16A34A' },
    { name: 'Pending', value: 12, color: '#F97316' },
  ];

  const areaData = [
    { name: 'Brgy. San Roque', customers: 42 },
    { name: 'Brgy. Sta. Cruz', customers: 38 },
    { name: 'Brgy. San Isidro', customers: 31 },
    { name: 'Brgy. Concepcion', customers: 25 },
    { name: 'Brgy. Mabini', customers: 19 },
    { name: 'Brgy. Rizal', customers: 15 },
  ];

  const cashFlowData = [
    { name: 'Week 1', inflow: 45000, outflow: 12000 },
    { name: 'Week 2', inflow: 62000, outflow: 18000 },
    { name: 'Week 3', inflow: 38000, outflow: 15000 },
    { name: 'Week 4', inflow: 71000, outflow: 22000 },
  ];

  const attendanceData = [
    { name: 'Present', value: 85, color: '#16A34A' },
    { name: 'Late', value: 8, color: '#F97316' },
    { name: 'Absent', value: 4, color: '#EF4444' },
    { name: 'Leave', value: 3, color: '#3B82F6' },
  ];

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
          trend={{ value: '+12% this month', positive: true }}
          subtitle="Registered borrowers"
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
          title="Today's Collections"
          value={formatCurrency(stats.todayCollections)}
          icon={<Wallet className="w-5 h-5" />}
          variant="success"
          trend={{ value: '+8% vs yesterday', positive: true }}
        />
        <StatCard
          title="Monthly Collections"
          value={formatCurrency(stats.monthlyCollections)}
          icon={<TrendingUp className="w-5 h-5" />}
          variant="success"
          trend={{ value: '+15% vs last month', positive: true }}
        />
        <StatCard
          title="Outstanding Balance"
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
          value="+₱128,500"
          icon={<Activity className="w-5 h-5" />}
          variant="success"
          trend={{ value: 'Net positive', positive: true }}
          subtitle="This month"
        />
      </div>

      {/* Secondary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Collector Attendance" value="8/10" icon={<UserCheck className="w-5 h-5" />} variant="success" subtitle="Active today" />
        <StatCard title="Employee Attendance" value="24/28" icon={<UserCheck className="w-5 h-5" />} variant="default" subtitle="Present today" />
        <StatCard title="Payroll Summary" value="₱285,400" icon={<ScrollText className="w-5 h-5" />} variant="warning" subtitle="Current period" />
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
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={dailyData}>
                <defs>
                  <linearGradient id="colorCollections" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0B1F3A" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#0B1F3A" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#16A34A" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#16A34A" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="name" className="text-xs" tick={{ fontSize: 12 }} />
                <YAxis className="text-xs" tick={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgb(var(--card))',
                    border: '1px solid rgb(var(--border))',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                  formatter={(value: number) => formatCurrency(value)}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="collections" stroke="#0B1F3A" strokeWidth={2} fill="url(#colorCollections)" />
                <Area type="monotone" dataKey="revenue" stroke="#16A34A" strokeWidth={2} fill="url(#colorRevenue)" />
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
              <BarChart data={cashFlowData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgb(var(--card))',
                    border: '1px solid rgb(var(--border))',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                  formatter={(value: number) => formatCurrency(value)}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="inflow" fill="#16A34A" radius={[4, 4, 0, 0]} />
                <Bar dataKey="outflow" fill="#EF4444" radius={[4, 4, 0, 0]} />
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
