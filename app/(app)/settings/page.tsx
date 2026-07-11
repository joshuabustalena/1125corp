'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { formatDate } from '@/lib/format';
import {
  Settings as SettingsIcon, Plus, Loader2, Building2, Calendar, Percent,
  Bell, Mail, Save, Trash2, MapPin,
} from 'lucide-react';

export default function SettingsPage() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [branches, setBranches] = useState<any[]>([]);
  const [areas, setAreas] = useState<any[]>([]);
  const [holidays, setHolidays] = useState<any[]>([]);
  const [loanTypes, setLoanTypes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [branchDialog, setBranchDialog] = useState(false);
  const [areaDialog, setAreaDialog] = useState(false);
  const [holidayDialog, setHolidayDialog] = useState(false);

  const [branchForm, setBranchForm] = useState({ name: '', code: '', address: '', phone: '', email: '', max_loan_limit: '80000' });
  const [areaForm, setAreaForm] = useState({ name: '', branch_id: '', max_loan_limit: '80000' });
  const [holidayForm, setHolidayForm] = useState({ name: '', holiday_date: '', type: 'regular' });

  const isAdmin = profile?.role_name === 'Administrator';

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [s, b, a, h, lt] = await Promise.all([
      supabase.from('settings').select('*'),
      supabase.from('branches').select('*').order('name'),
      supabase.from('areas').select('*, branches(name)').order('name'),
      supabase.from('holidays').select('*').order('holiday_date'),
      supabase.from('loan_types').select('*').order('name'),
    ]);
    const settingsMap: Record<string, string> = {};
    (s.data ?? []).forEach((item: any) => {
      settingsMap[item.key] = typeof item.value === 'string' ? item.value : JSON.stringify(item.value);
    });
    setSettings(settingsMap);
    setBranches(b.data ?? []);
    setAreas(a.data ?? []);
    setHolidays(h.data ?? []);
    setLoanTypes(lt.data ?? []);
    setLoading(false);
  }

  async function saveSettings() {
    setSaving(true);
    const updates = Object.entries(settings).map(([key, value]) =>
      supabase.from('settings').update({ value: JSON.parse(value), updated_at: new Date().toISOString() }).eq('key', key)
    );
    await Promise.all(updates);
    toast({ title: 'Success', description: 'Settings saved' });
    setSaving(false);
  }

  function nextBranchCode() {
    let max = 0;
    for (const b of branches) {
      const m = b.code?.match(/^BR-(\d+)$/i);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `BR-${String(max + 1).padStart(3, '0')}`;
  }

  function openBranchDialog() {
    setBranchForm({ name: '', code: nextBranchCode(), address: '', phone: '', email: '', max_loan_limit: '80000' });
    setBranchDialog(true);
  }

  async function addBranch() {
    const { error } = await supabase.from('branches').insert({
      name: branchForm.name, code: branchForm.code, address: branchForm.address || null,
      phone: branchForm.phone || null, email: branchForm.email || null,
      max_loan_limit: Number(branchForm.max_loan_limit) || 80000,
    });
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Success', description: 'Branch added' }); setBranchDialog(false); setBranchForm({ name: '', code: '', address: '', phone: '', email: '', max_loan_limit: '80000' }); load(); }
  }

  async function addArea() {
    const { error } = await supabase.from('areas').insert({
      name: areaForm.name, branch_id: areaForm.branch_id || null,
      max_loan_limit: Number(areaForm.max_loan_limit) || 80000,
    });
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Success', description: 'Area added' }); setAreaDialog(false); setAreaForm({ name: '', branch_id: '', max_loan_limit: '80000' }); load(); }
  }

  async function addHoliday() {
    const { error } = await supabase.from('holidays').insert({
      name: holidayForm.name, holiday_date: holidayForm.holiday_date, type: holidayForm.type, is_custom: true,
    });
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Success', description: 'Holiday added' }); setHolidayDialog(false); setHolidayForm({ name: '', holiday_date: '', type: 'regular' }); load(); }
  }

  async function deleteHoliday(id: string) {
    const { error } = await supabase.from('holidays').delete().eq('id', id);
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Success', description: 'Holiday removed' }); load(); }
  }

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="System configuration and preferences" />

      <Tabs defaultValue="general">
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-5">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="loan">Loan & Interest</TabsTrigger>
          <TabsTrigger value="branches">Branches</TabsTrigger>
          <TabsTrigger value="holidays">Holidays</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
        </TabsList>

        {/* General Settings */}
        <TabsContent value="general">
          <Card className="glass-card border-border">
            <CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="w-5 h-5" />Company Information</CardTitle></CardHeader>
            <CardContent className="space-y-4 max-w-lg">
              <div className="space-y-2"><Label>Company Name</Label><Input value={settings.company_name ?? '1125Corp'} onChange={(e) => setSettings({ ...settings, company_name: `"${e.target.value}"` })} /></div>
              <div className="space-y-2"><Label>Domain</Label><Input value={settings.company_domain ?? '1125corp.org'} onChange={(e) => setSettings({ ...settings, company_domain: `"${e.target.value}"` })} /></div>
              <div className="space-y-2"><Label>Max Customer Loan (₱)</Label><Input type="number" value={settings.max_customer_loan ?? '80000'} onChange={(e) => setSettings({ ...settings, max_customer_loan: e.target.value })} /></div>
              <div className="space-y-2"><Label>Max Employee Loan (₱)</Label><Input type="number" value={settings.max_employee_loan ?? '15000'} onChange={(e) => setSettings({ ...settings, max_employee_loan: e.target.value })} /></div>
              <Button onClick={saveSettings} disabled={saving || !isAdmin}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}<Save className="w-4 h-4 mr-2" />Save Changes</Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Loan & Interest */}
        <TabsContent value="loan">
          <Card className="glass-card border-border">
            <CardHeader><CardTitle className="flex items-center gap-2"><Percent className="w-5 h-5" />Interest & Loan Settings</CardTitle></CardHeader>
            <CardContent className="space-y-4 max-w-lg">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Default Interest Rate (%)</Label><Input type="number" value={settings.default_interest_rate ?? '8'} onChange={(e) => setSettings({ ...settings, default_interest_rate: e.target.value })} /></div>
                <div className="space-y-2"><Label>Default Term (Days)</Label><Input type="number" value={settings.default_term_days ?? '60'} onChange={(e) => setSettings({ ...settings, default_term_days: e.target.value })} /></div>
                <div className="space-y-2"><Label>Service Charge ≥ ₱10,000 (%)</Label><Input type="number" value={settings.service_charge_above_10000 ?? '3'} onChange={(e) => setSettings({ ...settings, service_charge_above_10000: e.target.value })} /></div>
                <div className="space-y-2"><Label>Service Charge below ₱10,000 (₱)</Label><Input type="number" value={settings.service_charge_below_10000 ?? '300'} onChange={(e) => setSettings({ ...settings, service_charge_below_10000: e.target.value })} /></div>
                <div className="space-y-2"><Label>Renewal Offset Required (%)</Label><Input type="number" value={settings.renewal_offset_required ?? '40'} onChange={(e) => setSettings({ ...settings, renewal_offset_required: e.target.value })} /></div>
                <div className="space-y-2"><Label>Max Active Employee Loans</Label><Input type="number" value={settings.max_active_employee_loans ?? '2'} onChange={(e) => setSettings({ ...settings, max_active_employee_loans: e.target.value })} /></div>
              </div>
              <Button onClick={saveSettings} disabled={saving || !isAdmin}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}<Save className="w-4 h-4 mr-2" />Save Changes</Button>
            </CardContent>
          </Card>

          <Card className="glass-card border-border mt-4">
            <CardHeader><CardTitle>Loan Types</CardTitle><CardDescription>Available loan products</CardDescription></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Interest Rate</TableHead><TableHead>Term</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {loanTypes.map(lt => (
                    <TableRow key={lt.id}>
                      <TableCell className="text-sm font-medium">{lt.name}</TableCell>
                      <TableCell className="text-sm">{lt.interest_rate}%</TableCell>
                      <TableCell className="text-sm">{lt.term_days} days</TableCell>
                      <TableCell><Badge variant={lt.status === 'active' ? 'default' : 'secondary'}>{lt.status}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Branches */}
        <TabsContent value="branches">
          <Card className="glass-card border-border">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div><CardTitle>Branches</CardTitle><CardDescription>Manage branch offices</CardDescription></div>
                {isAdmin && <Button size="sm" onClick={openBranchDialog}><Plus className="w-4 h-4 mr-2" />Add Branch</Button>}
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Code</TableHead><TableHead>Address</TableHead><TableHead>Max Loan</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {branches.map(b => (
                    <TableRow key={b.id}>
                      <TableCell className="text-sm font-medium">{b.name}</TableCell>
                      <TableCell className="text-sm font-mono">{b.code}</TableCell>
                      <TableCell className="text-sm">{b.address ?? '—'}</TableCell>
                      <TableCell className="text-sm">₱{Number(b.max_loan_limit).toLocaleString()}</TableCell>
                      <TableCell><Badge variant={b.status === 'active' ? 'default' : 'secondary'}>{b.status}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="glass-card border-border mt-4">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div><CardTitle>Areas</CardTitle><CardDescription>Manage collection areas</CardDescription></div>
                {isAdmin && <Button size="sm" onClick={() => setAreaDialog(true)}><Plus className="w-4 h-4 mr-2" />Add Area</Button>}
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Branch</TableHead><TableHead>Max Loan</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {areas.map(a => (
                    <TableRow key={a.id}>
                      <TableCell className="text-sm font-medium">{a.name}</TableCell>
                      <TableCell className="text-sm">{a.branches?.name ?? '—'}</TableCell>
                      <TableCell className="text-sm">₱{Number(a.max_loan_limit).toLocaleString()}</TableCell>
                      <TableCell><Badge variant={a.status === 'active' ? 'default' : 'secondary'}>{a.status}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Holidays */}
        <TabsContent value="holidays">
          <Card className="glass-card border-border">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div><CardTitle className="flex items-center gap-2"><Calendar className="w-5 h-5" />Holiday Calendar</CardTitle><CardDescription>Philippine holidays (customizable)</CardDescription></div>
                {isAdmin && <Button size="sm" onClick={() => setHolidayDialog(true)}><Plus className="w-4 h-4 mr-2" />Add Holiday</Button>}
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Custom</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                  {holidays.map(h => (
                    <TableRow key={h.id}>
                      <TableCell className="text-sm font-medium">{h.name}</TableCell>
                      <TableCell className="text-sm">{formatDate(h.holiday_date)}</TableCell>
                      <TableCell><Badge variant="outline" className="capitalize">{h.type}</Badge></TableCell>
                      <TableCell className="text-sm">{h.is_custom ? 'Yes' : 'No'}</TableCell>
                      <TableCell className="text-right">
                        {h.is_custom && isAdmin && (
                          <Button variant="ghost" size="icon" onClick={() => deleteHoliday(h.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notifications */}
        <TabsContent value="notifications">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="glass-card border-border">
              <CardHeader><CardTitle className="flex items-center gap-2"><Mail className="w-5 h-5" />Email Configuration</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2"><Label>SMTP Server</Label><Input placeholder="smtp.resend.com" /></div>
                <div className="space-y-2"><Label>From Email</Label><Input placeholder="noreply@1125corp.org" /></div>
                <div className="space-y-2"><Label>API Key</Label><Input type="password" placeholder="••••••••" /></div>
                <Button variant="outline"><Save className="w-4 h-4 mr-2" />Save Configuration</Button>
              </CardContent>
            </Card>

            <Card className="glass-card border-border">
              <CardHeader><CardTitle className="flex items-center gap-2"><Bell className="w-5 h-5" />SMS Configuration</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2"><Label>Provider</Label><Input placeholder="Twilio" /></div>
                <div className="space-y-2"><Label>Account SID</Label><Input placeholder="AC..." /></div>
                <div className="space-y-2"><Label>Auth Token</Label><Input type="password" placeholder="••••••••" /></div>
                <div className="space-y-2"><Label>Sender Number</Label><Input placeholder="+63..." /></div>
                <Button variant="outline"><Save className="w-4 h-4 mr-2" />Save Configuration</Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Branch Dialog */}
      <Dialog open={branchDialog} onOpenChange={setBranchDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Branch</DialogTitle><DialogDescription>Create a new branch office</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Name *</Label><Input value={branchForm.name} onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })} /></div>
              <div className="space-y-2"><Label>Code</Label><Input value={branchForm.code} readOnly disabled className="bg-muted" /></div>
            </div>
            <div className="space-y-2"><Label>Address</Label><Input value={branchForm.address} onChange={(e) => setBranchForm({ ...branchForm, address: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Phone</Label><Input value={branchForm.phone} onChange={(e) => setBranchForm({ ...branchForm, phone: e.target.value })} /></div>
              <div className="space-y-2"><Label>Email</Label><Input value={branchForm.email} onChange={(e) => setBranchForm({ ...branchForm, email: e.target.value })} /></div>
            </div>
            <div className="space-y-2"><Label>Max Loan Limit (₱)</Label><Input type="number" value={branchForm.max_loan_limit} onChange={(e) => setBranchForm({ ...branchForm, max_loan_limit: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setBranchDialog(false)}>Cancel</Button><Button onClick={addBranch} disabled={!branchForm.name || !branchForm.code}>Add Branch</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Area Dialog */}
      <Dialog open={areaDialog} onOpenChange={setAreaDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Area</DialogTitle><DialogDescription>Create a new collection area</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Name *</Label><Input value={areaForm.name} onChange={(e) => setAreaForm({ ...areaForm, name: e.target.value })} placeholder="e.g. Brgy. San Roque" /></div>
            <div className="space-y-2"><Label>Branch</Label>
              <select className="w-full rounded-md border border-input px-3 py-2 bg-background" value={areaForm.branch_id} onChange={(e) => setAreaForm({ ...areaForm, branch_id: e.target.value })}>
                <option value="">Select branch</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="space-y-2"><Label>Max Loan Limit (₱)</Label><Input type="number" value={areaForm.max_loan_limit} onChange={(e) => setAreaForm({ ...areaForm, max_loan_limit: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setAreaDialog(false)}>Cancel</Button><Button onClick={addArea} disabled={!areaForm.name}>Add Area</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Holiday Dialog */}
      <Dialog open={holidayDialog} onOpenChange={setHolidayDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Holiday</DialogTitle><DialogDescription>Add a custom holiday</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Name *</Label><Input value={holidayForm.name} onChange={(e) => setHolidayForm({ ...holidayForm, name: e.target.value })} /></div>
            <div className="space-y-2"><Label>Date *</Label><Input type="date" value={holidayForm.holiday_date} onChange={(e) => setHolidayForm({ ...holidayForm, holiday_date: e.target.value })} /></div>
            <div className="space-y-2"><Label>Type</Label>
              <select className="w-full rounded-md border border-input px-3 py-2 bg-background" value={holidayForm.type} onChange={(e) => setHolidayForm({ ...holidayForm, type: e.target.value })}>
                <option value="regular">Regular Holiday</option>
                <option value="special">Special Holiday</option>
                <option value="non_working">Non-Working Day</option>
              </select>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setHolidayDialog(false)}>Cancel</Button><Button onClick={addHoliday} disabled={!holidayForm.name || !holidayForm.holiday_date}>Add Holiday</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
