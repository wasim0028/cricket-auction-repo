// BACKEND_URL is read at BUILD time (rewrites are baked into the routes manifest).
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000';

/** @type {import('next').NextConfig} */
module.exports = {
  output: 'standalone',
  poweredByHeader: false,
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${BACKEND_URL}/api/:path*` },
      { source: '/ws', destination: `${BACKEND_URL}/ws` },
    ];
  },
};
