'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import { hasPermission } from '@/lib/permissions';
import { supabase } from '@/lib/supabase/client';
import { checkDueDateAlerts } from '@/lib/due-date-alerts';
import { Button } from '@/components/ui/button';
import {
  Menu,
  Sun,
  Moon,
  Bell,
  BellRing,
  AlertTriangle,
  Wallet,
  CheckCircle2,
  User,
  LogOut,
  Settings as SettingsIcon,
  ChevronDown,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getInitials } from '@/lib/format';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

// Notifications are broadcast by role (recipient_type, e.g. "branch_manager")
// rather than to a specific user — this maps the logged-in profile's role
// name to that same slug so the bell only shows notifications meant for
// their role. Administrators see every notification regardless of role.
function roleToRecipientType(roleName: string | null | undefined): string | null {
  if (!roleName) return null;
  return roleName.toLowerCase().replace(/\s+/g, '_');
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const { profile, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const router = useRouter();
  const [notifications, setNotifications] = useState<any[]>([]);
  const notifCount = notifications.filter(n => !n.read_at).length;

  useEffect(() => {
    if (!profile) return;
    loadNotifications();
  }, [profile]);

  async function loadNotifications() {
    await checkDueDateAlerts();
    const isAdmin = profile?.role_name === 'Administrator';
    let query = supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(10);
    if (!isAdmin) {
      const myType = roleToRecipientType(profile?.role_name);
      query = query.in('recipient_type', [myType, 'all'].filter(Boolean) as string[]);
    }
    const { data } = await query;
    setNotifications(data ?? []);
  }

  async function handleOpenChange(open: boolean) {
    if (!open) return;
    const unreadIds = notifications.filter(n => !n.read_at).map(n => n.id);
    if (unreadIds.length === 0) return;
    const readAt = new Date().toISOString();
    setNotifications(prev => prev.map(n => unreadIds.includes(n.id) ? { ...n, read_at: readAt } : n));
    await supabase.from('notifications').update({ read_at: readAt }).in('id', unreadIds);
  }

  const typeIcon = (type: string) => {
    switch (type) {
      case 'overdue': return <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />;
      case 'upcoming_due': return <Bell className="w-4 h-4 text-warning shrink-0" />;
      case 'payment_received': return <Wallet className="w-4 h-4 text-success shrink-0" />;
      default: return <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />;
    }
  };

  return (
    <header className="h-16 bg-card border-b border-border flex items-center px-4 gap-4 sticky top-0 z-30 glass">
      <button
        onClick={onMenuClick}
        className="lg:hidden p-2 rounded-lg hover:bg-secondary transition-colors"
      >
        <Menu className="w-5 h-5" />
      </button>

      <span className="lg:hidden font-bold text-xl text-[#0b1f3a] dark:text-white">1125Corp</span>

      <div className="flex items-center gap-2 ml-auto">
        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          className="rounded-lg"
        >
          {theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
        </Button>

        {/* Notifications */}
        <DropdownMenu onOpenChange={handleOpenChange}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative rounded-lg">
              {notifCount > 0 ? <BellRing className="w-5 h-5" /> : <Bell className="w-5 h-5" />}
              {notifCount > 0 && (
                <span className="absolute top-1 right-1 w-4 h-4 bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full flex items-center justify-center">
                  {notifCount > 9 ? '9+' : notifCount}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel>Notifications</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {notifications.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">No notifications</p>
            ) : (
              notifications.map(n => (
                <DropdownMenuItem key={n.id} className="flex items-start gap-2">
                  {typeIcon(n.type)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium capitalize truncate">{n.type.replace(/_/g, ' ')}</span>
                      {!n.read_at && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
                    </div>
                    <span className="text-xs text-muted-foreground line-clamp-2">{n.message ?? '—'}</span>
                    <span className="text-[10px] text-muted-foreground/70">{timeAgo(n.created_at)}</span>
                  </div>
                </DropdownMenuItem>
              ))
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/notifications" className="w-full text-center text-sm text-primary">
                View all notifications
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-secondary transition-colors">
              <Avatar className="w-8 h-8">
                <AvatarImage src={profile?.avatar_url ?? undefined} />
                <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                  {profile ? getInitials(profile.full_name) : 'U'}
                </AvatarFallback>
              </Avatar>
              <div className="hidden md:block text-left">
                <p className="text-sm font-medium leading-tight">{profile?.full_name ?? 'User'}</p>
                <p className="text-xs text-muted-foreground leading-tight">
                  {profile?.role_name ?? '—'}
                </p>
              </div>
              <ChevronDown className="w-4 h-4 text-muted-foreground hidden md:block" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div>
                <p className="text-sm font-medium">{profile?.full_name}</p>
                <p className="text-xs text-muted-foreground">{profile?.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/profile" className="cursor-pointer">
                <User className="w-4 h-4 mr-2" />
                My Profile
              </Link>
            </DropdownMenuItem>
            {hasPermission(profile?.permissions, 'settings') && (
              <DropdownMenuItem asChild>
                <Link href="/settings" className="cursor-pointer">
                  <SettingsIcon className="w-4 h-4 mr-2" />
                  Settings
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => signOut().then(() => router.push('/login'))}
              className="text-destructive cursor-pointer"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
