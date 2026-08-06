import { createServer } from 'node:http';
import { parse } from 'node:url';
import next from 'next';
import { WebSocketServer } from 'ws';
import { applyWSSHandler } from '@trpc/server/adapters/ws';
import { appRouter } from './src/server/trpc/root';
import { buildContext, clientIpFromXff } from './src/server/trpc/context';
import { releaseSelectingForSession } from './src/server/redis';
import { SessionPresence } from './src/server/presence';

const port = parseInt(process.env.PORT || '3000', 10);
const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  // getUpgradeHandler() requires prepare() to have run — acquire it here, not at module load.
  const upgrade = app.getUpgradeHandler();
  const server = createServer((req, res) => handle(req, res));

  // tRPC subscriptions only. Next's own HMR socket (/_next/*) is left untouched.
  const wss = new WebSocketServer({ noServer: true });

  // The WS connection is the client's liveness signal. When a session's last
  // socket drops (browser quit) and stays gone past the grace window, free its
  // pre-payment 'selecting' locks so the table doesn't sit greyed-out for the
  // full 10-min TTL. Grace absorbs reloads/reconnects; pending_payment is spared.
  const presence = new SessionPresence(10_000, (sessionId) => {
    releaseSelectingForSession(sessionId).catch((e) =>
      console.error(`[presence] release failed for ${sessionId}: ${e?.message || e}`),
    );
  });

  const trpcHandler = applyWSSHandler({
    wss,
    router: appRouter,
    // WS clients already carry the session cookie from their first HTTP hit;
    // just read it — no cookie to mint here, so drop mintedSid.
    createContext: ({ req }) => {
      // Rightmost XFF hop (see clientIpFromXff) — the address the trusted proxy
      // saw, not the client-forgeable leftmost. Fall back to the raw socket peer.
      const xff = req.headers['x-forwarded-for'];
      const ip = clientIpFromXff(
        Array.isArray(xff) ? xff.join(',') : xff,
        req.socket.remoteAddress || 'unknown'
      );
      return buildContext(req.headers.cookie, ip).ctx;
    },
  });

  // Bind each socket to its session so presence can refcount tabs and clean up.
  wss.on('connection', (ws, req) => {
    const sid = buildContext(req.headers.cookie).ctx.sessionId;
    presence.connect(sid, ws);
    ws.on('close', () => presence.disconnect(sid, ws));
  });

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = parse(req.url || '');
    if (pathname === '/api/trpc') {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    } else {
      // Next's HMR socket (/_next/webpack-hmr etc.) — hand back to Next.
      upgrade(req, socket, head);
    }
  });

  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port} (ws /api/trpc) — ${dev ? 'dev' : 'prod'}`);
  });

  process.on('SIGTERM', () => {
    trpcHandler.broadcastReconnectNotification();
    wss.close();
    server.close();
  });
});
