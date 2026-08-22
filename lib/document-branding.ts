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
  // Short "barangay, city, province" form for the document masthead —
  // the client's signed templates never print the street-level address
  // up top, only in the Loan Agreement's body sentence (see fullAddress).
  headerAddress: string;
  // Full formal-sentence form used only in the Loan Agreement's "located
  // at ___" clause. Spelled out ("Street", "City") the way the signed
  // template does, which the abbreviated `address` above doesn't match.
  fullAddress: string;
  contact: string;
}

const BALANGA_ADDRESS = '118 Maligaya St. Cupang West, Balanga, Bataan';
const DINALUPIHAN_ADDRESS = '155 National Hiway, Layac, Dinalupihan, Bataan';

const BRANCH_BRANDING: Record<string, BranchBranding> = {
  Balanga: {
    address: BALANGA_ADDRESS,
    // Taken verbatim from the client's own signed Borrower's Undertaking
    // and Loan Agreement templates (Aug 2026).
    headerAddress: 'Cupang West, Balanga City, Bataan',
    fullAddress: '118 Maligaya Street, Cupang West, Balanga City, Bataan',
    // Kept as-is at the client's instruction (Aug 2026). Worth knowing: the
    // signed Loan Agreement and Borrower's Undertaking templates both print
    // 0950-931-9848 instead, so printed documents will not match those two
    // paper originals on this one field.
    contact: '0950-431-9848',
  },
  Dinalupihan: {
    address: DINALUPIHAN_ADDRESS,
    // No signed Dinalupihan template confirmed yet — falls back to the
    // same address used everywhere else until one turns up.
    headerAddress: DINALUPIHAN_ADDRESS,
    fullAddress: DINALUPIHAN_ADDRESS,
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
