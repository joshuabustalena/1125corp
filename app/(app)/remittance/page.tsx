'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency } from '@/lib/format';
import { ArrowRightLeft, Loader2, Wallet } from 'lucide-react';

export default function RemittancePage() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const isFieldCollector = profile?.role_name === 'Branch Field Collector';
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(true);
  const [collectors, setCollectors] = useState<any[]>([]);
  const [collected, setCollected] = useState<Record<string, number>>({});
  const [remitted, setRemitted] = useState<Record<string, number>>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ collector_id: '', amount: '', notes: '' });

  useEffect(() => {
    if (!profile) return;
    loadData();
  }, [date, profile]);

  async function loadData() {
    setLoading(true);
    let colQuery = supabase.from('collectors').select('id, branch_id, profile_id, profiles(full_name)').eq('status', 'active');
    if (isFieldCollector && profile) colQuery = colQuery.eq('profile_id', profile.id);

    const [{ data: cols }, { data: pays }, { data: rems }] = await Promise.all([
      colQuery,
      supabase.from('payments').select('collector_id, amount_paid').eq('payment_date', date),
      supabase.from('remittances').select('collector_id, amount').eq('remittance_date', date),
    ]);

    setCollectors(cols ?? []);

    const collectedMap: Record<string, number> = {};
    (pays ?? []).forEach((p: any) => {
      if (!p.collector_id) return;
      collectedMap[p.collector_id] = (collectedMap[p.collector_id] ?? 0) + Number(p.amount_paid);
    });
    setCollected(collectedMap);

    const remittedMap: Record<string, number> = {};
    (rems ?? []).forEach((r: any) => {
      remittedMap[r.collector_id] = (remittedMap[r.collector_id] ?? 0) + Number(r.amount);
    });
    setRemitted(remittedMap);
    setLoading(false);
  }

  function openRecord(collectorId: string) {
    const owed = (collected[collectorId] ?? 0) - (remitted[collectorId] ?? 0);
    setForm({ collector_id: collectorId, amount: owed > 0 ? owed.toFixed(2) : '', notes: '' });
    setDialogOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.collector_id || !form.amount) return;
    setSaving(true);
    const { error } = await supabase.from('remittances').insert({
      collector_id: form.collector_id,
      amount: Number(form.amount),
      remittance_date: date,
      received_by: profile?.id ?? null,
      notes: form.notes || null,
    });
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: 'Remittance recorded' });
      setDialogOpen(false);
      loadData();
    }
    setSaving(false);
  }

  const rows = collectors.map(c => {
    const collectedAmt = collected[c.id] ?? 0;
    const remittedAmt = remitted[c.id] ?? 0;
    return {
      id: c.id,
      name: c.profiles?.full_name ?? 'Unassigned',
      collected: collectedAmt,
      remitted: remittedAmt,
      owed: collectedAmt - remittedAmt,
    };
  }).filter(r => r.collected > 0 || r.remitted > 0);

  const totalOwed = rows.reduce((s, r) => s + Math.max(0, r.owed), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={isFieldCollector ? 'My Remittance' : 'Collector Remittance'}
        description={isFieldCollector ? 'How much of your collections you still need to turn in to the Cashier' : "Cash collected by field collectors vs. what's been turned in"}
      >
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" />
      </PageHeader>

      <Card className="glass-card border-border">
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">{isFieldCollector ? 'Still Owed to Cashier' : 'Total Still Owed to Cashier'}</p>
              <p className="text-2xl font-bold">{formatCurrency(totalOwed)}</p>
            </div>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-warning/10 text-warning">
              <Wallet className="w-5 h-5" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card border-border">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ArrowRightLeft className="w-12 h-12 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">No collections recorded for this date</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Collector</TableHead>
                  <TableHead>Collected</TableHead>
                  <TableHead>Remitted</TableHead>
                  <TableHead>Balance Owed</TableHead>
                  {!isFieldCollector && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(r => (
                  <TableRow key={r.id} className="hover:bg-secondary/50">
                    <TableCell className="text-sm font-medium">{r.name}</TableCell>
                    <TableCell className="text-sm">{formatCurrency(r.collected)}</TableCell>
                    <TableCell className="text-sm">{formatCurrency(r.remitted)}</TableCell>
                    <TableCell className="text-sm font-medium">
                      <Badge variant={r.owed > 0 ? 'destructive' : 'default'}>{formatCurrency(r.owed)}</Badge>
                    </TableCell>
                    {!isFieldCollector && (
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" disabled={r.owed <= 0} onClick={() => openRecord(r.id)}>
                          Record Remittance
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Remittance</DialogTitle>
            <DialogDescription>Confirm the cash amount turned in by this collector</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Amount (₱) *</Label>
              <Input type="number" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Record
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
