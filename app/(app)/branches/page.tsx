'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
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
import { getInitials, exportToCSV } from '@/lib/format';
import {
  Building2, Plus, Search, Download, Pencil, Trash2, Loader2, Users, UserCog,
} from 'lucide-react';

interface Branch {
  id: string;
  name: string;
  code: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  status: string;
}

export default function BranchesPage() {
  const { toast } = useToast();
  const router = useRouter();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [employeeCounts, setEmployeeCounts] = useState<Record<string, number>>({});
  const [customerCounts, setCustomerCounts] = useState<Record<string, number>>({});
  const [managersByBranch, setManagersByBranch] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Branch | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: '', code: '', address: '', phone: '', email: '', status: 'active',
  });

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [branchesRes, employeesRes, customersRes] = await Promise.all([
      supabase.from('branches').select('*').order('name'),
      supabase.from('employees').select('id, branch_id, first_name, last_name, position'),
      supabase.from('customers').select('id, branch_id'),
    ]);

    setBranches(branchesRes.data ?? []);

    const eCounts: Record<string, number> = {};
    const managers: Record<string, string[]> = {};
    for (const e of employeesRes.data ?? []) {
      if (e.branch_id) {
        eCounts[e.branch_id] = (eCounts[e.branch_id] ?? 0) + 1;
        if (e.position === 'Branch Manager') {
          managers[e.branch_id] = [...(managers[e.branch_id] ?? []), `${e.first_name} ${e.last_name}`];
        }
      }
    }
    setEmployeeCounts(eCounts);
    setManagersByBranch(managers);

    const cCounts: Record<string, number> = {};
    for (const c of customersRes.data ?? []) {
      if (c.branch_id) cCounts[c.branch_id] = (cCounts[c.branch_id] ?? 0) + 1;
    }
    setCustomerCounts(cCounts);

    setLoading(false);
  }

  function nextBranchCode() {
    let max = 0;
    for (const b of branches) {
      const m = b.code?.match(/^BR-(\d+)$/i);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `BR-${String(max + 1).padStart(3, '0')}`;
  }

  function openCreate() {
    setEditing(null);
    setForm({ name: '', code: nextBranchCode(), address: '', phone: '', email: '', status: 'active' });
    setDialogOpen(true);
  }

  function openEdit(b: Branch) {
    setEditing(b);
    setForm({
      name: b.name, code: b.code, address: b.address ?? '', phone: b.phone ?? '',
      email: b.email ?? '', status: b.status,
    });
    setDialogOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const payload = {
      name: form.name, code: form.code, address: form.address || null,
      phone: form.phone || null, email: form.email || null,
      status: form.status,
    };
    if (editing) {
      const { error } = await supabase.from('branches').update(payload).eq('id', editing.id);
      if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
      else { toast({ title: 'Success', description: 'Branch updated' }); setDialogOpen(false); load(); }
    } else {
      const { error } = await supabase.from('branches').insert(payload);
      if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
      else { toast({ title: 'Success', description: 'Branch added' }); setDialogOpen(false); load(); }
    }
    setSaving(false);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const { error } = await supabase.from('branches').delete().eq('id', deleteTarget.id);
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Success', description: 'Branch deleted' }); setDeleteTarget(null); load(); }
  }

  function handleExport() {
    exportToCSV(branches.map(b => ({
      Name: b.name, Code: b.code, Manager: (managersByBranch[b.id] ?? []).join('; '),
      Employees: employeeCounts[b.id] ?? 0, Customers: customerCounts[b.id] ?? 0,
      Status: b.status,
    })), 'branches.csv');
  }

  const filtered = branches.filter(b =>
    !search || b.name.toLowerCase().includes(search.toLowerCase()) || b.code.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Branch Management" description="Manage branches and see how each connects down to its employees and clients">
        <Button variant="outline" size="sm" onClick={handleExport}><Download className="w-4 h-4 mr-2" />Export</Button>
        <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-2" />Add Branch</Button>
      </PageHeader>

      <Card className="glass-card border-border">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search branches..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card border-border">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Building2 className="w-12 h-12 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">No branches found</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Branch</TableHead>
                  <TableHead>Manager</TableHead>
                  <TableHead>Employees</TableHead>
                  <TableHead>Clients</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(b => (
                  <TableRow key={b.id} className="hover:bg-secondary/50 cursor-pointer" onClick={() => router.push(`/branches/${b.id}`)}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="w-9 h-9"><AvatarFallback className="bg-primary/10 text-primary text-xs">{getInitials(b.name)}</AvatarFallback></Avatar>
                        <div><p className="font-medium text-sm">{b.name}</p><p className="text-xs text-muted-foreground">{b.code}</p></div>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{(managersByBranch[b.id] ?? []).join(', ') || '—'}</TableCell>
                    <TableCell className="text-sm">
                      <span className="inline-flex items-center gap-1"><UserCog className="w-3.5 h-3.5 text-muted-foreground" />{employeeCounts[b.id] ?? 0}</span>
                    </TableCell>
                    <TableCell className="text-sm">
                      <span className="inline-flex items-center gap-1"><Users className="w-3.5 h-3.5 text-muted-foreground" />{customerCounts[b.id] ?? 0}</span>
                    </TableCell>
                    <TableCell><Badge variant={b.status === 'active' ? 'default' : 'secondary'}>{b.status}</Badge></TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" onClick={() => openEdit(b)}><Pencil className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(b)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Branch' : 'Add Branch'}</DialogTitle>
            <DialogDescription>{editing ? 'Update branch information' : 'Create a new branch office'}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Name *</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="space-y-2"><Label>Code</Label><Input value={form.code} readOnly disabled className="bg-muted" /></div>
              <div className="space-y-2 col-span-2"><Label>Address</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
              <div className="space-y-2"><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              <div className="space-y-2"><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Manager is assigned automatically — add an employee to this branch with Position set to "Branch Manager" on the Employees page.
            </p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}{editing ? 'Update' : 'Add'} Branch</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Branch</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {deleteTarget?.name}? Employees and clients assigned to it will become unassigned, not deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button><Button variant="destructive" onClick={handleDelete}>Delete</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
