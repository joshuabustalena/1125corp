'use client';

import { useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency, formatDate } from '@/lib/format';
import { Search, Users, Landmark, Wallet, Loader2 } from 'lucide-react';
import Link from 'next/link';

export default function SearchPage() {
  const searchParams = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const [results, setResults] = useState<{ customers: any[]; loans: any[]; payments: any[] }>({ customers: [], loans: [], payments: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function search() {
      if (!q) { setLoading(false); return; }
      const [c, l, p] = await Promise.all([
        supabase.from('customers').select('id, first_name, last_name, phone, email, status').or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,phone.ilike.%${q}%`).limit(10),
        supabase.from('loans').select('id, loan_number, amount, status, customers(first_name, last_name)').or(`loan_number.ilike.%${q}%`).limit(10),
        supabase.from('payments').select('id, amount_paid, payment_date, loans(loan_number, customers(first_name, last_name))').limit(10),
      ]);
      setResults({ customers: c.data ?? [], loans: l.data ?? [], payments: p.data ?? [] });
      setLoading(false);
    }
    search();
  }, [q]);

  const total = results.customers.length + results.loans.length + results.payments.length;

  return (
    <div className="space-y-6">
      <PageHeader title="Search Results" description={`${total} results for "${q}"`} />

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
      ) : total === 0 ? (
        <Card className="glass-card border-border">
          <CardContent className="py-16 text-center">
            <Search className="w-12 h-12 text-muted-foreground/50 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No results found for "{q}"</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {results.customers.length > 0 && (
            <Card className="glass-card border-border">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3"><Users className="w-5 h-5 text-primary" /><h3 className="font-semibold">Customers ({results.customers.length})</h3></div>
                <div className="space-y-2">
                  {results.customers.map(c => (
                    <Link key={c.id} href={`/customers/${c.id}`} className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors">
                      <div><p className="text-sm font-medium">{c.first_name} {c.last_name}</p><p className="text-xs text-muted-foreground">{c.phone ?? c.email ?? ''}</p></div>
                      <Badge variant={c.status === 'active' ? 'default' : 'secondary'}>{c.status}</Badge>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {results.loans.length > 0 && (
            <Card className="glass-card border-border">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3"><Landmark className="w-5 h-5 text-primary" /><h3 className="font-semibold">Loans ({results.loans.length})</h3></div>
                <div className="space-y-2">
                  {results.loans.map(l => (
                    <Link key={l.id} href={`/loans/${l.id}`} className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors">
                      <div><p className="text-sm font-medium">{l.loan_number}</p><p className="text-xs text-muted-foreground">{l.customers?.first_name} {l.customers?.last_name}</p></div>
                      <div className="flex items-center gap-2"><span className="text-sm">{formatCurrency(l.amount)}</span><Badge variant="outline">{l.status}</Badge></div>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {results.payments.length > 0 && (
            <Card className="glass-card border-border">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3"><Wallet className="w-5 h-5 text-success" /><h3 className="font-semibold">Payments ({results.payments.length})</h3></div>
                <div className="space-y-2">
                  {results.payments.map(p => (
                    <div key={p.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                      <div><p className="text-sm font-medium">{p.loans?.loan_number ?? '—'}</p><p className="text-xs text-muted-foreground">{p.loans ? `${p.loans.customers?.first_name} ${p.loans.customers?.last_name}` : ''} • {formatDate(p.payment_date)}</p></div>
                      <Badge variant="secondary" className="text-success">{formatCurrency(p.amount_paid)}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
