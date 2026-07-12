'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { navSections } from '@/lib/navigation';
import { getRequiredPermission, hasPermission } from '@/lib/permissions';
import { useAuth } from '@/lib/auth-context';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const pathname = usePathname();
  const { profile } = useAuth();

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-40 h-screen bg-[#0b1f3a] text-white transition-all duration-300 flex flex-col',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Logo */}
      <div className="h-16 flex items-center px-4 border-b border-white/10 shrink-0">
        <Link href="/dashboard" className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shrink-0 overflow-hidden">
            <Image src="/image/1125_Corp_Logo.png" alt="1125Corp" width={40} height={40} className="object-contain" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="font-bold text-base leading-tight truncate">1125Corp</p>
              <p className="text-xs text-white/50 leading-tight">1125corp.org</p>
            </div>
          )}
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-6">
        {navSections.map((section) => {
          const visibleItems = section.items.filter((item) =>
            hasPermission(profile?.permissions, getRequiredPermission(item.href))
          );
          if (visibleItems.length === 0) return null;
          return (
          <div key={section.title}>
            {!collapsed && (
              <p className="px-3 mb-2 text-xs font-semibold text-white/40 uppercase tracking-wider">
                {section.title}
              </p>
            )}
            <div className="space-y-1">
              {visibleItems.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group relative',
                      isActive
                        ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/30'
                        : 'text-white/60 hover:text-white hover:bg-white/5'
                    )}
                  >
                    {isActive && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-7 bg-blue-400 rounded-r-full" />
                    )}
                    <Icon className={cn('w-5 h-5 shrink-0', isActive && 'text-white')} />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <div className="p-2 border-t border-white/10 shrink-0">
        <button
          onClick={onToggle}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-white/60 hover:text-white hover:bg-white/5 transition-colors text-sm"
        >
          {collapsed ? <ChevronRight className="w-5 h-5" /> : (
            <>
              <ChevronLeft className="w-5 h-5" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
