// Maps each route to the permission string required to access it, matching the
// `permissions` jsonb array seeded on the `roles` table. `null` means every
// logged-in user can access it, regardless of role. Routes not listed here
// default to admin-only (see hasPermission below) since they aren't granted
// to any non-Administrator role in the seed data.
export const PAGE_PERMISSIONS: Record<string, string | null> = {
  '/dashboard': null,
  '/search': null,
  '/profile': null,
  '/branches': 'branches',
  '/areas': 'branches',
  '/customers': 'customers',
  '/loans': 'loans',
  '/payments': 'payments',
  '/penalties': 'penalties',
  '/payment-reports': 'receipts',
  '/credit-limit-requests': 'credit_limit_requests',
  '/broadcast-sms': 'broadcast_sms',
  '/employees': 'employees',
  '/collectors': 'collectors',
  // Reachable by every signed-in user, but the page itself splits in two:
  // anyone WITHOUT the 'payroll' permission sees only their own payslips
  // (self-service), never the generate/edit/delete tooling or anyone
  // else's pay. See app/(app)/payroll/page.tsx.
  '/payroll': null,
  '/employee-loans': 'employee_loans',
  '/leave-requests': 'leave_requests',
  '/attendance': 'attendance',
  '/collector-attendance': 'collector_attendance',
  '/accounting': 'accounting',
  '/general-ledger': 'general_ledger',
  '/journal-entries': 'general_ledger',
  '/account-ledger': 'general_ledger',
  '/chart-of-accounts': 'general_ledger',
  '/shareholders': 'general_ledger',
  '/cash-count': 'cash_count',
  '/collection-list': 'collection_list',
  '/gas-voucher': 'gas_voucher',
  '/cash-vouchers': 'cash_vouchers',
  '/remittance': 'remittance',
  '/reports': 'reports',
  // Not granted to any role in the seed data, so Administrator ('*') is the
  // only one with access by default — deliberately narrower than the other
  // Finance pages, matching how Kat asked for this specifically.
  '/write-off': 'write_off',
  '/notifications': 'notifications',
  '/audit-logs': 'audit_logs',
  '/settings': 'settings',
};

export function getRequiredPermission(pathname: string): string | null {
  const match = Object.keys(PAGE_PERMISSIONS)
    .sort((a, b) => b.length - a.length)
    .find((path) => pathname === path || pathname.startsWith(path + '/'));
  return match ? PAGE_PERMISSIONS[match] : null;
}

export function hasPermission(permissions: string[] | null | undefined, required: string | null): boolean {
  if (required === null) return true;
  if (!permissions || permissions.length === 0) return false;
  if (permissions.includes('*')) return true;
  if (permissions.includes(required)) return true;
  if (required === 'customers' && permissions.includes('customers_read')) return true;
  return false;
}


// ---------------------------------------------------------------------------
// The list the Access tab on Add/Edit Employee renders as checkboxes.
//
// Built from PAGE_PERMISSIONS rather than hand-maintained, so a page added to
// that map automatically becomes assignable and no route can quietly end up
// with no way to grant it. Routes mapped to `null` (Dashboard, Search,
// Profile, Payroll) are deliberately absent: they're open to every signed-in
// user, so a checkbox for them would be a lie.
//
// Several routes share one permission (the four ledger pages all use
// 'general_ledger'); each permission appears once, labelled with the pages it
// unlocks.
// ---------------------------------------------------------------------------
const PERMISSION_LABELS: Record<string, string> = {
  branches: 'Branches & Areas',
  customers: 'Customers',
  loans: 'Loans',
  payments: 'Payments',
  penalties: 'Penalties',
  receipts: 'Payment Reports',
  credit_limit_requests: 'Credit Limit Requests',
  broadcast_sms: 'Broadcast SMS',
  employees: 'Employees',
  collectors: 'Collectors',
  payroll: 'Payroll (manage)',
  employee_loans: 'Employee Loans',
  leave_requests: 'Leave Requests',
  attendance: 'Attendance',
  collector_attendance: 'Collector Attendance',
  accounting: 'Accounting',
  general_ledger: 'General Ledger, Journal Entries, Chart of Accounts, Financial Statements, Shareholders',
  cash_count: 'Cash Count',
  collection_list: 'Collection List',
  gas_voucher: 'Gas Voucher',
  cash_vouchers: 'Cash Vouchers',
  remittance: 'Remittance',
  reports: 'Reports',
  write_off: 'Write-Off',
  notifications: 'Notifications',
  audit_logs: 'Audit Logs',
  settings: 'Settings',
};

export interface AssignablePermission {
  key: string;
  label: string;
}

// Permissions that gate capability INSIDE an otherwise-open page, so they
// never appear as a value in PAGE_PERMISSIONS but still need a checkbox.
// 'payroll' is the live case: /payroll is open to everyone because employees
// read their own payslips there, while this permission is what separates that
// self-service view from the generate/approve/delete tooling. Without this
// list there would be no way to grant or revoke it from the Access tab.
const EXTRA_ASSIGNABLE_PERMISSIONS = ['payroll'];

export const ASSIGNABLE_PERMISSIONS: AssignablePermission[] = Array.from(
  new Set([
    ...Object.values(PAGE_PERMISSIONS).filter((v): v is string => v !== null),
    ...EXTRA_ASSIGNABLE_PERMISSIONS,
  ])
).map((key) => ({ key, label: PERMISSION_LABELS[key] ?? key }))
  .sort((a, b) => a.label.localeCompare(b.label));

// What the Access tab shows ticked when it first opens: the account's own
// override if one was saved, otherwise the plain role list. '*' (full access)
// is expanded so an Administrator sees every box ticked rather than none.
export function effectivePermissions(
  override: string[] | null | undefined,
  rolePermissions: string[] | null | undefined,
): string[] {
  const source = Array.isArray(override) ? override : (rolePermissions ?? []);
  if (source.includes('*')) return ASSIGNABLE_PERMISSIONS.map((p) => p.key);
  return source;
}

// Permissions that exist on roles but map to no page, so the Access tab has
// no checkbox for them — today: 'collections', 'cash_flow', 'expenses' and
// 'customers_read'. That last one is load-bearing: hasPermission() treats it
// as standing in for 'customers'. Saving a checkbox selection must carry
// these through untouched, or ticking anything at all would quietly strip
// them from the account.
export function nonAssignablePermissions(permissions: string[] | null | undefined): string[] {
  const assignable = new Set(ASSIGNABLE_PERMISSIONS.map(p => p.key));
  return (permissions ?? []).filter(p => p !== '*' && !assignable.has(p));
}
