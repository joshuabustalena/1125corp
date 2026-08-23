import { supabase } from '@/lib/supabase/client';

// Official Receipt numbers come from a Postgres sequence
// (supabase/add_sequential_or_numbers.sql) rather than the old random
// 6-digit generator, which had a ~14% collision probability at the current
// receipt count and climbing.
//
// A sequence needs the database, but a collector standing in a no-signal
// area still has to hand over a printed receipt right then. So the device
// reserves a BLOCK of numbers while it still has a connection and draws
// from that block offline. The sequence issued every number in the block
// exclusively, so two devices can never hold the same one.

const POOL_KEY = 'or_number_pool_v1';
// Enough to cover a full collection round without signal, small enough that
// an unused block only leaves a modest gap in the series.
const TARGET_POOL = 60;
const REFILL_AT = 20;

function readPool(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(POOL_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writePool(pool: string[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(POOL_KEY, JSON.stringify(pool));
  } catch {
    // A full or blocked localStorage shouldn't take the payment screen down;
    // the caller still gets a number, it just isn't persisted for offline use.
  }
}

export function getOrPoolCount(): number {
  return readPool().length;
}

// Takes one number out of the reserved block. Synchronous and offline-safe —
// this is what the payment flow calls at the moment of collection. Returns
// null when the block is empty, which the caller must handle rather than
// inventing a number: a made-up OR is exactly the collision this replaces.
export function takeOrNumber(): string | null {
  const pool = readPool();
  const next = pool.shift();
  if (!next) return null;
  writePool(pool);
  return next;
}

// Tops the block up when it runs low. Safe to call on every page load and
// after each sync; it's a no-op when the block is already healthy or the
// device is offline.
export async function ensureOrPool(): Promise<number> {
  const pool = readPool();
  if (pool.length >= REFILL_AT) return pool.length;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return pool.length;

  const need = TARGET_POOL - pool.length;
  const { data, error } = await supabase.rpc('reserve_or_numbers', { p_count: need });
  if (error || !Array.isArray(data)) return pool.length;

  const merged = [...pool, ...(data as string[])];
  writePool(merged);
  return merged.length;
}

// Online path: prefer a freshly issued number so the series stays tight, and
// fall back to the reserved block if the call fails (patchy signal that
// navigator.onLine still reports as "online").
export async function nextOrNumberOnline(): Promise<string | null> {
  const { data, error } = await supabase.rpc('next_or_number');
  if (!error && typeof data === 'string' && data) return data;
  return takeOrNumber();
}
