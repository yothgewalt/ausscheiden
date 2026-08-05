import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter } from '../../../../server/trpc/root';
import { buildContext, SESSION_COOKIE } from '../../../../server/trpc/context';

// Queries + mutations ride HTTP here; subscriptions ride the WS path (server.ts).
async function handler(req: Request) {
  const { ctx, mintedSid } = buildContext(req.headers.get('cookie'));

  const res = await fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: () => ctx,
  });

  if (mintedSid) {
    res.headers.append(
      'Set-Cookie',
      `${SESSION_COOKIE}=${mintedSid}; Path=/; SameSite=Lax; Max-Age=86400`,
    );
  }
  return res;
}

export { handler as GET, handler as POST };
