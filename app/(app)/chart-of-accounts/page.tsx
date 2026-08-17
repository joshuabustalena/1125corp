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
import { BookOpen, Plus, Pencil, Trash2, Loader2 } from 'lucide-react';

const SHARED_VALUE = 'shared';

export default function ChartOfAccountsPage() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const isAdmin = profile?.role_name === 'Administrator';
  const [accounts, setAccounts] = useState<any[]>([]);
  const [accountBalances, setAccountBalances] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState<any[]>([]);
  // Admin: free "All Branches" filter (default). Everyone else: locked to
  // their own branch + shared/company-wide accounts, same pattern used
  // elsewhere (Reports, Payment Reports, Dashboard).
  const [branchFilter, setBranchFilter] = useState('all');
  const [branchResolved, setBranchResolved] = useState(false);

  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);
  const [accountForm, setAccountForm] = useState({ code: '', name: '', account_type: 'asset', branch_id: SHARED_VALUE });
  const [editingAccount, setEditingAccount] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    supabase.from('branches').select('id, name').eq('status', 'active').order('name').then(({ data }) => setBranches(data ?? []));
  }, []);

  useEffect(() => {
    if (!profile) return;
    if (!isAdmin && profile.branch_id) setBranchFilter(profile.branch_id);
    setBranchResolved(true);
  }, [profile, isAdmin]);

  useEffect(() => {
    if (!branchResolved) return;
    load();
  }, [branchResolved, branchFilter]);

  async function load() {
    setLoading(true);
    // Every branch now keeps its own Chart of Accounts — an account with no
    // branch_id is company-wide/shared and always visible alongside
    // whichever branch is selected (or, for a non-admin, their own branch).
    let query = supabase.from('chart_of_accounts').select('*, branches(name)').order('code');
    if (branchFilter !== 'all') {
      query = query.or(`branch_id.eq.${branchFilter},branch_id.is.null`);
    }
    const { data: accts } = await query;
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

  function openAddAccount() {
    setEditingAccount(null);
    // Non-admin creating an account always tags it to their own branch —
    // they only ever operate within one branch anyway. Admin defaults to
    // Shared and picks explicitly.
    setAccountForm({ code: '', name: '', account_type: 'asset', branch_id: !isAdmin && profile?.branch_id ? profile.branch_id : SHARED_VALUE });
    setAccountDialogOpen(true);
  }

  function openEditAccount(account: any) {
    setEditingAccount(account);
    setAccountForm({ code: account.code, name: account.name, account_type: account.account_type, branch_id: account.branch_id ?? SHARED_VALUE });
    setAccountDialogOpen(true);
  }

  async function handleSaveAccount(e: React.FormEvent) {
    e.preventDefault();
    setSavingAccount(true);
    const payload = {
      code: accountForm.code,
      name: accountForm.name,
      account_type: accountForm.account_type,
      branch_id: accountForm.branch_id === SHARED_VALUE ? null : accountForm.branch_id,
    };
    const { error } = editingAccount
      ? await supabase.from('chart_of_accounts').update(payload).eq('id', editingAccount.id)
      : await supabase.from('chart_of_accounts').insert(payload);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: editingAccount ? 'Account updated' : 'Account added' });
      setAccountDialogOpen(false);
      setEditingAccount(null);
      setAccountForm({ code: '', name: '', account_type: 'asset', branch_id: SHARED_VALUE });
      load();
    }
    setSavingAccount(false);
  }

  async function handleDeleteAccount() {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from('chart_of_accounts').delete().eq('id', deleteTarget.id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: 'Account deleted' });
      setDeleteTarget(null);
      load();
    }
    setDeleting(false);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Chart of Accounts" description="Manage the accounts used across journal entries and financial statements">
        {isAdmin ? (
          <Select value={branchFilter} onValueChange={setBranchFilter}>
            <SelectTrigger className="w-full sm:w-48"><SelectValue placeholder="All Branches" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Branches</SelectItem>
              {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : (
          <Badge variant="outline" className="h-9 px-3 flex items-center">
            {branches.find(b => b.id === branchFilter)?.name ?? '—'}
          </Badge>
        )}
      </PageHeader>

      <Card className="glass-card border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Accounts</CardTitle>
            <CardDescription>{accounts.length} accounts</CardDescription>
          </div>
          {isAdmin && (
            <Button size="sm" variant="outline" onClick={openAddAccount}>
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
                  <TableHead>Branch</TableHead>
                  <TableHead className="text-right">Balance (as of today)</TableHead>
                  {isAdmin && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map(a => (
                  <TableRow key={a.id} className="hover:bg-secondary/50">
                    <TableCell className="text-sm font-mono">{a.code}</TableCell>
                    <TableCell className="text-sm font-medium">{a.name}</TableCell>
                    <TableCell><Badge variant="outline" className="capitalize">{a.account_type}</Badge></TableCell>
                    <TableCell>
                      {a.branches?.name ? (
                        <Badge variant="secondary">{a.branches.name}</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">Shared</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium">{formatCurrency(accountBalances[a.id] ?? 0)}</TableCell>
                    {isAdmin && (
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEditAccount(a)} title="Edit">
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(a)} title="Delete">
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit account (admin). Balance isn't part of this form at all —
          it's always computed live from journal entries, never a stored,
          editable field on the account itself. */}
      <Dialog open={accountDialogOpen} onOpenChange={setAccountDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingAccount ? 'Edit Account' : 'Add Account'}</DialogTitle>
            <DialogDescription>
              {editingAccount ? 'Update this account\'s details' : 'Add a new account to the chart of accounts'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveAccount} className="space-y-4">
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
              <div className="space-y-2 col-span-2">
                <Label>Branch</Label>
                <Select value={accountForm.branch_id} onValueChange={(v) => setAccountForm({ ...accountForm, branch_id: v })} disabled={!isAdmin}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SHARED_VALUE}>Shared / Company-wide</SelectItem>
                    {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {isAdmin
                    ? 'A branch-specific account (e.g. "Cash in Vault - Balanga") only shows up for that branch. "Shared" accounts show up everywhere.'
                    : 'New accounts you add are automatically scoped to your own branch.'}
                </p>
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

      {/* Delete account (admin) */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Account</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {deleteTarget?.code} — {deleteTarget?.name}? This action cannot be undone, and will fail if the account already has journal entries posted against it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteAccount} disabled={deleting}>
              {deleting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
