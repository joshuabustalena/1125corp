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
  '/employees': 'employees',
  '/collectors': 'collectors',
  '/payroll': 'payroll',
  '/employee-loans': 'employee_loans',
  '/leave-requests': 'leave_requests',
  '/attendance': 'attendance',
  '/collector-attendance': 'collector_attendance',
  '/accounting': 'accounting',
  '/general-ledger': 'general_ledger',
  '/cash-count': 'cash_count',
  '/remittance': 'remittance',
  '/reports': 'reports',
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
