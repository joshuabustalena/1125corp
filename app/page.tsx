'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import Image from 'next/image';

export default function Home() {
  const router = useRouter();
  const { user, loading } = useAuth();

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
    </div>
  );
}
