'use client';

import { useEffect } from 'react';

// Confirmed by real automated testing (flaky-network simulation): a chunk
// that was never fetched before (e.g. a route opened for the first time
// that day) can fail to load if signal drops mid-request, throwing an
// uncaught ChunkLoadError with no built-in Next.js recovery and no
// error.tsx boundary in this app to catch it. A single silent reload
// re-requests the missing chunk once a connection is available again,
// which is the standard fix for this. Guarded by sessionStorage so a
// chunk that's genuinely gone (e.g. an old tab left open across a deploy)
// reloads once, not in a loop - and the guard clears itself shortly after
// a clean run so a later, unrelated drop can still self-heal too.
const RELOAD_GUARD_KEY = 'chunk_reload_guard_v1';

export function PwaRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    const handleChunkError = (event: ErrorEvent | PromiseRejectionEvent) => {
      const message = String(('reason' in event ? event.reason?.message ?? event.reason : event.message) ?? '');
      if (!/ChunkLoadError|Loading chunk .* failed/i.test(message)) return;
      try {
        if (sessionStorage.getItem(RELOAD_GUARD_KEY)) return;
        sessionStorage.setItem(RELOAD_GUARD_KEY, '1');
      } catch {
        // best-effort guard only
      }
      window.location.reload();
    };

    window.addEventListener('error', handleChunkError);
    window.addEventListener('unhandledrejection', handleChunkError);
    const clearGuardTimer = setTimeout(() => {
      try { sessionStorage.removeItem(RELOAD_GUARD_KEY); } catch { /* best-effort */ }
    }, 5000);

    return () => {
      window.removeEventListener('error', handleChunkError);
      window.removeEventListener('unhandledrejection', handleChunkError);
      clearTimeout(clearGuardTimer);
    };
  }, []);

  return null;
}
