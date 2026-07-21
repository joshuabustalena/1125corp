'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency, formatDate, exportToCSV } from '@/lib/format';
import { COMPANY_NAME, getDocumentBranding } from '@/lib/document-branding';
import { ScrollText, Download, Loader2, Calculator, CheckCircle, Trash2, Receipt, Printer } from 'lucide-react';

// Semi-monthly period boundaries: the "15" period covers the 1st–15th of
// the pay date's month, "30" covers the 16th through the month's actual
// last day (30th or 31st).
function pad(n: number) { return String(n).padStart(2, '0'); }
function toDateStr(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function getPeriodRange(payDateStr: string, period: string) {
  const payDate = new Date(payDateStr);
  const year = payDate.getFullYear();
  const month = payDate.getMonth();
  if (period === '15') {
    return { start: toDateStr(new Date(year, month, 1)), end: toDateStr(new Date(year, month, 15)) };
  }
  return { start: toDateStr(new Date(year, month, 16)), end: toDateStr(new Date(year, month + 1, 0)) };
}
// Working days exclude Sundays, matching the "collection days" convention
// used elsewhere in the app for daily-payment schedules.
function countWorkingDays(startStr: string, endStr: string) {
  const start = new Date(startStr);
  const end = new Date(endStr);
  let count = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (d.getDay() !== 0) count++;
  }
  return count;
}

// If the employee's birthday (month/day, any birth year) falls somewhere
// inside this pay period, returns that exact date ('YYYY-MM-DD') so callers
// can check attendance on that specific day. Otherwise null.
function getBirthdayInPeriod(birthDate: string | null | undefined, startStr: string, endStr: string): string | null {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  const start = new Date(startStr);
  const end = new Date(endStr);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (d.getMonth() === birth.getMonth() && d.getDate() === birth.getDate()) return toDateStr(d);
  }
  return null;
}

