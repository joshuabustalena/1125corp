'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { formatDateTime } from '@/lib/format';
import { checkDueDateAlerts } from '@/lib/due-date-alerts';
import { getPushSubscriptionState, subscribeToPush, unsubscribeFromPush } from '@/lib/push';
import { useToast } from '@/hooks/use-toast';
import { Bell, BellOff, BellRing, Loader2, Mail, MessageSquare, Send } from 'lucide-react';

function roleToRecipientType(roleName: string | null | undefined): string | null {
  if (!roleName) return null;
  return roleName.toLowerCase().replace(/\s+/g, '_');
}

export default function NotificationsPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pushState, setPushState] = useState<'unsupported' | 'denied' | 'subscribed' | 'unsubscribed'>('unsubscribed');
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => { if (profile) load(); }, [profile]);
  useEffect(() => { getPushSubscriptionState().then(setPushState); }, []);

  async function handleTogglePush() {
    if (!profile) return;
    setPushBusy(true);
    if (pushState === 'subscribed') {
      await unsubscribeFromPush();
      toast({ title: 'Push notifications turned off' });
    } else {
      const ok = await subscribeToPush(profile.id);
      if (ok) {
        toast({ title: 'Push notifications enabled', description: 'You’ll get notified on this device even when the app is closed.' });
      } else {
        toast({ title: 'Could not enable push notifications', description: 'Check your browser notification permission and try again.', variant: 'destructive' });
      }
    }
    setPushState(await getPushSubscriptionState());
    setPushBusy(false);
  }

  async function load() {
    setLoading(true);
    await checkDueDateAlerts();
    const isAdmin = profile?.role_name === 'Administrator';
    let query = supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(50);
    if (!isAdmin) {
      const myType = roleToRecipientType(profile?.role_name);
      // Role broadcasts meant for me, plus anything addressed to me
      // personally (recipient_id) regardless of its recipient_type.
      query = query.or(`recipient_type.in.(${[myType, 'all'].filter(Boolean).join(',')}),recipient_id.eq.${profile?.id}`);
    }
    const { data } = await query;
    // A role broadcast scoped to a branch (branch_id set) only concerns that
    // branch's own staff — filter out other branches' broadcasts here since
    // the .or() above can't express that AND condition on its own. Personal
    // notifications (recipient_id) and unscoped broadcasts (branch_id null,
    // e.g. Administrator's) always pass through.
    const scoped = isAdmin ? (data ?? []) : (data ?? []).filter((n: any) =>
      n.recipient_id === profile?.id || !n.branch_id || n.branch_id === profile?.branch_id
    );
    setNotifications(scoped);
    // Opening this page reads everything currently shown, same as opening
    // the topbar bell dropdown.
    const unreadIds = scoped.filter((n: any) => !n.read_at).map((n: any) => n.id);
    if (unreadIds.length > 0) {
      await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', unreadIds);
    }
    setLoading(false);
  }

  const typeIcon = (type: string) => {
    switch (type) {
      case 'upcoming_due': return <Bell className="w-4 h-4 text-warning" />;
      case 'overdue': return <Bell className="w-4 h-4 text-destructive" />;
      case 'payment_received': return <Bell className="w-4 h-4 text-success" />;
      case 'loan_approved': return <Bell className="w-4 h-4 text-primary" />;
      default: return <Bell className="w-4 h-4" />;
    }
  };

  const channelIcon = (channel: string) => channel === 'sms' ? <MessageSquare className="w-4 h-4" /> : <Mail className="w-4 h-4" />;

  return (
    <div className="space-y-6">
      <PageHeader title="Notifications" description="SMS and email notification history">
        {pushState !== 'unsupported' && (
          <Button
            size="sm"
            variant={pushState === 'subscribed' ? 'default' : 'outline'}
            onClick={handleTogglePush}
            disabled={pushBusy || pushState === 'denied'}
            title={pushState === 'denied' ? 'Notifications are blocked in your browser settings' : undefined}
          >
            {pushBusy ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : pushState === 'subscribed' ? (
              <BellRing className="w-4 h-4 mr-2" />
            ) : (
              <BellOff className="w-4 h-4 mr-2" />
            )}
            {pushState === 'subscribed' ? 'Push Notifications On' : pushState === 'denied' ? 'Push Blocked' : 'Enable Push Notifications'}
          </Button>
        )}
        <Button size="sm" variant="outline"><Send className="w-4 h-4 mr-2" />Send Notification</Button>
      </PageHeader>

      <Card className="glass-card border-border">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Bell className="w-12 h-12 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">No notifications sent</p>
            </div>
          ) : (
            <>
            {/* Mobile card list */}
            <div className="md:hidden divide-y divide-border">
              {notifications.map(n => (
                <div key={n.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      {typeIcon(n.type)}
                      <span className="text-sm font-medium capitalize truncate">{n.type.replace(/_/g, ' ')}</span>
                    </div>
                    <Badge variant={n.status === 'sent' ? 'default' : n.status === 'failed' ? 'destructive' : 'secondary'} className="shrink-0">{n.status}</Badge>
                  </div>
                  <p className="mt-1.5 text-sm text-muted-foreground">{n.message ?? '—'}</p>
                  <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>{n.recipient_name ?? '—'}</span>
                    <span className="flex items-center gap-1">{channelIcon(n.channel)}{n.channel} · {formatDateTime(n.sent_at ?? n.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>

            <Table className="hidden md:table">
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {notifications.map(n => (
                  <TableRow key={n.id} className="hover:bg-secondary/50">
                    <TableCell><div className="flex items-center gap-2">{typeIcon(n.type)}<span className="text-sm capitalize">{n.type.replace(/_/g, ' ')}</span></div></TableCell>
                    <TableCell className="text-sm">{n.recipient_name ?? '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-xs truncate">{n.message ?? '—'}</TableCell>
                    <TableCell><div className="flex items-center gap-1 text-sm">{channelIcon(n.channel)}{n.channel}</div></TableCell>
                    <TableCell><Badge variant={n.status === 'sent' ? 'default' : n.status === 'failed' ? 'destructive' : 'secondary'}>{n.status}</Badge></TableCell>
                    <TableCell className="text-sm">{formatDateTime(n.sent_at ?? n.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
