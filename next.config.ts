import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === 'production';

// WS origin the browser dials — must be in connect-src or tRPC subscriptions die.
const wsOrigin = process.env.NEXT_PUBLIC_WS_URL ?? '';

// One CSP covering every external origin the app actually loads (grepped from
// source, not guessed): QR images from qrserver, the venue map iframe from
// google, fonts from next/font (self + data:), and the tRPC WS. Anything not
// listed is blocked. No dangerouslySetInnerHTML anywhere in src/, so inline
// script is limited to what the framework emits.
// ponytail: 'unsafe-inline' scripts instead of a nonce — safe with zero HTML
// sinks. Upgrade path: emit a per-request nonce from middleware and swap it in.
const csp = [
  `default-src 'self'`,
  // Next dev needs eval for HMR/react-refresh; prod does not.
  `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: https://api.qrserver.com`,
  `font-src 'self' data:`,
  `frame-src https://www.google.com`,
  `connect-src 'self'${wsOrigin ? ` ${wsOrigin}` : ''}`,
  `frame-ancestors 'none'`,
  `base-uri 'self'`,
  `object-src 'none'`,
  `form-action 'self'`,
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // HSTS only in prod (dev is plain http); 1 year, include subdomains.
  ...(isProd
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
    : []),
];

const nextConfig: NextConfig = {
  // /images/* are fixed-filename assets baked into the Docker image (no content
  // hash), so a redeploy can swap front.jpg behind the same URL. Cache to kill
  // the per-load 304 round-trip, but NEVER `immutable` — that would pin a stale
  // poster for a year. SWR lets a swap self-correct within one navigation.
  // ponytail: revalidatable window, not immutable — versioned paths only if instant busting is ever needed.
  async headers() {
    return [
      {
        source: '/images/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=300, stale-while-revalidate=3600' },
        ],
      },
      // Security headers on every route.
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
