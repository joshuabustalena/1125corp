'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
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
import { supabase } from '@/lib/supabase/client';
import { formatCurrency, formatDate, getInitials, exportToCSV } from '@/lib/format';
import { UserCog, Plus, Search, Download, Pencil, Trash2, Loader2, Eye } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function EmployeesPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [employees, setEmployees] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [positions, setPositions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
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
    branch_id: '', salary: '', status: 'active', hire_date: '', phone: '', email: '', address: '',
  });

  useEffect(() => { load(); loadBranches(); loadPositions(); }, [search, page]);

  async function loadBranches() {
    const { data } = await supabase.from('branches').select('id, name').eq('status', 'active');
    setBranches(data ?? []);
  }

  async function loadPositions() {
    const { data } = await supabase.from('roles').select('id, name').neq('name', 'Administrator').order('name');
    setPositions(data ?? []);
  }

  async function load() {
    setLoading(true);
    let query = supabase.from('employees').select('*, branches(name)', { count: 'exact' });
    if (search) query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%`);
    query = query.range((page - 1) * pageSize, page * pageSize - 1).order('created_at', { ascending: false });
    const { data, count } = await query;
    setEmployees(data ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }

  function openCreate() {
    setEditing(null);
    setForm({ first_name: '', last_name: '', middle_name: '', department: '', position: '', branch_id: '', salary: '', status: 'active', hire_date: '', phone: '', email: '', address: '' });
    setCreateLogin(true);
    setDialogOpen(true);
  }

  function openEdit(e: any) {
    setEditing(e);
    setForm({
      first_name: e.first_name, last_name: e.last_name, middle_name: e.middle_name ?? '',
      department: e.department ?? '', position: e.position ?? '', branch_id: e.branch_id ?? '',
      salary: String(e.salary ?? ''), status: e.status, hire_date: e.hire_date ?? '',
      phone: e.phone ?? '', email: e.email ?? '', address: e.address ?? '',
    });
    setDialogOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const payload = {
      first_name: form.first_name, last_name: form.last_name, middle_name: form.middle_name || null,
      department: form.department || null, position: form.position || null,
      branch_id: form.branch_id || null, salary: Number(form.salary) || 0,
      status: form.status, hire_date: form.hire_date || null,
      phone: form.phone || null, email: form.email || null, address: form.address || null,
    };
    if (editing) {
      const { error } = await supabase.from('employees').update(payload).eq('id', editing.id);
      if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
      else { toast({ title: 'Success', description: 'Employee updated' }); setDialogOpen(false); load(); }
    } else {
      const { error } = await supabase.from('employees').insert(payload);
      if (error) {
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
        setSaving(false);
        return;
      }
      toast({ title: 'Success', description: 'Employee added' });

      if (createLogin && form.email && form.position) {
        await createLoginAccount();
      }

      setDialogOpen(false);
      load();
    }
    setSaving(false);
  }

  async function createLoginAccount() {
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
    const { error } = await supabase.from('employees').delete().eq('id', deleteTarget.id);
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Success', description: 'Employee deleted' }); setDeleteTarget(null); load(); }
  }

  function handleExport() {
    exportToCSV(employees.map(e => ({
      Name: `${e.first_name} ${e.last_name}`, Department: e.department ?? '', Position: e.position ?? '',
      Branch: e.branches?.name ?? '', Salary: e.salary, Status: e.status, Hired: e.hire_date ?? '',
    })), 'employees.csv');
  }

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-6">
      <PageHeader title="Employee Management" description="Manage employee profiles, departments, and status">
        <Button variant="outline" size="sm" onClick={handleExport}><Download className="w-4 h-4 mr-2" />Export</Button>
        <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-2" />Add Employee</Button>
      </PageHeader>

      <Card className="glass-card border-border">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search employees..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="pl-10" />
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Position</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Salary</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employees.map(e => (
                    <TableRow key={e.id} className="hover:bg-secondary/50">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="w-9 h-9"><AvatarFallback className="bg-primary/10 text-primary text-xs">{getInitials(`${e.first_name} ${e.last_name}`)}</AvatarFallback></Avatar>
                          <div><p className="font-medium text-sm">{e.first_name} {e.last_name}</p><p className="text-xs text-muted-foreground">{e.email ?? ''}</p></div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{e.department ?? '—'}</TableCell>
                      <TableCell className="text-sm">{e.position ?? '—'}</TableCell>
                      <TableCell className="text-sm">{e.branches?.name ?? '—'}</TableCell>
                      <TableCell className="text-sm font-medium">{formatCurrency(e.salary)}</TableCell>
                      <TableCell><Badge variant={e.status === 'active' ? 'default' : 'secondary'}>{e.status}</Badge></TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => router.push(`/attendance?employee=${e.id}`)}><Eye className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => openEdit(e)}><Pencil className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(e)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between p-4 border-t border-border">
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
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>First Name *</Label><Input required value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} /></div>
              <div className="space-y-2"><Label>Last Name *</Label><Input required value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} /></div>
              <div className="space-y-2"><Label>Department</Label><Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="e.g. Operations" /></div>
              <div className="space-y-2">
                <Label>Position</Label>
                <Select value={form.position} onValueChange={(v) => setForm({ ...form, position: v })}>
                  <SelectTrigger><SelectValue placeholder="Select position" /></SelectTrigger>
                  <SelectContent>{positions.map(p => <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Branch</Label><Select value={form.branch_id} onValueChange={(v) => setForm({ ...form, branch_id: v })}><SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger><SelectContent>{branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>Salary (₱)</Label><Input type="number" value={form.salary} onChange={(e) => setForm({ ...form, salary: e.target.value })} placeholder="0.00" /></div>
              <div className="space-y-2"><Label>Hire Date</Label><Input type="date" value={form.hire_date} onChange={(e) => setForm({ ...form, hire_date: e.target.value })} /></div>
              <div className="space-y-2"><Label>Status</Label><Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem><SelectItem value="resigned">Resigned</SelectItem></SelectContent></Select></div>
              <div className="space-y-2"><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              <div className="space-y-2"><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            </div>
            <div className="space-y-2"><Label>Address</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>

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
          <DialogHeader><DialogTitle>Delete Employee</DialogTitle><DialogDescription>Are you sure you want to delete {deleteTarget?.first_name} {deleteTarget?.last_name}?</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button><Button variant="destructive" onClick={handleDelete}>Delete</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
