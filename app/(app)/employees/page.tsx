'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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
import { formatCurrency, formatDate, getInitials, exportToCSV } from '@/lib/format';
import { UserCog, Plus, Search, Download, Pencil, Trash2, Loader2, Eye } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function EmployeesPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { profile } = useAuth();
  const isAdmin = profile?.role_name === 'Administrator';
  const [employees, setEmployees] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [areas, setAreas] = useState<any[]>([]);
  const [positions, setPositions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
  const [positionFilter, setPositionFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [createLogin, setCreateLogin] = useState(true);
  const pageSize = 10;

  const [form, setForm] = useState({
    first_name: '', last_name: '', middle_name: '', department: '', position: '',
    branch_id: '', area_id: '', salary: '', pay_type: 'daily', status: 'active', hire_date: '', birth_date: '', phone: '', email: '', address: '',
    sss_number: '', philhealth_number: '', pagibig_number: '', tin_number: '',
    contact_person_name: '', contact_person_relationship: '', contact_person_phone: '',
  });

  useEffect(() => { load(); loadBranches(); loadAreas(); loadPositions(); }, [search, branchFilter, positionFilter, statusFilter, page]);

  async function loadBranches() {
    const { data } = await supabase.from('branches').select('id, name').eq('status', 'active');
    setBranches(data ?? []);
  }

  async function loadAreas() {
    const { data } = await supabase.from('areas').select('id, name, branch_id').eq('status', 'active');
    setAreas(data ?? []);
  }

  async function loadPositions() {
    const { data } = await supabase.from('roles').select('id, name').neq('name', 'Administrator').order('name');
    setPositions(data ?? []);
  }

  async function load() {
    setLoading(true);
    let query = supabase.from('employees').select('*, branches(name)', { count: 'exact' });
    if (search) query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%`);
    if (branchFilter !== 'all') query = query.eq('branch_id', branchFilter);
    if (positionFilter !== 'all') query = query.eq('position', positionFilter);
    if (statusFilter !== 'all') query = query.eq('status', statusFilter);
    query = query.range((page - 1) * pageSize, page * pageSize - 1).order('created_at', { ascending: false });
    const { data, count } = await query;
    setEmployees(data ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }

  function openCreate() {
    setEditing(null);
    setForm({
      first_name: '', last_name: '', middle_name: '', department: '', position: '', branch_id: '', area_id: '', salary: '', pay_type: 'daily', status: 'active', hire_date: '', birth_date: '', phone: '', email: '', address: '',
      sss_number: '', philhealth_number: '', pagibig_number: '', tin_number: '',
      contact_person_name: '', contact_person_relationship: '', contact_person_phone: '',
    });
    setCreateLogin(true);
    setDialogOpen(true);
  }

  function openEdit(e: any) {
    setEditing(e);
    setForm({
      first_name: e.first_name, last_name: e.last_name, middle_name: e.middle_name ?? '',
      department: e.department ?? '', position: e.position ?? '', branch_id: e.branch_id ?? '', area_id: e.area_id ?? '',
      salary: String(e.salary ?? ''), pay_type: e.pay_type ?? 'daily', status: e.status, hire_date: e.hire_date ?? '', birth_date: e.birth_date ?? '',
      phone: e.phone ?? '', email: e.email ?? '', address: e.address ?? '',
      sss_number: e.sss_number ?? '', philhealth_number: e.philhealth_number ?? '', pagibig_number: e.pagibig_number ?? '', tin_number: e.tin_number ?? '',
      contact_person_name: e.contact_person_name ?? '', contact_person_relationship: e.contact_person_relationship ?? '', contact_person_phone: e.contact_person_phone ?? '',
    });
    setDialogOpen(true);
  }

  // customers.collector_id references the separate `collectors` table (linked
  // to login accounts), not `employees` directly — keep them in sync whenever
  // an employee with a login account is saved as (or stops being) a Collector.
  async function syncCollectorRecord(
    profileId: string,
    payload: { position: string | null; branch_id: string | null; area_id: string | null; status: string }
  ) {
    if (payload.position !== 'Branch Field Collector') {
      await supabase.from('collectors').delete().eq('profile_id', profileId);
      return;
    }
    const { data: existing } = await supabase.from('collectors').select('id').eq('profile_id', profileId).maybeSingle();
    const collectorPayload = { branch_id: payload.branch_id, area_id: payload.area_id, status: payload.status };
    if (existing) {
      await supabase.from('collectors').update(collectorPayload).eq('id', existing.id);
    } else {
      await supabase.from('collectors').insert({ profile_id: profileId, ...collectorPayload });
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.birth_date) {
      toast({ title: 'Error', description: 'Birth date is required (used for birthday leave/pay)', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const payload = {
      first_name: form.first_name, last_name: form.last_name, middle_name: form.middle_name || null,
      department: form.department || null, position: form.position || null,
      branch_id: form.branch_id || null,
      area_id: form.position === 'Branch Field Collector' ? (form.area_id || null) : null,
      salary: Number(form.salary) || 0, pay_type: form.pay_type,
      status: form.status, hire_date: form.hire_date || null, birth_date: form.birth_date,
      phone: form.phone || null, email: form.email || null, address: form.address || null,
      sss_number: form.sss_number || null, philhealth_number: form.philhealth_number || null,
      pagibig_number: form.pagibig_number || null, tin_number: form.tin_number || null,
      contact_person_name: form.contact_person_name || null,
      contact_person_relationship: form.contact_person_relationship || null,
      contact_person_phone: form.contact_person_phone || null,
    };
    if (editing) {
      const { error } = await supabase.from('employees').update(payload).eq('id', editing.id);
      if (error) {
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
      } else {
        if (editing.profile_id) await syncCollectorRecord(editing.profile_id, payload);
        toast({ title: 'Success', description: 'Employee updated' });
        setDialogOpen(false);
        load();
      }
    } else {
      const { data: inserted, error } = await supabase.from('employees').insert(payload).select('id').single();
      if (error) {
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
        setSaving(false);
        return;
      }
      toast({ title: 'Success', description: 'Employee added' });

      if (createLogin && form.email && form.position) {
        await createLoginAccount(inserted.id);
      }

      setDialogOpen(false);
      load();
    }
    setSaving(false);
  }

  async function createLoginAccount(employeeId: string) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    try {
      const res = await fetch('/api/employees/create-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          email: form.email,
          full_name: `${form.first_name} ${form.last_name}`,
          role_name: form.position,
          branch_id: form.branch_id || null,
          employee_id: employeeId,
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        toast({ title: 'Login account not created', description: result.error ?? 'Unknown error', variant: 'destructive' });
      } else if (result.emailSent) {
        toast({ title: 'Login account created', description: `Credentials emailed to ${form.email}` });
      } else {
        toast({
          title: 'Login account created, but email failed',
          description: result.password ? `Share this password manually: ${result.password}` : (result.emailError ?? 'Email could not be sent'),
        });
      }
    } catch (err: any) {
      toast({ title: 'Login account not created', description: err?.message ?? 'Network error', variant: 'destructive' });
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;

    if (deleteTarget.profile_id) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const res = await fetch('/api/employees/delete-account', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ profile_id: deleteTarget.profile_id }),
        });
        if (!res.ok) {
          const result = await res.json().catch(() => ({}));
          toast({ title: 'Login account not deleted', description: result.error ?? 'Unknown error', variant: 'destructive' });
        }
      }
    }

    const { error } = await supabase.from('employees').delete().eq('id', deleteTarget.id);
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Success', description: 'Employee deleted' }); setDeleteTarget(null); load(); }
  }

  function handleExport() {
    exportToCSV(employees.map(e => ({
      Name: `${e.first_name} ${e.last_name}`, Department: e.department ?? '', Position: e.position ?? '',
      Branch: e.branches?.name ?? '', PayType: e.pay_type ?? 'daily', Salary: e.salary, Status: e.status, Hired: e.hire_date ?? '',
      SSS: e.sss_number ?? '', PhilHealth: e.philhealth_number ?? '', PagIBIG: e.pagibig_number ?? '', TIN: e.tin_number ?? '',
      ContactPerson: e.contact_person_name ?? '', ContactRelationship: e.contact_person_relationship ?? '', ContactPhone: e.contact_person_phone ?? '',
    })), 'employees.csv');
  }

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-6">
      <PageHeader title="Employee Management" description="Manage employee profiles, departments, and status">
        <Button variant="outline" size="sm" onClick={handleExport}><Download className="w-4 h-4 mr-2" />Export</Button>
        {isAdmin && (
          <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-2" />Add Employee</Button>
        )}
      </PageHeader>

      <Card className="glass-card border-border">
        <CardContent className="p-4 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search employees..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="pl-10" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Select value={branchFilter} onValueChange={(v) => { setBranchFilter(v); setPage(1); }}>
              <SelectTrigger><SelectValue placeholder="Branch" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Branches</SelectItem>
                {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={positionFilter} onValueChange={(v) => { setPositionFilter(v); setPage(1); }}>
              <SelectTrigger><SelectValue placeholder="Position" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Positions</SelectItem>
                {positions.map(p => <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="resigned">Resigned</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card border-border">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : employees.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <UserCog className="w-12 h-12 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">No employees found</p>
            </div>
          ) : (
            <>
              {/* Mobile card list */}
              <div className="md:hidden divide-y divide-border">
                {employees.map(e => (
                  <div key={e.id} className="p-4 active:bg-secondary/50 cursor-pointer" onClick={() => router.push(`/employees/${e.id}`)}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar className="w-9 h-9 shrink-0">
                          <AvatarImage src={e.photo_url ?? undefined} className="object-cover" />
                          <AvatarFallback className="bg-primary/10 text-primary text-xs">{getInitials(`${e.first_name} ${e.last_name}`)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{e.first_name} {e.last_name}</p>
                          <p className="text-xs text-muted-foreground truncate">{e.position ?? '—'}</p>
                        </div>
                      </div>
                      <Badge variant={e.status === 'active' ? 'default' : 'secondary'} className="shrink-0">{e.status}</Badge>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                      <div><p className="text-xs text-muted-foreground">Department</p><p className="truncate">{e.department ?? '—'}</p></div>
                      <div><p className="text-xs text-muted-foreground">Branch</p><p className="truncate">{e.branches?.name ?? '—'}</p></div>
                      <div className="col-span-2"><p className="text-xs text-muted-foreground">Rate</p><p className="font-medium">{formatCurrency(e.salary)}{e.pay_type === 'monthly' ? '/mo' : '/day'}</p></div>
                    </div>
                    <div className="mt-3 flex items-center justify-end gap-1" onClick={(e2) => e2.stopPropagation()}>
                      <Button variant="outline" size="sm" onClick={() => openEdit(e)}><Pencil className="w-3.5 h-3.5 mr-1.5" />Edit</Button>
                      <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteTarget(e)}><Trash2 className="w-3.5 h-3.5 mr-1.5" />Delete</Button>
                    </div>
                  </div>
                ))}
              </div>

              <Table className="hidden md:table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Position</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Daily Rate</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employees.map(e => (
                    <TableRow key={e.id} className="hover:bg-secondary/50 cursor-pointer" onClick={() => router.push(`/employees/${e.id}`)}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="w-9 h-9">
                            <AvatarImage src={e.photo_url ?? undefined} className="object-cover" />
                            <AvatarFallback className="bg-primary/10 text-primary text-xs">{getInitials(`${e.first_name} ${e.last_name}`)}</AvatarFallback>
                          </Avatar>
                          <div><p className="font-medium text-sm">{e.first_name} {e.last_name}</p><p className="text-xs text-muted-foreground">{e.email ?? ''}</p></div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{e.department ?? '—'}</TableCell>
                      <TableCell className="text-sm">{e.position ?? '—'}</TableCell>
                      <TableCell className="text-sm">{e.branches?.name ?? '—'}</TableCell>
                      <TableCell className="text-sm font-medium">{formatCurrency(e.salary)}{e.pay_type === 'monthly' ? '/mo' : '/day'}</TableCell>
                      <TableCell><Badge variant={e.status === 'active' ? 'default' : 'secondary'}>{e.status}</Badge></TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end" onClick={(e2) => e2.stopPropagation()}>
                          <Button variant="ghost" size="icon" onClick={() => router.push(`/employees/${e.id}`)}><Eye className="w-4 h-4" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => openEdit(e)}><Pencil className="w-4 h-4" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(e)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 border-t border-border">
                <p className="text-sm text-muted-foreground">Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Employee' : 'Add Employee'}</DialogTitle>
            <DialogDescription>{editing ? 'Update employee information' : 'Register a new employee'}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2"><Label>First Name *</Label><Input required value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} /></div>
              <div className="space-y-2"><Label>Last Name *</Label><Input required value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} /></div>
              <div className="space-y-2"><Label>Department</Label><Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="e.g. Operations" /></div>
              <div className="space-y-2">
                <Label>Position</Label>
                <Select value={form.position} onValueChange={(v) => setForm({ ...form, position: v, area_id: v === 'Branch Field Collector' ? form.area_id : '' })}>
                  <SelectTrigger><SelectValue placeholder="Select position" /></SelectTrigger>
                  <SelectContent>{positions.map(p => <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Branch</Label>
                <Select value={form.branch_id} onValueChange={(v) => setForm({ ...form, branch_id: v, area_id: '' })}>
                  <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                  <SelectContent>{branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {form.position === 'Branch Field Collector' && (
                <div className="space-y-2">
                  <Label>Area</Label>
                  <Select value={form.area_id} onValueChange={(v) => setForm({ ...form, area_id: v })} disabled={!form.branch_id}>
                    <SelectTrigger><SelectValue placeholder={form.branch_id ? 'Select area' : 'Select a branch first'} /></SelectTrigger>
                    <SelectContent>
                      {areas.filter(a => a.branch_id === form.branch_id).map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <Label>Pay Type</Label>
                <Select value={form.pay_type} onValueChange={(v) => setForm({ ...form, pay_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily Rate</SelectItem>
                    <SelectItem value="monthly">Fixed Monthly Salary</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{form.pay_type === 'monthly' ? 'Monthly Salary (₱)' : 'Daily Rate (₱)'}</Label>
                <Input type="number" value={form.salary} onChange={(e) => setForm({ ...form, salary: e.target.value })} placeholder="0.00" />
              </div>
              <div className="space-y-2"><Label>Hire Date</Label><Input type="date" value={form.hire_date} onChange={(e) => setForm({ ...form, hire_date: e.target.value })} /></div>
              <div className="space-y-2">
                <Label>Birth Date *</Label>
                <Input type="date" required value={form.birth_date} onChange={(e) => setForm({ ...form, birth_date: e.target.value })} />
                <p className="text-xs text-muted-foreground">Used for birthday leave/pay on payroll</p>
              </div>
              <div className="space-y-2"><Label>Status</Label><Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem><SelectItem value="resigned">Resigned</SelectItem></SelectContent></Select></div>
              <div className="space-y-2"><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              <div className="space-y-2"><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            </div>
            <div className="space-y-2"><Label>Address</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Government IDs</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2"><Label className="text-xs text-muted-foreground">SSS Number</Label><Input value={form.sss_number} onChange={(e) => setForm({ ...form, sss_number: e.target.value })} /></div>
                <div className="space-y-2"><Label className="text-xs text-muted-foreground">PhilHealth Number</Label><Input value={form.philhealth_number} onChange={(e) => setForm({ ...form, philhealth_number: e.target.value })} /></div>
                <div className="space-y-2"><Label className="text-xs text-muted-foreground">Pag-IBIG Number</Label><Input value={form.pagibig_number} onChange={(e) => setForm({ ...form, pagibig_number: e.target.value })} /></div>
                <div className="space-y-2"><Label className="text-xs text-muted-foreground">TIN</Label><Input value={form.tin_number} onChange={(e) => setForm({ ...form, tin_number: e.target.value })} /></div>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Contact Person</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2 col-span-2"><Label className="text-xs text-muted-foreground">Name</Label><Input value={form.contact_person_name} onChange={(e) => setForm({ ...form, contact_person_name: e.target.value })} placeholder="e.g. Juan Dela Cruz" /></div>
                <div className="space-y-2"><Label className="text-xs text-muted-foreground">Relationship</Label><Input value={form.contact_person_relationship} onChange={(e) => setForm({ ...form, contact_person_relationship: e.target.value })} placeholder="e.g. Spouse, Parent" /></div>
                <div className="space-y-2"><Label className="text-xs text-muted-foreground">Contact Number</Label><Input value={form.contact_person_phone} onChange={(e) => setForm({ ...form, contact_person_phone: e.target.value })} /></div>
              </div>
            </div>

            {!editing && (
              <div className="flex items-start space-x-2 rounded-lg border border-border p-3">
                <Checkbox
                  id="createLogin"
                  checked={createLogin}
                  onCheckedChange={(checked) => setCreateLogin(checked === true)}
                />
                <div>
                  <Label htmlFor="createLogin" className="cursor-pointer">Create login account</Label>
                  <p className="text-xs text-muted-foreground">
                    Generates a password and emails the login credentials to the Email address above (using the selected Position as their system role). Requires Email and Position to be filled in.
                  </p>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}{editing ? 'Update' : 'Add'} Employee</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Employee</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {deleteTarget?.first_name} {deleteTarget?.last_name}?
              {deleteTarget?.profile_id && ' Their login account will also be permanently deleted.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button><Button variant="destructive" onClick={handleDelete}>Delete</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
