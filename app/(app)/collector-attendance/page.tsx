'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import { formatDateTime, formatDate, exportToCSV } from '@/lib/format';
import { ClipboardCheck, Camera, Download, Loader2, MapPin } from 'lucide-react';

export default function CollectorAttendancePage() {
  const { toast } = useToast();
  const [records, setRecords] = useState<any[]>([]);
  const [collectors, setCollectors] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [areas, setAreas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkInLoading, setCheckInLoading] = useState(false);
  const [selectedCollector, setSelectedCollector] = useState('');

  useEffect(() => { load(); loadOptions(); }, []);

  async function loadOptions() {
    const [c, b, a] = await Promise.all([
      supabase.from('collectors').select('id, profiles(full_name)').eq('status', 'active'),
      supabase.from('branches').select('id, name').eq('status', 'active'),
      supabase.from('areas').select('id, name').eq('status', 'active'),
    ]);
    setCollectors(c.data ?? []);
    setBranches(b.data ?? []);
    setAreas(a.data ?? []);
  }

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('collector_attendance').select('*, collectors(profiles(full_name)), branches(name), areas(name)').order('date', { ascending: false }).limit(50);
    setRecords(data ?? []);
    setLoading(false);
  }

  async function handleCheckIn() {
    if (!selectedCollector) { toast({ title: 'Error', description: 'Select a collector first', variant: 'destructive' }); return; }
    setCheckInLoading(true);
    const collector = collectors.find(c => c.id === selectedCollector);
    const { error } = await supabase.from('collector_attendance').insert({
      collector_id: selectedCollector,
      branch_id: collector?.branch_id ?? null,
      area_id: collector?.area_id ?? null,
      date: new Date().toISOString().split('T')[0],
      time_in: new Date().toISOString(),
    });
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Success', description: 'Collector checked in' }); load(); }
    setCheckInLoading(false);
  }

  function handleExport() {
    exportToCSV(records.map(r => ({
      Collector: r.collectors?.profiles?.full_name ?? '',
      Date: r.date, TimeIn: r.time_in ?? '',
      Branch: r.branches?.name ?? '', Area: r.areas?.name ?? '',
    })), 'collector-attendance.csv');
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Collector Attendance" description="Field attendance with photo capture and GPS">
        <Button variant="outline" size="sm" onClick={handleExport}><Download className="w-4 h-4 mr-2" />Export</Button>
      </PageHeader>

      <Card className="glass-card border-border">
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="space-y-2 flex-1">
              <Label>Select Collector</Label>
              <Select value={selectedCollector} onValueChange={setSelectedCollector}>
                <SelectTrigger><SelectValue placeholder="Choose collector" /></SelectTrigger>
                <SelectContent>{collectors.map(c => <SelectItem key={c.id} value={c.id}>{c.profiles?.full_name ?? 'Unknown'}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button onClick={handleCheckIn} disabled={checkInLoading} className="h-10">
              {checkInLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Camera className="w-4 h-4 mr-2" />}
              Check-In with Photo
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card border-border">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : records.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ClipboardCheck className="w-12 h-12 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">No collector attendance records</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Collector</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Time In</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Area</TableHead>
                  <TableHead>GPS</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map(r => (
                  <TableRow key={r.id} className="hover:bg-secondary/50">
                    <TableCell className="text-sm font-medium">{r.collectors?.profiles?.full_name ?? '—'}</TableCell>
                    <TableCell className="text-sm">{formatDate(r.date)}</TableCell>
                    <TableCell className="text-sm">{r.time_in ? formatDateTime(r.time_in) : '—'}</TableCell>
                    <TableCell className="text-sm">{r.branches?.name ?? '—'}</TableCell>
                    <TableCell className="text-sm">{r.areas?.name ?? '—'}</TableCell>
                    <TableCell className="text-sm">
                      {r.gps_lat ? <Badge variant="outline" className="text-xs"><MapPin className="w-3 h-3 mr-1" />{r.gps_lat.toFixed(4)}, {r.gps_lng?.toFixed(4)}</Badge> : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
