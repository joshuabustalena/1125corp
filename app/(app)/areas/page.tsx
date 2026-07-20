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
  MapPin, Plus, Search, Download, Pencil, Trash2, Loader2, Users, UserCheck,
} from 'lucide-react';

interface Area {
  id: string;
  name: string;
  branch_id: string | null;
  status: string;
  branches: { name: string } | null;
}

export default function AreasPage() {
  const { toast } = useToast();
  const router = useRouter();
  const [areas, setAreas] = useState<Area[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [collectorCounts, setCollectorCounts] = useState<Record<string, number>>({});
  const [customerCounts, setCustomerCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Area | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: '', branch_id: '', status: 'active',
  });

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [areasRes, branchesRes, collectorsRes, customersRes] = await Promise.all([
      supabase.from('areas').select('*, branches(name)').order('name'),
      supabase.from('branches').select('id, name').eq('status', 'active').order('name'),
      supabase.from('employees').select('id, area_id').eq('position', 'Branch Field Collector'),
      supabase.from('customers').select('id, area_id'),
    ]);

    setAreas(areasRes.data ?? []);
    setBranches(branchesRes.data ?? []);

    const cCounts: Record<string, number> = {};
    for (const c of collectorsRes.data ?? []) {
      if (c.area_id) cCounts[c.area_id] = (cCounts[c.area_id] ?? 0) + 1;
    }
    setCollectorCounts(cCounts);

    const custCounts: Record<string, number> = {};
    for (const c of customersRes.data ?? []) {
      if (c.area_id) custCounts[c.area_id] = (custCounts[c.area_id] ?? 0) + 1;
    }
    setCustomerCounts(custCounts);

    setLoading(false);
  }

  function openCreate() {
    setEditing(null);
    setForm({ name: '', branch_id: '', status: 'active' });
    setDialogOpen(true);
  }

  function openEdit(a: Area) {
    setEditing(a);
    setForm({
      name: a.name, branch_id: a.branch_id ?? '', status: a.status,
    });
    setDialogOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    setSaving(true);
    const payload = {
      name: form.name, branch_id: form.branch_id || null,
      status: form.status,
    };
    if (editing) {
      const { error } = await supabase.from('areas').update(payload).eq('id', editing.id);
      if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
      else { toast({ title: 'Success', description: 'Area updated' }); setDialogOpen(false); load(); }
    } else {
      const { error } = await supabase.from('areas').insert(payload);
      if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
      else { toast({ title: 'Success', description: 'Area added' }); setDialogOpen(false); load(); }
    }
    setSaving(false);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const { error } = await supabase.from('areas').delete().eq('id', deleteTarget.id);
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Success', description: 'Area deleted' }); setDeleteTarget(null); load(); }
  }

  function handleExport() {
    exportToCSV(areas.map(a => ({
      Name: a.name, Branch: a.branches?.name ?? '',
      Collectors: collectorCounts[a.id] ?? 0, Customers: customerCounts[a.id] ?? 0,
      Status: a.status,
    })), 'areas.csv');
  }

  const filtered = areas.filter(a =>
    (!search || a.name.toLowerCase().includes(search.toLowerCase())) &&
    (branchFilter === 'all' || a.branch_id === branchFilter) &&
    (statusFilter === 'all' || a.status === statusFilter)
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Area Management" description="Manage collection areas and see how each connects down to collectors and clients">
        <Button variant="outline" size="sm" onClick={handleExport}><Download className="w-4 h-4 mr-2" />Export</Button>
        <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-2" />Add Area</Button>
      </PageHeader>

      <Card className="glass-card border-border">
        <CardContent className="p-4 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search areas..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Branch</Label>
              <Select value={branchFilter} onValueChange={setBranchFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Branches</SelectItem>
                  {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card border-border">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Area</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Collectors</TableHead>
                <TableHead>Clients</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-16 text-center">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto" />
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-16 text-center">
                    <MapPin className="w-12 h-12 text-muted-foreground/50 mb-3 mx-auto" />
                    <p className="text-sm text-muted-foreground">No areas found</p>
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map(a => (
                  <TableRow key={a.id} className="hover:bg-secondary/50 cursor-pointer" onClick={() => router.push(`/areas/${a.id}`)}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="w-9 h-9"><AvatarFallback className="bg-primary/10 text-primary text-xs">{getInitials(a.name)}</AvatarFallback></Avatar>
                        <p className="font-medium text-sm">{a.name}</p>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{a.branches?.name ?? '—'}</TableCell>
                    <TableCell className="text-sm">
                      <span className="inline-flex items-center gap-1"><UserCheck className="w-3.5 h-3.5 text-muted-foreground" />{collectorCounts[a.id] ?? 0}</span>
                    </TableCell>
                    <TableCell className="text-sm">
                      <span className="inline-flex items-center gap-1"><Users className="w-3.5 h-3.5 text-muted-foreground" />{customerCounts[a.id] ?? 0}</span>
                    </TableCell>
                    <TableCell><Badge variant={a.status === 'active' ? 'default' : 'secondary'}>{a.status}</Badge></TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" onClick={() => openEdit(a)}><Pencil className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(a)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Area' : 'Add Area'}</DialogTitle>
            <DialogDescription>{editing ? 'Update area information' : 'Create a new collection area'}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2"><Label>Name *</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Brgy. San Roque" /></div>
            <div className="space-y-2">
              <Label>Branch</Label>
              <Select value={form.branch_id} onValueChange={(v) => setForm({ ...form, branch_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                <SelectContent>{branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}{editing ? 'Update' : 'Add'} Area</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Area</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {deleteTarget?.name}? Collectors and clients assigned to it will become unassigned, not deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button><Button variant="destructive" onClick={handleDelete}>Delete</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
