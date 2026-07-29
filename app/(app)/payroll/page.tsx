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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency, formatDate, exportToCSV, generatePayrollVoucherNumber, generateThirteenthMonthVoucherNumber, numberToWordsPeso } from '@/lib/format';
import { COMPANY_NAME, COMPANY_NAME_DISPLAY, getDocumentBranding } from '@/lib/document-branding';
import { postJournalEntry } from '@/lib/ledger';
import { ScrollText, Download, Loader2, Calculator, CheckCircle, Trash2, Receipt, Printer, Gift, ListTree, Pencil, FileSpreadsheet, Eye } from 'lucide-react';
import { SPECIAL_LOAN_TYPES, SPECIAL_LOAN_LABELS } from '@/lib/special-loans';
import { DocumentScaler } from '@/components/document-scaler';

const pvCell: React.CSSProperties = { border: '1px solid #000', padding: '5px 8px' };
const pvCellCenter: React.CSSProperties = { ...pvCell, textAlign: 'center' };

function payrollDeductionsTotal(p: any): number {
  return Number(p.sss) + Number(p.philhealth) + Number(p.pag_ibig) + Number(p.incentive_retention)
    + Number(p.loan_deduction || 0) + Number(p.late_deduction || 0) + Number(p.carry_over_deduction || 0)
    + Number(p.sss_loan || 0) + Number(p.pag_ibig_loan || 0) + Number(p.service_vehicle || 0) + Number(p.uniform || 0) + Number(p.cash_shortage || 0);
}

