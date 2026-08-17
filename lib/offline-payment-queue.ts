/*
  Lets a collector record a payment with zero signal, print a receipt for
  the customer immediately, and defer the actual database write until
  signal comes back and they tap "Sync". This is intentionally an
  intent queue, not a pre-computed balance queue — the item stores WHO
  paid HOW MUCH for WHICH loan, nothing about the resulting balance. The
  balance itself is only ever computed at sync time, by the same
  row-locked apply_loan_payment RPC used for a normal online payment — so
  a queued payment can sit offline for hours and still sync with a
  correct, race-condition-safe balance, the same way apply_loan_payment
  protects a normal online payment.

  This is why the printed receipt for a still-queued payment can't show a
  real "Remaining Balance" (see PaymentReceiptDialog) — nobody can
  legitimately know it until sync actually happens.
*/

export interface PendingPayment {
  id: string; // client-generated, used to dedupe if Sync is tapped more than once
  loanId: string;
  loanNumber: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string | null;
  collectorId: string | null;
  collectorName: string | null;
  branchName: string | null;
  areaName: string | null;
  releaseDate: string | null;
  dueDate: string | null;
  amount: number;
  paymentDate: string;
  paymentTime: string;
  gpsLat: number | null;
  gpsLng: number | null;
  locationAddress: string | null;
  orNumber: string;
  createdAt: string;
  // Tracks how far a sync attempt got, so retrying a failed item never
  // re-applies the balance deduction twice — only the receipt/payment
  // bookkeeping gets retried once the RPC has already succeeded once.
  balanceApplied: boolean;
  appliedBalance: number | null;
  syncError: string | null;
}

const STORAGE_KEY = 'pending_payments_v1';

function readAll(): PendingPayment[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeAll(items: PendingPayment[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Best-effort — if storage is full/unavailable there's nothing safe to
    // do here except leave the in-memory state as the source of truth for
    // the rest of this session.
  }
}

export function getPendingPayments(): PendingPayment[] {
  return readAll().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function queuePendingPayment(payment: Omit<PendingPayment, 'id' | 'createdAt' | 'balanceApplied' | 'appliedBalance' | 'syncError'>): PendingPayment {
  const full: PendingPayment = {
    ...payment,
    id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    createdAt: new Date().toISOString(),
    balanceApplied: false,
    appliedBalance: null,
    syncError: null,
  };
  writeAll([...readAll(), full]);
  return full;
}

export function updatePendingPayment(id: string, updates: Partial<PendingPayment>) {
  writeAll(readAll().map(p => (p.id === id ? { ...p, ...updates } : p)));
}

export function removePendingPayment(id: string) {
  writeAll(readAll().filter(p => p.id !== id));
}

export function getPendingCount(): number {
  return readAll().length;
}
