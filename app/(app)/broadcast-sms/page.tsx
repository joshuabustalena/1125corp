'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { formatDateTime } from '@/lib/format';
import { MessageSquare, Loader2, Send, Users } from 'lucide-react';

// One SMS "credit" with Semaphore is a 160-character segment — a longer
// message just gets split into more segments/credits, it doesn't fail.
const SEGMENT_LENGTH = 160;

interface Customer { id: string; first_name: string; last_name: string; phone: string | null; branch_id: string | null; area_id: string | null; status: string; }

export default function BroadcastSmsPage() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const isAdmin = profile?.role_name === 'Administrator';

  const [message, setMessage] = useState('');
  const [branches, setBranches] = useState<any[]>([]);
  const [areas, setAreas] = useState<any[]>([]);
  const [branchFilter, setBranchFilter] = useState('all');
  const [areaFilter, setAreaFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('active');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  useEffect(() => {
    loadOptions();
    loadHistory();
  }, []);

  useEffect(() => {
    loadCustomers();
  }, [branchFilter, areaFilter, statusFilter]);

  async function loadOptions() {
    const [b, a] = await Promise.all([
      supabase.from('branches').select('id, name').eq('status', 'active').order('name'),
      supabase.from('areas').select('id, name, branch_id').eq('status', 'active').order('name'),
    ]);
    setBranches(b.data ?? []);
    setAreas(a.data ?? []);
  }

  async function loadHistory() {
    setLoadingHistory(true);
    const { data } = await supabase
      .from('sms_broadcasts')
      .select('*, profiles(full_name)')
      .order('created_at', { ascending: false })
      .limit(20);
    setHistory(data ?? []);
    setLoadingHistory(false);
  }

  async function loadCustomers() {
    setLoadingCustomers(true);
    let query = supabase.from('customers').select('id, first_name, last_name, phone, branch_id, area_id, status').not('phone', 'is', null);
    if (branchFilter !== 'all') query = query.eq('branch_id', branchFilter);
    if (areaFilter !== 'all') query = query.eq('area_id', areaFilter);
    if (statusFilter !== 'all') query = query.eq('status', statusFilter);
    const { data } = await query;
    setCustomers((data as any) ?? []);
    setLoadingCustomers(false);
  }

  const recipientCount = customers.filter(c => !!c.phone).length;
  const segments = message.trim() ? Math.ceil(message.trim().length / SEGMENT_LENGTH) : 0;
  const estimatedCredits = segments * recipientCount;

  function filterSummaryText() {
    const parts: string[] = [];
    parts.push(branchFilter === 'all' ? 'All Branches' : (branches.find(b => b.id === branchFilter)?.name ?? 'Branch'));
    parts.push(areaFilter === 'all' ? 'All Areas' : (areas.find(a => a.id === areaFilter)?.name ?? 'Area'));
    parts.push(statusFilter === 'all' ? 'All Statuses' : `${statusFilter} customers`);
    return parts.join(' · ');
  }

  async function handleSend() {
    setSending(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setSending(false); return; }

    try {
      const res = await fetch('/api/sms/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          message,
          customerIds: customers.map(c => c.id),
          filterSummary: filterSummaryText(),
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        toast({ title: 'Send failed', description: result.error ?? 'Unknown error', variant: 'destructive' });
      } else {
        toast({
          title: result.failedCount > 0 ? 'Sent with some failures' : 'Broadcast sent',
          description: `${result.sentCount} sent, ${result.failedCount} failed, out of ${result.recipientCount} recipients.`,
          variant: result.failedCount > 0 ? 'destructive' : 'default',
        });
        setMessage('');
        loadHistory();
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message ?? 'Failed to reach the server', variant: 'destructive' });
    } finally {
      setSending(false);
      setConfirmOpen(false);
    }
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <MessageSquare className="w-12 h-12 text-muted-foreground/50 mb-3" />
        <p className="text-sm text-muted-foreground">Only Administrators can send a broadcast SMS.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Broadcast SMS" description="Send a text message to your customers via Semaphore" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="glass-card border-border lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><MessageSquare className="w-5 h-5" />Compose Message</CardTitle>
            <CardDescription>This goes out as an actual SMS to each customer's phone — not an email.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Message</Label>
              <Textarea
                rows={5}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Type your message here..."
              />
              <p className="text-xs text-muted-foreground">
                {message.trim().length} characters · {segments} SMS segment{segments === 1 ? '' : 's'} per recipient
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>Branch</Label>
                <Select value={branchFilter} onValueChange={(v) => { setBranchFilter(v); setAreaFilter('all'); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Branches</SelectItem>
                    {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Area</Label>
                <Select value={areaFilter} onValueChange={setAreaFilter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Areas</SelectItem>
                    {areas.filter(a => branchFilter === 'all' || a.branch_id === branchFilter).map(a => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Customer Status</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="all">All Statuses</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg bg-secondary/50 p-3">
              <div className="flex items-center gap-2 text-sm">
                <Users className="w-4 h-4 text-muted-foreground" />
                {loadingCustomers ? (
                  <span className="text-muted-foreground">Counting recipients…</span>
                ) : (
                  <span><strong>{recipientCount}</strong> customer{recipientCount === 1 ? '' : 's'} with a phone number match this filter</span>
                )}
              </div>
              <Button
                onClick={() => setConfirmOpen(true)}
                disabled={!message.trim() || recipientCount === 0 || loadingCustomers}
              >
                <Send className="w-4 h-4 mr-2" />
                Send Broadcast
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-border">
          <CardHeader>
            <CardTitle className="text-base">Recent Broadcasts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loadingHistory ? (
              <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            ) : history.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No broadcasts sent yet</p>
            ) : (
              history.map(h => (
                <div key={h.id} className="p-3 rounded-lg bg-secondary/50 space-y-1">
                  <p className="text-sm line-clamp-2">{h.message}</p>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{h.filter_summary ?? 'All Customers'}</span>
                    <span>{formatDateTime(h.created_at)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={h.failed_count > 0 ? 'destructive' : 'default'} className="text-[10px]">
                      {h.sent_count}/{h.recipient_count} sent
                    </Badge>
                    <span className="text-xs text-muted-foreground">by {h.profiles?.full_name ?? 'Unknown'}</span>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Confirm send */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Broadcast SMS?</DialogTitle>
            <DialogDescription>
              This will send an SMS to <strong>{recipientCount}</strong> customer{recipientCount === 1 ? '' : 's'} ({filterSummaryText()}),
              using approximately <strong>{estimatedCredits}</strong> SMS credit{estimatedCredits === 1 ? '' : 's'} from your Semaphore balance.
              This cannot be recalled once sent.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg bg-secondary/50 p-3 text-sm whitespace-pre-wrap">{message}</div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={sending}>Cancel</Button>
            <Button onClick={handleSend} disabled={sending}>
              {sending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Confirm & Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
