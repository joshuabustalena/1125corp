import {
  LayoutDashboard,
  Users,
  Landmark,
  Wallet,
  AlertCircle,
  Calculator,
  FileBarChart,
  UserCog,
  ScrollText,
  Bell,
  Settings,
  ClipboardCheck,
  Receipt,
  ShieldCheck,
  Building2,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  roles?: string[];
  badge?: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const navSections: NavSection[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    ],
  },
  {
    title: 'Organization',
    items: [
      { label: 'Branches', href: '/branches', icon: Building2 },
    ],
  },
  {
    title: 'Lending',
    items: [
      { label: 'Customers', href: '/customers', icon: Users },
      { label: 'Loans', href: '/loans', icon: Landmark },
      { label: 'Payments', href: '/payments', icon: Wallet },
      { label: 'Penalties', href: '/penalties', icon: AlertCircle },
      { label: 'Receipts', href: '/receipts', icon: Receipt },
    ],
  },
  {
    title: 'Human Resources',
    items: [
      { label: 'Employees', href: '/employees', icon: UserCog },
      { label: 'Payroll', href: '/payroll', icon: ScrollText },
      { label: 'Employee Loans', href: '/employee-loans', icon: Landmark },
      { label: 'Attendance', href: '/attendance', icon: ClipboardCheck },
      { label: 'Collector Attendance', href: '/collector-attendance', icon: ClipboardCheck },
    ],
  },
  {
    title: 'Finance',
    items: [
      { label: 'Accounting', href: '/accounting', icon: Calculator },
      { label: 'Reports', href: '/reports', icon: FileBarChart },
    ],
  },
  {
    title: 'System',
    items: [
      { label: 'Notifications', href: '/notifications', icon: Bell },
      { label: 'Audit Logs', href: '/audit-logs', icon: ShieldCheck },
      { label: 'Settings', href: '/settings', icon: Settings },
    ],
  },
];
