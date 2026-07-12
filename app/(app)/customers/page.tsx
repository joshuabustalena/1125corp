'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency, getInitials, exportToCSV } from '@/lib/format';
import {
  Users, Plus, Search, Download, Pencil, Trash2, Eye, Loader2, Phone, Mail, MapPin,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

interface Customer {
  id: string;
  first_name: string;
  last_name: string;
  middle_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  barangay: string | null;
  city: string | null;
  province: string | null;
  zip_code: string | null;
  gender: string | null;
  birth_date: string | null;
  status: string;
  max_loan_limit: number;
  government_id: string | null;
  branch_id: string | null;
  area_id: string | null;
  collector_id: string | null;
  branches: { name: string } | null;
  areas: { name: string } | null;
  collectors: { profile_id: string } | null;
}

export default function CustomersPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { profile } = useAuth();
  const isAdmin = profile?.role_name === 'Administrator';
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [areas, setAreas] = useState<any[]>([]);
  const [collectors, setCollectors] = useState<any[]>([]);
  const [allCustomers, setAllCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);
  const [saving, setSaving] = useState(false);
  const pageSize = 10;

  const [form, setForm] = useState({
    first_name: '', last_name: '', middle_name: '', phone: '', email: '',
    address: '', barangay: '', city: '', province: '', zip_code: '',
    branch_id: '', area_id: '', collector_id: '', max_loan_limit: '80000',
    status: 'active', gender: '', birth_date: '', government_id: '',
  });

  useEffect(() => {
    if (!profile) return;
    loadCustomers();
    loadOptions();
  }, [profile, search, branchFilter, statusFilter, page]);

  async function loadOptions() {
    let branchQuery = supabase.from('branches').select('id, name').eq('status', 'active');
    let areaQuery = supabase.from('areas').select('id, name, branch_id, max_loan_limit').eq('status', 'active');
    if (!isAdmin && profile?.branch_id) {
      branchQuery = branchQuery.eq('id', profile.branch_id);
      areaQuery = areaQuery.eq('branch_id', profile.branch_id);
    }
    const [b, a, c, ac] = await Promise.all([
      branchQuery,
      areaQuery,
      supabase.from('collectors').select('id, profile_id, branch_id, area_id, profiles(full_name)').eq('status', 'active'),
      supabase.from('customers').select('id, area_id, max_loan_limit'),
    ]);
    setBranches(b.data ?? []);
    setAreas(a.data ?? []);
    setCollectors(c.data ?? []);
    setAllCustomers(ac.data ?? []);
  }

  function getAreaPool(areaId: string, excludeCustomerId?: string) {
    const area = areas.find((a) => a.id === areaId);
    if (!area) return null;
    const allocated = allCustomers
      .filter((c) => c.area_id === areaId && c.id !== excludeCustomerId)
      .reduce((sum, c) => sum + Number(c.max_loan_limit), 0);
    return { total: Number(area.max_loan_limit), allocated, remaining: Number(area.max_loan_limit) - allocated };
  }

  async function loadCustomers() {
    setLoading(true);
    let query = supabase
      .from('customers')
      .select('*, branches(name), areas(name), collectors(profile_id)', { count: 'exact' });

    if (search) {
      query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,phone.ilike.%${search}%`);
    }
    if (!isAdmin) {
      query = query.eq('branch_id', profile?.branch_id ?? '00000000-0000-0000-0000-000000000000');
    } else if (branchFilter !== 'all') {
      query = query.eq('branch_id', branchFilter);
    }
    if (statusFilter !== 'all') query = query.eq('status', statusFilter);

    query = query.range((page - 1) * pageSize, page * pageSize - 1).order('created_at', { ascending: false });

    const { data, count } = await query;
    setCustomers((data as any) ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }

  function openCreate() {
    setEditing(null);
    setForm({
      first_name: '', last_name: '', middle_name: '', phone: '', email: '',
      address: '', barangay: '', city: '', province: '', zip_code: '',
      branch_id: !isAdmin ? (profile?.branch_id ?? '') : '', area_id: '', collector_id: '', max_loan_limit: '80000',
      status: 'active', gender: '', birth_date: '', government_id: '',
    });
    setDialogOpen(true);
  }

  function openEdit(c: Customer) {
    setEditing(c);
    setForm({
      first_name: c.first_name, last_name: c.last_name, middle_name: c.middle_name ?? '',
      phone: c.phone ?? '', email: c.email ?? '', address: c.address ?? '',
      barangay: c.barangay ?? '', city: c.city ?? '', province: c.province ?? '', zip_code: c.zip_code ?? '',
      branch_id: c.branch_id ?? '', area_id: c.area_id ?? '', collector_id: c.collector_id ?? '', max_loan_limit: String(c.max_loan_limit),
      status: c.status, gender: c.gender ?? '', birth_date: c.birth_date ?? '', government_id: c.government_id ?? '',
    });
    setDialogOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (form.area_id) {
      const pool = getAreaPool(form.area_id, editing?.id);
      const requested = Number(form.max_loan_limit) || 0;
      if (pool && requested > pool.remaining) {
        toast({
          title: 'No loan limit available',
          description: pool.remaining <= 0
            ? 'This area\'s entire loan limit is already allocated to other customers.'
            : `Only ${formatCurrency(pool.remaining)} is left to allocate for this area.`,
          variant: 'destructive',
        });
        return;
      }
    }

    setSaving(true);
    const payload = {
      first_name: form.first_name,
      last_name: form.last_name,
      middle_name: form.middle_name || null,
      phone: form.phone || null,
      email: form.email || null,
      address: form.address || null,
      barangay: form.barangay || null,
      city: form.city || null,
      province: form.province || null,
      zip_code: form.zip_code || null,
      branch_id: form.branch_id || null,
      area_id: form.area_id || null,
      collector_id: form.collector_id || null,
      max_loan_limit: Number(form.max_loan_limit) || 80000,
      status: form.status,
      gender: form.gender || null,
      birth_date: form.birth_date || null,
      government_id: form.government_id || null,
    };

    if (editing) {
      const { error } = await supabase.from('customers').update(payload).eq('id', editing.id);
      if (error) {
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
      } else {
        toast({ title: 'Success', description: 'Customer updated successfully' });
        setDialogOpen(false);
        loadCustomers();
      }
    } else {
      const { error } = await supabase.from('customers').insert(payload);
      if (error) {
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
      } else {
        toast({ title: 'Success', description: 'Customer created successfully' });
        setDialogOpen(false);
        loadCustomers();
      }
    }
    setSaving(false);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const { data, error } = await supabase.from('customers').delete().eq('id', deleteTarget.id).select();
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else if (!data || data.length === 0) {
      toast({
        title: 'Delete blocked',
        description: 'Nothing was deleted — you may not have permission to delete customers (only Administrators can), or this record no longer exists.',
        variant: 'destructive',
      });
    } else {
      toast({ title: 'Success', description: 'Customer deleted' });
      setDeleteTarget(null);
      loadCustomers();
    }
  }

  function handleExport() {
    exportToCSV(
      customers.map(c => ({
        Name: `${c.first_name} ${c.last_name}`,
        Phone: c.phone ?? '',
        Email: c.email ?? '',
        Barangay: c.barangay ?? '',
        City: c.city ?? '',
        Status: c.status,
        MaxLoan: c.max_loan_limit,
      })),
      'customers.csv'
    );
  }

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-6">
      <PageHeader title="Customer Management" description="Manage borrower records, profiles, and documents">
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="w-4 h-4 mr-2" />
          Export
        </Button>
        <Button size="sm" onClick={openCreate}>
          <Plus className="w-4 h-4 mr-2" />
          Add Customer
        </Button>
      </PageHeader>

      {/* Filters */}
      <Card className="glass-card border-border">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or phone..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="pl-10"
              />
            </div>
            {isAdmin && (
            <Select value={branchFilter} onValueChange={(v) => { setBranchFilter(v); setPage(1); }}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder="All Branches" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Branches</SelectItem>
                {branches.map(b => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            )}
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="glass-card border-border">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : customers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Users className="w-12 h-12 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">No customers found</p>
              <Button size="sm" className="mt-4" onClick={openCreate}>
                <Plus className="w-4 h-4 mr-2" />
                Add your first customer
              </Button>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Branch / Area</TableHead>
                    <TableHead>Max Loan</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.map((c) => (
                    <TableRow key={c.id} className="hover:bg-secondary/50 cursor-pointer" onClick={() => router.push(`/customers/${c.id}`)}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="w-9 h-9">
                            <AvatarFallback className="bg-primary/10 text-primary text-xs">
                              {getInitials(`${c.first_name} ${c.last_name}`)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium text-sm">{c.first_name} {c.last_name}</p>
                            <p className="text-xs text-muted-foreground">{c.barangay ?? '—'}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          <p>{c.phone ?? '—'}</p>
                          <p className="text-xs text-muted-foreground">{c.email ?? ''}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          <p>{c.branches?.name ?? '—'}</p>
                          <p className="text-xs text-muted-foreground">{c.areas?.name ?? ''}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm font-medium">{formatCurrency(c.max_loan_limit)}</TableCell>
                      <TableCell>
                        <Badge variant={c.status === 'active' ? 'default' : 'secondary'}>
                          {c.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" onClick={() => router.push(`/customers/${c.id}`)}>
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => openEdit(c)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(c)}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              <div className="flex items-center justify-between p-4 border-t border-border">
                <p className="text-sm text-muted-foreground">
                  Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Customer' : 'Add New Customer'}</DialogTitle>
            <DialogDescription>
              {editing ? 'Update customer information' : 'Register a new borrower'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>First Name *</Label>
                <Input required value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Last Name *</Label>
                <Input required value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Middle Name</Label>
                <Input value={form.middle_name} onChange={(e) => setForm({ ...form, middle_name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Gender</Label>
                <Select value={form.gender} onValueChange={(v) => setForm({ ...form, gender: v })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="09XX XXX XXXX" />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Branch</Label>
                <Select
                  value={form.branch_id}
                  onValueChange={(v) => setForm({ ...form, branch_id: v, area_id: '', collector_id: '' })}
                  disabled={!isAdmin}
                >
                  <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                  <SelectContent>
                    {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Area</Label>
                <Select
                  value={form.area_id}
                  onValueChange={(v) => {
                    const pool = getAreaPool(v, editing?.id);
                    setForm({ ...form, area_id: v, collector_id: '', max_loan_limit: pool ? String(Math.max(0, pool.remaining)) : form.max_loan_limit });
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Select area" /></SelectTrigger>
                  <SelectContent>
                    {areas.filter(a => !form.branch_id || a.branch_id === form.branch_id).map(a => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Collector</Label>
                <Select value={form.collector_id} onValueChange={(v) => setForm({ ...form, collector_id: v })} disabled={!form.branch_id}>
                  <SelectTrigger><SelectValue placeholder={form.branch_id ? 'Select collector' : 'Select a branch first'} /></SelectTrigger>
                  <SelectContent>
                    {collectors
                      .filter(c => c.branch_id === form.branch_id && (!form.area_id || c.area_id === form.area_id))
                      .map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.profiles?.full_name ?? 'Unknown'}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Government ID</Label>
                <Input value={form.government_id} onChange={(e) => setForm({ ...form, government_id: e.target.value })} placeholder="SSS / UMID / Driver's License" />
              </div>
              <div className="space-y-2">
                <Label>Max Loan Limit (₱)</Label>
                <Input type="number" value={form.max_loan_limit} onChange={(e) => setForm({ ...form, max_loan_limit: e.target.value })} />
                {form.area_id && (() => {
                  const pool = getAreaPool(form.area_id, editing?.id);
                  if (!pool) return null;
                  return pool.remaining <= 0 ? (
                    <p className="text-xs text-destructive">No loan limit available — this area's full {formatCurrency(pool.total)} is already allocated to other customers.</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">{formatCurrency(pool.remaining)} available to allocate (of {formatCurrency(pool.total)} total for this area)</p>
                  );
                })()}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Address</Label>
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Street address" />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Barangay</Label>
                <Input value={form.barangay} onChange={(e) => setForm({ ...form, barangay: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>City</Label>
                <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Province</Label>
                <Input value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {editing ? 'Update' : 'Create'} Customer
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Customer</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {deleteTarget?.first_name} {deleteTarget?.last_name}? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
