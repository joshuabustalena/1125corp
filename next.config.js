/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: { unoptimized: true },
  // The logo, cover and app icons were re-requested from Vercel on every
  // page load. Let browsers keep them for 30 days instead — the client asked
  // for fewer Vercel requests (Oct 2026). Not immutable, so a replaced image
  // still shows up within the month. sw.js, manifest and offline.html are
  // left alone so app updates keep reaching devices immediately.
  async headers() {
    const cache30Days = [{ key: 'Cache-Control', value: 'public, max-age=2592000' }];
    return [
      { source: '/image/:path*', headers: cache30Days },
      { source: '/icons/:path*', headers: cache30Days },
    ];
  },
};

module.exports = nextConfig;
