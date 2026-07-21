// Shared branding for every printed/PDF document (Loan Agreement, Cash
// Voucher, Borrower's Undertaking, Payslip, thermal receipts). Renamed from
// "1125 Lending Corporation" to "1125 Credit Collection Services" — address
// and contact number vary by branch, so callers must pass the loan/employee's
// branch name to get the right one.
export const COMPANY_NAME = '1125 CREDIT COLLECTION SERVICES';
// Title-case form for use mid-sentence in body/legal text, where an
// all-caps company name would read oddly.
export const COMPANY_NAME_DISPLAY = '1125 Credit Collection Services';

interface BranchBranding {
  address: string;
  contact: string;
}

const BRANCH_BRANDING: Record<string, BranchBranding> = {
  Balanga: {
    address: '118 Maligaya St. Cupang West, Balanga, Bataan',
    contact: '0950-431-9848',
  },
  Dinalupihan: {
    address: '155 National Hiway, Layac, Dinalupihan, Bataan',
    contact: '0985-978-4404',
  },
};

const DEFAULT_BRANDING: BranchBranding = BRANCH_BRANDING.Dinalupihan;

// Branch names in the DB are things like "Dinalupihan Branch" or just
// "Balanga" — match on substring so either form resolves correctly.
export function getDocumentBranding(branchName: string | null | undefined): BranchBranding {
  if (!branchName) return DEFAULT_BRANDING;
  const match = Object.keys(BRANCH_BRANDING).find((key) => branchName.toLowerCase().includes(key.toLowerCase()));
  return match ? BRANCH_BRANDING[match] : DEFAULT_BRANDING;
}
