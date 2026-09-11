'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency, formatDate } from '@/lib/format';
import { postJournalEntry } from '@/lib/ledger';
import { resolveBranchAccountCode } from '@/lib/branch-accounts';
import { nextOrNumberOnline } from '@/lib/or-numbers';
import {
  ArrowLeft, Ban, User, Landmark, Plus, Loader2, FileText, Wallet,
} from 'lucide-react';

// A written-off loan's own self-contained view — full loan info, its
// complete payment history (before AND after the write-off), and its own
// Record Payment + Journal Entries, isolated from the main Payments/Journal
// Entries pages. See the "Write Off" button on /loans/[id] and
// supabase/add_loan_write_off.sql.
//
// Journal Entries here are everything postJournalEntry ever tagged with
// source_id = this loan (the original disbursement, the write-off entry
// itself — Debit Doubtful Accounts Expense / Credit Loans Receivable, see
// handleWriteOff in /loans/[id]/page.tsx — and any write-off recovery
// payments below) — that's the full set the app can cleanly attribute to
// ONE loan. Ongoing COLLECTION entries before the write-off
// are deliberately not reproduced here: those post as one lump sum per
// collector remittance batch, covering many loans at once, so there is no
// single entry to point at for "this loan's share" of one. The Payment
// History table below still shows those historical payments in full — it's
// only the ledger-entry view that has this one gap, and it's a structural
// one, not a bug.
export default function WriteOffDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const { profile } = useAuth();

  const [loan, setLoan] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(new Date().toISOString().split('T')[0]);
  const [payNotes, setPayNotes] = useState('');
  const [paying, setPaying] = useState(false);
  // Synchronous guard — see payments/page.tsx's submittingRef for why a
  // plain `paying` state isn't enough on its own.
  const payingRef = useRef(false);

  async function loadLoan() {
    const id = params.id as string;
    const [l, p, je] = await Promise.all([
      supabase
        .from('loans')
        .select('*, customers(first_name, last_name, phone, address, barangay), branches(name), collectors(profiles(full_name)), written_off_by_profile:profiles!written_off_by(full_name)')
        .eq('id', id)
        .maybeSingle(),
      supabase.from('payments').select('*, receipts(or_number)').eq('loan_id', id).order('payment_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase
        .from('journal_entries')
        .select('*, journal_entry_lines(debit, credit, memo, chart_of_accounts(code, name))')
        .eq('source_id', id)
        .in('source', ['disbursement', 'write_off', 'write_off_payment'])
        .order('entry_date', { ascending: false }),
    ]);
    setLoan(l.data);
    setPayments(p.data ?? []);
    setEntries(je.data ?? []);
    setLoading(false);
  }

  useEffect(() => { loadLoan(); }, [params.id]);

  function openPay() {
    setPayAmount('');
    setPayDate(new Date().toISOString().split('T')[0]);
    setPayNotes('');
    setPayOpen(true);
  }

  // Records a payment collected on an already-written-off loan. Unlike the
  // normal Payments page, this posts straight to Miscellaneous Income
  // instead of Loans Receivable — the loan stopped counting as a
  // receivable the moment it was written off, so crediting Loans
  // Receivable again here would quietly reintroduce it into that total.
  async function handleRecordPayment() {
    if (payingRef.current) return;
    const amount = Number(payAmount);
    if (!amount || amount <= 0 || !loan) return;
    payingRef.current = true;
    setPaying(true);
    try {
      const branchName = loan.branches?.name ?? null;
      const [cashCode, miscIncomeCode] = await Promise.all([
        resolveBranchAccountCode('Cash in Vault', loan.branch_id, branchName),
        resolveBranchAccountCode('Miscellaneous Income', loan.branch_id, branchName),
      ]);
      if (!cashCode || !miscIncomeCode) {
        toast({
          title: 'Error',
          description: `Could not find ${!cashCode ? 'a Cash in Vault' : 'the Miscellaneous Income'} account in the Chart of Accounts${!cashCode && branchName ? ` for ${branchName}` : ''}.`,
          variant: 'destructive',
        });
        return;
      }

      const orNumber = await nextOrNumberOnline();
      if (!orNumber) {
        toast({ title: 'Error', description: 'Could not get an OR number. Try again.', variant: 'destructive' });
        return;
      }

      const newBalance = Math.max(0, Number(loan.remaining_balance) - amount);

      const { data: receipt, error: receiptError } = await supabase.from('receipts').insert({
        or_number: orNumber,
        loan_id: loan.id,
        customer_id: loan.customer_id,
        amount,
        remaining_balance: newBalance,
        payment_date: payDate,
        qr_data: JSON.stringify({ or: orNumber, loan: loan.loan_number, amount }),
      }).select().single();
      if (receiptError || !receipt) {
        toast({ title: 'Error', description: receiptError?.message ?? 'Could not create the receipt', variant: 'destructive' });
        return;
      }

      const { error: payError } = await supabase.from('payments').insert({
        loan_id: loan.id,
        customer_id: loan.customer_id,
        receipt_id: receipt.id,
        amount_paid: amount,
        principal: 0,
        interest: 0,
        penalty: 0,
        remaining_balance: newBalance,
        payment_date: payDate,
        notes: payNotes.trim() || 'Write-off recovery payment',
      });
      if (payError) {
        toast({ title: 'Error', description: payError.message, variant: 'destructive' });
        return;
      }

      await supabase.from('loans').update({ remaining_balance: newBalance }).eq('id', loan.id);

      const ledgerResult = await postJournalEntry({
        entryDate: payDate,
        description: `Write-off recovery payment — ${loan.loan_number}`,
        reference: orNumber,
        source: 'write_off_payment',
        sourceId: loan.id,
        createdBy: profile?.id ?? null,
        branchId: loan.branch_id ?? null,
        lines: [
          { accountCode: cashCode, debit: amount, memo: 'Cash received' },
          { accountCode: miscIncomeCode, credit: amount, memo: `Recovery on written-off loan ${loan.loan_number}` },
        ],
      });
      if (!ledgerResult.ok) {
        toast({
          title: 'Payment recorded, ledger not posted',
          description: `The payment was saved, but the journal entry could not be posted (missing account: ${ledgerResult.missingCodes.join(', ') || 'unknown'}). Post it manually in Journal Entries.`,
          variant: 'destructive',
        });
      } else {
        toast({ title: 'Payment recorded', description: `OR ${orNumber} — posted to Miscellaneous Income.` });
      }

      setPayOpen(false);
      loadLoan();
    } finally {
      setPaying(false);
      payingRef.current = false;
    }
  }

  if (loading || !loan) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={loan.loan_number} description="Write-Off record — full loan detail, payment history, and its own finance trail">
        <Button variant="outline" size="sm" onClick={() => router.push('/write-off')}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Write-Off
        </Button>
        <Button size="sm" onClick={openPay}>
          <Plus className="w-4 h-4 mr-2" />
          Record Payment
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="glass-card border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Landmark className="w-5 h-5" />Loan Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Status:</span><Badge variant="destructive">Written Off</Badge></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Total Payable:</span><span>{formatCurrency(loan.total_payable)}</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Remaining Balance:</span><span className="font-bold">{formatCurrency(loan.remaining_balance)}</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Release Date:</span><span>{formatDate(loan.release_date)}</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Due Date:</span><span>{formatDate(loan.due_date)}</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Branch:</span><span>{loan.branches?.name ?? '—'}</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Collector:</span><span>{loan.collectors?.profiles?.full_name ?? '—'}</span></div>
          </CardContent>
        </Card>

        <Card className="glass-card border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><User className="w-5 h-5" />Customer & Write-Off Detail</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm"><p className="text-muted-foreground">Customer</p><p className="font-medium">{loan.customers?.first_name} {loan.customers?.last_name}</p></div>
            <div className="text-sm"><p className="text-muted-foreground">Phone</p><p>{loan.customers?.phone ?? '—'}</p></div>
            <div className="text-sm"><p className="text-muted-foreground">Address</p><p>{loan.customers?.address ?? '—'}{loan.customers?.barangay ? `, Brgy. ${loan.customers.barangay}` : ''}</p></div>
            <div className="text-sm"><p className="text-muted-foreground flex items-center gap-1"><Ban className="w-3.5 h-3.5" />Written off</p><p>{formatDate(loan.written_off_at)}{loan.written_off_by_profile?.full_name ? ` by ${loan.written_off_by_profile.full_name}` : ''}</p></div>
            <div className="text-sm"><p className="text-muted-foreground">Reason</p><p>{loan.written_off_reason ?? '—'}</p></div>
          </CardContent>
        </Card>
      </div>

      <Card className="glass-card border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Wallet className="w-5 h-5" />Payment History</CardTitle>
          <CardDescription>{payments.length} payment{payments.length === 1 ? '' : 's'} — before and after write-off</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No payments recorded on this loan</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>OR #</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Balance After</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="text-sm">{formatDate(p.payment_date)}</TableCell>
                    <TableCell className="text-sm font-mono">{p.receipts?.or_number ?? '—'}</TableCell>
                    <TableCell className="text-right text-sm">{formatCurrency(p.amount_paid)}</TableCell>
                    <TableCell className="text-right text-sm">{formatCurrency(p.remaining_balance)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.notes ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="glass-card border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileText className="w-5 h-5" />Journal Entries</CardTitle>
          <CardDescription>Every entry the ledger can attribute to this one loan specifically — its original disbursement, and any write-off recovery payments above</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No loan-specific journal entries found</p>
          ) : (
            <div className="divide-y divide-border">
              {entries.map(e => (
                <div key={e.id} className="p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{e.description}</p>
                    <span className="text-xs text-muted-foreground">{formatDate(e.entry_date)} · {e.entry_number}</span>
                  </div>
                  <table className="w-full text-sm mt-2">
                    <tbody>
                      {(e.journal_entry_lines ?? []).map((l: any, i: number) => (
                        <tr key={i}>
                          <td className="py-0.5 text-muted-foreground">{l.chart_of_accounts?.code} — {l.chart_of_accounts?.name}</td>
                          <td className="py-0.5 text-right w-28">{Number(l.debit) > 0 ? formatCurrency(l.debit) : ''}</td>
                          <td className="py-0.5 text-right w-28">{Number(l.credit) > 0 ? formatCurrency(l.credit) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Payment — {loan.loan_number}</DialogTitle>
            <DialogDescription>
              Posts straight to Miscellaneous Income, not Loans Receivable — this loan no longer counts as a receivable.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Amount (₱) *</Label>
              <Input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="0.00" />
            </div>
            <div className="space-y-2">
              <Label>Date *</Label>
              <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea value={payNotes} onChange={(e) => setPayNotes(e.target.value)} placeholder="Write-off recovery payment" rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>Cancel</Button>
            <Button disabled={paying || !payAmount || Number(payAmount) <= 0} onClick={handleRecordPayment}>
              {paying && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Record Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
