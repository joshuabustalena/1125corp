'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import { formatDateTime, formatDate, exportToCSV } from '@/lib/format';
import { ClipboardCheck, Camera, Download, Loader2, Clock, MapPin } from 'lucide-react';

export default function AttendancePage() {
  const { toast } = useToast();
  const [records, setRecords] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkInLoading, setCheckInLoading] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [filterEmployee, setFilterEmployee] = useState('all');

  useEffect(() => { load(); loadEmployees(); }, [filterEmployee]);

  async function loadEmployees() {
    const { data } = await supabase.from('employees').select('id, first_name, last_name').eq('status', 'active');
    setEmployees(data ?? []);
  }

  async function load() {
    setLoading(true);
    let query = supabase.from('attendance').select('*, employees(first_name, last_name)').order('date', { ascending: false });
    if (filterEmployee !== 'all') query = query.eq('employee_id', filterEmployee);
    const { data } = await query.limit(50);
    setRecords(data ?? []);
    setLoading(false);
  }

  async function handleCheckIn() {
    if (!selectedEmployee) { toast({ title: 'Error', description: 'Select an employee first', variant: 'destructive' }); return; }
    setCheckInLoading(true);
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const hour = now.getHours();
    const minute = now.getMinutes();
    const lateMinutes = (hour > 8 || (hour === 8 && minute > 0)) ? (hour - 8) * 60 + minute : 0;

    const { error } = await supabase.from('attendance').insert({
      employee_id: selectedEmployee,
      date: today,
      time_in: now.toISOString(),
      status: lateMinutes > 0 ? 'late' : 'present',
      late_minutes: lateMinutes,
    });
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Success', description: 'Checked in successfully' }); load(); }
    setCheckInLoading(false);
  }

  async function handleCheckOut(id: string) {
    const { error } = await supabase.from('attendance').update({ time_out: new Date().toISOString() }).eq('id', id);
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Success', description: 'Checked out' }); load(); }
  }

  function handleExport() {
    exportToCSV(records.map(r => ({
      Employee: `${r.employees?.first_name} ${r.employees?.last_name}`,
      Date: r.date, TimeIn: r.time_in ?? '', TimeOut: r.time_out ?? '',
      Status: r.status, Late: r.late_minutes, Overtime: r.overtime_minutes,
    })), 'attendance.csv');
  }

  const statusVariant = (s: string) => {
    switch (s) {
      case 'present': return 'default';
      case 'late': return 'outline';
      case 'absent': return 'destructive';
      case 'leave': return 'secondary';
      default: return 'secondary';
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Employee Attendance" description="Camera check-in/check-out with GPS tracking">
        <Button variant="outline" size="sm" onClick={handleExport}><Download className="w-4 h-4 mr-2" />Export</Button>
      </PageHeader>

      {/* Check-in panel */}
      <Card className="glass-card border-border">
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="space-y-2 flex-1">
              <Label>Select Employee</Label>
              <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
                <SelectTrigger><SelectValue placeholder="Choose employee to check in" /></SelectTrigger>
                <SelectContent>{employees.map(e => <SelectItem key={e.id} value={e.id}>{e.first_name} {e.last_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button onClick={handleCheckIn} disabled={checkInLoading} className="h-10">
              {checkInLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Camera className="w-4 h-4 mr-2" />}
              Camera Check-In
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Filter */}
      <Card className="glass-card border-border">
        <CardContent className="p-4">
          <Select value={filterEmployee} onValueChange={setFilterEmployee}>
            <SelectTrigger className="w-full sm:w-64"><SelectValue placeholder="All employees" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Employees</SelectItem>
              {employees.map(e => <SelectItem key={e.id} value={e.id}>{e.first_name} {e.last_name}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="glass-card border-border">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : records.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ClipboardCheck className="w-12 h-12 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">No attendance records</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Time In</TableHead>
                  <TableHead>Time Out</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Late</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map(r => (
                  <TableRow key={r.id} className="hover:bg-secondary/50">
                    <TableCell className="text-sm font-medium">{r.employees?.first_name} {r.employees?.last_name}</TableCell>
                    <TableCell className="text-sm">{formatDate(r.date)}</TableCell>
                    <TableCell className="text-sm">{r.time_in ? formatDateTime(r.time_in) : '—'}</TableCell>
                    <TableCell className="text-sm">{r.time_out ? formatDateTime(r.time_out) : '—'}</TableCell>
                    <TableCell><Badge variant={statusVariant(r.status)}>{r.status}</Badge></TableCell>
                    <TableCell className="text-sm">{r.late_minutes > 0 ? `${r.late_minutes} min` : '—'}</TableCell>
                    <TableCell className="text-right">
                      {!r.time_out && (
                        <Button variant="ghost" size="sm" onClick={() => handleCheckOut(r.id)}>
                          <Clock className="w-4 h-4 mr-1" />Check Out
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
