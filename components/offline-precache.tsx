'use client';

import { useEffect, useRef } from 'react';

/*
  Silently loads /payments into a hidden iframe once, right after login,
  so it's cached for opening with zero signal later — without the
  collector needing to remember to open it themselves first.

  WHY AN IFRAME, NOT JUST fetch('/payments'): the service worker
  (public/sw.js) only caches a page's full document on a real navigation
  (request.mode === 'navigate') — that's the only way to get the actual
  page Next.js serves for a fresh, offline top-level load, as opposed to
  the different, partial RSC-payload format Next.js's own client-side
  router.prefetch() fetches for an in-app link transition. A plain script
  can't set mode: 'navigate' on a fetch() call (browsers reject it), but
  loading a URL into an iframe IS a real navigation for that frame, with
  the service worker intercepting it exactly like a top-level page load —
  including every /_next/static/ chunk that page then requests to render,
  which get cached the same way any other visit would. This has the same
  practical effect as someone opening Payments once at the office, just
  without them having to remember to do it.

  Fires once per browser session (sessionStorage flag) — no need to redo
  this every time AppShell remounts while navigating around the app, only
  once per fresh login/session, and only while there's a live connection
  to actually fetch anything with.
*/
const SESSION_FLAG = 'payments_precached_v1';

export function OfflinePrecache() {
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    if (typeof window === 'undefined') return;
    try {
      if (window.sessionStorage.getItem(SESSION_FLAG)) return;
    } catch {
      // If sessionStorage is unavailable, just proceed — worst case this
      // silently re-precaches once per remount instead of once per
      // session, which costs a little redundant bandwidth, not correctness.
    }
    startedRef.current = true;

    const iframe = document.createElement('iframe');
    iframe.src = '/payments';
    iframe.style.position = 'fixed';
    iframe.style.top = '-9999px';
    iframe.style.left = '-9999px';
    iframe.style.width = '1px';
    iframe.style.height = '1px';
    iframe.style.border = 'none';
    iframe.setAttribute('aria-hidden', 'true');
    iframe.tabIndex = -1;

    const cleanup = () => {
      try { window.sessionStorage.setItem(SESSION_FLAG, '1'); } catch { /* best-effort */ }
      iframe.remove();
    };
    // Whether it loads cleanly or errors (e.g. the profile viewing this
    // has no access to Payments and gets redirected/blocked inside the
    // iframe), there's nothing more useful to do than clean up either way
    // — this is a best-effort cache warm, never something to retry
    // aggressively or surface an error about.
    iframe.onload = cleanup;
    iframe.onerror = cleanup;

    document.body.appendChild(iframe);

    return () => {
      iframe.remove();
    };
  }, []);

  return null;
}
