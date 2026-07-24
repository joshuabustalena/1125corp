'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency } from '@/lib/format';
import { BookOpen, Plus, Loader2 } from 'lucide-react';

export default function ChartOfAccountsPage() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const isAdmin = profile?.role_name === 'Administrator';
  const [accounts, setAccounts] = useState<any[]>([]);
  const [accountBalances, setAccountBalances] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);
  const [accountForm, setAccountForm] = useState({ code: '', name: '', account_type: 'asset' });

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data: accts } = await supabase.from('chart_of_accounts').select('*').order('code');
    setAccounts(accts ?? []);
    await loadAccountBalances(accts ?? []);
    setLoading(false);
  }

  // Live "as of today" balance per account. Sign follows each account's
  // normal balance side (debit for asset/expense, credit for
  // liability/equity/revenue).
  async function loadAccountBalances(accts: any[]) {
    const today = new Date().toISOString().split('T')[0];
    const { data } = await supabase
      .from('journal_entry_lines')
      .select('debit, credit, account_id, journal_entries!inner(entry_date)')
      .lte('journal_entries.entry_date', today);

    const typeByAccount = new Map(accts.map(a => [a.id, a.account_type]));
    const totals: Record<string, number> = {};
    (data ?? []).forEach((l: any) => {
      const type = typeByAccount.get(l.account_id);
      const net = type === 'asset' || type === 'expense'
        ? Number(l.debit) - Number(l.credit)
        : Number(l.credit) - Number(l.debit);
      totals[l.account_id] = (totals[l.account_id] ?? 0) + net;
    });
    setAccountBalances(totals);
  }

  async function handleAddAccount(e: React.FormEvent) {
    e.preventDefault();
    setSavingAccount(true);
    const { error } = await supabase.from('chart_of_accounts').insert(accountForm);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: 'Account added' });
      setAccountDialogOpen(false);
      setAccountForm({ code: '', name: '', account_type: 'asset' });
      load();
    }
    setSavingAccount(false);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Chart of Accounts" description="Manage the accounts used across journal entries and financial statements" />

      <Card className="glass-card border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Accounts</CardTitle>
            <CardDescription>{accounts.length} accounts</CardDescription>
          </div>
          {isAdmin && (
            <Button size="sm" variant="outline" onClick={() => setAccountDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Account
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : accounts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <BookOpen className="w-12 h-12 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">No accounts found</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Balance (as of today)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map(a => (
                  <TableRow key={a.id} className="hover:bg-secondary/50">
                    <TableCell className="text-sm font-mono">{a.code}</TableCell>
                    <TableCell className="text-sm font-medium">{a.name}</TableCell>
                    <TableCell><Badge variant="outline" className="capitalize">{a.account_type}</Badge></TableCell>
                    <TableCell className="text-right text-sm font-medium">{formatCurrency(accountBalances[a.id] ?? 0)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* New account (admin) */}
      <Dialog open={accountDialogOpen} onOpenChange={setAccountDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Account</DialogTitle>
            <DialogDescription>Add a new account to the chart of accounts</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddAccount} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Code *</Label>
                <Input required value={accountForm.code} onChange={(e) => setAccountForm({ ...accountForm, code: e.target.value })} placeholder="e.g. 1020" />
              </div>
              <div className="space-y-2">
                <Label>Type *</Label>
                <Select value={accountForm.account_type} onValueChange={(v) => setAccountForm({ ...accountForm, account_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="asset">Asset</SelectItem>
                    <SelectItem value="liability">Liability</SelectItem>
                    <SelectItem value="equity">Equity</SelectItem>
                    <SelectItem value="revenue">Revenue</SelectItem>
                    <SelectItem value="expense">Expense</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Name *</Label>
                <Input required value={accountForm.name} onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })} placeholder="e.g. Petty Cash Fund" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAccountDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={savingAccount}>
                {savingAccount && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
