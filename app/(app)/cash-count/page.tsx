'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { StatCard } from '@/components/dashboard/stat-card';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency, formatDate } from '@/lib/format';
import { Banknote, Loader2, TrendingUp, Scale } from 'lucide-react';

export default function CashCountPage() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const isAdmin = profile?.role_name === 'Administrator';
  const canRecordCount = isAdmin || profile?.role_name === 'Cashier';
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [branches, setBranches] = useState<any[]>([]);
  const [branchId, setBranchId] = useState('');
  const [expected, setExpected] = useState(0);
  const [vaultAmount, setVaultAmount] = useState('');
  const [bankAmount, setBankAmount] = useState('');
  const [pettyCashAmount, setPettyCashAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [pendingRemittanceIds, setPendingRemittanceIds] = useState<string[]>([]);

  useEffect(() => {
    if (isAdmin) {
      loadBranches();
    } else if (profile?.branch_id) {
      setBranchId(profile.branch_id);
    }
  }, [profile]);

  useEffect(() => {
    if (!branchId) return;
    loadData();
  }, [branchId, date]);

  async function loadBranches() {
    const { data } = await supabase.from('branches').select('id, name').eq('status', 'active').order('name');
    setBranches(data ?? []);
    if (data && data.length > 0 && !branchId) setBranchId(data[0].id);
  }

  async function loadData() {
    setLoading(true);
    const { data: collectors } = await supabase.from('collectors').select('id').eq('branch_id', branchId);
    const collectorIds = (collectors ?? []).map(c => c.id);

    // Expected Cash = whatever's still sitting as "pending" remittances for
    // this branch, up through the count date — not just today's, since an
    // unreconciled remittance from an earlier day should still be expected
    // until a count actually sweeps it up. Submitting a count marks these
    // as "received" so they aren't counted again on a later day.
    const [{ data: rems }, { data: hist }] = await Promise.all([
      collectorIds.length > 0
        ? supabase.from('remittances').select('id, amount').eq('status', 'pending').lte('remittance_date', date).in('collector_id', collectorIds)
        : Promise.resolve({ data: [] as any[] }),
      supabase.from('cash_counts').select('*').eq('branch_id', branchId).order('count_date', { ascending: false }).limit(30),
    ]);

    setPendingRemittanceIds((rems ?? []).map((r: any) => r.id));
    setExpected((rems ?? []).reduce((s: number, r: any) => s + Number(r.amount), 0));
    setHistory(hist ?? []);
    setLoading(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const counted = Number(vaultAmount || 0) + Number(bankAmount || 0) + Number(pettyCashAmount || 0);
    if (!branchId || counted <= 0) return;
    setSaving(true);
    const variance = counted - expected;
    const { error } = await supabase.from('cash_counts').insert({
      branch_id: branchId,
      count_date: date,
      expected_amount: expected,
      counted_amount: counted,
      vault_amount: Number(vaultAmount || 0),
      bank_amount: Number(bankAmount || 0),
      petty_cash_amount: Number(pettyCashAmount || 0),
      variance,
      counted_by: profile?.id ?? null,
      notes: notes || null,
    });
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      // This count just reconciled these remittances — mark them received
      // so they don't get counted as "pending" (and re-expected) again.
      if (pendingRemittanceIds.length > 0) {
        await supabase.from('remittances').update({ status: 'received', received_by: profile?.id ?? null }).in('id', pendingRemittanceIds);
      }
      toast({ title: 'Success', description: 'Cash count recorded' });
      setVaultAmount('');
      setBankAmount('');
      setPettyCashAmount('');
      setNotes('');
      loadData();
    }
    setSaving(false);
  }

  const countedTotal = Number(vaultAmount || 0) + Number(bankAmount || 0) + Number(pettyCashAmount || 0);
  const variancePreview = (vaultAmount || bankAmount || pettyCashAmount) ? countedTotal - expected : null;

  return (
    <div className="space-y-6">
      <PageHeader title="Daily Cash Count" description="Reconcile counted cash against expected cash for the day">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" />
        {isAdmin && (
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Select branch" /></SelectTrigger>
            <SelectContent>
              {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatCard title="Expected Cash" value={formatCurrency(expected)} icon={<TrendingUp className="w-5 h-5" />} subtitle="Total pending remittances not yet reconciled" />
        <StatCard
          title="Variance"
          value={variancePreview !== null ? formatCurrency(variancePreview) : '—'}
          icon={<Scale className="w-5 h-5" />}
          variant={variancePreview === null ? 'default' : variancePreview === 0 ? 'success' : variancePreview > 0 ? 'warning' : 'danger'}
        />
      </div>

      {canRecordCount && (
        <Card className="glass-card border-border">
          <CardHeader>
            <CardTitle>Record Today's Count</CardTitle>
            <CardDescription>Enter the physical cash counted for {formatDate(date)}, broken down by where it's held</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Cash in Vault (₱)</Label>
                  <Input type="number" value={vaultAmount} onChange={(e) => setVaultAmount(e.target.value)} placeholder="0.00" />
                </div>
                <div className="space-y-2">
                  <Label>Cash in Bank (₱)</Label>
                  <Input type="number" value={bankAmount} onChange={(e) => setBankAmount(e.target.value)} placeholder="0.00" />
                </div>
                <div className="space-y-2">
                  <Label>Petty Cash Fund (₱)</Label>
                  <Input type="number" value={pettyCashAmount} onChange={(e) => setPettyCashAmount(e.target.value)} placeholder="0.00" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={1} placeholder="Explain any variance" />
              </div>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">Total Counted: <span className="font-medium text-foreground">{formatCurrency(countedTotal)}</span></p>
                <Button type="submit" disabled={saving || loading || !branchId || countedTotal <= 0}>
                  {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Submit Count
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card className="glass-card border-border">
        <CardHeader><CardTitle>History</CardTitle><CardDescription>Last 30 counts for this branch</CardDescription></CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : history.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Banknote className="w-12 h-12 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">No cash counts recorded yet</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Vault</TableHead>
                  <TableHead>Bank</TableHead>
                  <TableHead>Petty Cash</TableHead>
                  <TableHead>Expected</TableHead>
                  <TableHead>Counted</TableHead>
                  <TableHead>Variance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map(h => (
                  <TableRow key={h.id}>
                    <TableCell className="text-sm">{formatDate(h.count_date)}</TableCell>
                    <TableCell className="text-sm">{formatCurrency(h.vault_amount ?? 0)}</TableCell>
                    <TableCell className="text-sm">{formatCurrency(h.bank_amount ?? 0)}</TableCell>
                    <TableCell className="text-sm">{formatCurrency(h.petty_cash_amount ?? 0)}</TableCell>
                    <TableCell className="text-sm">{formatCurrency(h.expected_amount)}</TableCell>
                    <TableCell className="text-sm">{formatCurrency(h.counted_amount)}</TableCell>
                    <TableCell className="text-sm">
                      <Badge variant={Number(h.variance) === 0 ? 'default' : 'destructive'}>
                        {Number(h.variance) === 0 ? 'Balanced' : formatCurrency(h.variance)}
                      </Badge>
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
