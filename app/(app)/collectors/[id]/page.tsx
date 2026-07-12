'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { StatCard } from '@/components/dashboard/stat-card';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency, formatDate, getInitials } from '@/lib/format';
import {
  ArrowLeft, Phone, Mail, MapPin, Calendar, Loader2, Users, Wallet, Building2,
} from 'lucide-react';

export default function CollectorDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [collector, setCollector] = useState<any>(null);
  const [customers, setCustomers] = useState<any[]>([]);
  const [totalCollected, setTotalCollected] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const id = params.id as string;
      const { data: employee } = await supabase
        .from('employees')
        .select('*, branches(name), areas(name)')
        .eq('id', id)
        .maybeSingle();
      setCollector(employee);

      if (employee?.profile_id) {
        const { data: collectorRow } = await supabase
          .from('collectors')
          .select('id')
          .eq('profile_id', employee.profile_id)
          .maybeSingle();

        if (collectorRow) {
          const { data: custData } = await supabase
            .from('customers')
            .select('id, first_name, last_name, phone, status, max_loan_limit, branches(name), areas(name)')
            .eq('collector_id', collectorRow.id)
            .order('first_name');
          setCustomers(custData ?? []);

          const customerIds = (custData ?? []).map(c => c.id);
          if (customerIds.length > 0) {
            const { data: payments } = await supabase
              .from('payments')
              .select('amount_paid')
              .in('customer_id', customerIds);
            setTotalCollected((payments ?? []).reduce((s, p) => s + Number(p.amount_paid), 0));
          }
        }
      }
      setLoading(false);
    }
    load();
  }, [params.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!collector) {
    return <p className="text-center text-muted-foreground py-16">Collector not found</p>;
  }

  const fullName = `${collector.first_name} ${collector.last_name}`;

  return (
    <div className="space-y-6">
      <PageHeader title={fullName} description="Collector profile and assigned customers">
        <Button variant="outline" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile card */}
        <Card className="glass-card border-border lg:col-span-1">
          <CardContent className="p-6 text-center">
            <Avatar className="w-24 h-24 mx-auto mb-4">
              <AvatarImage src={collector.photo_url ?? undefined} className="object-cover" />
              <AvatarFallback className="bg-primary/10 text-primary text-2xl">
                {getInitials(fullName)}
              </AvatarFallback>
            </Avatar>
            <h2 className="text-xl font-bold">{fullName}</h2>
            <Badge variant={collector.status === 'active' ? 'default' : 'secondary'} className="mt-2">
              {collector.status}
            </Badge>
            <div className="mt-6 space-y-3 text-left">
              <div className="flex items-center gap-3 text-sm">
                <Phone className="w-4 h-4 text-muted-foreground" />
                <span>{collector.phone ?? '—'}</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Mail className="w-4 h-4 text-muted-foreground" />
                <span className="truncate">{collector.email ?? '—'}</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                <span>Hired {collector.hire_date ? formatDate(collector.hire_date) : '—'}</span>
              </div>
            </div>
            <div className="mt-6 pt-6 border-t border-border space-y-2 text-left">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Branch:</span>
                <span className="font-medium">{collector.branches?.name ?? '—'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Area:</span>
                <span className="font-medium">{collector.areas?.name ?? '—'}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stats + customers */}
        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <StatCard title="Customers Assigned" value={customers.length.toString()} icon={<Users className="w-5 h-5" />} />
            <StatCard title="Total Collected" value={formatCurrency(totalCollected)} icon={<Wallet className="w-5 h-5" />} variant="success" />
          </div>

          <Card className="glass-card border-border">
            <CardHeader>
              <CardTitle>Assigned Customers</CardTitle>
              <CardDescription>{customers.length} customers under {collector.branches?.name ?? 'this collector'}{collector.areas?.name ? ` • ${collector.areas.name}` : ''}</CardDescription>
            </CardHeader>
            <CardContent>
              {customers.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No customers assigned yet</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Branch</TableHead>
                      <TableHead>Area</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Max Loan Limit</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customers.map(c => (
                      <TableRow key={c.id} className="cursor-pointer hover:bg-secondary/50" onClick={() => router.push(`/customers/${c.id}`)}>
                        <TableCell className="font-medium text-sm">{c.first_name} {c.last_name}</TableCell>
                        <TableCell className="text-sm">
                          <span className="flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5 text-muted-foreground" />{c.branches?.name ?? '—'}</span>
                        </TableCell>
                        <TableCell className="text-sm">
                          <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 text-muted-foreground" />{c.areas?.name ?? '—'}</span>
                        </TableCell>
                        <TableCell className="text-sm">{c.phone ?? '—'}</TableCell>
                        <TableCell className="text-sm">{formatCurrency(c.max_loan_limit)}</TableCell>
                        <TableCell>
                          <Badge variant={c.status === 'active' ? 'default' : 'secondary'}>{c.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
