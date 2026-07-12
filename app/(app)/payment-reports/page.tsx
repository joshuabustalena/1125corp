'use client';

import { useEffect, useRef, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { StatCard } from '@/components/dashboard/stat-card';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency, formatDate, exportToCSV } from '@/lib/format';
import { FileDown, Download, Loader2, TrendingUp, Wallet, Receipt } from 'lucide-react';

export default function PaymentReportsPage() {
  const { toast } = useToast();
  const [branches, setBranches] = useState<any[]>([]);
  const [areas, setAreas] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [branchFilter, setBranchFilter] = useState('all');
  const [areaFilter, setAreaFilter] = useState('all');
  const [customerFilter, setCustomerFilter] = useState('all');
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadFilterOptions();
    generateReport();
  }, []);

  async function loadFilterOptions() {
    const [b, a, c] = await Promise.all([
      supabase.from('branches').select('id, name').eq('status', 'active').order('name'),
      supabase.from('areas').select('id, name, branch_id').eq('status', 'active').order('name'),
      supabase.from('customers').select('id, first_name, last_name, branch_id, area_id').eq('status', 'active').order('first_name'),
    ]);
    setBranches(b.data ?? []);
    setAreas(a.data ?? []);
    setCustomers(c.data ?? []);
  }

  async function generateReport() {
    setLoading(true);

    let customerIds: string[] | null = null;
    if (customerFilter !== 'all') {
      customerIds = [customerFilter];
    } else if (areaFilter !== 'all') {
      customerIds = customers.filter(c => c.area_id === areaFilter).map(c => c.id);
    } else if (branchFilter !== 'all') {
      customerIds = customers.filter(c => c.branch_id === branchFilter).map(c => c.id);
    }

    let query = supabase
      .from('payments')
      .select('*, customers(first_name, last_name, branches(name), areas(name)), loans(loan_number)')
      .order('payment_date', { ascending: false });

    if (customerIds) {
      query = query.in('customer_id', customerIds.length > 0 ? customerIds : ['00000000-0000-0000-0000-000000000000']);
    }

    const { data, error } = await query;
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      setPayments([]);
    } else {
      setPayments(data ?? []);
    }
    setLoading(false);
  }

  const total = payments.reduce((s, p) => s + Number(p.amount_paid), 0);
  const count = payments.length;
  const average = count > 0 ? total / count : 0;

  const breakdown = (() => {
    const grouped: Record<string, { total: number; count: number }> = {};
    let categoryLabel = 'Branch';

    if (customerFilter !== 'all') {
      return null;
    } else if (areaFilter !== 'all') {
      categoryLabel = 'Customer';
      payments.forEach(p => {
        const name = p.customers ? `${p.customers.first_name} ${p.customers.last_name}` : 'Unknown';
        if (!grouped[name]) grouped[name] = { total: 0, count: 0 };
        grouped[name].total += Number(p.amount_paid);
        grouped[name].count++;
      });
    } else if (branchFilter !== 'all') {
      categoryLabel = 'Area';
      payments.forEach(p => {
        const name = p.customers?.areas?.name ?? 'Unassigned';
        if (!grouped[name]) grouped[name] = { total: 0, count: 0 };
        grouped[name].total += Number(p.amount_paid);
        grouped[name].count++;
      });
    } else {
      categoryLabel = 'Branch';
      payments.forEach(p => {
        const name = p.customers?.branches?.name ?? 'Unassigned';
        if (!grouped[name]) grouped[name] = { total: 0, count: 0 };
        grouped[name].total += Number(p.amount_paid);
        grouped[name].count++;
      });
    }

    return {
      categoryLabel,
      rows: Object.entries(grouped)
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.total - a.total),
    };
  })();

  const branchLabel = branchFilter === 'all' ? 'All Branches' : branches.find(b => b.id === branchFilter)?.name ?? 'All Branches';
  const areaLabel = areaFilter === 'all' ? 'All Areas' : areas.find(a => a.id === areaFilter)?.name ?? 'All Areas';
  const customerLabel = customerFilter === 'all'
    ? 'All Customers'
    : (() => {
        const c = customers.find(c => c.id === customerFilter);
        return c ? `${c.first_name} ${c.last_name}` : 'All Customers';
      })();

  async function handleGeneratePdf() {
    if (!reportRef.current) return;
    setGeneratingPdf(true);
    try {
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      await new Promise<void>((resolve, reject) => {
        pdf.html(reportRef.current as HTMLElement, {
          callback: (doc) => {
            doc.save(`payment-report-${new Date().toISOString().split('T')[0]}.pdf`);
            resolve();
          },
          x: 24,
          y: 24,
          width: pageWidth - 48,
          windowWidth: 820,
          autoPaging: 'text',
          html2canvas: { scale: (pageWidth - 48) / 820, backgroundColor: '#ffffff' },
        });
      });
    } catch (err: any) {
      toast({ title: 'PDF generation failed', description: err?.message ?? 'Could not generate report PDF', variant: 'destructive' });
    }
    setGeneratingPdf(false);
  }

  function handleExport() {
    if (payments.length === 0) return;
    exportToCSV(
      payments.map(p => ({
        Date: p.payment_date,
        Customer: p.customers ? `${p.customers.first_name} ${p.customers.last_name}` : '',
        Branch: p.customers?.branches?.name ?? '',
        Area: p.customers?.areas?.name ?? '',
        LoanNumber: p.loans?.loan_number ?? '',
        AmountPaid: p.amount_paid,
      })),
      'payment-report.csv'
    );
  }

  const filteredAreas = branchFilter !== 'all' ? areas.filter(a => a.branch_id === branchFilter) : areas;
  const filteredCustomers = areaFilter !== 'all'
    ? customers.filter(c => c.area_id === areaFilter)
    : branchFilter !== 'all'
      ? customers.filter(c => c.branch_id === branchFilter)
      : customers;

  return (
    <div className="space-y-6">
      <PageHeader title="Payment Reports" description="Payments collected, broken down by branch, area, and customer">
        <Button variant="outline" size="sm" onClick={handleExport} disabled={payments.length === 0}>
          <Download className="w-4 h-4 mr-2" />
          Export CSV
        </Button>
        <Button size="sm" onClick={handleGeneratePdf} disabled={generatingPdf || payments.length === 0}>
          {generatingPdf ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileDown className="w-4 h-4 mr-2" />}
          Generate PDF Report
        </Button>
      </PageHeader>

      {/* Filters */}
      <Card className="glass-card border-border">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="space-y-2 flex-1">
              <Label>Branch</Label>
              <Select value={branchFilter} onValueChange={(v) => { setBranchFilter(v); setAreaFilter('all'); setCustomerFilter('all'); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Branches</SelectItem>
                  {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 flex-1">
              <Label>Area</Label>
              <Select value={areaFilter} onValueChange={(v) => { setAreaFilter(v); setCustomerFilter('all'); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Areas</SelectItem>
                  {filteredAreas.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 flex-1">
              <Label>Customer</Label>
              <Select value={customerFilter} onValueChange={setCustomerFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Customers</SelectItem>
                  {filteredCustomers.map(c => <SelectItem key={c.id} value={c.id}>{c.first_name} {c.last_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={generateReport}>Apply Filters</Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard title="Total Collected" value={formatCurrency(total)} icon={<TrendingUp className="w-5 h-5" />} variant="success" />
        <StatCard title="Payments" value={count.toString()} icon={<Receipt className="w-5 h-5" />} />
        <StatCard title="Average Payment" value={formatCurrency(average)} icon={<Wallet className="w-5 h-5" />} />
      </div>

      {/* Breakdown */}
      {breakdown && breakdown.rows.length > 0 && (
        <Card className="glass-card border-border">
          <CardHeader>
            <CardTitle>By {breakdown.categoryLabel}</CardTitle>
            <CardDescription>Totals collected per {breakdown.categoryLabel.toLowerCase()}</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{breakdown.categoryLabel}</TableHead>
                  <TableHead>Payments</TableHead>
                  <TableHead>Total Collected</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {breakdown.rows.map(row => (
                  <TableRow key={row.name}>
                    <TableCell className="text-sm font-medium">{row.name}</TableCell>
                    <TableCell className="text-sm">{row.count}</TableCell>
                    <TableCell className="text-sm font-medium text-success">{formatCurrency(row.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Detail table */}
      <Card className="glass-card border-border">
        <CardHeader>
          <CardTitle>Payment Detail</CardTitle>
          <CardDescription>{payments.length} payments</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : payments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No payments found for this filter</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Area</TableHead>
                    <TableHead>Loan #</TableHead>
                    <TableHead>Amount Paid</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map(p => (
                    <TableRow key={p.id}>
                      <TableCell className="text-sm">{formatDate(p.payment_date)}</TableCell>
                      <TableCell className="text-sm">{p.customers ? `${p.customers.first_name} ${p.customers.last_name}` : '—'}</TableCell>
                      <TableCell className="text-sm">{p.customers?.branches?.name ?? '—'}</TableCell>
                      <TableCell className="text-sm">{p.customers?.areas?.name ?? '—'}</TableCell>
                      <TableCell className="text-sm">{p.loans?.loan_number ?? '—'}</TableCell>
                      <TableCell className="text-sm font-medium text-success">{formatCurrency(p.amount_paid)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Hidden professional report template, captured to PDF on "Generate PDF Report" */}
      <div style={{ position: 'fixed', top: 0, left: 0, opacity: 0, pointerEvents: 'none', zIndex: -1 }}>
        <div ref={reportRef} style={{ width: 820, background: '#ffffff', color: '#1a1a1a', padding: 32, fontFamily: 'Arial, sans-serif' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, borderBottom: '3px solid #0B1F3A', paddingBottom: 16, marginBottom: 20 }}>
            <img src="/image/1125_Corp_Logo.png" alt="1125Corp" style={{ width: 52, height: 52, objectFit: 'contain' }} />
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#0B1F3A' }}>1125Corp</div>
              <div style={{ fontSize: 11, color: '#666' }}>1125corp.org</div>
            </div>
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#0B1F3A' }}>Payment Report</div>
              <div style={{ fontSize: 11, color: '#666' }}>Generated {formatDate(new Date().toISOString())}</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 28, marginBottom: 20, fontSize: 12 }}>
            <div><span style={{ color: '#666' }}>Branch: </span><strong>{branchLabel}</strong></div>
            <div><span style={{ color: '#666' }}>Area: </span><strong>{areaLabel}</strong></div>
            <div><span style={{ color: '#666' }}>Customer: </span><strong>{customerLabel}</strong></div>
          </div>

          <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
            <div style={{ flex: 1, padding: 16, background: '#f4f6f9', borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: '#666' }}>Total Collected</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#0B7A3D' }}>{formatCurrency(total)}</div>
            </div>
            <div style={{ flex: 1, padding: 16, background: '#f4f6f9', borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: '#666' }}>Payments</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#0B1F3A' }}>{count}</div>
            </div>
            <div style={{ flex: 1, padding: 16, background: '#f4f6f9', borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: '#666' }}>Average Payment</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#0B1F3A' }}>{formatCurrency(average)}</div>
            </div>
          </div>

          {breakdown && breakdown.rows.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#0B1F3A', marginBottom: 8 }}>By {breakdown.categoryLabel}</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#0B1F3A', color: '#fff' }}>
                    <th style={{ textAlign: 'left', padding: '6px 10px' }}>{breakdown.categoryLabel}</th>
                    <th style={{ textAlign: 'left', padding: '6px 10px' }}>Payments</th>
                    <th style={{ textAlign: 'right', padding: '6px 10px' }}>Total Collected</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.rows.map((row, i) => (
                    <tr key={row.name} style={{ background: i % 2 === 0 ? '#ffffff' : '#f4f6f9' }}>
                      <td style={{ padding: '6px 10px' }}>{row.name}</td>
                      <td style={{ padding: '6px 10px' }}>{row.count}</td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', color: '#0B7A3D', fontWeight: 600 }}>{formatCurrency(row.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ fontSize: 14, fontWeight: 700, color: '#0B1F3A', marginBottom: 8 }}>Payment Detail</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ background: '#0B1F3A', color: '#fff' }}>
                <th style={{ textAlign: 'left', padding: '6px 10px' }}>Date</th>
                <th style={{ textAlign: 'left', padding: '6px 10px' }}>Customer</th>
                <th style={{ textAlign: 'left', padding: '6px 10px' }}>Branch</th>
                <th style={{ textAlign: 'left', padding: '6px 10px' }}>Area</th>
                <th style={{ textAlign: 'left', padding: '6px 10px' }}>Loan #</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>Amount Paid</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p, i) => (
                <tr key={p.id} style={{ background: i % 2 === 0 ? '#ffffff' : '#f4f6f9' }}>
                  <td style={{ padding: '6px 10px' }}>{formatDate(p.payment_date)}</td>
                  <td style={{ padding: '6px 10px' }}>{p.customers ? `${p.customers.first_name} ${p.customers.last_name}` : '—'}</td>
                  <td style={{ padding: '6px 10px' }}>{p.customers?.branches?.name ?? '—'}</td>
                  <td style={{ padding: '6px 10px' }}>{p.customers?.areas?.name ?? '—'}</td>
                  <td style={{ padding: '6px 10px' }}>{p.loans?.loan_number ?? '—'}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', color: '#0B7A3D', fontWeight: 600 }}>{formatCurrency(p.amount_paid)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ marginTop: 20, paddingTop: 12, borderTop: '1px solid #ddd', fontSize: 10, color: '#999', textAlign: 'center' }}>
            Generated by 1125Corp system
          </div>
        </div>
      </div>
    </div>
  );
}
