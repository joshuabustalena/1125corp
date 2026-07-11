'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { Button } from '@/components/ui/button';
import { getRequiredPermission, hasPermission } from '@/lib/permissions';
import { Building2, Loader2, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-secondary">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center animate-pulse">
            <Building2 className="w-9 h-9 text-white" />
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Loading 1125Corp...</span>
          </div>
        </div>
      </div>
    );
  }

  if (!user) return null;

  const allowed = hasPermission(profile?.permissions, getRequiredPermission(pathname));

  return (
    <div className="min-h-screen bg-secondary">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar */}
      <div
        className={cn(
          'fixed inset-y-0 left-0 z-50 lg:hidden transition-transform duration-300',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="h-full">
          <div className="h-full w-64 bg-[#0b1f3a]">
            <Sidebar collapsed={false} onToggle={() => setMobileOpen(false)} />
          </div>
        </div>
      </div>

      <div className={cn('transition-all duration-300', collapsed ? 'lg:ml-16' : 'lg:ml-64')}>
        <Topbar onMenuClick={() => setMobileOpen(true)} />
        <main className="p-4 lg:p-6 max-w-[1600px] mx-auto">
          {allowed ? (
            <div className="animate-fade-in">{children}</div>
          ) : (
            <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center">
                <ShieldAlert className="w-9 h-9 text-destructive" />
              </div>
              <div>
                <h2 className="text-xl font-bold">Access Denied</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Your role ({profile?.role_name ?? 'Unknown'}) doesn't have permission to view this page.
                </p>
              </div>
              <Link href="/dashboard"><Button>Back to Dashboard</Button></Link>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
