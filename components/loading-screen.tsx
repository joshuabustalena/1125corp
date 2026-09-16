import Image from 'next/image';

// Branded full-screen loader: a spinning ring around the logo, ambient glow
// blobs in the background, and a bouncing-dot "Loading" label — used both
// while the auth session is being checked (AppShell) and as the route
// segment's Suspense fallback (app/(app)/loading.tsx).
//
// `stuck`/`onRetry` are only meaningful for the auth-check use — a route
// transition (app/(app)/loading.tsx) never passes them and always gets the
// plain spinner, since Next.js itself drops that fallback the moment the
// segment finishes loading; there's nothing there that can hang the way an
// unresolved network call in AuthProvider can (see lib/auth-context.tsx).
export function LoadingScreen({ label = 'Loading 1125Corp', stuck = false, onRetry }: { label?: string; stuck?: boolean; onRetry?: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0b1f3a] relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-8%] w-96 h-96 bg-blue-500/20 rounded-full blur-3xl animate-pulse" />
      <div
        className="absolute bottom-[-10%] right-[-8%] w-96 h-96 bg-blue-400/10 rounded-full blur-3xl animate-pulse"
        style={{ animationDelay: '1s' }}
      />

      <div className="relative z-10 flex flex-col items-center gap-6">
        <div className="relative w-24 h-24 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full border-4 border-white/10" />
          <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-blue-400 border-r-blue-400 animate-spin" />
          <div className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center overflow-hidden shadow-xl shadow-black/30">
            <Image src="/image/1125_Corp_Logo.png" alt="1125Corp" width={64} height={64} className="object-contain" priority />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-white/60 text-sm">{label}</span>
          <span className="flex gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-white/60 animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-white/60 animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-white/60 animate-bounce" style={{ animationDelay: '300ms' }} />
          </span>
        </div>

        {stuck && (
          <div className="flex flex-col items-center gap-3 max-w-xs text-center mt-2">
            <p className="text-white/50 text-xs">
              This is taking longer than usual — the server may be slow to respond right now.
            </p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="px-4 py-1.5 rounded-md text-xs font-medium bg-white/10 text-white hover:bg-white/20 transition-colors"
              >
                Retry
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
