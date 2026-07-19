'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency, formatDate, getInitials } from '@/lib/format';
import {
  ArrowLeft, User, Briefcase, ClipboardCheck, Loader2, Landmark,
} from 'lucide-react';

export default function EmployeeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [employee, setEmployee] = useState<any>(null);
  const [employeeLoans, setEmployeeLoans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, [params.id]);

  async function load() {
    setLoading(true);
    const id = params.id as string;
    const [{ data }, { data: loans }] = await Promise.all([
      supabase.from('employees').select('*, branches(name), areas(name)').eq('id', id).maybeSingle(),
      supabase.from('employee_loans').select('*').eq('employee_id', id).in('status', ['active', 'approved']).order('created_at', { ascending: false }),
    ]);
    setEmployee(data);
    setEmployeeLoans(loans ?? []);
    setLoading(false);
  }

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
  }
  if (!employee) {
    return <p className="text-center text-muted-foreground py-16">Employee not found</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${employee.first_name} ${employee.last_name}`}
        description="Employee details"
      >
        <Button variant="outline" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <Button variant="outline" size="sm" onClick={() => router.push(`/attendance?employee=${employee.id}`)}>
          <ClipboardCheck className="w-4 h-4 mr-2" />
          Attendance
        </Button>
      </PageHeader>

      {employeeLoans.length > 0 && (
        <Card className="glass-card border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Landmark className="w-5 h-5 text-primary" />
              Active Employee Loan{employeeLoans.length > 1 ? 's' : ''}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {employeeLoans.map(loan => (
              <div
                key={loan.id}
                className="flex items-center justify-between p-3 rounded-lg border border-border cursor-pointer hover:bg-secondary/50"
                onClick={() => router.push(`/employee-loans/${loan.id}`)}
              >
                <div>
                  <p className="text-sm font-medium">{formatCurrency(loan.amount)} <Badge variant={loan.status === 'active' ? 'default' : 'secondary'} className="ml-2">{loan.status}</Badge></p>
                  <p className="text-xs text-muted-foreground">{formatCurrency(loan.deduction_amount)} per payroll · {loan.term_months} months</p>
                </div>
                <p className="text-sm font-bold text-destructive">{formatCurrency(loan.remaining_balance)}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-4">
        <Avatar className="w-16 h-16">
          <AvatarImage src={employee.photo_url ?? undefined} className="object-cover" />
          <AvatarFallback className="bg-primary/10 text-primary text-lg">{getInitials(`${employee.first_name} ${employee.last_name}`)}</AvatarFallback>
        </Avatar>
        <div>
          <p className="text-lg font-semibold">{employee.first_name} {employee.middle_name ? `${employee.middle_name} ` : ''}{employee.last_name}</p>
          <Badge variant={employee.status === 'active' ? 'default' : 'secondary'}>{employee.status}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="glass-card border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="w-5 h-5 text-primary" />
              Personal Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Phone:</span>
              <span>{employee.phone ?? '—'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Email:</span>
              <span>{employee.email ?? '—'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Address:</span>
              <span className="text-right">{employee.address ?? '—'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Hire Date:</span>
              <span>{employee.hire_date ? formatDate(employee.hire_date) : '—'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Paid Leaves Used:</span>
              <span>{employee.paid_leaves_used ?? 0}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Briefcase className="w-5 h-5 text-primary" />
              Employment Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Department:</span>
              <span>{employee.department ?? '—'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Position:</span>
              <span className="font-medium">{employee.position ?? '—'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Branch:</span>
              <span>{employee.branches?.name ?? '—'}</span>
            </div>
            {employee.position === 'Branch Field Collector' && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Area:</span>
                <span>{employee.areas?.name ?? '—'}</span>
              </div>
            )}
            <div className="flex justify-between text-sm pt-2 border-t border-border">
              <span className="text-muted-foreground">Daily Rate:</span>
              <span className="font-bold text-primary">{formatCurrency(employee.salary)}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
