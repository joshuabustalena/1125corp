'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency, formatDate, exportToCSV } from '@/lib/format';
import { ScrollText, Download, Loader2, Calculator, CheckCircle } from 'lucide-react';

export default function PayrollPage() {
  const { toast } = useToast();
  const [payroll, setPayroll] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [period, setPeriod] = useState('15');
  const [payDate, setPayDate] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => { load(); loadEmployees(); }, []);

  async function loadEmployees() {
    const { data } = await supabase.from('employees').select('id, first_name, last_name, salary, status, branches(name)').eq('status', 'active');
    setEmployees(data ?? []);
  }

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('payroll').select('*, employees(first_name, last_name, branches(name))').order('pay_date', { ascending: false });
    setPayroll(data ?? []);
    setLoading(false);
  }

  async function generatePayroll() {
    setGenerating(true);
    if (employees.length === 0) {
      toast({ title: 'Error', description: 'No active employees found', variant: 'destructive' });
      setGenerating(false);
      return;
    }

    const records = employees.map(e => {
      const basicSalary = Number(e.salary) / 2; // semi-monthly
      const sss = basicSalary * 0.045;
      const philhealth = basicSalary * 0.035;
      const pagIbig = basicSalary * 0.02;
      const incentive = basicSalary * 0.05;
      const retention = incentive * 0.25;
      const totalDeductions = sss + philhealth + pagIbig + retention;
      const netPay = basicSalary + incentive - totalDeductions;

      return {
        employee_id: e.id,
        period,
        pay_date: payDate,
        basic_salary: Math.round(basicSalary * 100) / 100,
        overtime_pay: 0,
        incentive: Math.round(incentive * 100) / 100,
        sss: Math.round(sss * 100) / 100,
        philhealth: Math.round(philhealth * 100) / 100,
        pag_ibig: Math.round(pagIbig * 100) / 100,
        incentive_retention: Math.round(retention * 100) / 100,
        net_pay: Math.round(netPay * 100) / 100,
        status: 'pending',
      };
    });

    const { error } = await supabase.from('payroll').insert(records);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: `Payroll generated for ${records.length} employees` });
      load();
    }
    setGenerating(false);
  }

  async function approvePayroll(id: string) {
    const { error } = await supabase.from('payroll').update({ status: 'paid' }).eq('id', id);
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Success', description: 'Payroll approved' }); load(); }
  }

  function handleExport() {
    exportToCSV(payroll.map(p => ({
      Employee: `${p.employees?.first_name} ${p.employees?.last_name}`,
      Period: p.period, PayDate: p.pay_date, Basic: p.basic_salary,
      Overtime: p.overtime_pay, Incentive: p.incentive, SSS: p.sss,
      PhilHealth: p.philhealth, PagIBIG: p.pag_ibig, Retention: p.incentive_retention,
      NetPay: p.net_pay, Status: p.status,
    })), 'payroll.csv');
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Payroll" description="Generate and manage employee payroll">
        <Button variant="outline" size="sm" onClick={handleExport}><Download className="w-4 h-4 mr-2" />Export</Button>
      </PageHeader>

      {/* Generate panel */}
      <Card className="glass-card border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Calculator className="w-5 h-5" />Generate Payroll</CardTitle>
          <CardDescription>Semi-monthly payroll (15th and 30th)</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="space-y-2 flex-1">
              <Label>Period</Label>
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="15">15th</SelectItem><SelectItem value="30">30th / 31st</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-2 flex-1">
              <Label>Pay Date</Label>
              <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
            </div>
            <Button onClick={generatePayroll} disabled={generating}>
              {generating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ScrollText className="w-4 h-4 mr-2" />}
              Generate Payroll
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Payroll table */}
      <Card className="glass-card border-border">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : payroll.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ScrollText className="w-12 h-12 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">No payroll records</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Pay Date</TableHead>
                  <TableHead>Basic</TableHead>
                  <TableHead>Incentive</TableHead>
                  <TableHead>Deductions</TableHead>
                  <TableHead>Net Pay</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payroll.map(p => {
                  const deductions = Number(p.sss) + Number(p.philhealth) + Number(p.pag_ibig) + Number(p.incentive_retention);
                  return (
                    <TableRow key={p.id} className="hover:bg-secondary/50">
                      <TableCell className="text-sm font-medium">{p.employees?.first_name} {p.employees?.last_name}</TableCell>
                      <TableCell className="text-sm">{p.period}</TableCell>
                      <TableCell className="text-sm">{formatDate(p.pay_date)}</TableCell>
                      <TableCell className="text-sm">{formatCurrency(p.basic_salary)}</TableCell>
                      <TableCell className="text-sm text-success">{formatCurrency(p.incentive)}</TableCell>
                      <TableCell className="text-sm text-destructive">{formatCurrency(deductions)}</TableCell>
                      <TableCell className="text-sm font-bold">{formatCurrency(p.net_pay)}</TableCell>
                      <TableCell><Badge variant={p.status === 'paid' ? 'default' : 'secondary'}>{p.status}</Badge></TableCell>
                      <TableCell className="text-right">
                        {p.status === 'pending' && (
                          <Button variant="ghost" size="icon" onClick={() => approvePayroll(p.id)}>
                            <CheckCircle className="w-4 h-4 text-success" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
