'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
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
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency, formatDate, exportToCSV } from '@/lib/format';
import { AlertCircle, Plus, Download, Loader2, Trash2 } from 'lucide-react';

export default function PenaltiesPage() {
  const { toast } = useToast();
  const [penalties, setPenalties] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loans, setLoans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);

  const [form, setForm] = useState({
    customer_id: '',
    loan_id: '',
    penalty_type: 'per_day',
    amount: '',
    reason: '',
  });

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [p, c, l] = await Promise.all([
      supabase.from('penalties').select('*, customers(first_name, last_name), loans(loan_number)').order('applied_at', { ascending: false }),
      supabase.from('customers').select('id, first_name, last_name').eq('status', 'active').order('first_name'),
      supabase.from('loans').select('id, loan_number, customer_id').in('status', ['active', 'overdue']),
    ]);
    setPenalties(p.data ?? []);
    setCustomers(c.data ?? []);
    setLoans(l.data ?? []);
    setLoading(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase.from('penalties').insert({
      customer_id: form.customer_id,
      loan_id: form.loan_id || null,
      penalty_type: form.penalty_type,
      amount: Number(form.amount),
      reason: form.reason || null,
    });
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: 'Penalty applied' });
      setDialogOpen(false);
      setForm({ customer_id: '', loan_id: '', penalty_type: 'per_day', amount: '', reason: '' });
      load();
    }
    setSaving(false);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const { error } = await supabase.from('penalties').delete().eq('id', deleteTarget.id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: 'Penalty removed' });
      setDeleteTarget(null);
      load();
    }
  }

  function handleExport() {
    exportToCSV(penalties.map(p => ({
      Customer: `${p.customers?.first_name} ${p.customers?.last_name}`,
      Loan: p.loans?.loan_number ?? '',
      Type: p.penalty_type,
      Amount: p.amount,
      Reason: p.reason ?? '',
      Applied: p.applied_at,
    })), 'penalties.csv');
  }

  const penaltyTypeLabel: Record<string, string> = {
    per_day: 'Per Day', per_month: 'Per Month', overdue_fee: 'Overdue Fee', custom: 'Custom',
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Penalty Management" description="Manually apply and manage customer penalties">
        <Button variant="outline" size="sm" onClick={handleExport}><Download className="w-4 h-4 mr-2" />Export</Button>
        <Button size="sm" onClick={() => setDialogOpen(true)}><Plus className="w-4 h-4 mr-2" />Apply Penalty</Button>
      </PageHeader>

      <Card className="glass-card border-border">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : penalties.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <AlertCircle className="w-12 h-12 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">No penalties applied</p>
            </div>
          ) : (
            <>
            {/* Mobile card list */}
            <div className="md:hidden divide-y divide-border">
              {penalties.map(p => (
                <div key={p.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{p.customers?.first_name} {p.customers?.last_name}</p>
                      <p className="text-xs text-muted-foreground">{p.loans?.loan_number ?? '—'}</p>
                    </div>
                    <p className="text-sm font-medium text-destructive shrink-0">{formatCurrency(p.amount)}</p>
                  </div>
                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    <Badge variant="outline">{penaltyTypeLabel[p.penalty_type] ?? p.penalty_type}</Badge>
                    <span className="text-xs text-muted-foreground">{formatDate(p.applied_at)}</span>
                  </div>
                  {p.reason && <p className="mt-2 text-sm text-muted-foreground">{p.reason}</p>}
                  <div className="mt-3 flex items-center justify-end">
                    <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteTarget(p)}>
                      <Trash2 className="w-3.5 h-3.5 mr-1.5" />Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <Table className="hidden md:table">
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Loan #</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Applied</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {penalties.map(p => (
                  <TableRow key={p.id} className="hover:bg-secondary/50">
                    <TableCell className="text-sm">{p.customers?.first_name} {p.customers?.last_name}</TableCell>
                    <TableCell className="text-sm">{p.loans?.loan_number ?? '—'}</TableCell>
                    <TableCell><Badge variant="outline">{penaltyTypeLabel[p.penalty_type] ?? p.penalty_type}</Badge></TableCell>
                    <TableCell className="text-sm font-medium text-destructive">{formatCurrency(p.amount)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.reason ?? '—'}</TableCell>
                    <TableCell className="text-sm">{formatDate(p.applied_at)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(p)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply Penalty</DialogTitle>
            <DialogDescription>Manually apply a penalty to a customer</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Customer *</Label>
              <Select value={form.customer_id} onValueChange={(v) => setForm({ ...form, customer_id: v })} required>
                <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                <SelectContent>
                  {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.first_name} {c.last_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Loan (optional)</Label>
              <Select value={form.loan_id} onValueChange={(v) => setForm({ ...form, loan_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select loan" /></SelectTrigger>
                <SelectContent>
                  {loans.filter(l => !form.customer_id || l.customer_id === form.customer_id).map(l => (
                    <SelectItem key={l.id} value={l.id}>{l.loan_number}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Penalty Type *</Label>
                <Select value={form.penalty_type} onValueChange={(v) => setForm({ ...form, penalty_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="per_day">Per Day</SelectItem>
                    <SelectItem value="per_month">Per Month</SelectItem>
                    <SelectItem value="overdue_fee">Overdue Fee</SelectItem>
                    <SelectItem value="custom">Custom Amount</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Amount (₱) *</Label>
                <Input type="number" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Reason</Label>
              <Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Reason for penalty" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Apply Penalty</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Penalty</DialogTitle>
            <DialogDescription>Are you sure you want to remove this penalty?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
