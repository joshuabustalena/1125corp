'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency, formatDate } from '@/lib/format';
import {
  ArrowLeft, Landmark, Wallet, Calendar, User, MapPin,
  Loader2, RefreshCw, Plus, Receipt,
} from 'lucide-react';
import Link from 'next/link';

export default function LoanDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const [loan, setLoan] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [renewing, setRenewing] = useState(false);

  useEffect(() => {
    async function load() {
      const id = params.id as string;
      const [l, p] = await Promise.all([
        supabase.from('loans').select('*, customers(first_name, last_name, phone, address, barangay, city), collectors(profiles(full_name)), branches(name), areas(name), loan_types(name)').eq('id', id).maybeSingle(),
        supabase.from('payments').select('*, receipts(or_number)').eq('loan_id', id).order('payment_date', { ascending: false }),
      ]);
      setLoan(l.data);
      setPayments(p.data ?? []);
      setLoading(false);
    }
    load();
  }, [params.id]);

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
  }
  if (!loan) {
    return <p className="text-center text-muted-foreground py-16">Loan not found</p>;
  }

  const offsetRequired = loan.remaining_balance * 0.40;
  const canRenew = loan.remaining_balance <= offsetRequired && loan.status === 'active';

  async function handleRenew() {
    setRenewing(true);
    const offsetRequired = loan.remaining_balance * 0.40;
    if (loan.remaining_balance > offsetRequired) {
      toast({
        title: 'Cannot renew',
        description: `40% remaining balance (₱${offsetRequired.toFixed(2)}) required. Current balance: ₱${loan.remaining_balance.toFixed(2)}`,
        variant: 'destructive',
      });
      setRenewing(false);
      return;
    }

    const newLoanNumber = `LN-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
    const { error } = await supabase.from('loans').insert({
      loan_number: newLoanNumber,
      customer_id: loan.customer_id,
      loan_type_id: loan.loan_type_id,
      amount: loan.amount,
      interest_rate: loan.interest_rate,
      interest_amount: loan.interest_amount,
      service_fee: loan.service_fee,
      release_amount: loan.release_amount,
      total_payable: loan.total_payable,
      remaining_balance: loan.total_payable,
      term_days: loan.term_days,
      collector_id: loan.collector_id,
      branch_id: loan.branch_id,
      area_id: loan.area_id,
      status: 'active',
      release_date: new Date().toISOString().split('T')[0],
      due_date: new Date(Date.now() + loan.term_days * 86400000).toISOString().split('T')[0],
    });

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      await supabase.from('loans').update({ status: 'renewed' }).eq('id', loan.id);
      toast({ title: 'Success', description: `Loan renewed as ${newLoanNumber}` });
      router.push('/loans');
    }
    setRenewing(false);
  }

  return (
    <div className="space-y-6">
      <PageHeader title={loan.loan_number} description="Loan details and payment history">
        <Button variant="outline" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <Link href={`/payments?loan=${loan.id}`}>
          <Button size="sm">
            <Plus className="w-4 h-4 mr-2" />
            Post Payment
          </Button>
        </Link>
        <Button size="sm" variant="outline" onClick={handleRenew} disabled={!canRenew || renewing}>
          {renewing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
          Renew Loan
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Loan info */}
        <Card className="glass-card border-border lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Landmark className="w-5 h-5" />
              Loan Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Status:</span>
              <Badge variant={loan.status === 'active' ? 'default' : loan.status === 'overdue' ? 'destructive' : 'secondary'}>{loan.status}</Badge>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Loan Type:</span>
              <span className="font-medium">{loan.loan_types?.name ?? '—'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Principal:</span>
              <span className="font-medium">{formatCurrency(loan.amount)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Interest ({loan.interest_rate}%):</span>
              <span className="font-medium">{formatCurrency(loan.interest_amount)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Service Fee:</span>
              <span className="font-medium text-warning">{formatCurrency(loan.service_fee)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Release Amount:</span>
              <span className="font-medium text-success">{formatCurrency(loan.release_amount)}</span>
            </div>
            <div className="flex justify-between text-sm pt-2 border-t border-border">
              <span className="text-muted-foreground">Total Payable:</span>
              <span className="font-bold text-primary">{formatCurrency(loan.total_payable)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Remaining Balance:</span>
              <span className="font-bold text-destructive">{formatCurrency(loan.remaining_balance)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Release Date:</span>
              <span>{formatDate(loan.release_date)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Due Date:</span>
              <span>{formatDate(loan.due_date)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Term:</span>
              <span>{loan.term_days} days</span>
            </div>
          </CardContent>
        </Card>

        {/* Customer & Collector */}
        <Card className="glass-card border-border lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="w-5 h-5" />
              Customer & Assignment
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm">
              <p className="text-muted-foreground">Customer</p>
              <p className="font-medium">{loan.customers?.first_name} {loan.customers?.last_name}</p>
            </div>
            <div className="text-sm">
              <p className="text-muted-foreground">Phone</p>
              <p>{loan.customers?.phone ?? '—'}</p>
            </div>
            <div className="text-sm">
              <p className="text-muted-foreground">Address</p>
              <p>{loan.customers?.address ?? '—'}{loan.customers?.barangay ? `, Brgy. ${loan.customers.barangay}` : ''}</p>
            </div>
            <div className="text-sm">
              <p className="text-muted-foreground">Collector</p>
              <p className="font-medium">{loan.collectors?.profiles?.full_name ?? '—'}</p>
            </div>
            <div className="text-sm">
              <p className="text-muted-foreground">Branch</p>
              <p>{loan.branches?.name ?? '—'}</p>
            </div>
            <div className="text-sm">
              <p className="text-muted-foreground">Area</p>
              <p>{loan.areas?.name ?? '—'}</p>
            </div>
          </CardContent>
        </Card>

        {/* Payment history */}
        <Card className="glass-card border-border lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="w-5 h-5" />
              Payment History
            </CardTitle>
            <CardDescription>{payments.length} payments</CardDescription>
          </CardHeader>
          <CardContent>
            {payments.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No payments yet</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {payments.map(p => (
                  <div key={p.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                    <div>
                      <p className="text-sm font-medium">{formatCurrency(p.amount_paid)}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(p.payment_date)} {p.receipts?.or_number ? `• ${p.receipts.or_number}` : ''}</p>
                    </div>
                    <Badge variant="secondary" className="text-success">{formatCurrency(p.remaining_balance)}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Renewal info */}
      {loan.status === 'active' && (
        <Card className="glass-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-warning/10 flex items-center justify-center">
                <RefreshCw className="w-5 h-5 text-warning" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">Loan Renewal</p>
                <p className="text-xs text-muted-foreground">
                  40% remaining balance ({formatCurrency(offsetRequired)}) required before renewal. Current balance: {formatCurrency(loan.remaining_balance)}
                </p>
              </div>
              <Badge variant={canRenew ? 'default' : 'secondary'}>
                {canRenew ? 'Eligible' : 'Not eligible'}
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
