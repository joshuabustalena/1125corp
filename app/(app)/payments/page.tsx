'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency, formatDate, generateORNumber, exportToCSV } from '@/lib/format';
import {
  Wallet, Plus, Search, Download, Eye, Loader2, MapPin, Receipt, Calculator,
} from 'lucide-react';
import Link from 'next/link';

export default function PaymentsPage() {
  const searchParams = useSearchParams();
  const { profile } = useAuth();
  const { toast } = useToast();
  const [payments, setPayments] = useState<any[]>([]);
  const [loans, setLoans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [receiptData, setReceiptData] = useState<any>(null);
  const pageSize = 10;

  const [form, setForm] = useState({
    loan_id: searchParams.get('loan') ?? '',
    amount_paid: '',
    principal: '',
    interest: '',
    penalty: '0',
    notes: '',
    gps_lat: '',
    gps_lng: '',
  });

  useEffect(() => {
    loadPayments();
    loadLoans();
  }, [search, page]);

  async function loadLoans() {
    const { data } = await supabase
      .from('loans')
      .select('id, loan_number, remaining_balance, status, customers(first_name, last_name)')
      .in('status', ['active', 'overdue'])
      .order('loan_number');
    setLoans(data ?? []);
  }

  async function loadPayments() {
    setLoading(true);
    let query = supabase
      .from('payments')
      .select('*, loans(loan_number, customers(first_name, last_name)), collectors(profiles(full_name)), receipts(or_number)', { count: 'exact' });

    if (search) {
      query = query.or(`loans.loan_number.ilike.%${search}%`);
    }

    query = query.range((page - 1) * pageSize, page * pageSize - 1).order('payment_date', { ascending: false });
    const { data, count } = await query;
    setPayments(data ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }

  const selectedLoan = loans.find(l => l.id === form.loan_id);
  const newBalance = selectedLoan ? Math.max(0, Number(selectedLoan.remaining_balance) - Number(form.amount_paid || 0)) : 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.loan_id || !form.amount_paid) return;
    setSaving(true);

    const orNumber = generateORNumber();
    const today = new Date().toISOString().split('T')[0];
    const now = new Date();

    // Create receipt first
    const { data: receipt, error: receiptError } = await supabase.from('receipts').insert({
      or_number: orNumber,
      loan_id: form.loan_id,
      customer_id: selectedLoan?.customers ? undefined : undefined,
      amount: Number(form.amount_paid),
      remaining_balance: newBalance,
      payment_date: today,
      qr_data: JSON.stringify({ or: orNumber, loan: selectedLoan?.loan_number, amount: form.amount_paid }),
    }).select().single();

    if (receiptError) {
      toast({ title: 'Error', description: receiptError.message, variant: 'destructive' });
      setSaving(false);
      return;
    }

    // Create payment
    const { error: payError } = await supabase.from('payments').insert({
      loan_id: form.loan_id,
      customer_id: selectedLoan?.customers ? undefined : undefined,
      receipt_id: receipt.id,
      amount_paid: Number(form.amount_paid),
      principal: Number(form.principal) || 0,
      interest: Number(form.interest) || 0,
      penalty: Number(form.penalty) || 0,
      remaining_balance: newBalance,
      payment_date: today,
      payment_time: now.toTimeString().split(' ')[0],
      gps_lat: form.gps_lat ? Number(form.gps_lat) : null,
      gps_lng: form.gps_lng ? Number(form.gps_lng) : null,
      notes: form.notes || null,
    });

    if (payError) {
      toast({ title: 'Error', description: payError.message, variant: 'destructive' });
      setSaving(false);
      return;
    }

    // Update loan balance
    await supabase.from('loans').update({
      remaining_balance: newBalance,
      status: newBalance === 0 ? 'paid' : selectedLoan?.status,
    }).eq('id', form.loan_id);

    toast({ title: 'Success', description: `Payment posted. OR: ${orNumber}` });

    setReceiptData({
      orNumber,
      loanNumber: selectedLoan?.loan_number,
      customerName: selectedLoan ? `${selectedLoan.customers?.first_name} ${selectedLoan.customers?.last_name}` : '',
      amount: Number(form.amount_paid),
      remainingBalance: newBalance,
      date: today,
    });

    setForm({ ...form, loan_id: '', amount_paid: '', principal: '', interest: '', penalty: '0', notes: '' });
    setDialogOpen(false);
    setSaving(false);
    loadPayments();
  }

  function handleExport() {
    exportToCSV(
      payments.map(p => ({
        Date: p.payment_date,
        LoanNumber: p.loans?.loan_number ?? '',
        Customer: p.loans ? `${p.loans.customers?.first_name} ${p.loans.customers?.last_name}` : '',
        Amount: p.amount_paid,
        Principal: p.principal,
        Interest: p.interest,
        Penalty: p.penalty,
        Balance: p.remaining_balance,
        OR: p.receipts?.or_number ?? '',
      })),
      'payments.csv'
    );
  }

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-6">
      <PageHeader title="Payment Collection" description="Post collections and generate official receipts">
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="w-4 h-4 mr-2" />
          Export
        </Button>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Post Collection
        </Button>
      </PageHeader>

      {/* Filters */}
      <Card className="glass-card border-border">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by loan number..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="glass-card border-border">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : payments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Wallet className="w-12 h-12 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">No payments recorded</p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Loan #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Collector</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Balance</TableHead>
                    <TableHead>OR #</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map(p => (
                    <TableRow key={p.id} className="hover:bg-secondary/50">
                      <TableCell className="text-sm">{formatDate(p.payment_date)}</TableCell>
                      <TableCell className="font-medium text-sm">{p.loans?.loan_number ?? '—'}</TableCell>
                      <TableCell className="text-sm">{p.loans ? `${p.loans.customers?.first_name} ${p.loans.customers?.last_name}` : '—'}</TableCell>
                      <TableCell className="text-sm">{p.collectors?.profiles?.full_name ?? '—'}</TableCell>
                      <TableCell className="text-sm font-medium text-success">{formatCurrency(p.amount_paid)}</TableCell>
                      <TableCell className="text-sm">{formatCurrency(p.remaining_balance)}</TableCell>
                      <TableCell className="text-sm">{p.receipts?.or_number ?? '—'}</TableCell>
                      <TableCell className="text-right">
                        <Link href="/receipts">
                          <Button variant="ghost" size="icon">
                            <Receipt className="w-4 h-4" />
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between p-4 border-t border-border">
                <p className="text-sm text-muted-foreground">
                  Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Post Collection Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Post Collection</DialogTitle>
            <DialogDescription>Record a payment and generate an official receipt</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Loan *</Label>
              <Select value={form.loan_id} onValueChange={(v) => setForm({ ...form, loan_id: v })} required>
                <SelectTrigger><SelectValue placeholder="Select loan" /></SelectTrigger>
                <SelectContent>
                  {loans.map(l => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.loan_number} — {l.customers?.first_name} {l.customers?.last_name} (Bal: {formatCurrency(l.remaining_balance)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedLoan && (
              <div className="p-3 rounded-lg bg-secondary/50 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Current Balance:</span><span className="font-medium">{formatCurrency(selectedLoan.remaining_balance)}</span></div>
              </div>
            )}

            <div className="space-y-2">
              <Label>Amount Paid (₱) *</Label>
              <Input type="number" required value={form.amount_paid} onChange={(e) => setForm({ ...form, amount_paid: e.target.value })} placeholder="0.00" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Principal</Label>
                <Input type="number" value={form.principal} onChange={(e) => setForm({ ...form, principal: e.target.value })} placeholder="0.00" />
              </div>
              <div className="space-y-2">
                <Label>Interest</Label>
                <Input type="number" value={form.interest} onChange={(e) => setForm({ ...form, interest: e.target.value })} placeholder="0.00" />
              </div>
              <div className="space-y-2">
                <Label>Penalty</Label>
                <Input type="number" value={form.penalty} onChange={(e) => setForm({ ...form, penalty: e.target.value })} placeholder="0.00" />
              </div>
              <div className="space-y-2">
                <Label>GPS (optional)</Label>
                <div className="flex gap-2">
                  <Input type="number" value={form.gps_lat} onChange={(e) => setForm({ ...form, gps_lat: e.target.value })} placeholder="Lat" />
                  <Input type="number" value={form.gps_lng} onChange={(e) => setForm({ ...form, gps_lng: e.target.value })} placeholder="Lng" />
                </div>
              </div>
            </div>

            {form.amount_paid && selectedLoan && (
              <div className="p-3 rounded-lg bg-primary/5 border border-border">
                <div className="flex items-center gap-2 text-sm font-medium text-primary mb-1">
                  <Calculator className="w-4 h-4" />
                  New Remaining Balance: {formatCurrency(newBalance)}
                </div>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving || !form.loan_id || !form.amount_paid}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Post & Generate Receipt
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Receipt preview */}
      {receiptData && (
        <Dialog open={!!receiptData} onOpenChange={(open) => !open && setReceiptData(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Receipt className="w-5 h-5" />
                Official Receipt
              </DialogTitle>
            </DialogHeader>
            <div className="p-6 border-2 border-border rounded-xl space-y-4">
              <div className="text-center">
                <h2 className="text-xl font-bold text-primary">1125Corp</h2>
                <p className="text-xs text-muted-foreground">1125corp.org</p>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">OR Number:</span><span className="font-mono font-bold">{receiptData.orNumber}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Date:</span><span>{formatDate(receiptData.date)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Loan #:</span><span>{receiptData.loanNumber}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Customer:</span><span>{receiptData.customerName}</span></div>
                <div className="flex justify-between pt-2 border-t border-border"><span className="font-medium">Amount Paid:</span><span className="font-bold text-success">{formatCurrency(receiptData.amount)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Remaining Balance:</span><span className="font-bold">{formatCurrency(receiptData.remainingBalance)}</span></div>
              </div>
              <div className="flex justify-center pt-2">
                <div className="w-20 h-20 bg-secondary rounded-lg flex items-center justify-center">
                  <Receipt className="w-10 h-10 text-muted-foreground" />
                </div>
              </div>
              <p className="text-center text-xs text-muted-foreground">Thank you for your payment!</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => window.print()}>Print</Button>
              <Button onClick={() => setReceiptData(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
