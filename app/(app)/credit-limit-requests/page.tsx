'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency, formatDate } from '@/lib/format';
import { TrendingUp, Plus, Loader2, CheckCircle, XCircle } from 'lucide-react';

export default function CreditLimitRequestsPage() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const searchParams = useSearchParams();
  const isAdmin = profile?.role_name === 'Administrator';
  const isBranchManager = profile?.role_name === 'Branch Manager';
  const [requests, setRequests] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [form, setForm] = useState({ customer_id: '', requested_limit: '', reason: '' });

  useEffect(() => {
    if (!profile) return;
    load();
    if (isBranchManager) loadCustomers();
  }, [profile]);

  useEffect(() => {
    const customerParam = searchParams.get('customer');
    if (customerParam && isBranchManager) {
      setForm(f => ({ ...f, customer_id: customerParam }));
      setDialogOpen(true);
    }
  }, [searchParams, isBranchManager]);

  async function loadCustomers() {
    let q = supabase.from('customers').select('id, first_name, last_name, max_loan_limit, branch_id').eq('status', 'active');
    if (profile?.branch_id) q = q.eq('branch_id', profile.branch_id);
    const { data } = await q;
    setCustomers(data ?? []);
  }

  async function load() {
    setLoading(true);
    let q = supabase.from('credit_limit_requests').select('*, customers(first_name, last_name), requested_by_profile:profiles!requested_by(full_name)').order('created_at', { ascending: false });
    if (!isAdmin) {
      q = q.eq('requested_by', profile?.id ?? '00000000-0000-0000-0000-000000000000');
    }
    const { data } = await q;
    setRequests(data ?? []);
    setLoading(false);
  }

  function openRequest() {
    setForm({ customer_id: '', requested_limit: '', reason: '' });
    setDialogOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const customer = customers.find(c => c.id === form.customer_id);
    if (!customer || !form.requested_limit) return;
    setSaving(true);
    const { error } = await supabase.from('credit_limit_requests').insert({
      customer_id: customer.id,
      requested_by: profile?.id ?? null,
      current_limit: customer.max_loan_limit,
      requested_limit: Number(form.requested_limit),
      reason: form.reason || null,
      status: 'pending',
    });
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      setSaving(false);
      return;
    }
    await supabase.from('notifications').insert({
      type: 'credit_limit_request',
      recipient_type: 'administrator',
      message: `${profile?.full_name ?? 'A Branch Manager'} requested a credit limit increase for ${customer.first_name} ${customer.last_name} (${formatCurrency(customer.max_loan_limit)} → ${formatCurrency(Number(form.requested_limit))}).`,
      channel: 'in_app',
      status: 'sent',
      sent_at: new Date().toISOString(),
    });
    toast({ title: 'Success', description: 'Credit limit request submitted for Admin approval' });
    setDialogOpen(false);
    load();
    setSaving(false);
  }

  async function handleReview(request: any, status: 'approved' | 'denied') {
    setReviewing(request.id);
    if (status === 'approved') {
      const { error } = await supabase.from('customers').update({ max_loan_limit: request.requested_limit }).eq('id', request.customer_id);
      if (error) {
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
        setReviewing(null);
        return;
      }
    }
    const { error } = await supabase.from('credit_limit_requests').update({
      status, reviewed_by: profile?.id ?? null, reviewed_at: new Date().toISOString(),
    }).eq('id', request.id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      setReviewing(null);
      return;
    }
    toast({ title: 'Success', description: `Request ${status}` });
    load();
    setReviewing(null);
  }

  const statusVariant = (s: string) => s === 'approved' ? 'default' : s === 'denied' ? 'destructive' : 'outline';

  return (
    <div className="space-y-6">
      <PageHeader title="Credit Limit Requests" description="Request and approve customer credit limit increases">
        {isBranchManager && (
          <Button size="sm" onClick={openRequest}>
            <Plus className="w-4 h-4 mr-2" />
            Request Increase
          </Button>
        )}
      </PageHeader>

      <Card className="glass-card border-border">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : requests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <TrendingUp className="w-12 h-12 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">No credit limit requests</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Current Limit</TableHead>
                  <TableHead>Requested Limit</TableHead>
                  <TableHead>Requested By</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Requested</TableHead>
                  {isAdmin && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map(r => (
                  <TableRow key={r.id} className="hover:bg-secondary/50">
                    <TableCell className="text-sm font-medium">{r.customers?.first_name} {r.customers?.last_name}</TableCell>
                    <TableCell className="text-sm">{formatCurrency(r.current_limit)}</TableCell>
                    <TableCell className="text-sm font-medium text-primary">{formatCurrency(r.requested_limit)}</TableCell>
                    <TableCell className="text-sm">{r.requested_by_profile?.full_name ?? '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-xs truncate">{r.reason ?? '—'}</TableCell>
                    <TableCell><Badge variant={statusVariant(r.status)}>{r.status}</Badge></TableCell>
                    <TableCell className="text-sm">{formatDate(r.created_at)}</TableCell>
                    {isAdmin && (
                      <TableCell className="text-right">
                        {r.status === 'pending' && (
                          <div className="flex gap-1 justify-end">
                            <Button variant="ghost" size="icon" disabled={reviewing === r.id} onClick={() => handleReview(r, 'approved')}>
                              <CheckCircle className="w-4 h-4 text-success" />
                            </Button>
                            <Button variant="ghost" size="icon" disabled={reviewing === r.id} onClick={() => handleReview(r, 'denied')}>
                              <XCircle className="w-4 h-4 text-destructive" />
                            </Button>
                          </div>
                        )}
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
            <DialogTitle>Request Credit Limit Increase</DialogTitle>
            <DialogDescription>Submitted for Administrator approval</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Customer *</Label>
              <Select value={form.customer_id} onValueChange={(v) => setForm({ ...form, customer_id: v })} required>
                <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                <SelectContent>{customers.map(c => <SelectItem key={c.id} value={c.id}>{c.first_name} {c.last_name} — current {formatCurrency(c.max_loan_limit)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Requested Limit (₱) *</Label>
              <Input type="number" required value={form.requested_limit} onChange={(e) => setForm({ ...form, requested_limit: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Reason</Label>
              <Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} rows={3} placeholder="Why does this customer need a higher limit?" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving || !form.customer_id || !form.requested_limit}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Submit Request
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