export default function PayrollPage() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const isAdmin = profile?.role_name === 'Administrator';
  const [payroll, setPayroll] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [period, setPeriod] = useState('15');
  const [payDate, setPayDate] = useState(new Date().toISOString().split('T')[0]);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [deleting, setDeleting] = useState(false);
  const [payslipTarget, setPayslipTarget] = useState<any>(null);
  const [printingPayslip, setPrintingPayslip] = useState(false);
  const [downloadingPayslip, setDownloadingPayslip] = useState(false);
  const payslipRef = useRef<HTMLDivElement>(null);

  useEffect(() => { load(); loadEmployees(); }, []);

  async function loadEmployees() {
    const { data } = await supabase.from('employees').select('id, first_name, last_name, salary, pay_type, status, birth_date, branches(name)').eq('status', 'active');
    setEmployees(data ?? []);
  }

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('payroll').select('*, employees(first_name, last_name, position, department, branches(name))').order('pay_date', { ascending: false });
    setPayroll(data ?? []);

    const employeeIds = Array.from(new Set((data ?? []).map(p => p.employee_id)));
    if (employeeIds.length > 0) {
      const { data: att } = await supabase.from('attendance').select('employee_id, date, status, review_status').in('employee_id', employeeIds);
      setAttendanceRecords(att ?? []);
    } else {
      setAttendanceRecords([]);
    }
    setLoading(false);
  }

  function daysPresent(p: any) {
    const { start, end } = getPeriodRange(p.pay_date, p.period);
    const attendancePresent = attendanceRecords.filter(a =>
      a.employee_id === p.employee_id && a.date >= start && a.date <= end &&
      (a.status === 'present' || a.status === 'late') && a.review_status !== 'rejected'
    ).length;
    // Birthday bonus and approved-leave auto-present days are paid days
    // that don't have (or, for a worked birthday, aren't only reflected by)
    // an attendance record — fold them into the displayed count so "Days
    // Present" actually shows the credit instead of just the raw
    // attendance tally.
    const birthdayCredit = Number(p.birthday_bonus) > 0 ? 1 : 0;
    const leaveCredit = Number(p.leave_days_credited) || 0;
    return { present: attendancePresent + birthdayCredit + leaveCredit, total: countWorkingDays(start, end) };
  }

  // Shared markup for both the on-screen preview (fluid, capped at 600px so
  // it always fits inside the Dialog no matter how the Dialog itself is
  // sized) and the hidden off-screen capture target (always exactly 600px,
  // rendered via a portal outside the Dialog entirely — so html2canvas
  // never depends on the Dialog's own width/padding math).
  function renderPayslipDoc(target: any, opts: { ref?: React.RefObject<HTMLDivElement>; fixed?: boolean } = {}) {
    const { present, total } = daysPresent(target);
    const loanDeduction = Number(target.loan_deduction) || 0;
    const carryOverDeduction = Number(target.carry_over_deduction) || 0;
    const birthdayBonus = Number(target.birthday_bonus) || 0;
    const leavePay = Number(target.leave_pay) || 0;
    const deductions = Number(target.sss) + Number(target.philhealth) + Number(target.pag_ibig) + Number(target.incentive_retention) + loanDeduction + carryOverDeduction;
    const branding = getDocumentBranding(target.employees?.branches?.name);
    return (
      <div ref={opts.ref} style={{ width: opts.fixed ? 600 : '100%', maxWidth: 600, background: '#ffffff', color: '#1a1a1a', padding: 28, fontFamily: 'Arial, sans-serif', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, borderBottom: '3px solid #0B1F3A', paddingBottom: 14, marginBottom: 16 }}>
          <img src="/image/1125_Corp_Logo.png" alt="1125Corp" style={{ width: 44, height: 44, objectFit: 'contain' }} />
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#0B1F3A' }}>{COMPANY_NAME}</div>
            <div style={{ fontSize: 9, color: '#666' }}>{branding.address} · {branding.contact}</div>
          </div>
          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#0B1F3A' }}>PAYSLIP</div>
            <div style={{ fontSize: 10, color: '#666' }}>{target.period === '15' ? '15th' : '30th'} cutoff</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 12, marginBottom: 16 }}>
          <div><span style={{ color: '#666' }}>Employee: </span><strong>{target.employees?.first_name} {target.employees?.last_name}</strong></div>
          <div><span style={{ color: '#666' }}>Pay Date: </span><strong>{formatDate(target.pay_date)}</strong></div>
          <div><span style={{ color: '#666' }}>Position: </span><strong>{target.employees?.position ?? '—'}</strong></div>
          <div><span style={{ color: '#666' }}>Branch: </span><strong>{target.employees?.branches?.name ?? '—'}</strong></div>
          <div><span style={{ color: '#666' }}>Department: </span><strong>{target.employees?.department ?? '—'}</strong></div>
          <div><span style={{ color: '#666' }}>Days Present: </span><strong>{present} / {total}</strong></div>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 16 }}>
          <tbody>
            <tr><td style={{ padding: '5px 0', color: '#666' }}>Basic Pay</td><td style={{ padding: '5px 0', textAlign: 'right', fontWeight: 600 }}>{formatCurrency(target.basic_salary)}</td></tr>
            <tr><td style={{ padding: '5px 0', color: '#666' }}>Incentive</td><td style={{ padding: '5px 0', textAlign: 'right', fontWeight: 600, color: '#0B7A3D' }}>{formatCurrency(target.incentive)}</td></tr>
            {birthdayBonus > 0 && (
              <tr>
                <td style={{ padding: '5px 0', color: '#666' }}>
                  🎂 {target.birthday_worked ? 'Birthday Bonus (worked — double pay)' : 'Birthday Leave (auto-present)'}
                </td>
                <td style={{ padding: '5px 0', textAlign: 'right', fontWeight: 600, color: '#0B7A3D' }}>{formatCurrency(birthdayBonus)}</td>
              </tr>
            )}
            {leavePay > 0 && (
              <tr>
                <td style={{ padding: '5px 0', color: '#666' }}>
                  Paid Leave ({target.leave_days_credited} day{Number(target.leave_days_credited) !== 1 ? 's' : ''}, auto-present)
                </td>
                <td style={{ padding: '5px 0', textAlign: 'right', fontWeight: 600, color: '#0B7A3D' }}>{formatCurrency(leavePay)}</td>
              </tr>
            )}
            <tr style={{ borderTop: '1px solid #ddd' }}><td style={{ padding: '8px 0 4px', fontWeight: 700 }}>Gross Pay</td><td style={{ padding: '8px 0 4px', textAlign: 'right', fontWeight: 700 }}>{formatCurrency(Number(target.basic_salary) + Number(target.incentive) + birthdayBonus + leavePay)}</td></tr>
            <tr><td colSpan={2} style={{ padding: '10px 0 2px', fontWeight: 700, color: '#0B1F3A' }}>Deductions</td></tr>
            <tr><td style={{ padding: '3px 0', color: '#666' }}>SSS</td><td style={{ padding: '3px 0', textAlign: 'right' }}>{formatCurrency(target.sss)}</td></tr>
            <tr><td style={{ padding: '3px 0', color: '#666' }}>PhilHealth</td><td style={{ padding: '3px 0', textAlign: 'right' }}>{formatCurrency(target.philhealth)}</td></tr>
            <tr><td style={{ padding: '3px 0', color: '#666' }}>Pag-IBIG</td><td style={{ padding: '3px 0', textAlign: 'right' }}>{formatCurrency(target.pag_ibig)}</td></tr>
            <tr><td style={{ padding: '3px 0', color: '#666' }}>Incentive Retention</td><td style={{ padding: '3px 0', textAlign: 'right' }}>{formatCurrency(target.incentive_retention)}</td></tr>
            {loanDeduction > 0 && (
              <tr><td style={{ padding: '3px 0', color: '#666' }}>Employee Loan Repayment</td><td style={{ padding: '3px 0', textAlign: 'right' }}>{formatCurrency(loanDeduction)}</td></tr>
            )}
            {carryOverDeduction > 0 && (
              <tr><td style={{ padding: '3px 0', color: '#c0392b' }}>Carried Over Deficit (prior payroll)</td><td style={{ padding: '3px 0', textAlign: 'right' }}>{formatCurrency(carryOverDeduction)}</td></tr>
            )}
            <tr style={{ borderTop: '1px solid #ddd' }}><td style={{ padding: '6px 0', fontWeight: 700 }}>Total Deductions</td><td style={{ padding: '6px 0', textAlign: 'right', fontWeight: 700, color: '#c0392b' }}>-{formatCurrency(deductions)}</td></tr>
          </tbody>
        </table>

        <div style={{ background: '#f4f6f9', borderRadius: 8, padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#0B1F3A' }}>NET PAY</span>
          <span style={{ fontSize: 20, fontWeight: 700, color: '#0B7A3D' }}>{formatCurrency(target.net_pay)}</span>
        </div>

        <div style={{ marginTop: 18, paddingTop: 10, borderTop: '1px solid #ddd', fontSize: 10, color: '#999', textAlign: 'center' }}>
          This is a system-generated payslip and is valid without a signature.
        </div>
      </div>
    );
  }

  async function generatePayroll() {
    setGenerating(true);
    if (employees.length === 0) {
      toast({ title: 'Error', description: 'No active employees found', variant: 'destructive' });
      setGenerating(false);
      return;
    }

    // employees.salary is a DAILY rate, not a monthly one — basic pay is
    // the daily rate multiplied by however many days they actually clocked
    // in (present or late) during this specific pay period, not a flat
    // salary/2 split.
    const { start, end } = getPeriodRange(payDate, period);
    const employeeIds = employees.map(e => e.id);
    const { data: att } = await supabase.from('attendance').select('employee_id, date, status, review_status').in('employee_id', employeeIds).gte('date', start).lte('date', end);

    // Approved leave counts as a paid present day even with no attendance
    // record for that day — an employee correctly out on approved leave
    // shouldn't lose pay just because they didn't clock in. Only credits
    // days that don't already have a present/late attendance record, so a
    // day worked despite being on leave isn't paid twice.
    const { data: approvedLeaves } = await supabase
      .from('leave_requests')
      .select('employee_id, start_date, end_date')
      .in('employee_id', employeeIds)
      .eq('status', 'approved')
      .lte('start_date', end)
      .gte('end_date', start);

    // excludeDate is the employee's birthday (if it falls in this period) —
    // that specific day is already credited/paid via the birthday bonus
    // logic below, so it's excluded here to avoid paying the same physical
    // day twice just because it happens to be both a birthday and an
    // approved leave day.
    function countLeaveDaysInPeriod(employeeId: string, excludeDate: string | null): number {
      const attendedDates = new Set(
        (att ?? [])
          .filter(a => a.employee_id === employeeId && (a.status === 'present' || a.status === 'late') && a.review_status !== 'rejected')
          .map(a => a.date)
      );
      const creditedDates = new Set<string>();
      for (const leave of (approvedLeaves ?? []).filter(l => l.employee_id === employeeId)) {
        const leaveStart = new Date(Math.max(new Date(leave.start_date).getTime(), new Date(start).getTime()));
        const leaveEnd = new Date(Math.min(new Date(leave.end_date).getTime(), new Date(end).getTime()));
        for (let d = new Date(leaveStart); d <= leaveEnd; d.setDate(d.getDate() + 1)) {
          if (d.getDay() === 0) continue; // Sundays aren't working days
          const key = toDateStr(d);
          if (key === excludeDate) continue;
          if (!attendedDates.has(key)) creditedDates.add(key);
        }
      }
      return creditedDates.size;
    }

    // Employees with an active salary loan get its per-payroll deduction
    // amount (capped at whatever's left on the loan) taken out automatically
    // — same schedule amount used by the loan's own Deduction Calendar, not
    // scaled by attendance (it's a fixed repayment obligation each cutoff).
    const { data: activeLoans } = await supabase.from('employee_loans').select('employee_id, deduction_amount, remaining_balance').in('employee_id', employeeIds).eq('status', 'active');

    // If an employee's most recent PRIOR payroll came out negative (fixed
    // deductions exceeded what they actually earned that cutoff), the
    // shortfall doesn't disappear — it's carried forward and deducted from
    // this payroll too, same as a real payroll advance/deficit ledger.
    const { data: priorPayroll } = await supabase
      .from('payroll')
      .select('employee_id, net_pay, pay_date')
      .in('employee_id', employeeIds)
      .lt('pay_date', payDate)
      .order('pay_date', { ascending: false });
    const previousNetPayByEmployee = new Map<string, number>();
    for (const p of priorPayroll ?? []) {
      if (!previousNetPayByEmployee.has(p.employee_id)) previousNetPayByEmployee.set(p.employee_id, Number(p.net_pay));
    }

    // Re-generating the same period/pay date used to insert a second,
    // duplicate row per employee on every click instead of replacing the
    // numbers — clear out the still-pending rows for this exact period
    // first so "Generate Payroll" is safe to click again. Already-approved
    // ("paid") rows are left untouched.
    await supabase.from('payroll').delete().eq('period', period).eq('pay_date', payDate).eq('status', 'pending');

    const totalWorkingDays = countWorkingDays(start, end);
    const records = employees.map(e => {
      const presentDays = (att ?? []).filter(a => a.employee_id === e.id && (a.status === 'present' || a.status === 'late') && a.review_status !== 'rejected').length;
      const isMonthly = e.pay_type === 'monthly';
      // A fixed-monthly employee (e.g. Branch Manager) is paid half their
      // monthly salary each semi-monthly cutoff regardless of attendance —
      // everyone else is daily-rate × actual days present.
      const dailyRate = Number(e.salary) || 0;
      const basicSalary = isMonthly ? dailyRate / 2 : dailyRate * presentDays;
      // SSS/PhilHealth/Pag-IBIG are statutory contributions for the whole
      // cutoff — they're based on the full period's expected pay (daily
      // rate × total working days for daily-rate staff, or the same
      // half-month salary for fixed-monthly staff), not scaled down by
      // actual attendance, the same way they'd still be deducted even with
      // a few absences.
      const fullPeriodBasic = isMonthly ? dailyRate / 2 : dailyRate * totalWorkingDays;
      const sss = fullPeriodBasic * 0.045;
      const philhealth = fullPeriodBasic * 0.035;
      const pagIbig = fullPeriodBasic * 0.02;
      // Incentive stays tied to what was actually earned this period.
      const incentive = basicSalary * 0.05;
      const retention = incentive * 0.25;
      const loanDeduction = (activeLoans ?? [])
        .filter(l => l.employee_id === e.id)
        .reduce((sum, l) => sum + Math.min(Number(l.deduction_amount) || 0, Number(l.remaining_balance) || 0), 0);
      const previousNetPay = previousNetPayByEmployee.get(e.id);
      const carryOverDeduction = previousNetPay !== undefined && previousNetPay < 0 ? -previousNetPay : 0;

      // Birthday leave/pay (daily-rate employees only — a fixed-monthly
      // salary already doesn't depend on attendance, so the concept doesn't
      // apply the same way): if the employee's birthday falls in this
      // period, they get one extra day's pay regardless. If they clocked in
      // that day it stacks on top of the day they already earned normally
      // (double pay for that specific day); if they didn't clock in, this
      // is the only pay for that day (auto-present paid birthday leave,
      // no attendance record needed).
      const birthdayDate = !isMonthly ? getBirthdayInPeriod(e.birth_date, start, end) : null;
      const birthdayWorked = birthdayDate
        ? (att ?? []).some(a => a.employee_id === e.id && a.date === birthdayDate && (a.status === 'present' || a.status === 'late') && a.review_status !== 'rejected')
        : false;
      const birthdayBonus = birthdayDate ? dailyRate : 0;

      // Approved leave (daily-rate employees only, same reasoning as
      // birthday pay above) — days already credited via attendance, or
      // already paid via the birthday bonus above, are excluded so the same
      // physical day is never paid twice (e.g. an employee whose birthday
      // happens to fall on an approved leave day still only gets paid once
      // for that one day).
      const leaveDaysCredited = isMonthly ? 0 : countLeaveDaysInPeriod(e.id, birthdayDate);
      const leavePay = leaveDaysCredited * dailyRate;

      const totalDeductions = sss + philhealth + pagIbig + retention + loanDeduction + carryOverDeduction;
      const netPay = basicSalary + incentive + birthdayBonus + leavePay - totalDeductions;

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
        loan_deduction: Math.round(loanDeduction * 100) / 100,
        carry_over_deduction: Math.round(carryOverDeduction * 100) / 100,
        birthday_bonus: Math.round(birthdayBonus * 100) / 100,
        birthday_worked: birthdayDate ? birthdayWorked : null,
        leave_pay: Math.round(leavePay * 100) / 100,
        leave_days_credited: leaveDaysCredited,
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
    const row = payroll.find(p => p.id === id);
    const { error } = await supabase.from('payroll').update({ status: 'paid' }).eq('id', id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }

    // Actually apply the loan repayment that was deducted on this payslip to
    // the employee's active loan(s) — same per-loan amount computed at
    // generation time (deduction_amount capped at remaining_balance).
    if (row && Number(row.loan_deduction) > 0) {
      const { data: activeLoans } = await supabase.from('employee_loans').select('id, deduction_amount, remaining_balance').eq('employee_id', row.employee_id).eq('status', 'active');
      for (const l of activeLoans ?? []) {
        const amt = Math.min(Number(l.deduction_amount) || 0, Number(l.remaining_balance) || 0);
        if (amt <= 0) continue;
        const newBalance = Number(l.remaining_balance) - amt;
        await supabase.from('employee_loans').update({
          remaining_balance: newBalance,
          status: newBalance <= 0 ? 'completed' : 'active',
        }).eq('id', l.id);
      }
    }

    toast({ title: 'Success', description: 'Payroll approved' });
    load();
  }

  async function handleDeletePayroll() {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from('payroll').delete().eq('id', deleteTarget.id);
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Payroll record deleted' }); setDeleteTarget(null); load(); }
    setDeleting(false);
  }

  function handleExport() {
    exportToCSV(payroll.map(p => {
      const { present, total } = daysPresent(p);
      return {
        Employee: `${p.employees?.first_name} ${p.employees?.last_name}`,
        Period: p.period, PayDate: p.pay_date, DaysPresent: `${present}/${total}`, Basic: p.basic_salary,
        Overtime: p.overtime_pay, Incentive: p.incentive, SSS: p.sss,
        PhilHealth: p.philhealth, PagIBIG: p.pag_ibig, Retention: p.incentive_retention,
        LoanDeduction: p.loan_deduction ?? 0, CarryOverDeduction: p.carry_over_deduction ?? 0,
        NetPay: p.net_pay, Status: p.status,
      };
    }), 'payroll.csv');
  }

  async function handlePrintPayslip() {
    if (!payslipRef.current) return;
    setPrintingPayslip(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(payslipRef.current, { backgroundColor: '#ffffff', scale: 2, width: 600, windowWidth: 600 });
      const dataUrl = canvas.toDataURL('image/png');
      const printWindow = window.open('', '_blank', 'width=700,height=900');
      if (!printWindow) {
        toast({ title: 'Print blocked', description: 'Please allow pop-ups for this site to print the payslip', variant: 'destructive' });
        setPrintingPayslip(false);
        return;
      }
      printWindow.document.write(`
        <html>
          <head><title>Payslip</title></head>
          <body style="margin:0;padding:0;background:#fff;">
            <img src="${dataUrl}" style="width:100%;display:block;" />
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.onload = () => printWindow.print();
      printWindow.onafterprint = () => printWindow.close();
    } catch (err: any) {
      toast({ title: 'Print failed', description: err?.message ?? 'Could not generate payslip for printing', variant: 'destructive' });
    }
    setPrintingPayslip(false);
  }

  async function handleDownloadPayslip() {
    if (!payslipRef.current || !payslipTarget) return;
    setDownloadingPayslip(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const { jsPDF } = await import('jspdf');
      const scale = 2;
      const canvas = await html2canvas(payslipRef.current, { backgroundColor: '#ffffff', scale, width: 600, windowWidth: 600 });
      const imgData = canvas.toDataURL('image/png');
      const pxToPt = 0.75;
      const contentWidthPt = (canvas.width / scale) * pxToPt;
      const contentHeightPt = (canvas.height / scale) * pxToPt;

      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const margin = 24;
      const usableWidth = pdf.internal.pageSize.getWidth() - margin * 2;
      const usableHeight = pdf.internal.pageSize.getHeight() - margin * 2;
      // Fit within the page on whichever dimension is tighter, instead of
      // always stretching to the full page width — a short payslip stretched
      // to fill an A4 width blows its height up past one page and gets cut
      // off in PDF viewers.
      const scaleToFit = Math.min(usableWidth / contentWidthPt, usableHeight / contentHeightPt, 1);
      const imgWidth = contentWidthPt * scaleToFit;
      const imgHeight = contentHeightPt * scaleToFit;
      pdf.addImage(imgData, 'PNG', margin, margin, imgWidth, imgHeight);
      pdf.save(`payslip-${payslipTarget.employees?.first_name ?? ''}-${payslipTarget.pay_date}.pdf`);
    } catch (err: any) {
      toast({ title: 'Download failed', description: err?.message ?? 'Could not generate payslip PDF', variant: 'destructive' });
    }
    setDownloadingPayslip(false);
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
                  <TableHead>Days Present</TableHead>
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
                  const deductions = Number(p.sss) + Number(p.philhealth) + Number(p.pag_ibig) + Number(p.incentive_retention) + Number(p.loan_deduction || 0) + Number(p.carry_over_deduction || 0);
                  const { present, total } = daysPresent(p);
                  return (
                    <TableRow key={p.id} className="hover:bg-secondary/50">
                      <TableCell className="text-sm font-medium">{p.employees?.first_name} {p.employees?.last_name}</TableCell>
                      <TableCell className="text-sm">{p.period}</TableCell>
                      <TableCell className="text-sm">{formatDate(p.pay_date)}</TableCell>
                      <TableCell className="text-sm">{present} / {total}</TableCell>
                      <TableCell className="text-sm">{formatCurrency(p.basic_salary)}</TableCell>
                      <TableCell className="text-sm text-success">{formatCurrency(p.incentive)}</TableCell>
                      <TableCell className="text-sm text-destructive">{formatCurrency(deductions)}</TableCell>
                      <TableCell className="text-sm font-bold">{formatCurrency(p.net_pay)}</TableCell>
                      <TableCell><Badge variant={p.status === 'paid' ? 'default' : 'secondary'}>{p.status}</Badge></TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 justify-end">
                          <Button variant="ghost" size="icon" onClick={() => setPayslipTarget(p)} title="Generate payslip">
                            <Receipt className="w-4 h-4" />
                          </Button>
                          {p.status === 'pending' && (
                            <Button variant="ghost" size="icon" onClick={() => approvePayroll(p.id)}>
                              <CheckCircle className="w-4 h-4 text-success" />
                            </Button>
                          )}
                          {isAdmin && (
                            <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(p)}>
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Payroll Record</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this {deleteTarget?.period === '15' ? '15th' : '30th'} payroll record for {deleteTarget?.employees?.first_name} {deleteTarget?.employees?.last_name} ({deleteTarget && formatCurrency(deleteTarget.net_pay)} net pay)? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeletePayroll} disabled={deleting}>
              {deleting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!payslipTarget} onOpenChange={(open) => !open && setPayslipTarget(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Payslip</DialogTitle>
            <DialogDescription>
              {payslipTarget?.employees?.first_name} {payslipTarget?.employees?.last_name} — {payslipTarget?.period === '15' ? '15th' : '30th'} cutoff, {payslipTarget && formatDate(payslipTarget.pay_date)}
            </DialogDescription>
          </DialogHeader>

          {payslipTarget && renderPayslipDoc(payslipTarget)}

          <DialogFooter>
            <Button variant="outline" onClick={handlePrintPayslip} disabled={printingPayslip}>
              {printingPayslip ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Printer className="w-4 h-4 mr-2" />}
              Print
            </Button>
            <Button onClick={handleDownloadPayslip} disabled={downloadingPayslip}>
              {downloadingPayslip ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
              Download PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hidden off-screen copy at a fixed 600px width, used purely as the
          html2canvas capture target — independent of the Dialog's own width,
          so Print/Download always produce a correctly-sized image no matter
          how the visible preview happens to be laid out. */}
      {payslipTarget && typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', top: 0, left: 0, opacity: 0, pointerEvents: 'none', zIndex: -1 }}>
          {renderPayslipDoc(payslipTarget, { ref: payslipRef, fixed: true })}
        </div>,
        document.body
      )}
    </div>
  );
}
