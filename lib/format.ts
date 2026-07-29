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

export function generateGasVoucherNumber(): string {
  const year = new Date().getFullYear();
  const random = Math.floor(100000 + Math.random() * 900000);
  return `GV-${year}-${random}`;
}

export function generatePayrollVoucherNumber(): string {
  const year = new Date().getFullYear();
  const random = Math.floor(100000 + Math.random() * 900000);
  return `PV-${year}-${random}`;
}

export function generateThirteenthMonthVoucherNumber(): string {
  const year = new Date().getFullYear();
  const random = Math.floor(100000 + Math.random() * 900000);
  return `TMV-${year}-${random}`;
}

export function generateGeneralCashVoucherNumber(): string {
  const year = new Date().getFullYear();
  const random = Math.floor(100000 + Math.random() * 900000);
  return `GCV-${year}-${random}`;
}

const WORDS_ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const WORDS_TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function threeDigitsToWords(n: number): string {
  let str = '';
  if (n >= 100) {
    str += `${WORDS_ONES[Math.floor(n / 100)]} Hundred `;
    n %= 100;
  }
  if (n >= 20) {
    str += `${WORDS_TENS[Math.floor(n / 10)]} `;
    n %= 10;
  }
  if (n > 0) {
    str += `${WORDS_ONES[n]} `;
  }
  return str.trim();
}

function integerToWords(n: number): string {
  if (n === 0) return 'Zero';
  const groups = ['', ' Thousand', ' Million', ' Billion'];
  let str = '';
  let groupIndex = 0;
  while (n > 0) {
    const chunk = n % 1000;
    if (chunk > 0) {
      str = `${threeDigitsToWords(chunk)}${groups[groupIndex]} ${str}`;
    }
    n = Math.floor(n / 1000);
    groupIndex++;
  }
  return str.trim();
}

// "280.00" -> "Two Hundred Eighty Pesos", "280.50" -> "Two Hundred Eighty
// Pesos and 50/100" — matches how amounts are spelled out on the company's
// paper vouchers (Gas Voucher, Cash Voucher).
export function numberToWordsPeso(amount: number): string {
  const rounded = Math.round((amount || 0) * 100) / 100;
  const isNegative = rounded < 0;
  const abs = Math.abs(rounded);
  const pesos = Math.floor(abs);
  const centavos = Math.round((abs - pesos) * 100);
  const pesosWords = `${integerToWords(pesos)} Pesos`;
  const result = centavos > 0 ? `${pesosWords} and ${centavos}/100` : pesosWords;
  return isNegative ? `Negative ${result}` : result;
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
  const serviceFee = amount > 10000 ? amount * 0.03 : 300;
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
