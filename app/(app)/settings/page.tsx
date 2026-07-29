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
import { formatDate } from '@/lib/format';
import {
  Settings as SettingsIcon, Plus, Loader2, Building2, Calendar, Percent,
  Bell, Mail, Save, Trash2, MapPin, Receipt, Pencil,
} from 'lucide-react';

export default function SettingsPage() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const [settings, setSettings] = useState<Record<string, string>>({});
  type DeductionConfig = { type: 'percent' | 'fixed'; period_1: string; period_16: string };
  const [deductions, setDeductions] = useState<{ sss: DeductionConfig; philhealth: DeductionConfig; pagibig: DeductionConfig }>({
    sss: { type: 'percent', period_1: '4.5', period_16: '4.5' },
    philhealth: { type: 'percent', period_1: '3.5', period_16: '3.5' },
    pagibig: { type: 'percent', period_1: '2', period_16: '2' },
  });
  const [branches, setBranches] = useState<any[]>([]);
  const [areas, setAreas] = useState<any[]>([]);
  const [holidays, setHolidays] = useState<any[]>([]);
  const [loanTypes, setLoanTypes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [branchDialog, setBranchDialog] = useState(false);
  const [areaDialog, setAreaDialog] = useState(false);
  const [holidayDialog, setHolidayDialog] = useState(false);
  const [editingHoliday, setEditingHoliday] = useState<any>(null);
  const [deleteHolidayTarget, setDeleteHolidayTarget] = useState<any>(null);
  const [loanTypeDialog, setLoanTypeDialog] = useState(false);
  const [editingLoanType, setEditingLoanType] = useState<any>(null);
  const [deleteLoanTypeTarget, setDeleteLoanTypeTarget] = useState<any>(null);
  const [activeTab, setActiveTab] = useState('general');

  const [branchForm, setBranchForm] = useState({ name: '', code: '', address: '', phone: '', email: '' });
  const [areaForm, setAreaForm] = useState({ name: '', branch_id: '' });
  const [holidayForm, setHolidayForm] = useState({ name: '', holiday_date: '', type: 'regular' });
  const [loanTypeForm, setLoanTypeForm] = useState({ name: '', interest_rate: '8', term_days: '60', status: 'active' });

  const isAdmin = profile?.role_name === 'Administrator';

  const SETTINGS_TABS = [
    { value: 'general', label: 'General' },
    { value: 'loan', label: 'Loan & Interest' },
    { value: 'deductions', label: 'Deductions' },
    { value: 'branches', label: 'Branches' },
    { value: 'holidays', label: 'Holidays' },
    { value: 'notifications', label: 'Notifications' },
  ];

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
    // Always store the JSON-encoded form (so a string like "1125Corp" is
    // kept as the literal `"1125Corp"`, quotes included) — saveSettings()
    // round-trips every value through JSON.parse, and a plain unquoted
    // string there throws ("1125Corp" parses as the number 1125 followed
    // by unexpected characters). Display inputs unwrap the quotes back out
    // via getStringSetting below.
    const settingsMap: Record<string, string> = {};
    (s.data ?? []).forEach((item: any) => {
      settingsMap[item.key] = JSON.stringify(item.value);
    });
    setSettings(settingsMap);

    const byKey = new Map((s.data ?? []).map((item: any) => [item.key, item.value]));
    const toConfig = (key: string, fallback: DeductionConfig): DeductionConfig => {
      const v = byKey.get(key);
      if (!v || typeof v !== 'object') return fallback;
      return {
        type: v.type === 'fixed' ? 'fixed' : 'percent',
        period_1: String(v.period_1 ?? fallback.period_1),
        period_16: String(v.period_16 ?? fallback.period_16),
      };
    };
    setDeductions({
      sss: toConfig('sss_deduction', { type: 'percent', period_1: '4.5', period_16: '4.5' }),
      philhealth: toConfig('philhealth_deduction', { type: 'percent', period_1: '3.5', period_16: '3.5' }),
      pagibig: toConfig('pagibig_deduction', { type: 'percent', period_1: '2', period_16: '2' }),
    });

    setBranches(b.data ?? []);
    setAreas(a.data ?? []);
    setHolidays(h.data ?? []);
    setLoanTypes(lt.data ?? []);
    setLoading(false);
  }

  async function saveSettings() {
    setSaving(true);
    const merged = {
      ...settings,
      sss_deduction: JSON.stringify({ ...deductions.sss, period_1: Number(deductions.sss.period_1) || 0, period_16: Number(deductions.sss.period_16) || 0 }),
      philhealth_deduction: JSON.stringify({ ...deductions.philhealth, period_1: Number(deductions.philhealth.period_1) || 0, period_16: Number(deductions.philhealth.period_16) || 0 }),
      pagibig_deduction: JSON.stringify({ ...deductions.pagibig, period_1: Number(deductions.pagibig.period_1) || 0, period_16: Number(deductions.pagibig.period_16) || 0 }),
    };
    const updates = Object.entries(merged).map(([key, value]) =>
      supabase.from('settings').update({ value: JSON.parse(value), updated_at: new Date().toISOString() }).eq('key', key)
    );
    await Promise.all(updates);
    toast({ title: 'Success', description: 'Settings saved' });
    setSaving(false);
  }

  function updateDeduction(key: 'sss' | 'philhealth' | 'pagibig', field: keyof DeductionConfig, value: string) {
    setDeductions(prev => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  }

  // settings[key] holds the JSON-encoded form (quotes and all) so it
  // round-trips through JSON.parse on save — this unwraps it back to a
  // plain string for a text Input's `value`.
  function getStringSetting(key: string, fallback: string): string {
    const raw = settings[key];
    if (raw === undefined) return fallback;
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === 'string' ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  function setStringSetting(key: string, value: string) {
    setSettings(prev => ({ ...prev, [key]: JSON.stringify(value) }));
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
    setBranchForm({ name: '', code: nextBranchCode(), address: '', phone: '', email: '' });
    setBranchDialog(true);
  }

  async function addBranch() {
    const { error } = await supabase.from('branches').insert({
      name: branchForm.name, code: branchForm.code, address: branchForm.address || null,
      phone: branchForm.phone || null, email: branchForm.email || null,
    });
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Success', description: 'Branch added' }); setBranchDialog(false); setBranchForm({ name: '', code: '', address: '', phone: '', email: '' }); load(); }
  }

  async function addArea() {
    const { error } = await supabase.from('areas').insert({
      name: areaForm.name, branch_id: areaForm.branch_id || null,
    });
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Success', description: 'Area added' }); setAreaDialog(false); setAreaForm({ name: '', branch_id: '' }); load(); }
  }

  function openAddHoliday() {
    setEditingHoliday(null);
    setHolidayForm({ name: '', holiday_date: '', type: 'regular' });
    setHolidayDialog(true);
  }

  function openEditHoliday(h: any) {
    setEditingHoliday(h);
    setHolidayForm({ name: h.name, holiday_date: h.holiday_date, type: h.type ?? 'regular' });
    setHolidayDialog(true);
  }

  async function saveHoliday() {
    const payload = { name: holidayForm.name, holiday_date: holidayForm.holiday_date, type: holidayForm.type };
    const { error } = editingHoliday
      ? await supabase.from('holidays').update(payload).eq('id', editingHoliday.id)
      : await supabase.from('holidays').insert({ ...payload, is_custom: true });
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: `Holiday ${editingHoliday ? 'updated' : 'added'}` });
      setHolidayDialog(false);
      load();
    }
  }

  async function confirmDeleteHoliday() {
    if (!deleteHolidayTarget) return;
    const { error } = await supabase.from('holidays').delete().eq('id', deleteHolidayTarget.id);
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Success', description: 'Holiday removed' }); setDeleteHolidayTarget(null); load(); }
  }

  function openAddLoanType() {
    setEditingLoanType(null);
    setLoanTypeForm({ name: '', interest_rate: '8', term_days: '60', status: 'active' });
    setLoanTypeDialog(true);
  }

  function openEditLoanType(lt: any) {
    setEditingLoanType(lt);
    setLoanTypeForm({ name: lt.name, interest_rate: String(lt.interest_rate), term_days: String(lt.term_days), status: lt.status });
    setLoanTypeDialog(true);
  }

  async function saveLoanType() {
    const payload = {
      name: loanTypeForm.name,
      interest_rate: Number(loanTypeForm.interest_rate) || 0,
      term_days: Number(loanTypeForm.term_days) || 0,
      status: loanTypeForm.status,
    };
    const { error } = editingLoanType
      ? await supabase.from('loan_types').update(payload).eq('id', editingLoanType.id)
      : await supabase.from('loan_types').insert(payload);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: `Loan type ${editingLoanType ? 'updated' : 'added'}` });
      setLoanTypeDialog(false);
      load();
    }
  }

  async function confirmDeleteLoanType() {
    if (!deleteLoanTypeTarget) return;
    const { error } = await supabase.from('loan_types').delete().eq('id', deleteLoanTypeTarget.id);
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Success', description: 'Loan type removed' }); setDeleteLoanTypeTarget(null); load(); }
  }

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="System configuration and preferences" />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        {/* Dropdown on mobile so 5 tabs don't wrap into a messy multi-row grid */}
        <Select value={activeTab} onValueChange={setActiveTab}>
          <SelectTrigger className="sm:hidden">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SETTINGS_TABS.map(t => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <TabsList className="hidden sm:grid w-full grid-cols-6 gap-1">
          {SETTINGS_TABS.map(t => (
            <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
          ))}
        </TabsList>

        {/* General Settings */}
        <TabsContent value="general">
          <Card className="glass-card border-border">
            <CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="w-5 h-5" />Company Information</CardTitle></CardHeader>
            <CardContent className="space-y-4 max-w-lg">
              <div className="space-y-2"><Label>Company Name</Label><Input value={getStringSetting('company_name', '1125Corp')} onChange={(e) => setStringSetting('company_name', e.target.value)} /></div>
              <div className="space-y-2"><Label>Domain</Label><Input value={getStringSetting('company_domain', '1125corp.org')} onChange={(e) => setStringSetting('company_domain', e.target.value)} /></div>
              <div className="space-y-2"><Label>Max Customer Loan (₱)</Label><Input type="number" value={settings.max_customer_loan ?? '30000'} onChange={(e) => setSettings({ ...settings, max_customer_loan: e.target.value })} /></div>
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div><CardTitle>Loan Types</CardTitle><CardDescription>Available loan products</CardDescription></div>
              {isAdmin && <Button size="sm" variant="outline" onClick={openAddLoanType}><Plus className="w-4 h-4 mr-2" />Add Loan Type</Button>}
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Interest Rate</TableHead>
                    <TableHead>Term</TableHead>
                    <TableHead>Status</TableHead>
                    {isAdmin && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loanTypes.map(lt => (
                    <TableRow key={lt.id}>
                      <TableCell className="text-sm font-medium">{lt.name}</TableCell>
                      <TableCell className="text-sm">{lt.interest_rate}%</TableCell>
                      <TableCell className="text-sm">{lt.term_days} days</TableCell>
                      <TableCell><Badge variant={lt.status === 'active' ? 'default' : 'secondary'}>{lt.status}</Badge></TableCell>
                      {isAdmin && (
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="icon" onClick={() => openEditLoanType(lt)} title="Edit"><Pencil className="w-4 h-4" /></Button>
                            <Button variant="ghost" size="icon" onClick={() => setDeleteLoanTypeTarget(lt)} title="Delete"><Trash2 className="w-4 h-4 text-destructive" /></Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Deductions */}
        <TabsContent value="deductions">
          <Card className="glass-card border-border">
            <CardHeader><CardTitle className="flex items-center gap-2"><Receipt className="w-5 h-5" />Statutory Deduction Rates</CardTitle><CardDescription>Default SSS, PhilHealth, and Pag-IBIG deductions applied to every employee's payroll — choose a percentage of pay or a fixed peso amount, and set it separately for the 1st and 16th cutoffs</CardDescription></CardHeader>
            <CardContent className="space-y-6">
              {([
                { key: 'sss' as const, label: 'SSS' },
                { key: 'philhealth' as const, label: 'PhilHealth' },
                { key: 'pagibig' as const, label: 'Pag-IBIG' },
              ]).map(({ key, label }) => {
                const cfg = deductions[key];
                const unit = cfg.type === 'fixed' ? '₱' : '%';
                return (
                  <div key={key} className="p-4 rounded-lg border border-border space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                      <div className="space-y-2 sm:w-40">
                        <Label>{label}</Label>
                        <Select value={cfg.type} onValueChange={(v) => updateDeduction(key, 'type', v)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="percent">Percentage</SelectItem>
                            <SelectItem value="fixed">Fixed Amount</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-3 flex-1">
                        <div className="space-y-2">
                          <Label className="text-xs">1st Payroll ({unit})</Label>
                          <Input type="number" step="0.01" value={cfg.period_1} onChange={(e) => updateDeduction(key, 'period_1', e.target.value)} />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs">16th Payroll ({unit})</Label>
                          <Input type="number" step="0.01" value={cfg.period_16} onChange={(e) => updateDeduction(key, 'period_16', e.target.value)} />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <p className="text-xs text-muted-foreground">Percentage is applied to the full cutoff's expected basic pay — not scaled down by attendance, the same way these contributions would still apply even with a few absences. Fixed amount is deducted as-is regardless of pay.</p>
              <Button onClick={saveSettings} disabled={saving || !isAdmin}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}<Save className="w-4 h-4 mr-2" />Save Changes</Button>
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
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Code</TableHead><TableHead>Address</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {branches.map(b => (
                    <TableRow key={b.id}>
                      <TableCell className="text-sm font-medium">{b.name}</TableCell>
                      <TableCell className="text-sm font-mono">{b.code}</TableCell>
                      <TableCell className="text-sm">{b.address ?? '—'}</TableCell>
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
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Branch</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {areas.map(a => (
                    <TableRow key={a.id}>
                      <TableCell className="text-sm font-medium">{a.name}</TableCell>
                      <TableCell className="text-sm">{a.branches?.name ?? '—'}</TableCell>
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
                {isAdmin && <Button size="sm" onClick={openAddHoliday}><Plus className="w-4 h-4 mr-2" />Add Holiday</Button>}
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
                        {isAdmin && (
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="icon" onClick={() => openEditHoliday(h)} title="Edit"><Pencil className="w-4 h-4" /></Button>
                            <Button variant="ghost" size="icon" onClick={() => setDeleteHolidayTarget(h)} title="Delete"><Trash2 className="w-4 h-4 text-destructive" /></Button>
                          </div>
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Name *</Label><Input value={branchForm.name} onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })} /></div>
              <div className="space-y-2"><Label>Code</Label><Input value={branchForm.code} readOnly disabled className="bg-muted" /></div>
            </div>
            <div className="space-y-2"><Label>Address</Label><Input value={branchForm.address} onChange={(e) => setBranchForm({ ...branchForm, address: e.target.value })} /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Phone</Label><Input value={branchForm.phone} onChange={(e) => setBranchForm({ ...branchForm, phone: e.target.value })} /></div>
              <div className="space-y-2"><Label>Email</Label><Input value={branchForm.email} onChange={(e) => setBranchForm({ ...branchForm, email: e.target.value })} /></div>
            </div>
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
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setAreaDialog(false)}>Cancel</Button><Button onClick={addArea} disabled={!areaForm.name}>Add Area</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Holiday Dialog */}
      <Dialog open={holidayDialog} onOpenChange={setHolidayDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingHoliday ? 'Edit Holiday' : 'Add Holiday'}</DialogTitle>
            <DialogDescription>{editingHoliday ? 'Update this holiday' : 'Add a custom holiday'}</DialogDescription>
          </DialogHeader>
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setHolidayDialog(false)}>Cancel</Button>
            <Button onClick={saveHoliday} disabled={!holidayForm.name || !holidayForm.holiday_date}>{editingHoliday ? 'Update' : 'Add'} Holiday</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Holiday confirmation */}
      <Dialog open={!!deleteHolidayTarget} onOpenChange={(open) => !open && setDeleteHolidayTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Holiday</DialogTitle>
            <DialogDescription>Are you sure you want to delete {deleteHolidayTarget?.name} ({deleteHolidayTarget && formatDate(deleteHolidayTarget.holiday_date)})? This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteHolidayTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDeleteHoliday}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Loan Type Dialog */}
      <Dialog open={loanTypeDialog} onOpenChange={setLoanTypeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingLoanType ? 'Edit Loan Type' : 'Add Loan Type'}</DialogTitle>
            <DialogDescription>{editingLoanType ? 'Update this loan product' : 'Add a new loan product'}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Name *</Label><Input value={loanTypeForm.name} onChange={(e) => setLoanTypeForm({ ...loanTypeForm, name: e.target.value })} placeholder="e.g. Standard" /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Interest Rate (%) *</Label><Input type="number" value={loanTypeForm.interest_rate} onChange={(e) => setLoanTypeForm({ ...loanTypeForm, interest_rate: e.target.value })} /></div>
              <div className="space-y-2"><Label>Term (Days) *</Label><Input type="number" value={loanTypeForm.term_days} onChange={(e) => setLoanTypeForm({ ...loanTypeForm, term_days: e.target.value })} /></div>
            </div>
            <div className="space-y-2"><Label>Status</Label>
              <Select value={loanTypeForm.status} onValueChange={(v) => setLoanTypeForm({ ...loanTypeForm, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLoanTypeDialog(false)}>Cancel</Button>
            <Button onClick={saveLoanType} disabled={!loanTypeForm.name}>{editingLoanType ? 'Update' : 'Add'} Loan Type</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Loan Type confirmation */}
      <Dialog open={!!deleteLoanTypeTarget} onOpenChange={(open) => !open && setDeleteLoanTypeTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Loan Type</DialogTitle>
            <DialogDescription>Are you sure you want to delete {deleteLoanTypeTarget?.name}? Existing loans created under this type keep their own terms, but will no longer be linked to it. This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteLoanTypeTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDeleteLoanType}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
