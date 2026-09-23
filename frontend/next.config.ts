import type { NextConfig } from 'next';

const isElectronBuild = process.env.ELECTRON_BUILD === '1';

const nextConfig: NextConfig = {
  reactStrictMode: false,

  // Static export requires unoptimized images (no server for optimization).
  // Uploaded portraits are served by the backend through the /api/uploads
  // rewrite below, so they stay same-origin and need no remote patterns.
  images: { unoptimized: true },

  // When ELECTRON_BUILD=1, produce a static export to frontend/out/
  // This is what Electron's app:// protocol serves in production
  ...(isElectronBuild && { output: 'export' as const }),

  // Dev proxy: forward /api requests to the backend server
  // (rewrites are not available in static export mode)
  ...(!isElectronBuild && {
    async rewrites() {
      return {
        beforeFiles: [
          {
            source: '/api/:path*',
            destination: 'http://localhost:3001/api/:path*',
          },
        ],
      };
    },
  }),

  experimental: {
    // Allow large file uploads through the dev proxy
    proxyClientMaxBodySize: '500mb',
  },
};

export default nextConfig;
