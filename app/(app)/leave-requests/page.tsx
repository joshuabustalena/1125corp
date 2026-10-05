'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { StatCard } from '@/components/dashboard/stat-card';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { formatDate, formatCustomerName, exportToCSV } from '@/lib/format';
import { notifyRoles, notifyProfile } from '@/lib/notify';
import { logAudit } from '@/lib/audit-log';
import { CalendarClock, Plus, Loader2, CheckCircle, XCircle, Search, Trash2, RotateCcw, Download } from 'lucide-react';

// 5 regular leave terms, plus a separate Special Leave category (solo
// parent, VAWC, etc.) with its own +7-day allowance — additive on top of
// the regular annual allowance, tracked in its own bucket.
const LEAVE_TYPES = [
  { value: 'vacation', label: 'Vacation' },
  { value: 'emergency', label: 'Emergency' },
  { value: 'paternity', label: 'Paternity' },
  { value: 'maternity', label: 'Maternity' },
  { value: 'other', label: 'Other' },
];
const SPECIAL_LEAVE_TYPE = 'special';

export default function LeaveRequestsPage() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const canApprove = profile?.role_name === 'Administrator' || profile?.role_name === 'Branch Manager';
  const isAdmin = profile?.role_name === 'Administrator';
  const isBranchManager = profile?.role_name === 'Branch Manager';
  const [loading, setLoading] = useState(true);
  const [myEmployee, setMyEmployee] = useState<{ id: string; paid_leaves_used: number; special_leaves_used?: number; position?: string | null; branch_id?: string | null } | null>(null);
  const [annualLeaves, setAnnualLeaves] = useState(5);
  const [specialLeavesAnnual, setSpecialLeavesAnnual] = useState(7);
  const [requests, setRequests] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ employee_id: '', leave_type: 'vacation', start_date: '', end_date: '', reason: '' });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [appliedFrom, setAppliedFrom] = useState('');
  const [appliedTo, setAppliedTo] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [resetLeavesOpen, setResetLeavesOpen] = useState(false);
  const [resettingLeaves, setResettingLeaves] = useState(false);
  const [balanceSearch, setBalanceSearch] = useState('');

  useEffect(() => {
    if (!profile) return;
    load();
  }, [profile]);

  async function loadEmployees() {
    let q = supabase.from('employees').select('id, first_name, last_name, paid_leaves_used, special_leaves_used, position, branch_id, branches(name)').eq('status', 'active').order('last_name').order('first_name');
    // A Branch Manager can only request/track leave on behalf of their own branch's staff.
    if (isBranchManager && profile?.branch_id) q = q.eq('branch_id', profile.branch_id);
    const { data } = await q;
    setEmployees(data ?? []);
  }

  async function load() {
    setLoading(true);
    // Every approve/delete/reset ends in load(), so refreshing the employee
    // list here keeps the balances table (and the request form's "remaining
    // after this request" hint) current instead of frozen at page open.
    if (canApprove) loadEmployees();
    const [{ data: emp }, { data: setting }, { data: specialSetting }] = await Promise.all([
      supabase.from('employees').select('id, paid_leaves_used, special_leaves_used, position, branch_id').eq('profile_id', profile?.id ?? '').maybeSingle(),
      supabase.from('settings').select('value').eq('key', 'paid_leaves_annual').maybeSingle(),
      supabase.from('settings').select('value').eq('key', 'special_leaves_annual').maybeSingle(),
    ]);
    setMyEmployee(emp);
    if (setting?.value) setAnnualLeaves(Number(setting.value));
    if (specialSetting?.value) setSpecialLeavesAnnual(Number(specialSetting.value));

    let q = supabase.from('leave_requests').select('*, employees(first_name, last_name, position, branch_id, profile_id)').order('created_at', { ascending: false });
    if (!canApprove) {
      q = q.eq('employee_id', emp?.id ?? '00000000-0000-0000-0000-000000000000');
    }
    const { data } = await q;
    // A Branch Manager only sees their own branch's requests — a Manager-tier
    // applicant's own leave still requires Administrator approval (handled
    // per-row below), but the list itself is branch-scoped here.
    const scoped = isBranchManager && profile?.branch_id
      ? (data ?? []).filter((r: any) => r.employees?.branch_id === profile.branch_id)
      : (data ?? []);
    setRequests(scoped);
    setLoading(false);
  }

  // Atomic, server-side change to the employee's used-days counter (see
  // supabase/add_adjust_leave_balance.sql). A plain UPDATE from here only
  // ever worked for Administrators, so Branch Manager approvals silently
  // never deducted anything.
  async function adjustLeaveBalance(employeeId: string, leaveType: string, days: number) {
    const { error } = await supabase.rpc('adjust_leave_balance', {
      p_employee_id: employeeId,
      p_bucket: leaveType === SPECIAL_LEAVE_TYPE ? 'special' : 'paid',
      p_days: days,
    });
    return error;
  }

  function canApproveRequest(r: any): boolean {
    if (isAdmin) return true;
    if (!isBranchManager) return false;
    return r.employees?.position !== 'Branch Manager' && r.employees?.branch_id === profile?.branch_id;
  }

  function openRequest() {
    setForm({ employee_id: canApprove ? '' : (myEmployee?.id ?? ''), leave_type: 'vacation', start_date: '', end_date: '', reason: '' });
    setDialogOpen(true);
  }

  const days = form.start_date && form.end_date
    ? Math.max(0, Math.round((new Date(form.end_date).getTime() - new Date(form.start_date).getTime()) / 86400000) + 1)
    : 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const targetEmployeeId = canApprove ? form.employee_id : myEmployee?.id;
    if (!targetEmployeeId || !form.start_date || !form.end_date || days <= 0) return;
    setSaving(true);

    // An Administrator creating a leave request directly (e.g. logging
    // approved time off on an employee's behalf) doesn't need to route it
    // through a separate approval step — it's auto-approved on creation,
    // same as if it had already gone through updateStatus('approved').
    const autoApprove = isAdmin;
    const { error } = await supabase.from('leave_requests').insert({
      employee_id: targetEmployeeId,
      leave_type: form.leave_type,
      start_date: form.start_date,
      end_date: form.end_date,
      days,
      reason: form.reason || null,
      status: autoApprove ? 'approved' : 'pending',
      approved_by: autoApprove ? (profile?.id ?? null) : null,
      approved_at: autoApprove ? new Date().toISOString() : null,
    });

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      setSaving(false);
      return;
    }

    const targetEmployee = employees.find(e => e.id === targetEmployeeId) ?? myEmployee;
    let balanceError: { message: string } | null = null;
    if (autoApprove) {
      balanceError = await adjustLeaveBalance(targetEmployeeId, form.leave_type, days);
    } else {
      const employeeName = (targetEmployee as any)?.first_name ? `${(targetEmployee as any).first_name} ${(targetEmployee as any).last_name}` : (profile?.full_name ?? 'An employee');
      notifyRoles(['branch_manager', 'administrator'], {
        type: 'leave_request_pending',
        title: 'New Leave Request',
        message: `${employeeName} requested ${days} day(s) of ${form.leave_type} leave — pending approval.`,
        url: '/leave-requests',
      }, (targetEmployee as any)?.branch_id);
    }

    // Only one toast shows at a time, so a balance failure replaces the
    // success message rather than following it.
    if (balanceError) {
      toast({ title: 'Leave added, but balance not updated', description: balanceError.message, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: autoApprove ? 'Leave request added and approved' : 'Leave request submitted' });
    }
    setDialogOpen(false);
    load();
    setSaving(false);
  }

  async function updateStatus(request: any, status: 'approved' | 'rejected') {
    const { error } = await supabase.from('leave_requests').update({
      status,
      approved_by: profile?.id ?? null,
      approved_at: new Date().toISOString(),
    }).eq('id', request.id);

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }

    const balanceError = status === 'approved'
      ? await adjustLeaveBalance(request.employee_id, request.leave_type, Number(request.days) || 0)
      : null;

    notifyProfile(request.employees?.profile_id, {
      type: 'leave_request_reviewed',
      title: status === 'approved' ? 'Leave Request Approved' : 'Leave Request Rejected',
      message: `Your ${request.leave_type} leave request (${formatDate(request.start_date)} – ${formatDate(request.end_date)}) was ${status}.`,
      url: '/leave-requests',
      recipientName: `${request.employees?.first_name ?? ''} ${request.employees?.last_name ?? ''}`.trim(),
    });

    if (balanceError) {
      toast({ title: 'Approved, but balance not updated', description: balanceError.message, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: `Leave request ${status}` });
    }
    logAudit({ action: status === 'approved' ? 'approve' : 'reject', entityType: 'leave_requests', entityId: request.id, userId: profile?.id ?? null });
    load();
  }

  // Deleting an approved request must give the days it consumed back to
  // the employee's balance — otherwise the balance stays permanently
  // reduced for a leave that, as far as the record's concerned, never
  // happened. A pending/rejected request never touched the balance in the
  // first place, so deleting one of those just removes the row.
  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    if (deleteTarget.status === 'approved') {
      // Restore first and stop if it fails — deleting the request anyway
      // would leave those days deducted with no record of why.
      const balanceError = await adjustLeaveBalance(deleteTarget.employee_id, deleteTarget.leave_type, -(Number(deleteTarget.days) || 0));
      if (balanceError) {
        toast({ title: 'Not deleted', description: `Could not restore the leave balance: ${balanceError.message}`, variant: 'destructive' });
        setDeleting(false);
        return;
      }
    }
    const { error } = await supabase.from('leave_requests').delete().eq('id', deleteTarget.id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Leave request deleted', description: deleteTarget.status === 'approved' ? 'The leave balance it used has been restored.' : undefined });
      load();
    }
    setDeleteTarget(null);
    setDeleting(false);
  }

  // Year-end (or whenever the client decides) bulk reset — zeroes both
  // leave buckets for every active employee, same as if their allotment
  // just renewed. Approved leave_requests rows are left alone (they're a
  // historical record of what was taken), only the running "used" counters
  // reset.
  async function handleResetLeaveBalances() {
    setResettingLeaves(true);
    const { error } = await supabase
      .from('employees')
      .update({ paid_leaves_used: 0, special_leaves_used: 0 })
      .eq('status', 'active');
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Leave balances reset', description: 'Every active employee’s leave balance is now back to the full annual allowance.' });
      load();
    }
    setResetLeavesOpen(false);
    setResettingLeaves(false);
  }

  const balance = annualLeaves - (myEmployee?.paid_leaves_used ?? 0);
  const specialBalance = specialLeavesAnnual - (myEmployee?.special_leaves_used ?? 0);
  const statusVariant = (s: string) => s === 'approved' ? 'default' : s === 'rejected' ? 'destructive' : 'outline';

  // Leave balance monitoring (Kat, Oct 2026): every active employee's
  // allowance, used and remaining days in one table, plus days still waiting
  // on approval — which haven't touched the balance yet but will if approved.
  const pendingDaysByEmployee = new Map<string, number>();
  for (const r of requests) {
    if (r.status !== 'pending') continue;
    const key = `${r.employee_id}|${r.leave_type === SPECIAL_LEAVE_TYPE ? 'special' : 'paid'}`;
    pendingDaysByEmployee.set(key, (pendingDaysByEmployee.get(key) ?? 0) + (Number(r.days) || 0));
  }
  const balanceRows = employees
    .filter(e => !balanceSearch || `${e.first_name} ${e.last_name}`.toLowerCase().includes(balanceSearch.toLowerCase()))
    .map(e => {
      const paidUsed = Number(e.paid_leaves_used) || 0;
      const specialUsed = Number(e.special_leaves_used) || 0;
      return {
        id: e.id,
        name: formatCustomerName(e.first_name, e.last_name),
        branch: e.branches?.name ?? '—',
        position: e.position ?? '—',
        paidUsed,
        paidRemaining: annualLeaves - paidUsed,
        paidPending: pendingDaysByEmployee.get(`${e.id}|paid`) ?? 0,
        specialUsed,
        specialRemaining: specialLeavesAnnual - specialUsed,
        specialPending: pendingDaysByEmployee.get(`${e.id}|special`) ?? 0,
      };
    });

  function handleExportBalances() {
    exportToCSV(balanceRows.map(b => ({
      Employee: b.name, Branch: b.branch, Position: b.position,
      PaidLeaveAllowance: annualLeaves, PaidLeaveUsed: b.paidUsed, PaidLeaveRemaining: b.paidRemaining, PaidLeavePending: b.paidPending,
      SpecialLeaveAllowance: specialLeavesAnnual, SpecialLeaveUsed: b.specialUsed, SpecialLeaveRemaining: b.specialRemaining, SpecialLeavePending: b.specialPending,
    })), 'leave-balances.csv');
  }

  const remainingClass = (n: number) => (n <= 0 ? 'text-destructive font-semibold' : 'text-success font-semibold');

  const filteredRequests = requests.filter(r => {
    const name = `${r.employees?.first_name ?? ''} ${r.employees?.last_name ?? ''}`.toLowerCase();
    if (search && !name.includes(search.toLowerCase())) return false;
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    const appliedDate = r.created_at?.split('T')[0];
    if (appliedFrom && appliedDate < appliedFrom) return false;
    if (appliedTo && appliedDate > appliedTo) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Leave Requests" description="Request time off and check your leave balance">
        {isAdmin && (
          <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setResetLeavesOpen(true)}>
            <RotateCcw className="w-4 h-4 mr-2" />
            Reset Leave Balances
          </Button>
        )}
        <Button size="sm" onClick={openRequest} disabled={!canApprove && !myEmployee}>
          <Plus className="w-4 h-4 mr-2" />
          Request Leave
        </Button>
      </PageHeader>

      {myEmployee && (
        <>
          <div className="grid grid-cols-3 gap-2 sm:gap-4">
            <StatCard title="Annual Paid Leaves" value={annualLeaves.toString()} icon={<CalendarClock className="w-5 h-5" />} />
            <StatCard title="Used" value={(myEmployee.paid_leaves_used ?? 0).toString()} icon={<CalendarClock className="w-5 h-5" />} variant="warning" />
            <StatCard title="Remaining Balance" value={balance.toString()} icon={<CalendarClock className="w-5 h-5" />} variant={balance > 0 ? 'success' : 'danger'} />
          </div>
          <div className="grid grid-cols-3 gap-2 sm:gap-4">
            <StatCard title="Special Leave Allowance" value={specialLeavesAnnual.toString()} icon={<CalendarClock className="w-5 h-5" />} />
            <StatCard title="Special Leave Used" value={(myEmployee.special_leaves_used ?? 0).toString()} icon={<CalendarClock className="w-5 h-5" />} variant="warning" />
            <StatCard title="Special Leave Remaining" value={specialBalance.toString()} icon={<CalendarClock className="w-5 h-5" />} variant={specialBalance > 0 ? 'success' : 'danger'} />
          </div>
        </>
      )}

      {canApprove && (
        <Card className="glass-card border-border">
          <CardHeader className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div>
                <CardTitle>Leave Balances</CardTitle>
                <CardDescription>
                  {isBranchManager ? 'Your branch' : 'All active employees'} · {annualLeaves} paid leave day{annualLeaves !== 1 ? 's' : ''} and {specialLeavesAnnual} special leave day{specialLeavesAnnual !== 1 ? 's' : ''} per year
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={handleExportBalances} disabled={balanceRows.length === 0}>
                <Download className="w-4 h-4 mr-2" />Export
              </Button>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search employee..." value={balanceSearch} onChange={(e) => setBalanceSearch(e.target.value)} className="pl-10" />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {balanceRows.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No employees found</p>
            ) : (
              <>
                {/* Mobile card list */}
                <div className="md:hidden divide-y divide-border max-h-[28rem] overflow-y-auto">
                  {balanceRows.map(b => (
                    <div key={b.id} className="p-4">
                      <p className="font-medium text-sm">{b.name}</p>
                      <p className="text-xs text-muted-foreground">{b.position} · {b.branch}</p>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <p className="text-xs text-muted-foreground">Paid Leave</p>
                          <p><span className={remainingClass(b.paidRemaining)}>{b.paidRemaining} left</span> · {b.paidUsed} used</p>
                          {b.paidPending > 0 && <p className="text-xs text-warning">{b.paidPending} pending</p>}
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Special Leave</p>
                          <p><span className={remainingClass(b.specialRemaining)}>{b.specialRemaining} left</span> · {b.specialUsed} used</p>
                          {b.specialPending > 0 && <p className="text-xs text-warning">{b.specialPending} pending</p>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="hidden md:block max-h-[28rem] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead>
                        <TableHead>Branch</TableHead>
                        <TableHead className="text-center">Paid Used</TableHead>
                        <TableHead className="text-center">Paid Remaining</TableHead>
                        <TableHead className="text-center">Special Used</TableHead>
                        <TableHead className="text-center">Special Remaining</TableHead>
                        <TableHead className="text-center">Pending</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {balanceRows.map(b => (
                        <TableRow key={b.id}>
                          <TableCell className="text-sm">
                            <p className="font-medium">{b.name}</p>
                            <p className="text-xs text-muted-foreground">{b.position}</p>
                          </TableCell>
                          <TableCell className="text-sm">{b.branch}</TableCell>
                          <TableCell className="text-sm text-center">{b.paidUsed} / {annualLeaves}</TableCell>
                          <TableCell className={`text-sm text-center ${remainingClass(b.paidRemaining)}`}>{b.paidRemaining}</TableCell>
                          <TableCell className="text-sm text-center">{b.specialUsed} / {specialLeavesAnnual}</TableCell>
                          <TableCell className={`text-sm text-center ${remainingClass(b.specialRemaining)}`}>{b.specialRemaining}</TableCell>
                          <TableCell className="text-sm text-center">
                            {b.paidPending + b.specialPending > 0
                              ? <span className="text-warning">{b.paidPending + b.specialPending} day{b.paidPending + b.specialPending !== 1 ? 's' : ''}</span>
                              : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

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
                  {['pending', 'approved', 'rejected'].map(s => (
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
          ) : filteredRequests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <CalendarClock className="w-12 h-12 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">No leave requests found</p>
            </div>
          ) : (
            <>
              {/* Mobile card list */}
              <div className="md:hidden divide-y divide-border">
                {filteredRequests.map(r => (
                  <div key={r.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        {canApprove && <p className="font-medium text-sm truncate">{r.employees?.first_name} {r.employees?.last_name}</p>}
                        <p className="text-sm capitalize">{r.leave_type}</p>
                      </div>
                      <Badge variant={statusVariant(r.status)} className="shrink-0">{r.status}</Badge>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                      <div><p className="text-xs text-muted-foreground">Start</p><p>{formatDate(r.start_date)}</p></div>
                      <div><p className="text-xs text-muted-foreground">End</p><p>{formatDate(r.end_date)}</p></div>
                      <div><p className="text-xs text-muted-foreground">Days</p><p>{r.days}</p></div>
                      <div className="col-span-2"><p className="text-xs text-muted-foreground">Reason</p><p>{r.reason ?? '—'}</p></div>
                    </div>
                    <div className="mt-3 flex items-center justify-end gap-1">
                      {canApprove && r.status === 'pending' && (
                        canApproveRequest(r) ? (
                          <div className="flex gap-1">
                            <Button variant="outline" size="sm" onClick={() => updateStatus(r, 'approved')}><CheckCircle className="w-3.5 h-3.5 mr-1.5 text-success" />Approve</Button>
                            <Button variant="outline" size="sm" onClick={() => updateStatus(r, 'rejected')}><XCircle className="w-3.5 h-3.5 mr-1.5 text-destructive" />Reject</Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">Pending Admin approval</span>
                        )
                      )}
                      {isAdmin && (
                        <Button variant="ghost" size="icon" title="Delete" onClick={() => setDeleteTarget(r)}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <Table className="hidden md:table">
                <TableHeader>
                  <TableRow>
                    {canApprove && <TableHead>Employee</TableHead>}
                    <TableHead>Type</TableHead>
                    <TableHead>Start</TableHead>
                    <TableHead>End</TableHead>
                    <TableHead>Days</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Status</TableHead>
                    {canApprove && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRequests.map(r => (
                    <TableRow key={r.id} className="hover:bg-secondary/50">
                      {canApprove && <TableCell className="text-sm font-medium">{r.employees?.first_name} {r.employees?.last_name}</TableCell>}
                      <TableCell className="text-sm capitalize">{r.leave_type}</TableCell>
                      <TableCell className="text-sm">{formatDate(r.start_date)}</TableCell>
                      <TableCell className="text-sm">{formatDate(r.end_date)}</TableCell>
                      <TableCell className="text-sm">{r.days}</TableCell>
                      <TableCell className="text-sm">{r.reason ?? '—'}</TableCell>
                      <TableCell><Badge variant={statusVariant(r.status)}>{r.status}</Badge></TableCell>
                      {canApprove && (
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end items-center">
                            {r.status === 'pending' && (
                              canApproveRequest(r) ? (
                                <>
                                  <Button variant="ghost" size="icon" onClick={() => updateStatus(r, 'approved')}><CheckCircle className="w-4 h-4 text-success" /></Button>
                                  <Button variant="ghost" size="icon" onClick={() => updateStatus(r, 'rejected')}><XCircle className="w-4 h-4 text-destructive" /></Button>
                                </>
                              ) : (
                                <span className="text-xs text-muted-foreground">Pending Admin approval</span>
                              )
                            )}
                            {isAdmin && (
                              <Button variant="ghost" size="icon" title="Delete" onClick={() => setDeleteTarget(r)}>
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Leave</DialogTitle>
            <DialogDescription>
              {isAdmin ? 'Add a leave request — this will be auto-approved immediately' : 'Submit a leave request for Branch Manager approval'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {canApprove && (
              <div className="space-y-2">
                <Label>Employee *</Label>
                <Select value={form.employee_id} onValueChange={(v) => setForm({ ...form, employee_id: v })} required>
                  <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>{employees.map(e => <SelectItem key={e.id} value={e.id}>{formatCustomerName(e.first_name, e.last_name)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>Leave Type</Label>
              <Select value={form.leave_type} onValueChange={(v) => setForm({ ...form, leave_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LEAVE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  <SelectItem value={SPECIAL_LEAVE_TYPE}>Special Leave (solo parent, VAWC, etc.)</SelectItem>
                </SelectContent>
              </Select>
              {form.leave_type === SPECIAL_LEAVE_TYPE && (
                <p className="text-xs text-muted-foreground">Uses the separate +{specialLeavesAnnual}-day special leave allowance, on top of the regular annual leave balance. Please specify the qualifying reason below.</p>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Date *</Label>
                <Input type="date" required value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>End Date *</Label>
                <Input type="date" required value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
              </div>
            </div>
            {days > 0 && (() => {
              const target = canApprove ? employees.find(e => e.id === form.employee_id) : myEmployee;
              const isSpecial = form.leave_type === SPECIAL_LEAVE_TYPE;
              const targetBalance = target
                ? (isSpecial ? specialLeavesAnnual - (target.special_leaves_used ?? 0) : annualLeaves - (target.paid_leaves_used ?? 0))
                : null;
              return (
                <p className="text-sm text-muted-foreground">
                  {days} day{days !== 1 ? 's' : ''}{targetBalance !== null ? ` — remaining ${isSpecial ? 'special leave' : ''} balance after this request: ${targetBalance - days}` : ''}
                </p>
              );
            })()}
            <div className="space-y-2">
              <Label>Reason</Label>
              <Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} rows={3} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving || days <= 0 || (canApprove && !form.employee_id)}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {isAdmin ? 'Add & Approve' : 'Submit Request'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Leave Request</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this leave request?
              {deleteTarget?.status === 'approved' && ` This will restore the ${deleteTarget?.days} day(s) it used back to the employee's leave balance.`}
              {' '}This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset leave balances confirmation */}
      <Dialog open={resetLeavesOpen} onOpenChange={setResetLeavesOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Leave Balances</DialogTitle>
            <DialogDescription>
              This sets both the Paid Leave and Special Leave "used" counters back to 0 for every active employee, company-wide — as if their annual allowance just renewed. Past leave request records are not affected, only the running balance. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetLeavesOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleResetLeaveBalances} disabled={resettingLeaves}>
              {resettingLeaves && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Reset All Balances
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
