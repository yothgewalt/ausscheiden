import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter } from '../../../../server/trpc/root';
import { buildContext, clientIpFromXff, sessionCookie } from '../../../../server/trpc/context';

// Queries + mutations ride HTTP here; subscriptions ride the WS path (server.ts).
async function handler(req: Request) {
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
  });

  if (mintedSid) {
    res.headers.append('Set-Cookie', sessionCookie(mintedSid));
  }
  return res;
}

export { handler as GET, handler as POST };
