'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
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
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency, formatDate, exportToCSV } from '@/lib/format';
import { Landmark, Plus, Download, Loader2, CheckCircle, XCircle } from 'lucide-react';

export default function EmployeeLoansPage() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const canApprove = profile?.role_name === 'Administrator' || profile?.role_name === 'Branch Manager';
  const [loans, setLoans] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [myEmployee, setMyEmployee] = useState<{ id: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({ employee_id: '', amount: '', deduction_amount: '', term_months: '6' });

  useEffect(() => {
    if (!profile) return;
    load();
    if (canApprove) loadEmployees();
  }, [profile]);

  async function loadEmployees() {
    const { data } = await supabase.from('employees').select('id, first_name, last_name, salary').eq('status', 'active');
    setEmployees(data ?? []);
  }

  async function load() {
    setLoading(true);
    let empId: string | null = null;
    if (!canApprove) {
      const { data: emp } = await supabase.from('employees').select('id').eq('profile_id', profile?.id ?? '').maybeSingle();
      setMyEmployee(emp);
      empId = emp?.id ?? '00000000-0000-0000-0000-000000000000';
    }
    let q = supabase.from('employee_loans').select('*, employees(first_name, last_name)').order('created_at', { ascending: false });
    if (empId) q = q.eq('employee_id', empId);
    const { data } = await q;
    setLoans(data ?? []);
    setLoading(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    // Check max 2 active loans
    const activeCount = loans.filter(l => l.employee_id === form.employee_id && (l.status === 'active' || l.status === 'approved')).length;
    if (activeCount >= 2) {
      toast({ title: 'Error', description: 'Employee already has 2 active loans', variant: 'destructive' });
      setSaving(false);
      return;
    }

    // Check max 15,000
    if (Number(form.amount) > 15000) {
      toast({ title: 'Error', description: 'Maximum employee loan is ₱15,000', variant: 'destructive' });
      setSaving(false);
      return;
    }

    const { error } = await supabase.from('employee_loans').insert({
      employee_id: form.employee_id,
      amount: Number(form.amount),
      remaining_balance: Number(form.amount),
      deduction_amount: Number(form.deduction_amount) || 0,
      term_months: Number(form.term_months) || 6,
      status: 'pending',
    });

    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Success', description: 'Employee loan application submitted' }); setDialogOpen(false); setForm({ employee_id: '', amount: '', deduction_amount: '', term_months: '6' }); load(); }
    setSaving(false);
  }

  async function updateStatus(id: string, status: string) {
    const { error } = await supabase.from('employee_loans').update({ status, approved_at: new Date().toISOString() }).eq('id', id);
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Success', description: `Loan ${status}` }); load(); }
  }

  function handleExport() {
    exportToCSV(loans.map(l => ({
      Employee: `${l.employees?.first_name} ${l.employees?.last_name}`,
      Amount: l.amount, Balance: l.remaining_balance, Deduction: l.deduction_amount,
      Term: l.term_months, Status: l.status, Applied: l.created_at,
    })), 'employee-loans.csv');
  }

  const statusVariant = (s: string) => s === 'active' ? 'default' : s === 'pending' ? 'outline' : s === 'rejected' ? 'destructive' : 'secondary';

  return (
    <div className="space-y-6">
      <PageHeader title="Employee Loans" description="Manage employee loan applications (max ₱15,000, 2 active, 6 months)">
        <Button variant="outline" size="sm" onClick={handleExport}><Download className="w-4 h-4 mr-2" />Export</Button>
        <Button
          size="sm"
          disabled={!canApprove && !myEmployee}
          onClick={() => { setForm(f => ({ ...f, employee_id: canApprove ? f.employee_id : (myEmployee?.id ?? '') })); setDialogOpen(true); }}
        >
          <Plus className="w-4 h-4 mr-2" />
          Apply Loan
        </Button>
      </PageHeader>

      <Card className="glass-card border-border">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : loans.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Landmark className="w-12 h-12 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">No employee loans</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Balance</TableHead>
                  <TableHead>Deduction</TableHead>
                  <TableHead>Term</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Applied</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loans.map(l => (
                  <TableRow key={l.id} className="hover:bg-secondary/50">
                    <TableCell className="text-sm font-medium">{l.employees?.first_name} {l.employees?.last_name}</TableCell>
                    <TableCell className="text-sm">{formatCurrency(l.amount)}</TableCell>
                    <TableCell className="text-sm">{formatCurrency(l.remaining_balance)}</TableCell>
                    <TableCell className="text-sm">{formatCurrency(l.deduction_amount)}</TableCell>
                    <TableCell className="text-sm">{l.term_months} months</TableCell>
                    <TableCell><Badge variant={statusVariant(l.status)}>{l.status}</Badge></TableCell>
                    <TableCell className="text-sm">{formatDate(l.created_at)}</TableCell>
                    <TableCell className="text-right">
                      {l.status === 'pending' && canApprove && (
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => updateStatus(l.id, 'active')}><CheckCircle className="w-4 h-4 text-success" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => updateStatus(l.id, 'rejected')}><XCircle className="w-4 h-4 text-destructive" /></Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Apply Employee Loan</DialogTitle><DialogDescription>Max ₱15,000, max 2 active loans, 6 months repayment</DialogDescription></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {canApprove && (
              <div className="space-y-2">
                <Label>Employee *</Label>
                <Select value={form.employee_id} onValueChange={(v) => setForm({ ...form, employee_id: v })} required>
                  <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>{employees.map(e => <SelectItem key={e.id} value={e.id}>{e.first_name} {e.last_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Amount (₱) *</Label><Input type="number" required max="15000" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="Max 15000" /></div>
              <div className="space-y-2"><Label>Term (Months)</Label><Input type="number" max="6" value={form.term_months} onChange={(e) => setForm({ ...form, term_months: e.target.value })} /></div>
              <div className="space-y-2 col-span-2"><Label>Deduction per Payroll (₱)</Label><Input type="number" value={form.deduction_amount} onChange={(e) => setForm({ ...form, deduction_amount: e.target.value })} placeholder="0.00" /></div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Submit Application</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
