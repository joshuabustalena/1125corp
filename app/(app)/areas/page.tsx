'use client';

import { useEffect, useState } from 'react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency, getInitials, exportToCSV } from '@/lib/format';
import {
  MapPin, Plus, Search, Download, Pencil, Trash2, Loader2, Eye, Users, UserCheck, ChevronDown, Check,
} from 'lucide-react';

interface Area {
  id: string;
  name: string;
  branch_id: string | null;
  max_loan_limit: number;
  status: string;
  branches: { name: string } | null;
}

export default function AreasPage() {
  const { toast } = useToast();
  const [areas, setAreas] = useState<Area[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [collectorCounts, setCollectorCounts] = useState<Record<string, number>>({});
  const [customerCounts, setCustomerCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Area | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);

  const [viewTarget, setViewTarget] = useState<Area | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewCollectors, setViewCollectors] = useState<any[]>([]);
  const [viewCustomers, setViewCustomers] = useState<any[]>([]);

  const [form, setForm] = useState({
    name: '', branch_id: '', max_loan_limit: '', status: 'active',
  });

  useEffect(() => { load(); }, []);

  function getBranchPool(branchId: string, excludeAreaId?: string) {
    const branch = branches.find((b) => b.id === branchId);
    if (!branch) return null;
    const allocated = areas
      .filter((a) => a.branch_id === branchId && a.id !== excludeAreaId)
      .reduce((sum, a) => sum + Number(a.max_loan_limit), 0);
    return { total: Number(branch.max_loan_limit), allocated, remaining: Number(branch.max_loan_limit) - allocated };
  }

  async function load() {
    setLoading(true);
    const [areasRes, branchesRes, collectorsRes, customersRes] = await Promise.all([
      supabase.from('areas').select('*, branches(name)').order('name'),
      supabase.from('branches').select('id, name, max_loan_limit').eq('status', 'active').order('name'),
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
    setForm({ name: '', branch_id: '', max_loan_limit: '', status: 'active' });
    setDialogOpen(true);
  }

  function openEdit(a: Area) {
    setEditing(a);
    setForm({
      name: a.name, branch_id: a.branch_id ?? '',
      max_loan_limit: String(a.max_loan_limit ?? '0'), status: a.status,
    });
    setDialogOpen(true);
  }

  async function openView(a: Area) {
    setViewTarget(a);
    setViewLoading(true);
    const [collectorsRes, customersRes] = await Promise.all([
      supabase.from('employees').select('id, first_name, last_name, status').eq('area_id', a.id).eq('position', 'Branch Field Collector').order('first_name'),
      supabase.from('customers').select('id, first_name, last_name, phone, status').eq('area_id', a.id).order('first_name'),
    ]);
    setViewCollectors(collectorsRes.data ?? []);
    setViewCustomers(customersRes.data ?? []);
    setViewLoading(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (form.branch_id) {
      const pool = getBranchPool(form.branch_id, editing?.id);
      const requested = Number(form.max_loan_limit) || 0;
      if (pool && requested > pool.remaining) {
        toast({
          title: 'No loan limit available',
          description: pool.remaining <= 0
            ? 'This branch\'s entire loan limit is already allocated to other areas.'
            : `Only ${formatCurrency(pool.remaining)} is left to allocate for this branch.`,
          variant: 'destructive',
        });
        return;
      }
    }

    setSaving(true);
    const payload = {
      name: form.name, branch_id: form.branch_id || null,
      max_loan_limit: Number(form.max_loan_limit) || 0,
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
      MaxLoanLimit: a.max_loan_limit, Status: a.status,
    })), 'areas.csv');
  }

  const filtered = areas.filter(a =>
    (!search || a.name.toLowerCase().includes(search.toLowerCase())) &&
    (branchFilter === 'all' || a.branch_id === branchFilter)
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Area Management" description="Manage collection areas and see how each connects down to collectors and clients">
        <Button variant="outline" size="sm" onClick={handleExport}><Download className="w-4 h-4 mr-2" />Export</Button>
        <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-2" />Add Area</Button>
      </PageHeader>

      <Card className="glass-card border-border">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search areas..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card border-border">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Area</TableHead>
                <TableHead>
                  <DropdownMenu>
                    <DropdownMenuTrigger className="flex items-center gap-1 hover:text-foreground">
                      Branch
                      <ChevronDown className="w-3.5 h-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem onClick={() => setBranchFilter('all')} className="flex items-center justify-between">
                        All Branches
                        {branchFilter === 'all' && <Check className="w-4 h-4" />}
                      </DropdownMenuItem>
                      {branches.map((b) => (
                        <DropdownMenuItem key={b.id} onClick={() => setBranchFilter(b.id)} className="flex items-center justify-between">
                          {b.name}
                          {branchFilter === b.id && <Check className="w-4 h-4" />}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableHead>
                <TableHead>Collectors</TableHead>
                <TableHead>Clients</TableHead>
                <TableHead>Max Loan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-16 text-center">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto" />
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-16 text-center">
                    <MapPin className="w-12 h-12 text-muted-foreground/50 mb-3 mx-auto" />
                    <p className="text-sm text-muted-foreground">No areas found</p>
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map(a => (
                  <TableRow key={a.id} className="hover:bg-secondary/50">
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
                    <TableCell className="text-sm font-medium">{formatCurrency(a.max_loan_limit)}</TableCell>
                    <TableCell><Badge variant={a.status === 'active' ? 'default' : 'secondary'}>{a.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => openView(a)}><Eye className="w-4 h-4" /></Button>
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
              {form.branch_id && (() => {
                const pool = getBranchPool(form.branch_id, editing?.id);
                if (!pool) return null;
                return pool.remaining <= 0 ? (
                  <p className="text-xs text-destructive">No loan limit available — this branch's full {formatCurrency(pool.total)} is already allocated to other areas.</p>
                ) : (
                  <p className="text-xs text-muted-foreground">{formatCurrency(pool.remaining)} available to allocate (of {formatCurrency(pool.total)} total for this branch)</p>
                );
              })()}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Max Loan Limit (₱)</Label><Input type="number" value={form.max_loan_limit} onChange={(e) => setForm({ ...form, max_loan_limit: e.target.value })} /></div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent>
                </Select>
              </div>
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

      {/* Drill-down view: area -> collectors -> clients */}
      <Dialog open={!!viewTarget} onOpenChange={(open) => !open && setViewTarget(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><MapPin className="w-5 h-5" />{viewTarget?.name}</DialogTitle>
            <DialogDescription>Branch: {viewTarget?.branches?.name ?? 'Unassigned'}</DialogDescription>
          </DialogHeader>
          {viewLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : (
            <Tabs defaultValue="collectors">
              <TabsList>
                <TabsTrigger value="collectors">Collectors ({viewCollectors.length})</TabsTrigger>
                <TabsTrigger value="clients">Clients ({viewCustomers.length})</TabsTrigger>
              </TabsList>
              <TabsContent value="collectors">
                {viewCollectors.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">No collectors assigned to this area</p>
                ) : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {viewCollectors.map((c: any) => (
                        <TableRow key={c.id}>
                          <TableCell className="text-sm font-medium">{c.first_name} {c.last_name}</TableCell>
                          <TableCell><Badge variant={c.status === 'active' ? 'default' : 'secondary'}>{c.status}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </TabsContent>
              <TabsContent value="clients">
                {viewCustomers.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">No clients assigned to this area</p>
                ) : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Phone</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {viewCustomers.map((c: any) => (
                        <TableRow key={c.id}>
                          <TableCell className="text-sm font-medium">{c.first_name} {c.last_name}</TableCell>
                          <TableCell className="text-sm">{c.phone ?? '—'}</TableCell>
                          <TableCell><Badge variant={c.status === 'active' ? 'default' : 'secondary'}>{c.status}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
