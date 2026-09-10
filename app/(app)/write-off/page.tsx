'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency, formatDate, formatCustomerName } from '@/lib/format';
import { Ban, Loader2 } from 'lucide-react';

// Loans with status = 'written_off' — deliberately excluded from every
// other list in the app (Loans, the Payments loan picker, Dashboard/Reports
// receivable & overdue) once a loan lands here. See
// supabase/add_loan_write_off.sql and the "Write Off" button on
// /loans/[id]. Click a row to open its own detail/payment/finance view.
export default function WriteOffPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role_name === 'Administrator';
  const [loans, setLoans] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [branchFilter, setBranchFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('branches').select('id, name').eq('status', 'active').order('name').then(({ data }) => setBranches(data ?? []));
  }, []);

  useEffect(() => {
    load();
  }, [branchFilter]);

  async function load() {
    setLoading(true);
    let query = supabase
      .from('loans')
      .select('*, customers(first_name, last_name, phone), branches(name), written_off_by_profile:profiles!written_off_by(full_name)')
      .eq('status', 'written_off')
      .order('written_off_at', { ascending: false });
    if (!isAdmin && profile?.branch_id) {
      query = query.eq('branch_id', profile.branch_id);
    } else if (branchFilter !== 'all') {
      query = query.eq('branch_id', branchFilter);
    }
    const { data } = await query;
    setLoans(data ?? []);
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Write-Off" description="Loans written off — excluded from receivable/overdue everywhere else, still fully tracked here">
        {isAdmin && (
          <Select value={branchFilter} onValueChange={setBranchFilter}>
            <SelectTrigger className="w-full sm:w-48"><SelectValue placeholder="All Branches" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Branches</SelectItem>
              {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </PageHeader>

      <Card className="glass-card border-border">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : loans.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Ban className="w-12 h-12 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">No loans have been written off</p>
            </div>
          ) : (
            <>
              {/* Mobile card list */}
              <div className="md:hidden divide-y divide-border">
                {loans.map(l => (
                  <Link key={l.id} href={`/write-off/${l.id}`} className="block p-4 hover:bg-secondary/50">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-sm">{l.loan_number}</p>
                        <p className="text-sm text-muted-foreground">{formatCustomerName(l.customers?.first_name, l.customers?.last_name)}</p>
                      </div>
                      <Badge variant="outline">{l.branches?.name ?? '—'}</Badge>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{l.written_off_reason ?? '—'}</span>
                      <span className="font-semibold">{formatCurrency(l.remaining_balance)}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Written off {formatDate(l.written_off_at)}{l.written_off_by_profile?.full_name ? ` by ${l.written_off_by_profile.full_name}` : ''}
                    </p>
                  </Link>
                ))}
              </div>

              <Table className="hidden md:table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Loan #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Written Off</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loans.map(l => (
                    <TableRow key={l.id} className="cursor-pointer hover:bg-secondary/50" onClick={() => { window.location.href = `/write-off/${l.id}`; }}>
                      <TableCell className="text-sm font-medium">
                        <Link href={`/write-off/${l.id}`} className="hover:underline">{l.loan_number}</Link>
                      </TableCell>
                      <TableCell className="text-sm">{formatCustomerName(l.customers?.first_name, l.customers?.last_name)}</TableCell>
                      <TableCell><Badge variant="outline">{l.branches?.name ?? '—'}</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{l.written_off_reason ?? '—'}</TableCell>
                      <TableCell className="text-sm">
                        {formatDate(l.written_off_at)}
                        {l.written_off_by_profile?.full_name && <span className="text-muted-foreground"> · {l.written_off_by_profile.full_name}</span>}
                      </TableCell>
                      <TableCell className="text-right text-sm font-semibold">{formatCurrency(l.remaining_balance)}</TableCell>
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
