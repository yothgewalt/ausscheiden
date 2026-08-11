import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter } from '../../../../server/trpc/root';
import { buildContext, clientIpFromXff, sessionCookie } from '../../../../server/trpc/context';
import { traced } from '../../../../server/otel';

// Queries + mutations ride HTTP here; subscriptions ride the WS path (server.ts).
async function handler(req: Request) {
  // The client batches (httpBatchLink), so ONE POST can carry several procedure
  // calls. This span is their common parent — the per-procedure spans hang off it
  // via the tRPC middleware, which is what makes a batch legible in Jaeger.
  // Note /api/health is a different route handler and stays uninstrumented.
  return traced(
    'http.trpc',
    { 'http.request.method': req.method, 'url.path': new URL(req.url).pathname },
    async (span) => {
      // Client IP for rate limiting. Behind the shared nginx the app is only
      // reachable through the proxy, which appends the peer it saw as the RIGHTMOST
      // X-Forwarded-For hop; the leftmost is attacker-controlled. clientIpFromXff
      // takes the rightmost so a forged header can't dodge per-IP limits.
      const ip = clientIpFromXff(req.headers.get('x-forwarded-for'));
      const { ctx, mintedSid } = buildContext(req.headers.get('cookie'), ip);

      const res = await fetchRequestHandler({
        endpoint: '/api/trpc',
        req,
        router: appRouter,
        createContext: () => ctx,
        // Errors on the HTTP path were never logged server-side before this.
        onError: ({ error, path, type }) => {
          span.addEvent('trpc.error', {
            'rpc.method': path ?? '<no-path>',
            'trpc.type': type,
            'trpc.error_code': error.code,
          });
          console.error(`[trpc.http] ${type} ${path ?? '<no-path>'} failed: ${error.code} ${error.message}`);
        },
      });

      span.setAttribute('http.response.status_code', res.status);
      if (mintedSid) {
        res.headers.append('Set-Cookie', sessionCookie(mintedSid));
        span.addEvent('session.minted');
      }
      return res;
    }
  );
}

export { handler as GET, handler as POST };
