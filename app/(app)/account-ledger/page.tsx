'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency, formatDate } from '@/lib/format';
import { Loader2 } from 'lucide-react';

export default function AccountLedgerPage() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [ledgerAccountId, setLedgerAccountId] = useState('');
  const [ledgerStartDate, setLedgerStartDate] = useState(new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0]);
  const [ledgerEndDate, setLedgerEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [ledgerRows, setLedgerRows] = useState<any[] | null>(null);
  const [ledgerOpeningBalance, setLedgerOpeningBalance] = useState(0);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  useEffect(() => {
    supabase.from('chart_of_accounts').select('*').order('code').then(({ data }) => setAccounts(data ?? []));
  }, []);

  // Every line ever posted to one account, in date order, with a running
  // balance — the actual General Ledger, as distinct from the chronological
  // by-transaction view on Journal Entries.
  async function generateLedger() {
    if (!ledgerAccountId) return;
    setLedgerLoading(true);
    const account = accounts.find(a => a.id === ledgerAccountId);
    const isDebitNormal = account?.account_type === 'asset' || account?.account_type === 'expense';

    const { data } = await supabase
      .from('journal_entry_lines')
      .select('debit, credit, memo, journal_entries!inner(entry_number, entry_date, description, reference, created_at)')
      .eq('account_id', ledgerAccountId)
      .lte('journal_entries.entry_date', ledgerEndDate);

    const sorted = (data ?? []).slice().sort((a: any, b: any) => {
      const da = a.journal_entries?.entry_date ?? '';
      const db = b.journal_entries?.entry_date ?? '';
      if (da !== db) return da.localeCompare(db);
      return (a.journal_entries?.created_at ?? '').localeCompare(b.journal_entries?.created_at ?? '');
    });

    let running = 0;
    let opening = 0;
    const rows: any[] = [];
    sorted.forEach((l: any) => {
      const delta = isDebitNormal ? Number(l.debit) - Number(l.credit) : Number(l.credit) - Number(l.debit);
      const entryDate = l.journal_entries?.entry_date;
      running += delta;
      if (entryDate && entryDate < ledgerStartDate) {
        opening += delta;
        return;
      }
      rows.push({
        date: entryDate,
        entryNumber: l.journal_entries?.entry_number,
        description: l.journal_entries?.description,
        reference: l.journal_entries?.reference,
        memo: l.memo,
        debit: Number(l.debit),
        credit: Number(l.credit),
        balance: running,
      });
    });

    setLedgerRows(rows);
    setLedgerOpeningBalance(opening);
    setLedgerLoading(false);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="General Ledger" description="Every line posted to a single account, in date order, with a running balance" />

      <Card className="glass-card border-border">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="space-y-2 flex-1">
              <Label>Account</Label>
              <Select value={ledgerAccountId} onValueChange={setLedgerAccountId}>
                <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>{accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2 flex-1">
              <Label>Start Date</Label>
              <Input type="date" value={ledgerStartDate} onChange={(e) => setLedgerStartDate(e.target.value)} />
            </div>
            <div className="space-y-2 flex-1">
              <Label>End Date</Label>
              <Input type="date" value={ledgerEndDate} onChange={(e) => setLedgerEndDate(e.target.value)} />
            </div>
            <Button onClick={generateLedger} disabled={ledgerLoading || !ledgerAccountId}>
              {ledgerLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Generate
            </Button>
          </div>
        </CardContent>
      </Card>

      {ledgerRows && (
        <Card className="glass-card border-border">
          <CardHeader>
            <CardTitle>{accounts.find(a => a.id === ledgerAccountId)?.code} — {accounts.find(a => a.id === ledgerAccountId)?.name}</CardTitle>
            <CardDescription>{formatDate(ledgerStartDate)} – {formatDate(ledgerEndDate)}</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Entry #</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="bg-secondary/30">
                  <TableCell colSpan={5} className="text-sm font-medium">Opening Balance</TableCell>
                  <TableCell className="text-right text-sm font-medium">{formatCurrency(ledgerOpeningBalance)}</TableCell>
                </TableRow>
                {ledgerRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">No activity in this date range</TableCell>
                  </TableRow>
                ) : (
                  ledgerRows.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-sm">{formatDate(r.date)}</TableCell>
                      <TableCell className="text-sm font-mono">{r.entryNumber}</TableCell>
                      <TableCell className="text-right text-sm">{r.debit > 0 ? formatCurrency(r.debit) : ''}</TableCell>
                      <TableCell className="text-right text-sm">{r.credit > 0 ? formatCurrency(r.credit) : ''}</TableCell>
                      <TableCell className="text-sm">{r.description ?? r.memo ?? '—'}</TableCell>
                      <TableCell className="text-right text-sm font-medium">{formatCurrency(r.balance)}</TableCell>
                    </TableRow>
                  ))
                )}
                <TableRow className="border-t-2 border-border">
                  <TableCell colSpan={5} className="font-bold">Ending Balance</TableCell>
                  <TableCell className="text-right font-bold">
                    {formatCurrency(ledgerRows.length > 0 ? ledgerRows[ledgerRows.length - 1].balance : ledgerOpeningBalance)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
