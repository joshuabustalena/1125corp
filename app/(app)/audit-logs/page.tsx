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
import { supabase } from '@/lib/supabase/client';
import { formatDateTime, exportToCSV } from '@/lib/format';
import { ShieldCheck, Search, Download, Loader2, LogIn, LogOut, Pencil, Trash2, Plus, Check, X } from 'lucide-react';

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all');

  useEffect(() => { load(); }, [search, actionFilter]);

  async function load() {
    setLoading(true);
    let query = supabase.from('audit_logs').select('*, profiles(full_name, email)').order('created_at', { ascending: false }).limit(100);
    if (search) query = query.or(`action.ilike.%${search}%,entity_type.ilike.%${search}%`);
    if (actionFilter !== 'all') query = query.eq('action', actionFilter);
    const { data } = await query;
    setLogs(data ?? []);
    setLoading(false);
  }

  function handleExport() {
    exportToCSV(logs.map(l => ({
      Timestamp: l.created_at, User: l.profiles?.full_name ?? '', Action: l.action,
      Entity: l.entity_type ?? '', IP: l.ip_address ?? '',
    })), 'audit-logs.csv');
  }

  const actionIcon = (action: string) => {
    switch (action) {
      case 'login': return <LogIn className="w-4 h-4 text-success" />;
      case 'logout': return <LogOut className="w-4 h-4 text-muted-foreground" />;
      case 'create': return <Plus className="w-4 h-4 text-primary" />;
      case 'edit': return <Pencil className="w-4 h-4 text-warning" />;
      case 'delete': return <Trash2 className="w-4 h-4 text-destructive" />;
      case 'approve': return <Check className="w-4 h-4 text-success" />;
      case 'reject': return <X className="w-4 h-4 text-destructive" />;
      default: return <ShieldCheck className="w-4 h-4" />;
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Audit Logs" description="System activity and security trail">
        <Button variant="outline" size="sm" onClick={handleExport}><Download className="w-4 h-4 mr-2" />Export</Button>
      </PageHeader>

      <Card className="glass-card border-border">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search by action or entity..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
            </div>
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="w-full sm:w-48"><SelectValue placeholder="All Actions" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                <SelectItem value="login">Login</SelectItem>
                <SelectItem value="logout">Logout</SelectItem>
                <SelectItem value="create">Create</SelectItem>
                <SelectItem value="edit">Edit</SelectItem>
                <SelectItem value="delete">Delete</SelectItem>
                <SelectItem value="approve">Approve</SelectItem>
                <SelectItem value="reject">Reject</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card border-border">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ShieldCheck className="w-12 h-12 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">No audit logs found</p>
            </div>
          ) : (
            <>
            {/* Mobile card list */}
            <div className="md:hidden divide-y divide-border">
              {logs.map(l => (
                <div key={l.id} className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      {actionIcon(l.action)}
                      <Badge variant="outline" className="capitalize">{l.action}</Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">{formatDateTime(l.created_at)}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className="font-medium">{l.profiles?.full_name ?? 'System'}</span>
                    <span className="text-muted-foreground">{l.entity_type ?? '—'}</span>
                  </div>
                  {l.ip_address && <p className="mt-1 text-xs text-muted-foreground font-mono">{l.ip_address}</p>}
                </div>
              ))}
            </div>

            <Table className="hidden md:table">
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>IP Address</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map(l => (
                  <TableRow key={l.id} className="hover:bg-secondary/50">
                    <TableCell className="text-sm">{formatDateTime(l.created_at)}</TableCell>
                    <TableCell className="text-sm font-medium">{l.profiles?.full_name ?? 'System'}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {actionIcon(l.action)}
                        <Badge variant="outline" className="capitalize">{l.action}</Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{l.entity_type ?? '—'}</TableCell>
                    <TableCell className="text-sm font-mono">{l.ip_address ?? '—'}</TableCell>
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
