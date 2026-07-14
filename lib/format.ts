export function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '₱0.00';
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
  }).format(amount);
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '0';
  return new Intl.NumberFormat('en-PH').format(value);
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTime(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleTimeString('en-PH', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDuration(start: string | Date | null | undefined, end: string | Date | null | undefined): string {
  if (!start || !end) return '—';
  const s = typeof start === 'string' ? new Date(start) : start;
  const e = typeof end === 'string' ? new Date(end) : end;
  const minutes = Math.max(0, Math.round((e.getTime() - s.getTime()) / 60000));
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

export function generateLoanNumber(): string {
  const year = new Date().getFullYear();
  const random = Math.floor(100000 + Math.random() * 900000);
  return `LN-${year}-${random}`;
}

export function generateORNumber(): string {
  const year = new Date().getFullYear();
  const random = Math.floor(100000 + Math.random() * 900000);
  return `OR-${year}-${random}`;
}

export function generateVoucherNumber(): string {
  const year = new Date().getFullYear();
  const random = Math.floor(100000 + Math.random() * 900000);
  return `CV-${year}-${random}`;
}

export function generateEntryNumber(): string {
  const year = new Date().getFullYear();
  const random = Math.floor(100000 + Math.random() * 900000);
  return `JE-${year}-${random}`;
}

export function computeLoanDetails(
  amount: number,
  interestRate: number,
  termDays: number,
) {
  // Interest rate is always a monthly rate — scale it by the number of
  // months in the term (30-day months) rather than applying it once flat.
  const months = termDays / 30;
  const interestAmount = amount * (interestRate / 100) * months;
  const totalPayable = amount + interestAmount;
  const serviceFee = amount >= 10000 ? amount * 0.03 : 300;
  const releaseAmount = amount - serviceFee;
  return {
    interestAmount: Math.round(interestAmount * 100) / 100,
    totalPayable: Math.round(totalPayable * 100) / 100,
    serviceFee: Math.round(serviceFee * 100) / 100,
    releaseAmount: Math.round(releaseAmount * 100) / 100,
  };
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function exportToCSV(data: Record<string, unknown>[], filename: string) {
  if (data.length === 0) return;
  const headers = Object.keys(data[0]);
  const csvRows = [
    headers.join(','),
    ...data.map((row) =>
      headers
        .map((h) => {
          const val = row[h];
          const str = val === null || val === undefined ? '' : String(val);
          return `"${str.replace(/"/g, '""')}"`;
        })
        .join(',')
    ),
  ];
  const csv = csvRows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
