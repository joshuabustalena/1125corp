'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { StatCard } from '@/components/dashboard/stat-card';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency, formatDate } from '@/lib/format';
import { Plus, Loader2, TrendingUp, Scale } from 'lucide-react';

export default function ShareholdersPage() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const isAdmin = profile?.role_name === 'Administrator';
  const canManageShareholders = isAdmin || profile?.role_name === 'Accounting';
  const [shareholders, setShareholders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingShareholder, setEditingShareholder] = useState<any>(null);
  const [form, setForm] = useState({ name: '', capital_contributed: '', ownership_percent: '', date_invested: '', notes: '' });

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('shareholders').select('*').order('ownership_percent', { ascending: false });
    setShareholders(data ?? []);
    setLoading(false);
  }

  function openAdd() {
    setEditingShareholder(null);
    setForm({ name: '', capital_contributed: '', ownership_percent: '', date_invested: '', notes: '' });
    setDialogOpen(true);
  }

  function openEdit(s: any) {
    setEditingShareholder(s);
    setForm({
      name: s.name,
      capital_contributed: String(s.capital_contributed),
      ownership_percent: String(s.ownership_percent),
      date_invested: s.date_invested ?? '',
      notes: s.notes ?? '',
    });
    setDialogOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const payload = {
      name: form.name,
      capital_contributed: Number(form.capital_contributed) || 0,
      ownership_percent: Number(form.ownership_percent) || 0,
      date_invested: form.date_invested || null,
      notes: form.notes || null,
    };

    const { error } = editingShareholder
      ? await supabase.from('shareholders').update(payload).eq('id', editingShareholder.id)
      : await supabase.from('shareholders').insert({ ...payload, created_by: profile?.id ?? null });

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: `Shareholder ${editingShareholder ? 'updated' : 'added'}` });
      setDialogOpen(false);
      load();
    }
    setSaving(false);
  }

  const totalCapital = shareholders.reduce((s, sh) => s + Number(sh.capital_contributed), 0);
  const totalPercent = shareholders.reduce((s, sh) => s + Number(sh.ownership_percent), 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Shareholders" description="Capital contributed and ownership percentage per shareholder">
        {canManageShareholders && (
          <Button size="sm" onClick={openAdd}>
            <Plus className="w-4 h-4 mr-2" />
            Add Shareholder
          </Button>
        )}
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatCard title="Total Capital Contributed" value={formatCurrency(totalCapital)} icon={<TrendingUp className="w-5 h-5" />} variant="success" />
        <StatCard
          title="Total Ownership Allocated"
          value={`${totalPercent.toFixed(1)}%`}
          icon={<Scale className="w-5 h-5" />}
          variant={Math.abs(totalPercent - 100) < 0.01 ? 'success' : 'warning'}
        />
      </div>

      <Card className="glass-card border-border">
        <CardHeader>
          <CardTitle>Shareholders' Capital</CardTitle>
          <CardDescription>{shareholders.length} shareholder{shareholders.length !== 1 ? 's' : ''}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : shareholders.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No shareholders recorded yet</p>
          ) : (
            <>
            {/* Mobile card list */}
            <div className="md:hidden divide-y divide-border">
              {shareholders.map(sh => (
                <div key={sh.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium text-sm truncate">{sh.name}</p>
                    <p className="text-sm font-medium shrink-0">{Number(sh.ownership_percent).toFixed(1)}%</p>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div><p className="text-xs text-muted-foreground">Capital Contributed</p><p>{formatCurrency(sh.capital_contributed)}</p></div>
                    <div><p className="text-xs text-muted-foreground">Date Invested</p><p>{sh.date_invested ? formatDate(sh.date_invested) : '—'}</p></div>
                    {sh.notes && <div className="col-span-2"><p className="text-xs text-muted-foreground">Notes</p><p>{sh.notes}</p></div>}
                  </div>
                  {canManageShareholders && (
                    <div className="mt-3 flex justify-end">
                      <Button variant="outline" size="sm" onClick={() => openEdit(sh)}>Edit</Button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <Table className="hidden md:table">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Capital Contributed</TableHead>
                  <TableHead className="text-right">Ownership %</TableHead>
                  <TableHead>Date Invested</TableHead>
                  <TableHead>Notes</TableHead>
                  {canManageShareholders && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {shareholders.map(sh => (
                  <TableRow key={sh.id}>
                    <TableCell className="text-sm font-medium">{sh.name}</TableCell>
                    <TableCell className="text-right text-sm">{formatCurrency(sh.capital_contributed)}</TableCell>
                    <TableCell className="text-right text-sm">{Number(sh.ownership_percent).toFixed(1)}%</TableCell>
                    <TableCell className="text-sm">{sh.date_invested ? formatDate(sh.date_invested) : '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{sh.notes ?? '—'}</TableCell>
                    {canManageShareholders && (
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(sh)}>Edit</Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </>
          )}
          {Math.abs(totalPercent - 100) >= 0.01 && shareholders.length > 0 && (
            <p className="text-xs text-warning px-4 pb-4">Ownership percentages add up to {totalPercent.toFixed(1)}%, not 100% — double-check the entries above.</p>
          )}
        </CardContent>
      </Card>

      {/* Add/edit shareholder */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingShareholder ? 'Edit Shareholder' : 'Add Shareholder'}</DialogTitle>
            <DialogDescription>Track capital contributed and ownership percentage</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Capital Contributed (₱) *</Label>
                <Input type="number" required value={form.capital_contributed} onChange={(e) => setForm({ ...form, capital_contributed: e.target.value })} placeholder="0.00" />
              </div>
              <div className="space-y-2">
                <Label>Ownership % *</Label>
                <Input type="number" required max="100" step="0.1" value={form.ownership_percent} onChange={(e) => setForm({ ...form, ownership_percent: e.target.value })} placeholder="0.0" />
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Date Invested</Label>
                <Input type="date" value={form.date_invested} onChange={(e) => setForm({ ...form, date_invested: e.target.value })} />
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Notes</Label>
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {editingShareholder ? 'Update' : 'Add'} Shareholder
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
