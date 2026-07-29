// SSS Loan, Pag-IBIG Loan, and the three "Special Loans" (Service Vehicle,
// Uniform, Cash Shortage) all work the same way: a running balance that
// only moves when someone manually enters a deduction on a payroll row —
// no fixed schedule/term like the existing Employee Loan feature has.
// Shared between the Employee Loans page (where balances are created/
// managed) and the Payroll page (where they're deducted each cutoff).
export const SPECIAL_LOAN_TYPES = ['sss_loan', 'pag_ibig_loan', 'service_vehicle', 'uniform', 'cash_shortage'] as const;
export type SpecialLoanType = typeof SPECIAL_LOAN_TYPES[number];

export const SPECIAL_LOAN_LABELS: { key: SpecialLoanType; label: string }[] = [
  { key: 'sss_loan', label: 'SSS Loan' },
  { key: 'pag_ibig_loan', label: 'Pag-IBIG Loan' },
  { key: 'service_vehicle', label: 'Service Vehicle' },
  { key: 'uniform', label: 'Uniform' },
  { key: 'cash_shortage', label: 'Cash Shortage' },
];

export function specialLoanLabel(key: string): string {
  return SPECIAL_LOAN_LABELS.find(l => l.key === key)?.label ?? key;
}
