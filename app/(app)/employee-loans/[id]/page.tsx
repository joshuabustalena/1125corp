'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency, formatDate } from '@/lib/format';
import {
  ArrowLeft, Landmark, User, CheckCircle, XCircle, CalendarDays, ChevronLeft, ChevronRight, Loader2, AlertTriangle,
} from 'lucide-react';

function maxLoanAmount(position: string | null | undefined) {
  return position === 'Branch Manager' ? 20000 : 15000;
}

export default function EmployeeLoanDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const { profile } = useAuth();
  const isAdmin = profile?.role_name === 'Administrator';
  const isBranchManager = profile?.role_name === 'Branch Manager';
  const [loan, setLoan] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [approveOpen, setApproveOpen] = useState(false);
  const [approving, setApproving] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);

  useEffect(() => { load(); }, [params.id]);

  async function load() {
    setLoading(true);
    const id = params.id as string;
    const { data } = await supabase
      .from('employee_loans')
      .select('*, employees(first_name, last_name, department, position, phone, email, branch_id, branches(name)), approved_by_profile:profiles!approved_by(full_name)')
      .eq('id', id)
      .maybeSingle();
    setLoan(data);
    if (data) {
      const start = new Date(data.approved_at ?? data.created_at);
      setCalendarMonth(new Date(start.getFullYear(), start.getMonth(), 1));
    }
    setLoading(false);
  }

  async function handleApprove() {
    setApproving(true);
    const { error } = await supabase.from('employee_loans').update({ status: 'active', approved_at: new Date().toISOString() }).eq('id', loan.id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Loan approved' });
      setApproveOpen(false);
      load();
    }
    setApproving(false);
  }

  async function handleReject() {
    if (!rejectReason.trim()) return;
    setRejecting(true);
    const { error } = await supabase.from('employee_loans').update({
      status: 'rejected',
      approved_at: new Date().toISOString(),
      decline_reason: rejectReason.trim(),
    }).eq('id', loan.id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Loan rejected' });
      setRejectOpen(false);
      setRejectReason('');
      load();
    }
    setRejecting(false);
  }

  const statusVariant = (s: string) => s === 'active' ? 'default' : s === 'pending' ? 'outline' : s === 'rejected' ? 'destructive' : 'secondary';

  // Semi-monthly payroll deduction: the 15th and the last day of the month,
  // twice a month, for the loan's term. The final deduction absorbs whatever
  // balance is left over. Stops as soon as the balance hits zero instead of
  // continuing to list ₱0.00 deductions for the rest of the term.
  function computeSchedule() {
    if (!loan) return [];
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

  const schedule = computeSchedule();
  const scheduleByDate = new Map(schedule.map(s => [dateKey(s.date), s]));

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
  }
  if (!loan) {
    return <p className="text-center text-muted-foreground py-16">Employee loan not found</p>;
  }

  // A Branch Manager approves their own branch's staff loans, but a loan
  // where the applicant IS a Branch Manager always requires Administrator
  // approval instead — avoids a Manager approving their own or a peer's loan.
  const applicantMaxLoan = maxLoanAmount(loan.employees?.position);
  const canApprove = isAdmin || (
    isBranchManager &&
    loan.employees?.position !== 'Branch Manager' &&
    loan.employees?.branch_id === profile?.branch_id
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${loan.employees?.first_name ?? ''} ${loan.employees?.last_name ?? ''}`.trim() || 'Employee Loan'}
        description="Employee loan details and deduction schedule"
      >
        <Button variant="outline" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        {loan.status === 'pending' && canApprove && (
          <>
            <Button size="sm" onClick={() => setApproveOpen(true)}>
              <CheckCircle className="w-4 h-4 mr-2" />
              Approve
            </Button>
            <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setRejectOpen(true)}>
              <XCircle className="w-4 h-4 mr-2" />
              Reject
            </Button>
          </>
        )}
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="glass-card border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Landmark className="w-5 h-5 text-primary" />
              Loan Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Status:</span>
              <Badge variant={statusVariant(loan.status)}>{loan.status}</Badge>
            </div>
            {loan.status === 'rejected' && loan.decline_reason && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                <p className="text-xs font-medium text-destructive mb-1">Reason for rejection</p>
                <p className="text-sm">{loan.decline_reason}</p>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Amount:</span>
              <span className="font-medium">{formatCurrency(loan.amount)}</span>
            </div>
            <div className="flex justify-between text-sm pt-2 border-t border-border">
              <span className="text-muted-foreground">Remaining Balance:</span>
              <span className="font-bold text-destructive">{formatCurrency(loan.remaining_balance)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Deduction per Payroll:</span>
              <span className="font-medium">{formatCurrency(loan.deduction_amount)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Term:</span>
              <span>{loan.term_months} months</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Applied:</span>
              <span>{formatDate(loan.created_at)}</span>
            </div>
            {loan.approved_at && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{loan.status === 'rejected' ? 'Rejected' : 'Approved'}:</span>
                <span>{formatDate(loan.approved_at)}</span>
              </div>
            )}
            {loan.approved_by_profile?.full_name && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">By:</span>
                <span>{loan.approved_by_profile.full_name}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="glass-card border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="w-5 h-5 text-primary" />
              Employee
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Name:</span>
              <span className="font-medium">{loan.employees?.first_name} {loan.employees?.last_name}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Position:</span>
              <span>{loan.employees?.position ?? '—'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Department:</span>
              <span>{loan.employees?.department ?? '—'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Branch:</span>
              <span>{loan.employees?.branches?.name ?? '—'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Phone:</span>
              <span>{loan.employees?.phone ?? '—'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Email:</span>
              <span>{loan.employees?.email ?? '—'}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {loan.status !== 'rejected' && (
        <Card className="glass-card border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="w-5 h-5 text-primary" />
              Deduction Calendar
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {formatCurrency(loan.deduction_amount)} deducted every payroll (15th and end of month) for {loan.term_months} months
            </p>
            {schedule.length > 0 && (
              <p className="text-xs font-medium text-success">
                Fully paid by {formatDate(schedule[schedule.length - 1].date.toISOString())} ({schedule.length} deduction{schedule.length === 1 ? '' : 's'})
              </p>
            )}
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                    {schedule.map((s, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-sm">{formatDate(s.date.toISOString())}</TableCell>
                        <TableCell className="text-sm">{formatCurrency(s.amount)}</TableCell>
                        <TableCell className="text-sm font-medium">{formatCurrency(s.remainingAfter)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

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
          </CardContent>
        </Card>
      )}

      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Employee Loan</DialogTitle>
            <DialogDescription>
              Approve {formatCurrency(loan.amount)} for {loan.employees?.first_name} {loan.employees?.last_name}? This will activate the loan and begin the deduction schedule.
            </DialogDescription>
          </DialogHeader>
          {Number(loan.amount) > applicantMaxLoan && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-warning/10 border border-warning/20">
              <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
              <p className="text-sm">
                This loan ({formatCurrency(loan.amount)}) exceeds the maximum employee loan limit of {formatCurrency(applicantMaxLoan)}.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveOpen(false)}>Cancel</Button>
            <Button onClick={handleApprove} disabled={approving}>
              {approving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={(open) => { setRejectOpen(open); if (!open) setRejectReason(''); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Employee Loan</DialogTitle>
            <DialogDescription>
              Reject {formatCurrency(loan.amount)} for {loan.employees?.first_name} {loan.employees?.last_name}. Please provide a reason.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-reason">Reason for rejection *</Label>
            <Textarea
              id="reject-reason"
              required
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. Already has 2 active loans, insufficient tenure, etc."
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleReject} disabled={rejecting || !rejectReason.trim()}>
              {rejecting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
