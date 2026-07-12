'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { getInitials, exportToCSV } from '@/lib/format';
import { UserCheck, Search, Download, Loader2 } from 'lucide-react';

export default function CollectorsPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role_name === 'Administrator';
  const [collectors, setCollectors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => { if (profile) load(); }, [profile]);

  async function load() {
    setLoading(true);
    let query = supabase
      .from('employees')
      .select('id, first_name, last_name, phone, email, status, photo_url, branches(name), areas(name)')
      .eq('position', 'Collector')
      .order('first_name');

    if (!isAdmin) {
      query = query.eq('branch_id', profile?.branch_id ?? '00000000-0000-0000-0000-000000000000');
    }

    const { data } = await query;
    setCollectors(data ?? []);
    setLoading(false);
  }

  function handleExport() {
    exportToCSV(collectors.map(c => ({
      Name: `${c.first_name} ${c.last_name}`, Branch: c.branches?.name ?? '',
      Area: c.areas?.name ?? '', Phone: c.phone ?? '', Email: c.email ?? '', Status: c.status,
    })), 'collectors.csv');
  }

  const filtered = collectors.filter(c =>
    !search || `${c.first_name} ${c.last_name}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Collectors"
        description={isAdmin ? 'All collectors across every branch' : 'Collectors assigned to your branch'}
      >
        <Button variant="outline" size="sm" onClick={handleExport}><Download className="w-4 h-4 mr-2" />Export</Button>
      </PageHeader>

      <Card className="glass-card border-border">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search collectors..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card border-border">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Collector</TableHead>
                {isAdmin && <TableHead>Branch</TableHead>}
                <TableHead>Area</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 5 : 4} className="py-16 text-center">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto" />
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 5 : 4} className="py-16 text-center">
                    <UserCheck className="w-12 h-12 text-muted-foreground/50 mb-3 mx-auto" />
                    <p className="text-sm text-muted-foreground">No collectors found</p>
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map(c => (
                  <TableRow key={c.id} className="hover:bg-secondary/50">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="w-9 h-9">
                          <AvatarImage src={c.photo_url ?? undefined} className="object-cover" />
                          <AvatarFallback className="bg-primary/10 text-primary text-xs">{getInitials(`${c.first_name} ${c.last_name}`)}</AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium text-sm">{c.first_name} {c.last_name}</p>
                          <p className="text-xs text-muted-foreground">{c.email ?? ''}</p>
                        </div>
                      </div>
                    </TableCell>
                    {isAdmin && <TableCell className="text-sm">{c.branches?.name ?? '—'}</TableCell>}
                    <TableCell className="text-sm">{c.areas?.name ?? '—'}</TableCell>
                    <TableCell className="text-sm">{c.phone ?? '—'}</TableCell>
                    <TableCell><Badge variant={c.status === 'active' ? 'default' : 'secondary'}>{c.status}</Badge></TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
