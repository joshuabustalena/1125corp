'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import Image from 'next/image';

export default function Home() {
  const router = useRouter();
  const { user, loading, authStuck } = useAuth();

  useEffect(() => {
    if (!loading) {
      router.replace(user ? '/dashboard' : '/login');
    }
  }, [user, loading, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-secondary">
      <div className="flex flex-col items-center gap-4 animate-pulse">
        <div className="w-16 h-16 rounded-2xl bg-white border border-border flex items-center justify-center overflow-hidden shrink-0">
          <Image src="/image/1125_Corp_Logo.png" alt="1125Corp" width={64} height={64} className="object-contain" />
        </div>
        <p className="text-muted-foreground text-sm">Loading 1125Corp...</p>
      </div>
      {/* See lib/auth-context.tsx's authStuck — if the initial session check
          hasn't resolved after 10s (a slow/unresponsive Supabase, not a
          local bug), this offers a way out instead of leaving the splash
          spinning forever with no explanation. */}
      {authStuck && (
        <div className="fixed bottom-16 left-0 right-0 flex flex-col items-center gap-3 px-6">
          <p className="text-muted-foreground text-xs text-center max-w-xs">
            This is taking longer than usual — the server may be slow to respond right now.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-1.5 rounded-md text-xs font-medium bg-white border border-border hover:bg-secondary transition-colors"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
