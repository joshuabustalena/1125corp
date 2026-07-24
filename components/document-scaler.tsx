'use client';

import { useEffect, useRef, useState } from 'react';

// Printable documents (loan agreement, voucher, undertaking) are laid out at
// a fixed 780px width to match their real paper size, which is wider than a
// phone screen. Rather than letting them force a horizontal scroll, this
// scales the whole block down (via CSS transform, so html2canvas/print
// capture of the un-scaled refs inside is unaffected) to exactly fit
// whatever width its container actually has, up to natural size.
export function DocumentScaler({ width, children }: { width: number; children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    function recompute() {
      const containerWidth = containerRef.current?.offsetWidth ?? width;
      const s = containerWidth > 0 ? Math.min(1, containerWidth / width) : 1;
      setScale(s);
      setHeight((innerRef.current?.offsetHeight ?? 0) * s);
    }
    recompute();
    const ro = new ResizeObserver(recompute);
    if (containerRef.current) ro.observe(containerRef.current);
    if (innerRef.current) ro.observe(innerRef.current);
    return () => ro.disconnect();
  }, [width]);

  return (
    <div ref={containerRef} className="relative w-full" style={{ height }}>
      <div
        ref={innerRef}
        style={{
          position: 'absolute',
          top: 0,
          left: '50%',
          width,
          transform: `translateX(-50%) scale(${scale})`,
          transformOrigin: 'top center',
        }}
      >
        {children}
      </div>
    </div>
  );
}