// Semi-monthly payroll, paid on the 1st and the 16th of each month, each
// covering the cutoff that just ended before that pay date:
// - "1" (paid the 1st) covers the 16th of the PREVIOUS month through that
//   month's actual last day.
// - "16" (paid the 16th) covers the 1st–15th of the SAME month.
function pad(n: number) { return String(n).padStart(2, '0'); }
function toDateStr(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function getPeriodRange(payDateStr: string, period: string) {
  const payDate = new Date(payDateStr);
  const year = payDate.getFullYear();
  const month = payDate.getMonth();
  if (period === '1') {
    return { start: toDateStr(new Date(year, month - 1, 16)), end: toDateStr(new Date(year, month, 0)) };
  }
  return { start: toDateStr(new Date(year, month, 1)), end: toDateStr(new Date(year, month, 15)) };
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
  const [period, setPeriod] = useState('1');
  const [payDate, setPayDate] = useState(new Date().toISOString().split('T')[0]);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [deleting, setDeleting] = useState(false);
  const [payslipTarget, setPayslipTarget] = useState<any>(null);
  const [printingPayslip, setPrintingPayslip] = useState(false);
  const [downloadingPayslip, setDownloadingPayslip] = useState(false);
  const [activeLoanBalances, setActiveLoanBalances] = useState<Record<string, number>>({});
  const [specialLoanBalances, setSpecialLoanBalances] = useState<Record<string, Record<string, number>>>({});
  const [specialLoanDefaults, setSpecialLoanDefaults] = useState<Record<string, Record<string, number>>>({});
  const [editDeductionsTarget, setEditDeductionsTarget] = useState<any>(null);
  const [editDeductionsForm, setEditDeductionsForm] = useState({ sss_loan: '', pag_ibig_loan: '', service_vehicle: '', uniform: '', cash_shortage: '' });
  const [savingDeductions, setSavingDeductions] = useState(false);
  const [activeTab, setActiveTab] = useState<'records' | 'voucher' | 'thirteenth'>('records');
  const [thirteenthYear, setThirteenthYear] = useState(String(new Date().getFullYear()));
  const [thirteenthCycle, setThirteenthCycle] = useState<'partial' | 'full'>(new Date().getMonth() < 6 ? 'partial' : 'full');
  const [thirteenthAdjustments, setThirteenthAdjustments] = useState<Record<string, { deductionFromEarnings: string; totalDeduction: string }>>({});
  const [breakdownEmployeeId, setBreakdownEmployeeId] = useState<string | null>(null);
  const [thirteenthVouchers, setThirteenthVouchers] = useState<any[]>([]);
  const [thirteenthCashierName, setThirteenthCashierName] = useState('');
  const [thirteenthAdminName, setThirteenthAdminName] = useState('');
  const [generatingThirteenthVoucher, setGeneratingThirteenthVoucher] = useState(false);
  const [downloadingThirteenthVoucher, setDownloadingThirteenthVoucher] = useState(false);
  const [historyThirteenthVoucher, setHistoryThirteenthVoucher] = useState<any | null>(null);
  const [downloadingHistoryThirteenthId, setDownloadingHistoryThirteenthId] = useState<string | null>(null);
  const [thirteenthVoucherNumber, setThirteenthVoucherNumber] = useState(generateThirteenthMonthVoucherNumber());
  const [thirteenthVoucherPreviewOpen, setThirteenthVoucherPreviewOpen] = useState(false);
  const thirteenthVoucherPrintRef = useRef<HTMLDivElement>(null);
  const payslipRef = useRef<HTMLDivElement>(null);

  // Payroll Voucher
  const [branches, setBranches] = useState<any[]>([]);
  const [voucherBranchId, setVoucherBranchId] = useState('');
  const [voucherPeriod, setVoucherPeriod] = useState('1');
  const [voucherPayDate, setVoucherPayDate] = useState(new Date().toISOString().split('T')[0]);
  const [voucherCashierName, setVoucherCashierName] = useState('');
  const [voucherAdminName, setVoucherAdminName] = useState('');
  const [generatingVoucher, setGeneratingVoucher] = useState(false);
  const [downloadingVoucher, setDownloadingVoucher] = useState(false);
  const [payrollVouchers, setPayrollVouchers] = useState<any[]>([]);
  const [historyPayrollVoucher, setHistoryPayrollVoucher] = useState<any | null>(null);
  const [downloadingHistoryVoucherId, setDownloadingHistoryVoucherId] = useState<string | null>(null);
  const [voucherNumber, setVoucherNumber] = useState(generatePayrollVoucherNumber());
  const [voucherPreviewOpen, setVoucherPreviewOpen] = useState(false);
  const payrollVoucherPrintRef = useRef<HTMLDivElement>(null);

  useEffect(() => { load(); loadEmployees(); loadBranches(); loadPayrollVouchers(); loadThirteenthVouchers(); }, []);

  useEffect(() => {
    if (profile?.role_name === 'Cashier' && profile?.full_name) {
      setVoucherCashierName(profile.full_name);
      setThirteenthCashierName(profile.full_name);
    }
  }, [profile]);

  async function loadThirteenthVouchers() {
    const { data } = await supabase.from('thirteenth_month_vouchers').select('*').order('year', { ascending: false }).order('created_at', { ascending: false }).limit(30);
    setThirteenthVouchers(data ?? []);
  }

  async function loadEmployees() {
    const { data } = await supabase.from('employees').select('id, first_name, last_name, salary, pay_type, status, birth_date, branches(name)').eq('status', 'active');
    setEmployees(data ?? []);
  }

  async function loadBranches() {
    const { data } = await supabase.from('branches').select('id, name').eq('status', 'active').order('name');
    setBranches(data ?? []);
    if (data && data.length > 0 && !voucherBranchId) setVoucherBranchId(data[0].id);
  }

  async function loadPayrollVouchers() {
    const { data } = await supabase.from('payroll_vouchers').select('*, branches(name)').order('pay_date', { ascending: false }).order('created_at', { ascending: false }).limit(30);
    setPayrollVouchers(data ?? []);
  }

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('payroll').select('*, employees(first_name, last_name, position, department, branch_id, branches(name))').order('pay_date', { ascending: false });
    setPayroll(data ?? []);

    const employeeIds = Array.from(new Set((data ?? []).map(p => p.employee_id)));
    if (employeeIds.length > 0) {
      const [{ data: att }, { data: loans }, { data: specialLoans }] = await Promise.all([
        supabase.from('attendance').select('employee_id, date, status, review_status').in('employee_id', employeeIds),
        supabase.from('employee_loans').select('employee_id, remaining_balance').eq('status', 'active').in('employee_id', employeeIds),
        supabase.from('employee_special_loans').select('employee_id, loan_type, remaining_balance, deduction_amount').eq('status', 'active').in('employee_id', employeeIds),
      ]);
      setAttendanceRecords(att ?? []);
      const balances: Record<string, number> = {};
      for (const l of loans ?? []) {
        balances[l.employee_id] = (balances[l.employee_id] ?? 0) + (Number(l.remaining_balance) || 0);
      }
      setActiveLoanBalances(balances);
      const specialBalances: Record<string, Record<string, number>> = {};
      const specialDefaults: Record<string, Record<string, number>> = {};
      for (const l of specialLoans ?? []) {
        specialBalances[l.employee_id] = specialBalances[l.employee_id] ?? {};
        specialBalances[l.employee_id][l.loan_type] = (specialBalances[l.employee_id][l.loan_type] ?? 0) + (Number(l.remaining_balance) || 0);
        specialDefaults[l.employee_id] = specialDefaults[l.employee_id] ?? {};
        const suggested = Math.min(Number(l.deduction_amount) || 0, Number(l.remaining_balance) || 0);
        specialDefaults[l.employee_id][l.loan_type] = (specialDefaults[l.employee_id][l.loan_type] ?? 0) + suggested;
      }
      setSpecialLoanDefaults(specialDefaults);
      setSpecialLoanBalances(specialBalances);
    } else {
      setAttendanceRecords([]);
      setActiveLoanBalances({});
      setSpecialLoanBalances({});
      setSpecialLoanDefaults({});
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

  // 13th Month Pay, disbursed twice a year rather than once — Partial (paid
  // every June) covers the 12 cutoffs from Dec 1 of the previous year
  // through May 31; Full (paid every December) covers June 1 through Nov
  // 30 of the same year. Both still divide by 12 (not 6), same as DOLE's
  // standard annual formula — paying it out in two halves this way adds up
  // to the same total a once-a-year computation would, just split evenly.
  // Only the raw `basic_salary` figure from each cutoff counts; incentives,
  // birthday bonus, leave pay, and other allowances are excluded.
  const payrollYears = Array.from(new Set(payroll.map(p => String(new Date(p.pay_date).getFullYear())))).sort((a, b) => Number(b) - Number(a));

  function getThirteenthMonthRange(year: string, cycle: 'partial' | 'full') {
    const y = Number(year);
    if (cycle === 'partial') return { start: `${y - 1}-12-01`, end: `${y}-05-31` };
    return { start: `${y}-06-01`, end: `${y}-11-30` };
  }

  function getThirteenthMonthRows(year: string, cycle: 'partial' | 'full') {
    const { start, end } = getThirteenthMonthRange(year, cycle);
    const totals = new Map<string, { employee: any; totalEarnings: number }>();
    for (const p of payroll) {
      if (p.pay_date < start || p.pay_date > end) continue;
      const existing = totals.get(p.employee_id) ?? { employee: p.employees, totalEarnings: 0 };
      existing.totalEarnings += Number(p.basic_salary) || 0;
      totals.set(p.employee_id, existing);
    }
    return Array.from(totals.entries())
      .map(([employee_id, v]) => {
        const adj = thirteenthAdjustments[employee_id] ?? { deductionFromEarnings: '', totalDeduction: '' };
        const deductionFromEarnings = Number(adj.deductionFromEarnings) || 0;
        const totalDeduction = Number(adj.totalDeduction) || 0;
        const dividedBy12 = Math.round(((v.totalEarnings - deductionFromEarnings) / 12) * 100) / 100;
        const netPay = Math.round((dividedBy12 - totalDeduction) * 100) / 100;
        return { employee_id, employee: v.employee, totalEarnings: v.totalEarnings, deductionFromEarnings, totalDeduction, dividedBy12, netPay };
      })
      .sort((a, b) => (a.employee?.first_name ?? '').localeCompare(b.employee?.first_name ?? ''));
  }

  // Cutoff-by-cutoff breakdown (e.g. "December 1-15") for one employee
  // within the selected Partial/Full range, matching the reference 13th
  // Month Pay Slip's line-item layout.
  function getCutoffBreakdown(employeeId: string, year: string, cycle: 'partial' | 'full') {
    const { start, end } = getThirteenthMonthRange(year, cycle);
    return payroll
      .filter(p => p.employee_id === employeeId && p.pay_date >= start && p.pay_date <= end)
      .map(p => {
        const { start: cStart, end: cEnd } = getPeriodRange(p.pay_date, p.period);
        const s = new Date(cStart), e = new Date(cEnd);
        const label = `${s.toLocaleDateString('en-US', { month: 'long' })} ${s.getDate()}-${e.getDate()}`;
        return { label, payDate: p.pay_date, amount: Number(p.basic_salary) || 0 };
      })
      .sort((a, b) => a.payDate.localeCompare(b.payDate));
  }

  // Shared markup for both the on-screen preview (fluid, capped at 600px so
  // it always fits inside the Dialog no matter how the Dialog itself is
  // sized) and the hidden off-screen capture target (always exactly 600px,
  // rendered via a portal outside the Dialog entirely — so html2canvas
  // never depends on the Dialog's own width/padding math).
  function renderPayslipDoc(target: any, opts: { ref?: React.RefObject<HTMLDivElement>; fixed?: boolean } = {}) {
    const { present, total } = daysPresent(target);
    const loanDeduction = Number(target.loan_deduction) || 0;
    const lateDeduction = Number(target.late_deduction) || 0;
    const carryOverDeduction = Number(target.carry_over_deduction) || 0;
    const birthdayBonus = Number(target.birthday_bonus) || 0;
    const leavePay = Number(target.leave_pay) || 0;
    const sssLoan = Number(target.sss_loan) || 0;
    const pagIbigLoan = Number(target.pag_ibig_loan) || 0;
    const serviceVehicle = Number(target.service_vehicle) || 0;
    const uniform = Number(target.uniform) || 0;
    const cashShortage = Number(target.cash_shortage) || 0;
    const deductions = payrollDeductionsTotal(target);
    const loanBalance = activeLoanBalances[target.employee_id] ?? 0;
    const specialBalances = specialLoanBalances[target.employee_id] ?? {};
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
            <div style={{ fontSize: 10, color: '#666' }}>{target.period === '1' ? '1st' : '16th'} cutoff</div>
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
            {loanBalance > 0 && (
              <tr><td colSpan={2} style={{ padding: '0 0 3px', fontSize: 10, color: '#999', fontStyle: 'italic' }}>Remaining Employee Loan Balance: {formatCurrency(loanBalance)}</td></tr>
            )}
            {lateDeduction > 0 && (
              <tr><td style={{ padding: '3px 0', color: '#666' }}>Late Deduction</td><td style={{ padding: '3px 0', textAlign: 'right' }}>{formatCurrency(lateDeduction)}</td></tr>
            )}
            {carryOverDeduction > 0 && (
              <tr><td style={{ padding: '3px 0', color: '#c0392b' }}>Carried Over Deficit (prior payroll)</td><td style={{ padding: '3px 0', textAlign: 'right' }}>{formatCurrency(carryOverDeduction)}</td></tr>
            )}
            {sssLoan > 0 && (
              <tr><td style={{ padding: '3px 0', color: '#666' }}>SSS Loan</td><td style={{ padding: '3px 0', textAlign: 'right' }}>{formatCurrency(sssLoan)}</td></tr>
            )}
            {pagIbigLoan > 0 && (
              <tr><td style={{ padding: '3px 0', color: '#666' }}>Pag-IBIG Loan</td><td style={{ padding: '3px 0', textAlign: 'right' }}>{formatCurrency(pagIbigLoan)}</td></tr>
            )}
            {serviceVehicle > 0 && (
              <tr><td style={{ padding: '3px 0', color: '#666' }}>Service Vehicle</td><td style={{ padding: '3px 0', textAlign: 'right' }}>{formatCurrency(serviceVehicle)}</td></tr>
            )}
            {uniform > 0 && (
              <tr><td style={{ padding: '3px 0', color: '#666' }}>Uniform</td><td style={{ padding: '3px 0', textAlign: 'right' }}>{formatCurrency(uniform)}</td></tr>
            )}
            {cashShortage > 0 && (
              <tr><td style={{ padding: '3px 0', color: '#666' }}>Cash Shortage</td><td style={{ padding: '3px 0', textAlign: 'right' }}>{formatCurrency(cashShortage)}</td></tr>
            )}
            {SPECIAL_LOAN_LABELS.map(({ key, label }) => (specialBalances[key] ?? 0) > 0 && (
              <tr key={key}><td colSpan={2} style={{ padding: '0 0 3px', fontSize: 10, color: '#999', fontStyle: 'italic' }}>Remaining {label} Balance: {formatCurrency(specialBalances[key])}</td></tr>
            ))}
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

    // Admin-configurable in Settings -> Deductions: each is either a
    // percentage of the cutoff's expected basic pay or a flat peso amount,
    // and can differ between the 1st and 16th cutoffs (defaults match what
    // was previously hardcoded: 4.5% / 3.5% / 2%, same both cutoffs).
    const { data: deductionSettings } = await supabase.from('settings').select('key, value').in('key', ['sss_deduction', 'philhealth_deduction', 'pagibig_deduction']);
    const deductionByKey = new Map((deductionSettings ?? []).map((s: any) => [s.key, s.value]));
    const periodKey = period === '1' ? 'period_1' : 'period_16';
    function resolveDeduction(key: string, fallbackPercent: number, fullPeriodBasic: number): number {
      const cfg = deductionByKey.get(key);
      if (!cfg) return fullPeriodBasic * (fallbackPercent / 100);
      const value = Number(cfg[periodKey]) || 0;
      return cfg.type === 'fixed' ? value : fullPeriodBasic * (value / 100);
    }

    // employees.salary is a DAILY rate, not a monthly one — basic pay is
    // the daily rate multiplied by however many days they actually clocked
    // in (present or late) during this specific pay period, not a flat
    // salary/2 split.
    const { start, end } = getPeriodRange(payDate, period);
    const employeeIds = employees.map(e => e.id);
    const { data: att } = await supabase.from('attendance').select('employee_id, date, status, review_status, late_deduction').in('employee_id', employeeIds).gte('date', start).lte('date', end);

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
      const sss = resolveDeduction('sss_deduction', 4.5, fullPeriodBasic);
      const philhealth = resolveDeduction('philhealth_deduction', 3.5, fullPeriodBasic);
      const pagIbig = resolveDeduction('pagibig_deduction', 2, fullPeriodBasic);
      // Incentive stays tied to what was actually earned this period.
      const incentive = basicSalary * 0.05;
      const retention = incentive * 0.25;
      const loanDeduction = (activeLoans ?? [])
        .filter(l => l.employee_id === e.id)
        .reduce((sum, l) => sum + Math.min(Number(l.deduction_amount) || 0, Number(l.remaining_balance) || 0), 0);
      // Sum whatever's actually stored on each late attendance record for
      // this period — defaults to half a day's rate at check-in time, but
      // an Administrator may have customized individual records, so this
      // never recomputes the amount itself.
      const lateDeduction = (att ?? [])
        .filter(a => a.employee_id === e.id && a.status === 'late' && a.review_status !== 'rejected')
        .reduce((sum, a) => sum + (Number(a.late_deduction) || 0), 0);
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

      const totalDeductions = sss + philhealth + pagIbig + retention + loanDeduction + carryOverDeduction + lateDeduction;
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
        late_deduction: Math.round(lateDeduction * 100) / 100,
        carry_over_deduction: Math.round(carryOverDeduction * 100) / 100,
        // SSS/Pag-IBIG loans and the three Special Loans (Service Vehicle,
        // Uniform, Cash Shortage) have no fixed formula or term — the
        // preparer enters each one manually per cutoff via "Edit
        // Deductions" before approving, so these always start at 0 here.
        sss_loan: 0,
        pag_ibig_loan: 0,
        service_vehicle: 0,
        uniform: 0,
        cash_shortage: 0,
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

  // Reduces whatever's active on this employee's special loan(s) of this
  // type by `amount` — oldest first, spilling into the next one if a single
  // loan doesn't cover the whole deducted amount (only matters if an
  // employee somehow has more than one active loan of the same type at once).
  async function applySpecialLoanDeduction(employeeId: string, loanType: string, amount: number) {
    if (amount <= 0) return;
    const { data: loans } = await supabase
      .from('employee_special_loans')
      .select('id, remaining_balance')
      .eq('employee_id', employeeId)
      .eq('loan_type', loanType)
      .eq('status', 'active')
      .order('created_at', { ascending: true });
    let remaining = amount;
    for (const l of loans ?? []) {
      if (remaining <= 0) break;
      const applied = Math.min(remaining, Number(l.remaining_balance) || 0);
      if (applied <= 0) continue;
      const newBalance = Number(l.remaining_balance) - applied;
      await supabase.from('employee_special_loans').update({
        remaining_balance: newBalance,
        status: newBalance <= 0 ? 'completed' : 'active',
      }).eq('id', l.id);
      remaining -= applied;
    }
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

    if (row) {
      for (const type of SPECIAL_LOAN_TYPES) {
        await applySpecialLoanDeduction(row.employee_id, type, Number(row[type]) || 0);
      }
    }

    toast({ title: 'Success', description: 'Payroll approved' });
    load();
  }

  function openEditDeductions(row: any) {
    setEditDeductionsTarget(row);
    const defaults = specialLoanDefaults[row.employee_id] ?? {};
    // Pre-fill from whatever's already saved on this row (e.g. re-opening
    // after a previous edit); otherwise fall back to the suggested default
    // deduction set on the employee's special loan (still fully editable).
    const initial: Record<string, string> = {};
    for (const { key } of SPECIAL_LOAN_LABELS) {
      const saved = Number(row[key]) || 0;
      initial[key] = saved > 0 ? String(saved) : (defaults[key] > 0 ? String(defaults[key]) : '');
    }
    setEditDeductionsForm(initial as typeof editDeductionsForm);
  }

  async function handleSaveDeductions() {
    if (!editDeductionsTarget) return;
    setSavingDeductions(true);
    const row = editDeductionsTarget;
    const sssLoan = Number(editDeductionsForm.sss_loan) || 0;
    const pagIbigLoan = Number(editDeductionsForm.pag_ibig_loan) || 0;
    const serviceVehicle = Number(editDeductionsForm.service_vehicle) || 0;
    const uniform = Number(editDeductionsForm.uniform) || 0;
    const cashShortage = Number(editDeductionsForm.cash_shortage) || 0;

    const totalDeductions = Number(row.sss) + Number(row.philhealth) + Number(row.pag_ibig) + Number(row.incentive_retention)
      + Number(row.loan_deduction || 0) + Number(row.late_deduction || 0) + Number(row.carry_over_deduction || 0)
      + sssLoan + pagIbigLoan + serviceVehicle + uniform + cashShortage;
    const grossPay = Number(row.basic_salary) + Number(row.incentive) + Number(row.birthday_bonus || 0) + Number(row.leave_pay || 0);
    const netPay = Math.round((grossPay - totalDeductions) * 100) / 100;

    const { error } = await supabase.from('payroll').update({
      sss_loan: sssLoan,
      pag_ibig_loan: pagIbigLoan,
      service_vehicle: serviceVehicle,
      uniform,
      cash_shortage: cashShortage,
      net_pay: netPay,
    }).eq('id', row.id);

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: 'Deductions updated' });
      setEditDeductionsTarget(null);
      load();
    }
    setSavingDeductions(false);
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
        LoanDeduction: p.loan_deduction ?? 0, LateDeduction: p.late_deduction ?? 0, CarryOverDeduction: p.carry_over_deduction ?? 0,
        SSSLoan: p.sss_loan ?? 0, PagIBIGLoan: p.pag_ibig_loan ?? 0, ServiceVehicle: p.service_vehicle ?? 0, Uniform: p.uniform ?? 0, CashShortage: p.cash_shortage ?? 0,
        NetPay: p.net_pay, Status: p.status,
      };
    }), 'payroll.csv');
  }

  function handleExportThirteenthMonth() {
    const rows = getThirteenthMonthRows(thirteenthYear, thirteenthCycle);
    exportToCSV(rows.map(r => ({
      Employee: `${r.employee?.first_name ?? ''} ${r.employee?.last_name ?? ''}`,
      Year: thirteenthYear, Cycle: thirteenthCycle,
      TotalEarnings: r.totalEarnings, DeductionFromEarnings: r.deductionFromEarnings,
      DividedBy12: r.dividedBy12, TotalDeduction: r.totalDeduction, NetPay: r.netPay,
    })), `13th-month-pay-${thirteenthYear}-${thirteenthCycle}.csv`);
  }

  const thirteenthMonthRows = getThirteenthMonthRows(thirteenthYear, thirteenthCycle);
  const thirteenthNetPayTotal = thirteenthMonthRows.reduce((sum, r) => sum + r.netPay, 0);
  const thirteenthCycleLabel = thirteenthCycle === 'partial' ? `Partial (Dec ${Number(thirteenthYear) - 1} - May ${thirteenthYear})` : `Full (Jun - Nov ${thirteenthYear})`;

  // Same live-vs-history swap as the Payroll Voucher above — printed*
  // sources from the saved record when re-downloading from History,
  // otherwise from the live computed rows.
  const printedThirteenth = historyThirteenthVoucher;
  const printedThirteenthLines: { key: string; name: string; net_pay: number }[] = printedThirteenth
    ? (printedThirteenth.lines ?? []).map((l: any) => ({ key: l.employee_id, name: l.name, net_pay: Number(l.net_pay) || 0 }))
    : thirteenthMonthRows.map(r => ({ key: r.employee_id, name: `${r.employee?.first_name ?? ''} ${r.employee?.last_name ?? ''}`, net_pay: r.netPay }));
  const printedThirteenthTotal = printedThirteenth ? Number(printedThirteenth.total_net_pay) || 0 : thirteenthNetPayTotal;
  const printedThirteenthCashierName = printedThirteenth ? (printedThirteenth.cashier_name ?? '') : thirteenthCashierName;
  const printedThirteenthAdminName = printedThirteenth ? (printedThirteenth.admin_name ?? '') : thirteenthAdminName;
  const printedThirteenthCycleLabel = printedThirteenth
    ? (printedThirteenth.cycle === 'partial' ? `Partial (Dec ${printedThirteenth.year - 1} - May ${printedThirteenth.year})` : `Full (Jun - Nov ${printedThirteenth.year})`)
    : thirteenthCycleLabel;
  const printedThirteenthCycle = printedThirteenth ? printedThirteenth.cycle : thirteenthCycle;
  const printedThirteenthVoucherNumber = printedThirteenth ? printedThirteenth.voucher_number : thirteenthVoucherNumber;

  useEffect(() => {
    if (!historyThirteenthVoucher) return;
    (async () => {
      await handleDownloadThirteenthVoucherPdf(historyThirteenthVoucher.voucher_number);
      setHistoryThirteenthVoucher(null);
      setDownloadingHistoryThirteenthId(null);
    })();
  }, [historyThirteenthVoucher]);

  function renderThirteenthVoucherCopy() {
    return (
      <>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 20 }}>
          <img src="/image/1125_Corp_Logo.png" alt="1125Corp" style={{ width: 84, height: 84, objectFit: 'contain' }} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontWeight: 700, fontSize: 20, color: '#1F4E79' }}>{COMPANY_NAME_DISPLAY}</div>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#1F4E79' }}>{getDocumentBranding(undefined).address}</div>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#1F4E79' }}>Cel. No. {getDocumentBranding(undefined).contact}</div>
          </div>
        </div>
        <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 20, color: '#1F4E79', marginTop: 10, marginBottom: 22, textDecoration: 'underline' }}>CASH VOUCHER</div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 15, marginBottom: 12 }}>
          <div style={{ fontWeight: 700 }}>{printedThirteenthCycle === 'partial' ? 'PARTIAL 13TH MONTH PAY' : 'FULL 13TH MONTH PAY'}</div>
          <div style={{ textAlign: 'right' }}>
            <div>Voucher No.&nbsp;&nbsp;&nbsp;<strong>{printedThirteenthVoucherNumber}</strong></div>
            <div>Date&nbsp;&nbsp;&nbsp;&nbsp;{formatDate(new Date().toISOString())}</div>
          </div>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <colgroup>
            <col style={{ width: '20%' }} />
            <col style={{ width: '38%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '18%' }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ ...pvCellCenter, fontWeight: 700 }}>PAID TO:</th>
              <th colSpan={2} style={{ ...pvCellCenter, fontWeight: 700 }}>AMOUNT</th>
              <th style={{ ...pvCellCenter, fontWeight: 700 }}>
                <div>Received by:</div>
                <div style={{ fontWeight: 400 }}>Signature</div>
              </th>
            </tr>
          </thead>
          <tbody>
            {printedThirteenthLines.map(l => (
              <tr key={l.key}>
                <td style={{ ...pvCell, fontWeight: 700 }}>{l.name}</td>
                <td style={{ ...pvCell, textTransform: 'uppercase' }}>{numberToWordsPeso(l.net_pay)}</td>
                <td style={pvCellCenter}>{l.net_pay.toFixed(2)}</td>
                <td style={{ ...pvCell, height: 26 }}>&nbsp;</td>
              </tr>
            ))}
            <tr>
              <td colSpan={2} style={{ border: 'none', textAlign: 'right', fontWeight: 700, paddingTop: 10 }}>Grand Total:</td>
              <td style={{ border: 'none', textAlign: 'center', fontWeight: 700, paddingTop: 10 }}>{printedThirteenthTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
              <td style={{ border: 'none' }} />
            </tr>
          </tbody>
        </table>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginTop: 36 }}>
          <tbody>
            <tr>
              <td style={{ border: 'none', width: '50%', paddingBottom: 30 }}>Disbursed by:</td>
              <td style={{ border: 'none', textAlign: 'right', paddingBottom: 30 }}>Approved by:</td>
            </tr>
            <tr>
              <td style={{ border: 'none', textDecoration: 'underline' }}>{printedThirteenthCashierName || ' '}</td>
              <td style={{ border: 'none', textAlign: 'right', textDecoration: 'underline' }}>{printedThirteenthAdminName || ' '}</td>
            </tr>
            <tr>
              <td style={{ border: 'none', paddingTop: 2 }}>Cashier</td>
              <td style={{ border: 'none', textAlign: 'right', paddingTop: 2 }}>Admin</td>
            </tr>
          </tbody>
        </table>
      </>
    );
  }

  async function handleGenerateThirteenthVoucher() {
    if (thirteenthMonthRows.length === 0) return;
    setGeneratingThirteenthVoucher(true);
    const lines = thirteenthMonthRows.map(r => ({
      employee_id: r.employee_id,
      name: `${r.employee?.first_name ?? ''} ${r.employee?.last_name ?? ''}`,
      net_pay: r.netPay,
    }));

    const { error } = await supabase.from('thirteenth_month_vouchers').insert({
      voucher_number: thirteenthVoucherNumber,
      cycle: thirteenthCycle,
      year: Number(thirteenthYear),
      lines,
      total_net_pay: thirteenthNetPayTotal,
      prepared_by: profile?.id ?? null,
      cashier_name: thirteenthCashierName || null,
      admin_name: thirteenthAdminName || null,
    });

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      setGeneratingThirteenthVoucher(false);
      return;
    }

    await postJournalEntry({
      entryDate: new Date().toISOString().split('T')[0],
      description: `13th Month Voucher — ${thirteenthCycleLabel}`,
      reference: thirteenthVoucherNumber,
      source: 'thirteenth_month_voucher',
      createdBy: profile?.id ?? null,
      lines: [
        { accountCode: '5030', debit: thirteenthNetPayTotal, memo: 'Employee Benefits Expense' },
        { accountCode: '1000', credit: thirteenthNetPayTotal, memo: 'Cash in Vault' },
      ],
    });

    toast({ title: 'Success', description: '13th Month voucher generated and journal entry posted' });
    await handleDownloadThirteenthVoucherPdf(thirteenthVoucherNumber);
    setThirteenthVoucherNumber(generateThirteenthMonthVoucherNumber());
    loadThirteenthVouchers();
    setGeneratingThirteenthVoucher(false);
  }

  async function handleDownloadThirteenthVoucherPdf(voucherNumberOverride?: string) {
    if (!thirteenthVoucherPrintRef.current) return;
    setDownloadingThirteenthVoucher(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const { jsPDF } = await import('jspdf');
      const canvas = await html2canvas(thirteenthVoucherPrintRef.current, { backgroundColor: '#ffffff', scale: 2, width: 900, windowWidth: 900 });
      const imgData = canvas.toDataURL('image/png');
      const pxToPt = 0.75;
      const contentWidthPt = (canvas.width / 2) * pxToPt;
      const contentHeightPt = (canvas.height / 2) * pxToPt;
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: [612, 936] });
      const margin = 24;
      const usableWidth = pdf.internal.pageSize.getWidth() - margin * 2;
      const imgWidth = usableWidth;
      const imgHeight = (contentHeightPt / contentWidthPt) * imgWidth;
      pdf.addImage(imgData, 'PNG', margin, margin, imgWidth, imgHeight);
      pdf.save(`13th-month-voucher-${voucherNumberOverride ?? `${thirteenthYear}-${thirteenthCycle}`}.pdf`);
    } catch (err: any) {
      toast({ title: 'Download failed', description: err?.message ?? 'Could not generate the 13th Month voucher PDF', variant: 'destructive' });
    }
    setDownloadingThirteenthVoucher(false);
  }

  // Rows already approved ("paid") for this exact cutoff + branch that
  // haven't been swept into a Payroll Voucher yet — voucher_id is set the
  // moment a voucher includes them, so re-generating for the same cutoff
  // never double-counts or double-posts the journal entry.
  const eligiblePayrollRows = payroll.filter(p =>
    p.status === 'paid' && !p.voucher_id && p.period === voucherPeriod && p.pay_date === voucherPayDate && p.employees?.branch_id === voucherBranchId
  );
  const voucherBranch = branches.find(b => b.id === voucherBranchId);
  const voucherBranding = getDocumentBranding(voucherBranch?.name);
  const voucherNetPayTotal = eligiblePayrollRows.reduce((sum, p) => sum + (Number(p.net_pay) || 0), 0);

  // The printable div normally reflects the live form above — but to
  // re-download an already-generated voucher from History, it needs to
  // render that voucher's own saved `lines` instead. Setting
  // historyPayrollVoucher switches every printed* value over to the
  // saved record; the effect below fires the actual download once that
  // swap has made it into the DOM, then clears it back to live mode.
  const printedVoucher = historyPayrollVoucher;
  const printedLines: { key: string; name: string; net_pay: number }[] = printedVoucher
    ? (printedVoucher.lines ?? []).map((l: any) => ({ key: l.payroll_id ?? l.employee_id, name: l.name, net_pay: Number(l.net_pay) || 0 }))
    : eligiblePayrollRows.map(p => ({ key: p.id, name: `${p.employees?.first_name ?? ''} ${p.employees?.last_name ?? ''}`, net_pay: Number(p.net_pay) || 0 }));
  const printedTotal = printedVoucher ? Number(printedVoucher.total_net_pay) || 0 : voucherNetPayTotal;
  const printedCashierName = printedVoucher ? (printedVoucher.cashier_name ?? '') : voucherCashierName;
  const printedAdminName = printedVoucher ? (printedVoucher.admin_name ?? '') : voucherAdminName;
  const printedPeriod = printedVoucher ? printedVoucher.period : voucherPeriod;
  const printedPayDate = printedVoucher ? printedVoucher.pay_date : voucherPayDate;
  const printedBranchName = printedVoucher ? (branches.find(b => b.id === printedVoucher.branch_id)?.name ?? printedVoucher.branches?.name) : voucherBranch?.name;
  const printedBranding = getDocumentBranding(printedBranchName);
  const printedVoucherNumber = printedVoucher ? printedVoucher.voucher_number : voucherNumber;
  const printedParticulars = (() => {
    const { start, end } = getPeriodRange(printedPayDate, printedPeriod);
    const s = new Date(start), e = new Date(end);
    return `Payroll ${s.toLocaleDateString('en-US', { month: 'long' })} ${s.getDate()}-${e.getDate()}, ${s.getFullYear()}`;
  })();

  useEffect(() => {
    if (!historyPayrollVoucher) return;
    (async () => {
      await handleDownloadVoucherPdf(historyPayrollVoucher.voucher_number);
      setHistoryPayrollVoucher(null);
      setDownloadingHistoryVoucherId(null);
    })();
  }, [historyPayrollVoucher]);

  // Matches the client's actual Payroll Voucher exactly: amount-in-words is
  // ALL CAPS here (unlike numberToWordsPeso's normal Title Case, used as-is
  // elsewhere e.g. Gas Voucher), and the PARTICULARS line sits vertically
  // centered against the Voucher No./Date block beside it.
  function renderPayrollVoucherCopy() {
    return (
      <>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 20 }}>
          <img src="/image/1125_Corp_Logo.png" alt="1125Corp" style={{ width: 84, height: 84, objectFit: 'contain' }} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontWeight: 700, fontSize: 20, color: '#1F4E79' }}>{COMPANY_NAME_DISPLAY}</div>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#1F4E79' }}>{printedBranding.address}</div>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#1F4E79' }}>Cel. No. {printedBranding.contact}</div>
          </div>
        </div>
        <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 20, color: '#1F4E79', marginTop: 10, marginBottom: 22, textDecoration: 'underline' }}>CASH VOUCHER</div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 15, marginBottom: 12 }}>
          <div style={{ fontWeight: 700 }}>PARTICULARS {printedParticulars}</div>
          <div style={{ textAlign: 'right' }}>
            <div>Voucher No.&nbsp;&nbsp;&nbsp;<strong>{printedVoucherNumber}</strong></div>
            <div>Date&nbsp;&nbsp;&nbsp;&nbsp;{formatDate(printedPayDate)}</div>
          </div>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <colgroup>
            <col style={{ width: '20%' }} />
            <col style={{ width: '38%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '18%' }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ ...pvCellCenter, fontWeight: 700 }}>PAID TO:</th>
              <th colSpan={2} style={{ ...pvCellCenter, fontWeight: 700 }}>AMOUNT</th>
              <th style={{ ...pvCellCenter, fontWeight: 700 }}>
                <div>Received by:</div>
                <div style={{ fontWeight: 400 }}>Signature</div>
              </th>
            </tr>
          </thead>
          <tbody>
            {printedLines.map(l => (
              <tr key={l.key}>
                <td style={{ ...pvCell, fontWeight: 700 }}>{l.name}</td>
                <td style={{ ...pvCell, textTransform: 'uppercase' }}>{numberToWordsPeso(l.net_pay)}</td>
                <td style={pvCellCenter}>{l.net_pay.toFixed(2)}</td>
                <td style={{ ...pvCell, height: 26 }}>&nbsp;</td>
              </tr>
            ))}
            <tr>
              <td colSpan={2} style={{ border: 'none', textAlign: 'right', fontWeight: 700, paddingTop: 10 }}>Grand Total:</td>
              <td style={{ border: 'none', textAlign: 'center', fontWeight: 700, paddingTop: 10 }}>{printedTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
              <td style={{ border: 'none' }} />
            </tr>
          </tbody>
        </table>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginTop: 36 }}>
          <tbody>
            <tr>
              <td style={{ border: 'none', width: '50%', paddingBottom: 30 }}>Disbursed by:</td>
              <td style={{ border: 'none', textAlign: 'right', paddingBottom: 30 }}>Approved by:</td>
            </tr>
            <tr>
              <td style={{ border: 'none', textDecoration: 'underline' }}>{printedCashierName || ' '}</td>
              <td style={{ border: 'none', textAlign: 'right', textDecoration: 'underline' }}>{printedAdminName || ' '}</td>
            </tr>
            <tr>
              <td style={{ border: 'none', paddingTop: 2 }}>Cashier</td>
              <td style={{ border: 'none', textAlign: 'right', paddingTop: 2 }}>Payroll Officer</td>
            </tr>
          </tbody>
        </table>
      </>
    );
  }

  async function handleGenerateVoucher() {
    if (!voucherBranchId || eligiblePayrollRows.length === 0) return;
    setGeneratingVoucher(true);

    let sssPayable = 0, philPayable = 0, pagibigPayable = 0, svTotal = 0, uniformTotal = 0, cashShortageTotal = 0, employeeLoanTotal = 0, netPayTotal = 0;
    const lines = eligiblePayrollRows.map(p => {
      sssPayable += Number(p.sss) + Number(p.sss_loan || 0);
      philPayable += Number(p.philhealth);
      pagibigPayable += Number(p.pag_ibig) + Number(p.pag_ibig_loan || 0);
      svTotal += Number(p.service_vehicle || 0);
      uniformTotal += Number(p.uniform || 0);
      cashShortageTotal += Number(p.cash_shortage || 0);
      employeeLoanTotal += Number(p.loan_deduction || 0);
      netPayTotal += Number(p.net_pay) || 0;
      return { payroll_id: p.id, employee_id: p.employee_id, name: `${p.employees?.first_name ?? ''} ${p.employees?.last_name ?? ''}`, net_pay: Number(p.net_pay) || 0 };
    });
    // Backed out from the credit side so the entry always balances by
    // construction, regardless of which deduction types happen to be zero.
    const salariesExpense = netPayTotal + sssPayable + philPayable + pagibigPayable + svTotal + uniformTotal + cashShortageTotal + employeeLoanTotal;

    const { data: voucher, error } = await supabase.from('payroll_vouchers').insert({
      voucher_number: voucherNumber,
      branch_id: voucherBranchId,
      period: voucherPeriod,
      pay_date: voucherPayDate,
      lines,
      total_net_pay: netPayTotal,
      prepared_by: profile?.id ?? null,
      cashier_name: voucherCashierName || null,
      admin_name: voucherAdminName || null,
    }).select('id').single();

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      setGeneratingVoucher(false);
      return;
    }

    await supabase.from('payroll').update({ voucher_id: voucher.id }).in('id', eligiblePayrollRows.map(p => p.id));

    await postJournalEntry({
      entryDate: voucherPayDate,
      description: `Payroll Voucher — ${voucherBranch?.name ?? ''} — ${formatDate(voucherPayDate)}`,
      reference: voucherNumber,
      source: 'payroll_voucher',
      sourceId: voucher?.id ?? null,
      createdBy: profile?.id ?? null,
      lines: [
        { accountCode: '5010', debit: salariesExpense, memo: 'Salaries Expense' },
        { accountCode: '2010', credit: sssPayable, memo: 'SSS Payable' },
        { accountCode: '2020', credit: philPayable, memo: 'Philhealth Payable' },
        { accountCode: '2030', credit: pagibigPayable, memo: 'PagIBIG Payable' },
        { accountCode: '1120', credit: svTotal, memo: 'Service Vehicle Loan' },
        { accountCode: '1130', credit: uniformTotal, memo: 'Uniform' },
        { accountCode: '1140', credit: cashShortageTotal, memo: 'Cash Shortage' },
        { accountCode: '1110', credit: employeeLoanTotal, memo: 'Employee Loan' },
        { accountCode: '1000', credit: netPayTotal, memo: 'Cash in Vault' },
      ],
    });

    toast({ title: 'Success', description: 'Payroll voucher generated and journal entry posted' });
    // Download while the just-vouchered rows are still showing in the
    // printable div — load() below refreshes `payroll`, which immediately
    // clears eligiblePayrollRows (they're no longer un-vouchered), so
    // Download PDF would produce a blank document if called after this.
    await handleDownloadVoucherPdf(voucherNumber);
    setVoucherNumber(generatePayrollVoucherNumber());
    load();
    loadPayrollVouchers();
    setGeneratingVoucher(false);
  }

  async function handleDownloadVoucherPdf(voucherNumberOverride?: string) {
    if (!payrollVoucherPrintRef.current) return;
    setDownloadingVoucher(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const { jsPDF } = await import('jspdf');
      const canvas = await html2canvas(payrollVoucherPrintRef.current, { backgroundColor: '#ffffff', scale: 2, width: 900, windowWidth: 900 });
      const imgData = canvas.toDataURL('image/png');
      const pxToPt = 0.75;
      const contentWidthPt = (canvas.width / 2) * pxToPt;
      const contentHeightPt = (canvas.height / 2) * pxToPt;
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: [612, 936] });
      const margin = 24;
      const usableWidth = pdf.internal.pageSize.getWidth() - margin * 2;
      const imgWidth = usableWidth;
      const imgHeight = (contentHeightPt / contentWidthPt) * imgWidth;
      pdf.addImage(imgData, 'PNG', margin, margin, imgWidth, imgHeight);
      pdf.save(`payroll-voucher-${voucherNumberOverride ?? printedBranchName ?? ''}-${printedPayDate}.pdf`);
    } catch (err: any) {
      toast({ title: 'Download failed', description: err?.message ?? 'Could not generate the payroll voucher PDF', variant: 'destructive' });
    }
    setDownloadingVoucher(false);
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

      // 8.5" x 13" (Philippine "folio"/long bond paper), in points (72pt/in).
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: [612, 936] });
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
        {activeTab === 'records' && (
          <Button variant="outline" size="sm" onClick={handleExport}><Download className="w-4 h-4 mr-2" />Export</Button>
        )}
      </PageHeader>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'records' | 'thirteenth')}>
        <TabsList className="grid grid-cols-3 w-full sm:w-auto">
          <TabsTrigger value="records">Payroll Records</TabsTrigger>
          <TabsTrigger value="voucher"><FileSpreadsheet className="w-4 h-4 mr-1.5" />Payroll Voucher</TabsTrigger>
          <TabsTrigger value="thirteenth"><Gift className="w-4 h-4 mr-1.5" />13th Month Pay</TabsTrigger>
        </TabsList>

      <TabsContent value="records" className="space-y-6 pt-4">
      {/* Generate panel */}
      <Card className="glass-card border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Calculator className="w-5 h-5" />Generate Payroll</CardTitle>
          <CardDescription>Semi-monthly payroll (15th and 30th)</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-end">
            <div className="space-y-2 flex-1">
              <Label>Period</Label>
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="1">1st</SelectItem><SelectItem value="16">16th</SelectItem></SelectContent>
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
            <>
              {/* Mobile card list */}
              <div className="md:hidden divide-y divide-border">
                {payroll.map(p => {
                  const deductions = payrollDeductionsTotal(p);
                  const { present, total } = daysPresent(p);
                  return (
                    <div key={p.id} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{p.employees?.first_name} {p.employees?.last_name}</p>
                          <p className="text-xs text-muted-foreground">{p.period === '1' ? '1st' : '16th'} cutoff · {formatDate(p.pay_date)}</p>
                        </div>
                        <Badge variant={p.status === 'paid' ? 'default' : 'secondary'} className="shrink-0">{p.status}</Badge>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                        <div><p className="text-xs text-muted-foreground">Days Present</p><p>{present} / {total}</p></div>
                        <div><p className="text-xs text-muted-foreground">Basic</p><p>{formatCurrency(p.basic_salary)}</p></div>
                        <div><p className="text-xs text-muted-foreground">Incentive</p><p className="text-success">{formatCurrency(p.incentive)}</p></div>
                        <div><p className="text-xs text-muted-foreground">Deductions</p><p className="text-destructive">{formatCurrency(deductions)}</p></div>
                        <div className="col-span-2"><p className="text-xs text-muted-foreground">Net Pay</p><p className="font-bold">{formatCurrency(p.net_pay)}</p></div>
                      </div>
                      <div className="mt-3 flex items-center justify-end gap-1">
                        <Button variant="outline" size="sm" onClick={() => setPayslipTarget(p)}>
                          <Receipt className="w-3.5 h-3.5 mr-1.5" />Payslip
                        </Button>
                        {p.status === 'pending' && (
                          <Button variant="outline" size="sm" onClick={() => openEditDeductions(p)}>
                            <Pencil className="w-3.5 h-3.5 mr-1.5" />Deductions
                          </Button>
                        )}
                        {p.status === 'pending' && (
                          <Button variant="outline" size="sm" onClick={() => approvePayroll(p.id)}>
                            <CheckCircle className="w-3.5 h-3.5 mr-1.5 text-success" />Approve
                          </Button>
                        )}
                        {isAdmin && (
                          <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteTarget(p)}>
                            <Trash2 className="w-3.5 h-3.5 mr-1.5" />Delete
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <Table className="hidden md:table">
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
                  const deductions = payrollDeductionsTotal(p);
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
                            <Button variant="ghost" size="icon" onClick={() => openEditDeductions(p)} title="Edit deductions">
                              <Pencil className="w-4 h-4" />
                            </Button>
                          )}
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
            </>
          )}
        </CardContent>
      </Card>
      </TabsContent>

      <TabsContent value="voucher" className="space-y-6 pt-4">
      <Card className="glass-card border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileSpreadsheet className="w-5 h-5" />Payroll Voucher</CardTitle>
          <CardDescription>Summary of net pay per employee for one cutoff — generating posts the journal entry and marks those payroll records as vouchered</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className="text-xs">Branch</Label>
              <Select value={voucherBranchId} onValueChange={setVoucherBranchId}>
                <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                <SelectContent>{branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Period</Label>
              <Select value={voucherPeriod} onValueChange={setVoucherPeriod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="1">1st</SelectItem><SelectItem value="16">16th</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Pay Date</Label>
              <Input type="date" value={voucherPayDate} onChange={(e) => setVoucherPayDate(e.target.value)} />
            </div>
          </div>

          {eligiblePayrollRows.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No approved, not-yet-vouchered payroll records for this branch/cutoff</p>
          ) : (
            <div className="border border-border rounded-lg divide-y divide-border overflow-hidden">
              {eligiblePayrollRows.map(p => (
                <div key={p.id} className="flex items-center justify-between p-3 text-sm">
                  <span>{p.employees?.first_name} {p.employees?.last_name}</span>
                  <span className="font-medium">{formatCurrency(p.net_pay)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2"><Label className="text-xs">Disbursed by (Branch Cashier)</Label><Input value={voucherCashierName} onChange={(e) => setVoucherCashierName(e.target.value)} /></div>
            <div className="space-y-2"><Label className="text-xs">Approved by (Admin)</Label><Input value={voucherAdminName} onChange={(e) => setVoucherAdminName(e.target.value)} /></div>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Grand Total: <span className="font-semibold text-foreground">{formatCurrency(voucherNetPayTotal)}</span></p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setVoucherPreviewOpen(true)} disabled={eligiblePayrollRows.length === 0}>
                <Eye className="w-4 h-4 mr-2" />
                Preview
              </Button>
              <Button type="button" variant="outline" onClick={() => handleDownloadVoucherPdf()} disabled={downloadingVoucher || eligiblePayrollRows.length === 0}>
                {downloadingVoucher ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                Download PDF
              </Button>
              <Button type="button" onClick={handleGenerateVoucher} disabled={generatingVoucher || eligiblePayrollRows.length === 0}>
                {generatingVoucher && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Generate
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card border-border">
        <CardHeader><CardTitle>History</CardTitle><CardDescription>Last 30 payroll vouchers</CardDescription></CardHeader>
        <CardContent className="p-0">
          {payrollVouchers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No payroll vouchers generated yet</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Voucher #</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Pay Date</TableHead>
                  <TableHead>Employees</TableHead>
                  <TableHead>Total Net Pay</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payrollVouchers.map(v => (
                  <TableRow key={v.id}>
                    <TableCell className="text-sm font-mono">{v.voucher_number}</TableCell>
                    <TableCell className="text-sm">{v.branches?.name ?? '—'}</TableCell>
                    <TableCell className="text-sm">{formatDate(v.pay_date)}</TableCell>
                    <TableCell className="text-sm">{((v.lines ?? []) as any[]).length}</TableCell>
                    <TableCell className="text-sm font-medium">{formatCurrency(v.total_net_pay)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Download PDF"
                        disabled={downloadingHistoryVoucherId === v.id}
                        onClick={() => { setDownloadingHistoryVoucherId(v.id); setHistoryPayrollVoucher(v); }}
                      >
                        {downloadingHistoryVoucherId === v.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={voucherPreviewOpen} onOpenChange={setVoucherPreviewOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Payroll Voucher Preview</DialogTitle>
            <DialogDescription>{voucherBranch?.name ?? ''} — {printedParticulars}</DialogDescription>
          </DialogHeader>
          <div className="bg-secondary/30 p-4 rounded-lg">
            <DocumentScaler width={900}>
              <div style={{ width: 900, background: '#fff', color: '#111', padding: 40, fontFamily: '"Times New Roman", Calibri, serif' }}>
                {renderPayrollVoucherCopy()}
              </div>
            </DocumentScaler>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoucherPreviewOpen(false)}>Close</Button>
            <Button onClick={() => handleDownloadVoucherPdf()} disabled={downloadingVoucher}>
              {downloadingVoucher ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
              Download PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hidden printable Payroll Voucher, matching the company's paper
          Cash Voucher format exactly. */}
      {typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', top: 0, left: 0, opacity: 0, pointerEvents: 'none', zIndex: -1 }}>
          <div ref={payrollVoucherPrintRef} style={{ width: 900, background: '#fff', color: '#111', padding: 40, fontFamily: '"Times New Roman", Calibri, serif' }}>
            {renderPayrollVoucherCopy()}
          </div>
        </div>,
        document.body
      )}
      </TabsContent>

      <TabsContent value="thirteenth" className="space-y-6 pt-4">
      {/* 13th Month Pay */}
      <Card className="glass-card border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2"><Gift className="w-5 h-5" />13th Month Pay</CardTitle>
            <CardDescription>{thirteenthCycleLabel} — Total Earnings ÷ 12, minus any adjustments</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={thirteenthCycle} onValueChange={(v) => setThirteenthCycle(v as 'partial' | 'full')}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="partial">Partial (June)</SelectItem>
                <SelectItem value="full">Full (December)</SelectItem>
              </SelectContent>
            </Select>
            <Select value={thirteenthYear} onValueChange={setThirteenthYear}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(payrollYears.includes(thirteenthYear) ? payrollYears : [thirteenthYear, ...payrollYears]).map(y => (
                  <SelectItem key={y} value={y}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={handleExportThirteenthMonth}>
              <Download className="w-4 h-4 mr-2" />Export
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {thirteenthMonthRows.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No payroll records for this period</p>
          ) : (
            <>
              {/* Mobile card list */}
              <div className="md:hidden divide-y divide-border">
                {thirteenthMonthRows.map(r => (
                  <div key={r.employee_id} className="p-4">
                    <p className="font-medium text-sm">{r.employee?.first_name} {r.employee?.last_name}</p>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                      <div><p className="text-xs text-muted-foreground">Total Earnings</p><p>{formatCurrency(r.totalEarnings)}</p></div>
                      <div><p className="text-xs text-muted-foreground">Net Pay</p><p className="font-bold">{formatCurrency(r.netPay)}</p></div>
                    </div>
                    <div className="mt-3 flex justify-end">
                      <Button variant="outline" size="sm" onClick={() => setBreakdownEmployeeId(r.employee_id)}>
                        <ListTree className="w-3.5 h-3.5 mr-1.5" />Breakdown
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <Table className="hidden md:table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Total Earnings</TableHead>
                    <TableHead>÷ 12</TableHead>
                    <TableHead>Total Deduction</TableHead>
                    <TableHead>Net Pay</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {thirteenthMonthRows.map(r => (
                    <TableRow key={r.employee_id} className="hover:bg-secondary/50">
                      <TableCell className="text-sm font-medium">{r.employee?.first_name} {r.employee?.last_name}</TableCell>
                      <TableCell className="text-sm">{formatCurrency(r.totalEarnings)}</TableCell>
                      <TableCell className="text-sm">{formatCurrency(r.dividedBy12)}</TableCell>
                      <TableCell className="text-sm text-destructive">{r.totalDeduction > 0 ? formatCurrency(r.totalDeduction) : '—'}</TableCell>
                      <TableCell className="text-sm font-bold">{formatCurrency(r.netPay)}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => setBreakdownEmployeeId(r.employee_id)} title="View breakdown / edit adjustments">
                          <ListTree className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>

      {/* 13th Month Voucher */}
      <Card className="glass-card border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileSpreadsheet className="w-5 h-5" />13th Month Voucher</CardTitle>
          <CardDescription>Summary of net 13th month pay per employee — generating posts the journal entry</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2"><Label className="text-xs">Disbursed by (Branch Cashier)</Label><Input value={thirteenthCashierName} onChange={(e) => setThirteenthCashierName(e.target.value)} /></div>
            <div className="space-y-2"><Label className="text-xs">Approved by (Admin)</Label><Input value={thirteenthAdminName} onChange={(e) => setThirteenthAdminName(e.target.value)} /></div>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Grand Total: <span className="font-semibold text-foreground">{formatCurrency(thirteenthNetPayTotal)}</span></p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setThirteenthVoucherPreviewOpen(true)} disabled={thirteenthMonthRows.length === 0}>
                <Eye className="w-4 h-4 mr-2" />
                Preview
              </Button>
              <Button type="button" variant="outline" onClick={() => handleDownloadThirteenthVoucherPdf()} disabled={downloadingThirteenthVoucher || thirteenthMonthRows.length === 0}>
                {downloadingThirteenthVoucher ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                Download PDF
              </Button>
              <Button type="button" onClick={handleGenerateThirteenthVoucher} disabled={generatingThirteenthVoucher || thirteenthMonthRows.length === 0}>
                {generatingThirteenthVoucher && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Generate
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card border-border">
        <CardHeader><CardTitle>History</CardTitle><CardDescription>Last 30 13th Month vouchers</CardDescription></CardHeader>
        <CardContent className="p-0">
          {thirteenthVouchers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No 13th Month vouchers generated yet</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Voucher #</TableHead>
                  <TableHead>Cycle</TableHead>
                  <TableHead>Year</TableHead>
                  <TableHead>Employees</TableHead>
                  <TableHead>Total Net Pay</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {thirteenthVouchers.map(v => (
                  <TableRow key={v.id}>
                    <TableCell className="text-sm font-mono">{v.voucher_number}</TableCell>
                    <TableCell className="text-sm capitalize">{v.cycle}</TableCell>
                    <TableCell className="text-sm">{v.year}</TableCell>
                    <TableCell className="text-sm">{((v.lines ?? []) as any[]).length}</TableCell>
                    <TableCell className="text-sm font-medium">{formatCurrency(v.total_net_pay)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Download PDF"
                        disabled={downloadingHistoryThirteenthId === v.id}
                        onClick={() => { setDownloadingHistoryThirteenthId(v.id); setHistoryThirteenthVoucher(v); }}
                      >
                        {downloadingHistoryThirteenthId === v.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={thirteenthVoucherPreviewOpen} onOpenChange={setThirteenthVoucherPreviewOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>13th Month Voucher Preview</DialogTitle>
            <DialogDescription>{thirteenthCycleLabel}</DialogDescription>
          </DialogHeader>
          <div className="bg-secondary/30 p-4 rounded-lg">
            <DocumentScaler width={900}>
              <div style={{ width: 900, background: '#fff', color: '#111', padding: 40, fontFamily: '"Times New Roman", Calibri, serif' }}>
                {renderThirteenthVoucherCopy()}
              </div>
            </DocumentScaler>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setThirteenthVoucherPreviewOpen(false)}>Close</Button>
            <Button onClick={() => handleDownloadThirteenthVoucherPdf()} disabled={downloadingThirteenthVoucher}>
              {downloadingThirteenthVoucher ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
              Download PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hidden printable 13th Month Voucher */}
      {typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', top: 0, left: 0, opacity: 0, pointerEvents: 'none', zIndex: -1 }}>
          <div ref={thirteenthVoucherPrintRef} style={{ width: 900, background: '#fff', color: '#111', padding: 40, fontFamily: '"Times New Roman", Calibri, serif' }}>
            {renderThirteenthVoucherCopy()}
          </div>
        </div>,
        document.body
      )}
      </TabsContent>
      </Tabs>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Payroll Record</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this {deleteTarget?.period === '1' ? '1st' : '16th'} payroll record for {deleteTarget?.employees?.first_name} {deleteTarget?.employees?.last_name} ({deleteTarget && formatCurrency(deleteTarget.net_pay)} net pay)? This action cannot be undone.
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

      <Dialog open={!!editDeductionsTarget} onOpenChange={(open) => !open && setEditDeductionsTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Deductions</DialogTitle>
            <DialogDescription>
              {editDeductionsTarget?.employees?.first_name} {editDeductionsTarget?.employees?.last_name} — no fixed formula for these, enter what's actually being deducted this cutoff.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {SPECIAL_LOAN_LABELS.map(({ key, label }) => {
              const balance = editDeductionsTarget ? (specialLoanBalances[editDeductionsTarget.employee_id]?.[key] ?? 0) : 0;
              return (
                <div key={key} className="space-y-2">
                  <Label className="text-xs">{label}{balance > 0 ? ` (balance: ${formatCurrency(balance)})` : ''}</Label>
                  <Input
                    type="number"
                    value={editDeductionsForm[key]}
                    onChange={(e) => setEditDeductionsForm(f => ({ ...f, [key]: e.target.value }))}
                    placeholder="0.00"
                  />
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDeductionsTarget(null)}>Cancel</Button>
            <Button onClick={handleSaveDeductions} disabled={savingDeductions}>
              {savingDeductions && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!breakdownEmployeeId} onOpenChange={(open) => !open && setBreakdownEmployeeId(null)}>
        <DialogContent className="max-w-md">
          {(() => {
            if (!breakdownEmployeeId) return null;
            const row = thirteenthMonthRows.find(r => r.employee_id === breakdownEmployeeId);
            const cutoffs = getCutoffBreakdown(breakdownEmployeeId, thirteenthYear, thirteenthCycle);
            const adj = thirteenthAdjustments[breakdownEmployeeId] ?? { deductionFromEarnings: '', totalDeduction: '' };
            return (
              <>
                <DialogHeader>
                  <DialogTitle>13th Month Pay Breakdown</DialogTitle>
                  <DialogDescription>{row?.employee?.first_name} {row?.employee?.last_name} — {thirteenthCycleLabel}</DialogDescription>
                </DialogHeader>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cutoff</TableHead>
                      <TableHead className="text-right">Basic Salary</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cutoffs.map((c, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-sm">{c.label}</TableCell>
                        <TableCell className="text-sm text-right">{formatCurrency(c.amount)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell className="text-sm font-bold">Total Earnings</TableCell>
                      <TableCell className="text-sm font-bold text-right">{formatCurrency(row?.totalEarnings ?? 0)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>

                <div className="grid grid-cols-1 gap-3 pt-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Deduction from Earnings (e.g. leave adjustment, before ÷ 12)</Label>
                    <Input
                      type="number"
                      value={adj.deductionFromEarnings}
                      onChange={(e) => setThirteenthAdjustments(prev => ({ ...prev, [breakdownEmployeeId!]: { ...adj, deductionFromEarnings: e.target.value } }))}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Total Deduction (from net pay, after ÷ 12)</Label>
                    <Input
                      type="number"
                      value={adj.totalDeduction}
                      onChange={(e) => setThirteenthAdjustments(prev => ({ ...prev, [breakdownEmployeeId!]: { ...adj, totalDeduction: e.target.value } }))}
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <Table>
                  <TableBody>
                    <TableRow>
                      <TableCell className="text-sm font-bold">Divided by 12</TableCell>
                      <TableCell className="text-sm font-bold text-right">{formatCurrency(row?.dividedBy12 ?? 0)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="text-sm font-bold text-success">Net Pay</TableCell>
                      <TableCell className="text-sm font-bold text-success text-right">{formatCurrency(row?.netPay ?? 0)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setBreakdownEmployeeId(null)}>Close</Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      <Dialog open={!!payslipTarget} onOpenChange={(open) => !open && setPayslipTarget(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Payslip</DialogTitle>
            <DialogDescription>
              {payslipTarget?.employees?.first_name} {payslipTarget?.employees?.last_name} — {payslipTarget?.period === '1' ? '1st' : '16th'} cutoff, {payslipTarget && formatDate(payslipTarget.pay_date)}
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
