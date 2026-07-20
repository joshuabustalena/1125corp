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
import { Bell, Loader2, Mail, MessageSquare, Send } from 'lucide-react';

function roleToRecipientType(roleName: string | null | undefined): string | null {
  if (!roleName) return null;
  return roleName.toLowerCase().replace(/\s+/g, '_');
}

export default function NotificationsPage() {
  const { profile } = useAuth();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { if (profile) load(); }, [profile]);

  async function load() {
    setLoading(true);
    await checkDueDateAlerts();
    const isAdmin = profile?.role_name === 'Administrator';
    let query = supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(50);
    if (!isAdmin) {
      const myType = roleToRecipientType(profile?.role_name);
      query = query.in('recipient_type', [myType, 'all'].filter(Boolean) as string[]);
    }
    const { data } = await query;
    setNotifications(data ?? []);
    // Opening this page reads everything currently shown, same as opening
    // the topbar bell dropdown.
    const unreadIds = (data ?? []).filter((n: any) => !n.read_at).map((n: any) => n.id);
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
            <Table>
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
