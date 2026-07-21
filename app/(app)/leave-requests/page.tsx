'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
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
import { formatDate } from '@/lib/format';
import { CalendarClock, Plus, Loader2, CheckCircle, XCircle, Search } from 'lucide-react';

// 5 regular leave terms, plus a separate Special Leave category (solo
// parent, VAWC, etc.) with its own +7-day allowance — additive on top of
// the regular annual allowance, tracked in its own bucket.
const LEAVE_TYPES = [
  { value: 'vacation', label: 'Vacation' },
  { value: 'sick', label: 'Sick' },
  { value: 'emergency', label: 'Emergency' },
  { value: 'bereavement', label: 'Bereavement' },
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

  useEffect(() => {
    if (!profile) return;
    load();
    if (canApprove) loadEmployees();
  }, [profile]);

  async function loadEmployees() {
    let q = supabase.from('employees').select('id, first_name, last_name, paid_leaves_used, special_leaves_used, position, branch_id').eq('status', 'active');
    // A Branch Manager can only request/track leave on behalf of their own branch's staff.
    if (isBranchManager && profile?.branch_id) q = q.eq('branch_id', profile.branch_id);
    const { data } = await q;
    setEmployees(data ?? []);
  }

  async function load() {
    setLoading(true);
    const [{ data: emp }, { data: setting }, { data: specialSetting }] = await Promise.all([
      supabase.from('employees').select('id, paid_leaves_used, special_leaves_used, position, branch_id').eq('profile_id', profile?.id ?? '').maybeSingle(),
      supabase.from('settings').select('value').eq('key', 'paid_leaves_annual').maybeSingle(),
      supabase.from('settings').select('value').eq('key', 'special_leaves_annual').maybeSingle(),
    ]);
    setMyEmployee(emp);
    if (setting?.value) setAnnualLeaves(Number(setting.value));
    if (specialSetting?.value) setSpecialLeavesAnnual(Number(specialSetting.value));

    let q = supabase.from('leave_requests').select('*, employees(first_name, last_name, position, branch_id)').order('created_at', { ascending: false });
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

    if (autoApprove) {
      const targetEmployee = employees.find(e => e.id === targetEmployeeId) ?? myEmployee;
      const field = form.leave_type === SPECIAL_LEAVE_TYPE ? 'special_leaves_used' : 'paid_leaves_used';
      const current = form.leave_type === SPECIAL_LEAVE_TYPE ? (targetEmployee?.special_leaves_used ?? 0) : (targetEmployee?.paid_leaves_used ?? 0);
      await supabase.from('employees').update({ [field]: current + days }).eq('id', targetEmployeeId);
    }

    toast({ title: 'Success', description: autoApprove ? 'Leave request added and approved' : 'Leave request submitted' });
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

    if (status === 'approved') {
      const field = request.leave_type === SPECIAL_LEAVE_TYPE ? 'special_leaves_used' : 'paid_leaves_used';
      const { data: emp } = await supabase.from('employees').select(field).eq('id', request.employee_id).maybeSingle();
      const current = (emp as any)?.[field] ?? 0;
      await supabase.from('employees').update({ [field]: current + request.days }).eq('id', request.employee_id);
    }

    toast({ title: 'Success', description: `Leave request ${status}` });
    load();
  }

  const balance = annualLeaves - (myEmployee?.paid_leaves_used ?? 0);
  const specialBalance = specialLeavesAnnual - (myEmployee?.special_leaves_used ?? 0);
  const statusVariant = (s: string) => s === 'approved' ? 'default' : s === 'rejected' ? 'destructive' : 'outline';

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
        <Button size="sm" onClick={openRequest} disabled={!canApprove && !myEmployee}>
          <Plus className="w-4 h-4 mr-2" />
          Request Leave
        </Button>
      </PageHeader>

      {myEmployee && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard title="Annual Paid Leaves" value={annualLeaves.toString()} icon={<CalendarClock className="w-5 h-5" />} />
            <StatCard title="Used" value={(myEmployee.paid_leaves_used ?? 0).toString()} icon={<CalendarClock className="w-5 h-5" />} variant="warning" />
            <StatCard title="Remaining Balance" value={balance.toString()} icon={<CalendarClock className="w-5 h-5" />} variant={balance > 0 ? 'success' : 'danger'} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard title="Special Leave Allowance" value={specialLeavesAnnual.toString()} icon={<CalendarClock className="w-5 h-5" />} />
            <StatCard title="Special Leave Used" value={(myEmployee.special_leaves_used ?? 0).toString()} icon={<CalendarClock className="w-5 h-5" />} variant="warning" />
            <StatCard title="Special Leave Remaining" value={specialBalance.toString()} icon={<CalendarClock className="w-5 h-5" />} variant={specialBalance > 0 ? 'success' : 'danger'} />
          </div>
        </>
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
            <Table>
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
                        {r.status === 'pending' && (
                          canApproveRequest(r) ? (
                            <div className="flex gap-1 justify-end">
                              <Button variant="ghost" size="icon" onClick={() => updateStatus(r, 'approved')}><CheckCircle className="w-4 h-4 text-success" /></Button>
                              <Button variant="ghost" size="icon" onClick={() => updateStatus(r, 'rejected')}><XCircle className="w-4 h-4 text-destructive" /></Button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">Pending Admin approval</span>
                          )
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
                  <SelectContent>{employees.map(e => <SelectItem key={e.id} value={e.id}>{e.first_name} {e.last_name}</SelectItem>)}</SelectContent>
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
            <div className="grid grid-cols-2 gap-4">
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
    </div>
  );
}
