'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
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
import { Landmark, Plus, Download, Loader2, CalendarDays, ChevronLeft, ChevronRight, Pencil, Trash2, Search } from 'lucide-react';

export default function EmployeeLoansPage() {
  const { toast } = useToast();
  const router = useRouter();
  const { profile } = useAuth();
  const canApprove = profile?.role_name === 'Administrator' || profile?.role_name === 'Branch Manager';
  const isAdmin = profile?.role_name === 'Administrator';
  const isBranchManager = profile?.role_name === 'Branch Manager';
  const [loans, setLoans] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [myEmployee, setMyEmployee] = useState<{ id: string; position?: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({ employee_id: '', amount: '', deduction_amount: '', term_months: '6' });
  const [calendarLoan, setCalendarLoan] = useState<any>(null);
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [editTarget, setEditTarget] = useState<any>(null);
  const [editForm, setEditForm] = useState({ amount: '', remaining_balance: '', deduction_amount: '', term_months: '', status: '' });
  const [editSaving, setEditSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [deleting, setDeleting] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [appliedFrom, setAppliedFrom] = useState('');
  const [appliedTo, setAppliedTo] = useState('');

  useEffect(() => {
    if (!profile) return;
    load();
    if (canApprove) loadEmployees();
  }, [profile]);

  async function loadEmployees() {
    let q = supabase.from('employees').select('id, first_name, last_name, salary, position, branch_id').eq('status', 'active');
    // A Branch Manager can only apply on behalf of their own branch's staff.
    if (isBranchManager && profile?.branch_id) q = q.eq('branch_id', profile.branch_id);
    const { data } = await q;
    setEmployees(data ?? []);
  }

  async function load() {
    setLoading(true);
    let empId: string | null = null;
    if (!canApprove) {
      const { data: emp } = await supabase.from('employees').select('id, position').eq('profile_id', profile?.id ?? '').maybeSingle();
      setMyEmployee(emp);
      empId = emp?.id ?? '00000000-0000-0000-0000-000000000000';
    }
    let q = supabase.from('employee_loans').select('*, employees(first_name, last_name, position, branch_id)').order('created_at', { ascending: false });
    if (empId) q = q.eq('employee_id', empId);
    const { data } = await q;
    // A Branch Manager only sees/acts on their own branch's applications —
    // a Manager-tier applicant's own loan is Admin-only regardless (handled
    // on the detail page), but the list itself is still branch-scoped here.
    const scoped = isBranchManager && profile?.branch_id
      ? (data ?? []).filter((l: any) => l.employees?.branch_id === profile.branch_id)
      : (data ?? []);
    setLoans(scoped);
    setLoading(false);
  }

  function maxLoanAmount(position: string | null | undefined) {
    return position === 'Branch Manager' ? 20000 : 15000;
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

    // Check max amount — 20,000 for a Branch Manager applicant, 15,000 for
    // everyone else.
    const targetPosition = canApprove
      ? employees.find(e => e.id === form.employee_id)?.position
      : myEmployee?.position;
    const maxAmount = maxLoanAmount(targetPosition);
    if (Number(form.amount) > maxAmount) {
      toast({ title: 'Error', description: `Maximum employee loan is ${formatCurrency(maxAmount)}`, variant: 'destructive' });
      setSaving(false);
      return;
    }

    // Maximum deduction per cutoff is amount / 12 — spreads repayment over
    // at least 12 semi-monthly cutoffs (6 months) instead of paying it off
    // in one or two large deductions.
    const maxDeduction = Number(form.amount) / 12;
    if (Number(form.deduction_amount) > maxDeduction) {
      toast({ title: 'Error', description: `Maximum deduction per cutoff for this amount is ${formatCurrency(maxDeduction)} (loan amount ÷ 12)`, variant: 'destructive' });
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

  function openEditLoan(l: any) {
    setEditTarget(l);
    setEditForm({
      amount: String(l.amount), remaining_balance: String(l.remaining_balance),
      deduction_amount: String(l.deduction_amount), term_months: String(l.term_months), status: l.status,
    });
  }

  async function handleEditLoan(e: React.FormEvent) {
    e.preventDefault();
    if (!editTarget) return;

    const maxDeduction = Number(editForm.amount) / 12;
    if (Number(editForm.deduction_amount) > maxDeduction) {
      toast({ title: 'Error', description: `Maximum deduction per cutoff for this amount is ${formatCurrency(maxDeduction)} (loan amount ÷ 12)`, variant: 'destructive' });
      return;
    }

    setEditSaving(true);
    const { error } = await supabase.from('employee_loans').update({
      amount: Number(editForm.amount),
      remaining_balance: Number(editForm.remaining_balance),
      deduction_amount: Number(editForm.deduction_amount),
      term_months: Number(editForm.term_months),
      status: editForm.status,
    }).eq('id', editTarget.id);

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Loan updated' });
      setEditTarget(null);
      load();
    }
    setEditSaving(false);
  }

  async function handleDeleteLoan() {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from('employee_loans').delete().eq('id', deleteTarget.id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Loan deleted' });
      setDeleteTarget(null);
      load();
    }
    setDeleting(false);
  }

  function handleExport() {
    exportToCSV(filteredLoans.map(l => ({
      Employee: `${l.employees?.first_name} ${l.employees?.last_name}`,
      Amount: l.amount, Balance: l.remaining_balance, Deduction: l.deduction_amount,
      Term: l.term_months, Status: l.status, Applied: l.created_at,
    })), 'employee-loans.csv');
  }

  const statusVariant = (s: string) => s === 'active' ? 'default' : s === 'pending' ? 'outline' : s === 'rejected' ? 'destructive' : 'secondary';

  function openCalendar(loan: any) {
    const start = new Date(loan.approved_at ?? loan.created_at);
    setCalendarMonth(new Date(start.getFullYear(), start.getMonth(), 1));
    setCalendarLoan(loan);
  }

  // Semi-monthly payroll deduction: the 15th and the last day of the month,
  // twice a month, for the loan's term. The final deduction absorbs whatever
  // balance is left over, same "last one settles the remainder" rule used
  // for customer daily-payment schedules. Stops as soon as the balance hits
  // zero instead of continuing to list ₱0.00 deductions for the rest of the
  // term — an early payoff should just end the schedule, not pad it out.
  function computeEmployeeSchedule(loan: any) {
    const termMonths = Number(loan.term_months) || 6;
    const deduction = Number(loan.deduction_amount) || 0;
    const start = new Date(loan.approved_at ?? loan.created_at);
    const dates: Date[] = [];
    for (let m = 0; m < termMonths; m++) {
      const year = start.getFullYear();
      const month = start.getMonth() + m;
      // If the loan starts after the 15th, that month's 15th has already
      // passed — the first deduction is the end of that month instead
      // (30th, or 31st for months with 31 days).
      if (m > 0 || start.getDate() <= 15) {
        dates.push(new Date(year, month, 15));
      }
      dates.push(new Date(year, month + 1, 0));
    }
    let remaining = Number(loan.amount);
    const schedule: { date: Date; amount: number; remainingAfter: number }[] = [];
    for (let idx = 0; idx < dates.length && remaining > 0; idx++) {
      const isLast = idx === dates.length - 1;
      const amount = isLast ? remaining : Math.min(deduction, remaining);
      remaining = Math.max(0, remaining - amount);
      schedule.push({ date: dates[idx], amount, remainingAfter: remaining });
    }
    return schedule;
  }

  function dateKey(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function getMonthGrid(monthDate: Date) {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const startOffset = firstDay.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: { date: Date; inCurrentMonth: boolean }[] = [];
    for (let i = 0; i < startOffset; i++) {
      cells.push({ date: new Date(year, month, i - startOffset + 1), inCurrentMonth: false });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ date: new Date(year, month, d), inCurrentMonth: true });
    }
    while (cells.length % 7 !== 0) {
      const last = cells[cells.length - 1].date;
      cells.push({ date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), inCurrentMonth: false });
    }
    return cells;
  }

  const calendarSchedule = calendarLoan ? computeEmployeeSchedule(calendarLoan) : [];
  const scheduleByDate = new Map(calendarSchedule.map(s => [dateKey(s.date), s]));

  const applicantMaxAmount = maxLoanAmount(
    canApprove ? employees.find(e => e.id === form.employee_id)?.position : myEmployee?.position
  );

  const filteredLoans = loans.filter(l => {
    const name = `${l.employees?.first_name ?? ''} ${l.employees?.last_name ?? ''}`.toLowerCase();
    if (search && !name.includes(search.toLowerCase())) return false;
    if (statusFilter !== 'all' && l.status !== statusFilter) return false;
    const appliedDate = l.created_at?.split('T')[0];
    if (appliedFrom && appliedDate < appliedFrom) return false;
    if (appliedTo && appliedDate > appliedTo) return false;
    return true;
  });

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
        <CardContent className="p-4 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search by employee name..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {['pending', 'active', 'approved', 'completed', 'rejected'].map(s => (
                    <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Applied From</Label>
              <Input type="date" value={appliedFrom} onChange={(e) => setAppliedFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Applied To</Label>
              <Input type="date" value={appliedTo} onChange={(e) => setAppliedTo(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card border-border">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : filteredLoans.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Landmark className="w-12 h-12 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">No employee loans found</p>
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
                {filteredLoans.map(l => (
                  <TableRow key={l.id} className="hover:bg-secondary/50 cursor-pointer" onClick={() => router.push(`/employee-loans/${l.id}`)}>
                    <TableCell className="text-sm font-medium">{l.employees?.first_name} {l.employees?.last_name}</TableCell>
                    <TableCell className="text-sm">{formatCurrency(l.amount)}</TableCell>
                    <TableCell className="text-sm">{formatCurrency(l.remaining_balance)}</TableCell>
                    <TableCell className="text-sm">{formatCurrency(l.deduction_amount)}</TableCell>
                    <TableCell className="text-sm">{l.term_months} months</TableCell>
                    <TableCell><Badge variant={statusVariant(l.status)}>{l.status}</Badge></TableCell>
                    <TableCell className="text-sm">{formatDate(l.created_at)}</TableCell>
                    <TableCell className="text-right">
                      {isAdmin && (
                        <div className="flex gap-1 justify-end">
                          <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); openEditLoan(l); }}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setDeleteTarget(l); }}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
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
              <div className="space-y-2">
                <Label>Amount (₱) *</Label>
                <Input type="number" required max={applicantMaxAmount} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder={`Max ${applicantMaxAmount}`} />
                <p className="text-xs text-muted-foreground">Max {formatCurrency(applicantMaxAmount)}{applicantMaxAmount > 15000 ? ' (Branch Manager tier)' : ''}</p>
              </div>
              <div className="space-y-2"><Label>Term (Months)</Label><Input type="number" max="6" value={form.term_months} onChange={(e) => setForm({ ...form, term_months: e.target.value })} /></div>
              <div className="space-y-2 col-span-2">
                <Label>Deduction per Payroll (₱)</Label>
                <Input type="number" value={form.deduction_amount} onChange={(e) => setForm({ ...form, deduction_amount: e.target.value })} placeholder="0.00" />
                {form.amount && <p className="text-xs text-muted-foreground">Max {formatCurrency(Number(form.amount) / 12)} per cutoff (loan amount ÷ 12)</p>}
              </div>
            </div>

            {form.amount && form.deduction_amount && (
              <div className="p-4 rounded-xl bg-secondary/50 border border-border space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium text-primary">
                    <CalendarDays className="w-4 h-4" />
                    Deduction Schedule
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => openCalendar({
                      amount: Number(form.amount),
                      deduction_amount: Number(form.deduction_amount),
                      term_months: Number(form.term_months) || 6,
                      created_at: new Date().toISOString(),
                    })}
                  >
                    <CalendarDays className="w-4 h-4 mr-1.5" />
                    View Calendar
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatCurrency(Number(form.deduction_amount))} deducted every payroll (15th and end of month) — preview the full schedule before submitting.
                </p>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Submit Application</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!calendarLoan} onOpenChange={(open) => !open && setCalendarLoan(null)}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl">Deduction Calendar</DialogTitle>
            <DialogDescription className="text-base">
              {calendarLoan && `${formatCurrency(calendarLoan.deduction_amount)} deducted every payroll (15th and end of month) for ${calendarLoan.term_months} months`}
            </DialogDescription>
          </DialogHeader>

          {calendarSchedule.length > 0 && (
            <p className="text-xs font-medium text-success">
              Fully paid by {formatDate(calendarSchedule[calendarSchedule.length - 1].date.toISOString())} ({calendarSchedule.length} deduction{calendarSchedule.length === 1 ? '' : 's'})
            </p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Details on the left */}
            {calendarLoan && (
              <div className="rounded-xl border border-border overflow-hidden max-h-[420px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Deduction</TableHead>
                      <TableHead>Balance After</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {calendarSchedule.map((s, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-sm">{formatDate(s.date.toISOString())}</TableCell>
                        <TableCell className="text-sm">{formatCurrency(s.amount)}</TableCell>
                        <TableCell className="text-sm font-medium">{formatCurrency(s.remainingAfter)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Calendar on the right */}
            <div className="space-y-3 rounded-xl border border-border p-4">
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><span className="w-3 h-3 rounded-sm bg-primary/10 border border-primary/30" /> Payroll deduction</span>

              <div className="flex items-center justify-between">
                <Button type="button" variant="outline" size="icon" className="h-10 w-10"
                  onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))}>
                  <ChevronLeft className="w-5 h-5" />
                </Button>
                <p className="text-lg font-semibold">
                  {calendarMonth.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}
                </p>
                <Button type="button" variant="outline" size="icon" className="h-10 w-10"
                  onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))}>
                  <ChevronRight className="w-5 h-5" />
                </Button>
              </div>

              <div className="grid grid-cols-7 gap-1.5 text-center">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                  <div key={d} className="text-sm font-medium text-muted-foreground py-1.5">{d}</div>
                ))}
                {getMonthGrid(calendarMonth).map(({ date, inCurrentMonth }, i) => {
                  const info = inCurrentMonth ? scheduleByDate.get(dateKey(date)) : undefined;
                  return (
                    <div
                      key={i}
                      className={`relative rounded-lg py-3 text-sm ${
                        !inCurrentMonth ? 'text-muted-foreground/30' :
                        info ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground'
                      }`}
                    >
                      <p className="text-base">{date.getDate()}</p>
                      {info && <p className="text-xs leading-tight mt-0.5">{formatCurrency(info.amount)}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCalendarLoan(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Employee Loan</DialogTitle>
            <DialogDescription>{editTarget?.employees?.first_name} {editTarget?.employees?.last_name}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditLoan} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Amount (₱)</Label><Input type="number" required value={editForm.amount} onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })} /></div>
              <div className="space-y-2"><Label>Remaining Balance (₱)</Label><Input type="number" value={editForm.remaining_balance} onChange={(e) => setEditForm({ ...editForm, remaining_balance: e.target.value })} /></div>
              <div className="space-y-2">
                <Label>Deduction per Payroll (₱)</Label>
                <Input type="number" value={editForm.deduction_amount} onChange={(e) => setEditForm({ ...editForm, deduction_amount: e.target.value })} />
                {editForm.amount && <p className="text-xs text-muted-foreground">Max {formatCurrency(Number(editForm.amount) / 12)} per cutoff</p>}
              </div>
              <div className="space-y-2"><Label>Term (Months)</Label><Input type="number" value={editForm.term_months} onChange={(e) => setEditForm({ ...editForm, term_months: e.target.value })} /></div>
              <div className="space-y-2 col-span-2">
                <Label>Status</Label>
                <Select value={editForm.status} onValueChange={(v) => setEditForm({ ...editForm, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['pending', 'active', 'approved', 'completed', 'rejected'].map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
              <Button type="submit" disabled={editSaving}>{editSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Employee Loan</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {deleteTarget?.employees?.first_name} {deleteTarget?.employees?.last_name}'s loan of {deleteTarget && formatCurrency(deleteTarget.amount)}? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteLoan} disabled={deleting}>
              {deleting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
