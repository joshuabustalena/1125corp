'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
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
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { formatDate, formatTime, formatDuration, exportToCSV } from '@/lib/format';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { ClipboardCheck, Camera, Download, Loader2, Clock, MapPin, RotateCcw, Check, X, ImageOff, Search, CheckCircle, XCircle } from 'lucide-react';

type CameraMode = 'checkin' | 'checkout';

export default function AttendancePage() {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const { profile } = useAuth();
  const isAdmin = profile?.role_name === 'Administrator';
  const [records, setRecords] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [positions, setPositions] = useState<any[]>([]);
  const [myEmployeeId, setMyEmployeeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [filterEmployee, setFilterEmployee] = useState('all');
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
  const [positionFilter, setPositionFilter] = useState('all');
  const [employeeStatusFilter, setEmployeeStatusFilter] = useState('all');

  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraMode, setCameraMode] = useState<CameraMode>('checkin');
  const [checkoutTargetId, setCheckoutTargetId] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [capturedPreviewUrl, setCapturedPreviewUrl] = useState<string | null>(null);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationAddress, setLocationAddress] = useState<string | null>(null);
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ url: string; label: string } | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const locationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bestAccuracyRef = useRef<number>(Infinity);
  const bestCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  // The ?employee= deep-link updates filterEmployee a tick after mount,
  // firing a second load() while the first (unfiltered) one may still be in
  // flight. Without a sequence guard, whichever request's response arrives
  // last wins — which could re-overwrite the filtered result with the
  // unfiltered one. This tags each call so only the most recent applies.
  const loadSeq = useRef(0);

  useEffect(() => { if (profile) { loadEmployees(); } }, [profile]);
  useEffect(() => {
    if (!isAdmin) return;
    supabase.from('branches').select('id, name').eq('status', 'active').order('name').then(({ data }) => setBranches(data ?? []));
    supabase.from('roles').select('id, name').neq('name', 'Administrator').order('name').then(({ data }) => setPositions(data ?? []));
  }, [isAdmin]);
  // Deep-link support: /attendance?employee=<id> (e.g. from the employee
  // detail page's "Attendance" button) pre-selects that employee's filter.
  useEffect(() => {
    if (!isAdmin) return;
    const employeeParam = searchParams.get('employee');
    if (employeeParam) setFilterEmployee(employeeParam);
  }, [isAdmin, searchParams]);
  useEffect(() => { if (profile) load(); }, [filterEmployee, branchFilter, positionFilter, employeeStatusFilter, search, profile, myEmployeeId]);
  useEffect(() => () => stopStream(), []);

  async function loadEmployees() {
    if (isAdmin) {
      const { data } = await supabase.from('employees').select('id, first_name, last_name, branch_id, position, status');
      setEmployees(data ?? []);
      return;
    }
    let { data } = await supabase.from('employees').select('id, first_name, last_name').eq('profile_id', profile?.id ?? '').maybeSingle();
    if (!data) {
      // Fallback for employees not yet linked via profile_id (legacy records)
      ({ data } = await supabase.from('employees').select('id, first_name, last_name').eq('email', profile?.email ?? '').maybeSingle());
    }
    if (data) {
      setEmployees([data]);
      setMyEmployeeId(data.id);
      setSelectedEmployee(data.id);
    } else {
      setEmployees([]);
    }
  }

  // Branch/Position/Status/Search narrow the pool of employees, which then
  // narrows the attendance records down to just those employees' ids — same
  // pattern as the Payment Reports branch filter.
  function filteredEmployeeIds(): string[] | null {
    if (branchFilter === 'all' && positionFilter === 'all' && employeeStatusFilter === 'all' && !search) return null;
    return employees
      .filter(e =>
        (branchFilter === 'all' || e.branch_id === branchFilter) &&
        (positionFilter === 'all' || e.position === positionFilter) &&
        (employeeStatusFilter === 'all' || e.status === employeeStatusFilter) &&
        (!search || `${e.first_name} ${e.last_name}`.toLowerCase().includes(search.toLowerCase()))
      )
      .map(e => e.id);
  }

  async function load() {
    const seq = ++loadSeq.current;
    setLoading(true);
    let query = supabase.from('attendance').select('*, employees(first_name, last_name)').order('date', { ascending: false });
    if (!isAdmin) {
      query = query.eq('employee_id', myEmployeeId ?? '00000000-0000-0000-0000-000000000000');
    } else if (filterEmployee !== 'all') {
      query = query.eq('employee_id', filterEmployee);
    } else {
      const ids = filteredEmployeeIds();
      if (ids) query = query.in('employee_id', ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000']);
    }
    const { data } = await query.limit(50);
    if (seq !== loadSeq.current) return; // a newer load() already started — discard this stale response
    setRecords(data ?? []);
    setLoading(false);
  }

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  async function openCamera(mode: CameraMode, targetId?: string) {
    if (mode === 'checkin' && !selectedEmployee) {
      toast({ title: 'Error', description: 'Select an employee first', variant: 'destructive' });
      return;
    }
    setCameraMode(mode);
    setCheckoutTargetId(targetId ?? null);
    setCapturedBlob(null);
    setCapturedPreviewUrl(null);
    setCameraError(null);
    setLocation(null);
    setLocationAddress(null);
    setLocationAccuracy(null);
    setCameraOpen(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      setCameraError('Could not access the camera. Check your browser/device camera permissions and try again.');
    }

    requestLocation();
  }

  function stopLocationWatch() {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (locationTimeoutRef.current !== null) {
      clearTimeout(locationTimeoutRef.current);
      locationTimeoutRef.current = null;
    }
  }

  // A phone's very first GPS fix is often a coarse Wi-Fi/network estimate
  // (100-300m). Rather than taking that first reading, this keeps listening
  // for a few seconds — long enough for the device's actual GPS chip to
  // lock on — and keeps only the single best (lowest-accuracy-value)
  // reading it sees, same free browser Geolocation API, tighter result.
  function requestLocation() {
    if (!navigator.geolocation) return;
    stopLocationWatch();
    setLocating(true);
    setLocationAccuracy(null);
    bestAccuracyRef.current = Infinity;
    bestCoordsRef.current = null;

    const GOOD_ENOUGH_ACCURACY_M = 15;
    const MAX_WAIT_MS = 12000;

    const finish = async (coords: { lat: number; lng: number }) => {
      stopLocationWatch();
      const address = await reverseGeocode(coords.lat, coords.lng);
      setLocationAddress(address);
      setLocating(false);
    };

    locationTimeoutRef.current = setTimeout(() => {
      if (bestCoordsRef.current) {
        finish(bestCoordsRef.current);
      } else {
        stopLocationWatch();
        setLocating(false);
      }
    }, MAX_WAIT_MS);

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const accuracy = pos.coords.accuracy;
        if (accuracy < bestAccuracyRef.current) {
          bestAccuracyRef.current = accuracy;
          const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          bestCoordsRef.current = coords;
          setLocation(coords);
          setLocationAccuracy(accuracy);
          if (accuracy <= GOOD_ENOUGH_ACCURACY_M) {
            finish(coords);
          }
        }
      },
      () => {
        stopLocationWatch();
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: MAX_WAIT_MS, maximumAge: 0 }
    );
  }

  async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
        { headers: { 'Accept-Language': 'en' } }
      );
      if (!res.ok) return null;
      const data = await res.json();
      return data.display_name ?? null;
    } catch {
      return null;
    }
  }

  function closeCamera() {
    stopStream();
    stopLocationWatch();
    setCameraOpen(false);
    setCapturedBlob(null);
    if (capturedPreviewUrl) URL.revokeObjectURL(capturedPreviewUrl);
    setCapturedPreviewUrl(null);
  }

  function capturePhoto() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx?.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      setCapturedBlob(blob);
      setCapturedPreviewUrl(URL.createObjectURL(blob));
      stopStream();
    }, 'image/jpeg', 0.85);
  }

  function retake() {
    setCapturedBlob(null);
    if (capturedPreviewUrl) URL.revokeObjectURL(capturedPreviewUrl);
    setCapturedPreviewUrl(null);
    setCameraError(null);
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then((stream) => {
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
      })
      .catch(() => setCameraError('Could not access the camera. Check your browser/device camera permissions and try again.'));
  }

  async function confirmCapture() {
    if (!capturedBlob) return;
    setSubmitting(true);

    const fileName = `${cameraMode}-${Date.now()}.jpg`;
    const path = `${cameraMode === 'checkin' ? selectedEmployee : checkoutTargetId}/${fileName}`;
    const { error: uploadError } = await supabase.storage.from('attendance-photos').upload(path, capturedBlob, { contentType: 'image/jpeg' });

    if (uploadError) {
      toast({ title: 'Photo upload failed', description: uploadError.message, variant: 'destructive' });
      setSubmitting(false);
      return;
    }

    const { data: urlData } = supabase.storage.from('attendance-photos').getPublicUrl(path);
    const photoUrl = urlData.publicUrl;

    if (cameraMode === 'checkin') {
      const now = new Date();
      const today = now.toISOString().split('T')[0];
      const hour = now.getHours();
      const minute = now.getMinutes();
      const lateMinutes = (hour > 8 || (hour === 8 && minute > 0)) ? (hour - 8) * 60 + minute : 0;

      const { error } = await supabase.from('attendance').insert({
        employee_id: selectedEmployee,
        date: today,
        time_in: now.toISOString(),
        status: lateMinutes > 0 ? 'late' : 'present',
        late_minutes: lateMinutes,
        photo_in_url: photoUrl,
        gps_lat: location?.lat ?? null,
        gps_lng: location?.lng ?? null,
        location_address: locationAddress,
      });
      if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
      else toast({ title: 'Success', description: 'Checked in successfully' });
    } else if (checkoutTargetId) {
      const { error } = await supabase.from('attendance').update({
        time_out: new Date().toISOString(),
        photo_out_url: photoUrl,
        location_address: locationAddress,
      }).eq('id', checkoutTargetId);
      if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
      else toast({ title: 'Success', description: 'Checked out' });
    }

    setSubmitting(false);
    closeCamera();
    load();
  }

  // Only an Administrator can accept/reject an attendance record, across
  // every employee — a rejected record is excluded from payroll's
  // days-present count, while pending/accepted both count normally.
  async function handleReview(id: string, reviewStatus: 'accepted' | 'rejected') {
    const { error } = await supabase.from('attendance').update({ review_status: reviewStatus }).eq('id', id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }
    setRecords(prev => prev.map(r => r.id === id ? { ...r, review_status: reviewStatus } : r));
  }

  const reviewVariant = (s: string | null | undefined) => s === 'accepted' ? 'default' : s === 'rejected' ? 'destructive' : 'outline';

  function handleExport() {
    exportToCSV(records.map(r => ({
      Employee: `${r.employees?.first_name} ${r.employees?.last_name}`,
      Date: r.date, TimeIn: r.time_in ?? '', TimeOut: r.time_out ?? '',
      Hours: formatDuration(r.time_in, r.time_out),
      Status: r.status, Late: r.late_minutes, Overtime: r.overtime_minutes,
      Location: r.location_address ?? '',
    })), 'attendance.csv');
  }

  function shortenAddress(address: string | null | undefined, parts = 3): string | null {
    if (!address) return null;
    return address.split(',').slice(0, parts).map(p => p.trim()).join(', ');
  }

  const statusVariant = (s: string) => {
    switch (s) {
      case 'present': return 'default';
      case 'late': return 'outline';
      case 'absent': return 'destructive';
      case 'leave': return 'secondary';
      default: return 'secondary';
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Employee Attendance" description="Camera check-in/check-out with GPS tracking">
        <Button variant="outline" size="sm" onClick={handleExport}><Download className="w-4 h-4 mr-2" />Export</Button>
      </PageHeader>

      {/* Check-in panel */}
      <Card className="glass-card border-border">
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-end">
            {isAdmin ? (
              <div className="space-y-2 flex-1">
                <Label>Select Employee</Label>
                <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
                  <SelectTrigger><SelectValue placeholder="Choose employee to check in" /></SelectTrigger>
                  <SelectContent>{employees.filter(e => e.status === 'active').map(e => <SelectItem key={e.id} value={e.id}>{e.first_name} {e.last_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1 flex-1">
                <Label>Checking in as</Label>
                <p className="text-sm font-medium">{employees[0] ? `${employees[0].first_name} ${employees[0].last_name}` : 'No matching employee record'}</p>
              </div>
            )}
            <Button onClick={() => openCamera('checkin')} disabled={!selectedEmployee} className="h-10">
              <Camera className="w-4 h-4 mr-2" />
              Camera Check-In
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Filters (admin only — non-admins only ever see their own record) */}
      {isAdmin && (
        <Card className="glass-card border-border">
          <CardContent className="p-4 space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search employees..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Select value={branchFilter} onValueChange={setBranchFilter}>
                <SelectTrigger><SelectValue placeholder="Branch" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Branches</SelectItem>
                  {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={positionFilter} onValueChange={setPositionFilter}>
                <SelectTrigger><SelectValue placeholder="Position" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Positions</SelectItem>
                  {positions.map(p => <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={employeeStatusFilter} onValueChange={setEmployeeStatusFilter}>
                <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="resigned">Resigned</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card className="glass-card border-border">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : records.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ClipboardCheck className="w-12 h-12 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">No attendance records</p>
            </div>
          ) : (
            <>
            {/* Mobile card list */}
            <div className="md:hidden divide-y divide-border">
              {records.map(r => (
                <div key={r.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <button
                        type="button"
                        onClick={() => r.photo_in_url && setPreviewImage({ url: r.photo_in_url, label: 'Check-In Photo' })}
                        title="Check-in photo"
                        className="shrink-0"
                      >
                        <Avatar className="w-9 h-9 rounded-md">
                          <AvatarImage src={r.photo_in_url ?? undefined} className="object-cover" />
                          <AvatarFallback className="rounded-md"><ImageOff className="w-4 h-4 text-muted-foreground" /></AvatarFallback>
                        </Avatar>
                      </button>
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{r.employees?.first_name} {r.employees?.last_name}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(r.date)}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
                      <Badge variant={reviewVariant(r.review_status)} className="text-[10px]">{r.review_status ?? 'pending'}</Badge>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div><p className="text-xs text-muted-foreground">Time In</p><p>{formatTime(r.time_in)}</p></div>
                    <div><p className="text-xs text-muted-foreground">Time Out</p><p>{formatTime(r.time_out)}</p></div>
                    <div><p className="text-xs text-muted-foreground">Hours</p><p>{formatDuration(r.time_in, r.time_out)}</p></div>
                    <div><p className="text-xs text-muted-foreground">Late</p><p>{r.late_minutes > 0 ? `${r.late_minutes} min` : '—'}</p></div>
                    {r.gps_lat && r.gps_lng && (
                      <div className="col-span-2">
                        <p className="text-xs text-muted-foreground">Location</p>
                        <a
                          className="flex items-start gap-1 text-primary hover:underline min-w-0"
                          href={`https://www.google.com/maps?q=${r.gps_lat},${r.gps_lng}`}
                          target="_blank" rel="noopener noreferrer"
                        >
                          <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span className="truncate min-w-0">{shortenAddress(r.location_address) ?? 'View on map'}</span>
                        </a>
                      </div>
                    )}
                  </div>
                  <div className="mt-3 flex items-center justify-end gap-1 flex-wrap">
                    {!r.time_out && (
                      <Button variant="outline" size="sm" onClick={() => openCamera('checkout', r.id)}>
                        <Clock className="w-3.5 h-3.5 mr-1.5" />Check Out
                      </Button>
                    )}
                    {isAdmin && r.review_status !== 'accepted' && (
                      <Button variant="outline" size="sm" onClick={() => handleReview(r.id, 'accepted')}>
                        <CheckCircle className="w-3.5 h-3.5 mr-1.5 text-success" />Accept
                      </Button>
                    )}
                    {isAdmin && r.review_status !== 'rejected' && (
                      <Button variant="outline" size="sm" onClick={() => handleReview(r.id, 'rejected')}>
                        <XCircle className="w-3.5 h-3.5 mr-1.5 text-destructive" />Reject
                      </Button>
                    )}
                    {r.photo_out_url && (
                      <Button variant="outline" size="sm" onClick={() => setPreviewImage({ url: r.photo_out_url, label: 'Check-Out Photo' })}>
                        Out Photo
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden md:block overflow-x-auto">
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Photo</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Time In</TableHead>
                    <TableHead>Time Out</TableHead>
                    <TableHead>Hours</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Late</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Review</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map(r => (
                    <TableRow key={r.id} className="hover:bg-secondary/50">
                      <TableCell className="text-sm font-medium whitespace-nowrap">{r.employees?.first_name} {r.employees?.last_name}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <button
                            type="button"
                            className="flex flex-col items-center gap-0.5"
                            onClick={() => r.photo_in_url && setPreviewImage({ url: r.photo_in_url, label: 'Check-In Photo' })}
                            title="Check-in photo"
                          >
                            <Avatar className="w-9 h-9 rounded-md">
                              <AvatarImage src={r.photo_in_url ?? undefined} className="object-cover" />
                              <AvatarFallback className="rounded-md"><ImageOff className="w-4 h-4 text-muted-foreground" /></AvatarFallback>
                            </Avatar>
                            <span className="text-[10px] text-muted-foreground leading-none">In</span>
                          </button>
                          {r.photo_out_url && (
                            <button
                              type="button"
                              className="flex flex-col items-center gap-0.5"
                              onClick={() => setPreviewImage({ url: r.photo_out_url, label: 'Check-Out Photo' })}
                              title="Check-out photo"
                            >
                              <Avatar className="w-9 h-9 rounded-md">
                                <AvatarImage src={r.photo_out_url} className="object-cover" />
                                <AvatarFallback className="rounded-md"><ImageOff className="w-4 h-4 text-muted-foreground" /></AvatarFallback>
                              </Avatar>
                              <span className="text-[10px] text-muted-foreground leading-none">Out</span>
                            </button>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{formatDate(r.date)}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{formatTime(r.time_in)}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{formatTime(r.time_out)}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{formatDuration(r.time_in, r.time_out)}</TableCell>
                      <TableCell><Badge variant={statusVariant(r.status)}>{r.status}</Badge></TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{r.late_minutes > 0 ? `${r.late_minutes} min` : '—'}</TableCell>
                      <TableCell className="text-sm w-[220px]">
                        {r.gps_lat && r.gps_lng ? (
                          <a
                            className="flex items-start gap-1 text-primary hover:underline min-w-0"
                            href={`https://www.google.com/maps?q=${r.gps_lat},${r.gps_lng}`}
                            target="_blank" rel="noopener noreferrer"
                            title={r.location_address ?? undefined}
                          >
                            <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span className="truncate min-w-0">{shortenAddress(r.location_address) ?? 'View on map'}</span>
                          </a>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Badge variant={reviewVariant(r.review_status)}>{r.review_status ?? 'pending'}</Badge>
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          {!r.time_out && (
                            <Button variant="ghost" size="sm" onClick={() => openCamera('checkout', r.id)}>
                              <Clock className="w-4 h-4 mr-1" />Check Out
                            </Button>
                          )}
                          {isAdmin && r.review_status !== 'accepted' && (
                            <Button variant="ghost" size="icon" onClick={() => handleReview(r.id, 'accepted')} title="Accept">
                              <CheckCircle className="w-4 h-4 text-success" />
                            </Button>
                          )}
                          {isAdmin && r.review_status !== 'rejected' && (
                            <Button variant="ghost" size="icon" onClick={() => handleReview(r.id, 'rejected')} title="Reject">
                              <XCircle className="w-4 h-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Full-page camera view */}
      {cameraOpen && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          <div className="flex items-center justify-between px-4 py-4 sm:px-6 text-white">
            <div>
              <h2 className="text-lg font-bold">{cameraMode === 'checkin' ? 'Camera Check-In' : 'Camera Check-Out'}</h2>
              <p className="text-sm text-white/60">Take a photo to confirm your attendance</p>
            </div>
            <button onClick={closeCamera} className="p-2 rounded-full hover:bg-white/10">
              <X className="w-6 h-6" />
            </button>
          </div>

          <div className="flex-1 relative flex items-center justify-center overflow-hidden">
            {cameraError ? (
              <p className="text-sm text-white bg-destructive px-4 py-2 rounded mx-6 text-center">{cameraError}</p>
            ) : capturedPreviewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={capturedPreviewUrl} alt="Captured" className="w-full h-full object-contain" />
            ) : (
              <video ref={videoRef} className="w-full h-full object-contain -scale-x-100" muted playsInline />
            )}
            <canvas ref={canvasRef} className="hidden" />
          </div>

          <div className="px-4 py-4 sm:px-6 space-y-4">
            <div className="flex items-start gap-1.5 text-sm text-white/70">
              <MapPin className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                {locating
                  ? (locationAccuracy !== null ? 'Improving accuracy...' : 'Getting your location...')
                  : shortenAddress(locationAddress) ?? (location ? `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}` : 'Location unavailable')}
                {locationAccuracy !== null && (
                  <span className="text-white/40"> (accurate to ±{Math.round(locationAccuracy)}m)</span>
                )}
              </span>
            </div>

            <div className="flex items-center justify-center gap-3">
              {capturedPreviewUrl ? (
                <>
                  <Button type="button" variant="outline" onClick={retake} disabled={submitting} className="bg-transparent text-white border-white/30 hover:bg-white/10 hover:text-white">
                    <RotateCcw className="w-4 h-4 mr-2" />Retake
                  </Button>
                  <Button type="button" onClick={confirmCapture} disabled={submitting}>
                    {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                    Confirm
                  </Button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={capturePhoto}
                  disabled={!!cameraError}
                  aria-label="Capture photo"
                  className="w-16 h-16 rounded-full border-4 border-white flex items-center justify-center transition-transform active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span className="w-12 h-12 rounded-full bg-white" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Photo preview modal */}
      <Dialog open={!!previewImage} onOpenChange={(open) => !open && setPreviewImage(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{previewImage?.label ?? 'Attendance Photo'}</DialogTitle>
          </DialogHeader>
          {previewImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewImage.url} alt={previewImage.label} className="w-full rounded-lg object-contain max-h-[70vh]" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
