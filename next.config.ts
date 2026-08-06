import type { NextConfig } from "next";

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
    ];
  },
};

export default nextConfig;
