/*
  Lets an employee check in with zero signal (or during a Supabase-side
  outage like Sep 16, 2026's Auth Service outage — see the attendance page's
  own comments) instead of the whole check-in silently going nowhere. The
  photo and GPS fix are captured the moment they tap Confirm; the actual
  database write (photo upload + attendance row) is deferred until they tap
  "Sync" with a working connection.

  Check-in only, deliberately — check-out queues against an EXISTING
  attendance row's id, and if that check-in itself is still sitting
  unsynced (not a real row yet), there's nothing real to attach a checkout
  to until the check-in syncs first. That's a genuinely different, harder
  problem (chaining a pending checkout to a pending checkin) than "the
  whole day already failed to save" — check-in is also what actually
  blocked people during today's outage, so it's the one worth fixing first.

  The photo is stored as a base64 data URL (not a Blob) because
  localStorage can only hold strings — IndexedDB would avoid the ~33% size
  bloat that base64 adds, but would also be the only thing in this app not
  using the same localStorage-backed pattern as offline-payment-queue.ts /
  offline-receipts.ts, and the attendance photo is already downscaled to
  720px on its longer side (see attendance/page.tsx's capturePhoto) — small
  enough in practice that the bloat isn't worth that inconsistency.

  lateMinutes/status are computed and stored at QUEUE time (when they
  actually tapped Confirm), not at sync time — someone who checked in
  on-time at 8:15am but couldn't sync until 11am must not come out of this
  looking 3 hours late.
*/

export interface PendingAttendance {
  id: string; // client-generated, used to dedupe if Sync is tapped more than once
  employeeId: string;
  employeeName: string;
  photoDataUrl: string;
  gpsLat: number | null;
  gpsLng: number | null;
  locationAddress: string | null;
  // The real moment they checked in, captured offline — this is what
  // status/lateMinutes/late_deduction at sync time must be computed from.
  checkedInAt: string;
  createdAt: string;
  syncError: string | null;
}

const STORAGE_KEY = 'pending_attendance_v1';

function readAll(): PendingAttendance[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeAll(items: PendingAttendance[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Best-effort — if storage is full/unavailable there's nothing safe to
    // do here except leave the in-memory state as the source of truth for
    // the rest of this session. The caller still has the photo in memory
    // for this one attempt even if it can't be persisted.
  }
}

export function getPendingAttendance(): PendingAttendance[] {
  return readAll().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function queuePendingAttendance(item: Omit<PendingAttendance, 'id' | 'createdAt' | 'syncError'>): PendingAttendance {
  const full: PendingAttendance = {
    ...item,
    id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    createdAt: new Date().toISOString(),
    syncError: null,
  };
  writeAll([...readAll(), full]);
  return full;
}

export function updatePendingAttendance(id: string, updates: Partial<PendingAttendance>) {
  writeAll(readAll().map(p => (p.id === id ? { ...p, ...updates } : p)));
}

export function removePendingAttendance(id: string) {
  writeAll(readAll().filter(p => p.id !== id));
}

export function getPendingAttendanceCount(): number {
  return readAll().length;
}
