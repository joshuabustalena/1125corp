'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/lib/supabase/client';
import { ArrowLeft, Loader2 } from 'lucide-react';

export default function BranchDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [branch, setBranch] = useState<any>(null);
  const [employees, setEmployees] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [managers, setManagers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, [params.id]);

  async function load() {
    setLoading(true);
    const id = params.id as string;
    const [{ data: b }, { data: emps }, { data: custs }] = await Promise.all([
      supabase.from('branches').select('*').eq('id', id).maybeSingle(),
      supabase.from('employees').select('id, first_name, last_name, position, department, status').eq('branch_id', id).order('first_name'),
      supabase.from('customers').select('id, first_name, last_name, phone, status').eq('branch_id', id).order('first_name'),
    ]);
    setBranch(b);
    setEmployees(emps ?? []);
    setCustomers(custs ?? []);
    setManagers((emps ?? []).filter(e => e.position === 'Branch Manager').map(e => `${e.first_name} ${e.last_name}`));
    setLoading(false);
  }

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
  }
  if (!branch) {
    return <p className="text-center text-muted-foreground py-16">Branch not found</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={branch.name}
        description={`${branch.code} · Manager: ${managers.join(', ') || 'Unassigned'}`}
      >
        <Button variant="outline" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
      </PageHeader>

      <Card className="glass-card border-border">
        <CardContent className="p-4">
          <Tabs defaultValue="employees">
            <TabsList>
              <TabsTrigger value="employees">Employees ({employees.length})</TabsTrigger>
              <TabsTrigger value="clients">Clients ({customers.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="employees">
              {employees.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No employees assigned to this branch</p>
              ) : (
                <Table>
                  <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Department</TableHead><TableHead>Position</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {employees.map((e: any) => (
                      <TableRow key={e.id}>
                        <TableCell className="text-sm font-medium">{e.first_name} {e.last_name}</TableCell>
                        <TableCell className="text-sm">{e.department ?? '—'}</TableCell>
                        <TableCell className="text-sm">{e.position ?? '—'}</TableCell>
                        <TableCell><Badge variant={e.status === 'active' ? 'default' : 'secondary'}>{e.status}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>
            <TabsContent value="clients">
              {customers.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No clients assigned to this branch</p>
              ) : (
                <Table>
                  <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Phone</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {customers.map((c: any) => (
                      <TableRow key={c.id}>
                        <TableCell className="text-sm font-medium">{c.first_name} {c.last_name}</TableCell>
                        <TableCell className="text-sm">{c.phone ?? '—'}</TableCell>
                        <TableCell><Badge variant={c.status === 'active' ? 'default' : 'secondary'}>{c.status}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
