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
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency, formatDate, exportToCSV } from '@/lib/format';
import { Receipt, Search, Download, Loader2, Printer } from 'lucide-react';

export default function ReceiptsPage() {
  const { toast } = useToast();
  const [receipts, setReceipts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [preview, setPreview] = useState<any>(null);
  const pageSize = 10;

  useEffect(() => { load(); }, [search, page]);

  async function load() {
    setLoading(true);
    let query = supabase
      .from('receipts')
      .select('*, loans(loan_number, customers(first_name, last_name)), collectors(profiles(full_name))', { count: 'exact' });
    if (search) query = query.or(`or_number.ilike.%${search}%`);
    query = query.range((page - 1) * pageSize, page * pageSize - 1).order('created_at', { ascending: false });
    const { data, count } = await query;
    setReceipts(data ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }

  function handleExport() {
    exportToCSV(receipts.map(r => ({
      ORNumber: r.or_number,
      Date: r.payment_date,
      Loan: r.loans?.loan_number ?? '',
      Customer: r.loans ? `${r.loans.customers?.first_name} ${r.loans.customers?.last_name}` : '',
      Amount: r.amount,
      Balance: r.remaining_balance,
    })), 'receipts.csv');
  }

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-6">
      <PageHeader title="Receipts" description="Official receipts for all payments">
        <Button variant="outline" size="sm" onClick={handleExport}><Download className="w-4 h-4 mr-2" />Export</Button>
      </PageHeader>

      <Card className="glass-card border-border">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search by OR number..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="pl-10" />
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card border-border">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : receipts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Receipt className="w-12 h-12 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">No receipts found</p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>OR Number</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Loan #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Collector</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Balance</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {receipts.map(r => (
                    <TableRow key={r.id} className="hover:bg-secondary/50">
                      <TableCell className="font-mono text-sm font-bold">{r.or_number}</TableCell>
                      <TableCell className="text-sm">{formatDate(r.payment_date)}</TableCell>
                      <TableCell className="text-sm">{r.loans?.loan_number ?? '—'}</TableCell>
                      <TableCell className="text-sm">{r.loans ? `${r.loans.customers?.first_name} ${r.loans.customers?.last_name}` : '—'}</TableCell>
                      <TableCell className="text-sm">{r.collectors?.profiles?.full_name ?? '—'}</TableCell>
                      <TableCell className="text-sm font-medium text-success">{formatCurrency(r.amount)}</TableCell>
                      <TableCell className="text-sm">{formatCurrency(r.remaining_balance)}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => setPreview(r)}>
                          <Printer className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between p-4 border-t border-border">
                <p className="text-sm text-muted-foreground">Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setPreview(null)}>
          <div className="bg-card rounded-2xl p-8 max-w-md w-full shadow-2xl animate-scale-in" onClick={(e) => e.stopPropagation()}>
            <div className="text-center mb-6">
              <div className="w-16 h-16 mx-auto rounded-xl bg-primary flex items-center justify-center mb-3">
                <Receipt className="w-9 h-9 text-white" />
              </div>
              <h2 className="text-xl font-bold text-primary">1125Corp</h2>
              <p className="text-xs text-muted-foreground">1125corp.org</p>
            </div>
            <div className="space-y-2 text-sm border-2 border-border rounded-xl p-6">
              <div className="flex justify-between"><span className="text-muted-foreground">OR Number:</span><span className="font-mono font-bold">{preview.or_number}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Date:</span><span>{formatDate(preview.payment_date)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Loan #:</span><span>{preview.loans?.loan_number ?? '—'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Customer:</span><span>{preview.loans ? `${preview.loans.customers?.first_name} ${preview.loans.customers?.last_name}` : '—'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Collector:</span><span>{preview.collectors?.profiles?.full_name ?? '—'}</span></div>
              <div className="flex justify-between pt-2 border-t border-border"><span className="font-medium">Amount Paid:</span><span className="font-bold text-success">{formatCurrency(preview.amount)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Remaining Balance:</span><span className="font-bold">{formatCurrency(preview.remaining_balance)}</span></div>
            </div>
            <div className="flex justify-center mt-4">
              <div className="w-24 h-24 bg-secondary rounded-lg flex items-center justify-center">
                <Receipt className="w-12 h-12 text-muted-foreground" />
              </div>
            </div>
            <p className="text-center text-xs text-muted-foreground mt-4">Thank you for your payment!</p>
            <div className="flex gap-2 mt-6">
              <Button variant="outline" className="flex-1" onClick={() => window.print()}><Printer className="w-4 h-4 mr-2" />Print</Button>
              <Button className="flex-1" onClick={() => setPreview(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
