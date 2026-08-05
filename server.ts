import { createServer } from 'node:http';
import { parse } from 'node:url';
import next from 'next';
import { WebSocketServer } from 'ws';
import { applyWSSHandler } from '@trpc/server/adapters/ws';
import { appRouter } from './src/server/trpc/root';
import { buildContext } from './src/server/trpc/context';

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
  const trpcHandler = applyWSSHandler({
    wss,
    router: appRouter,
    // WS clients already carry the session cookie from their first HTTP hit;
    // just read it — no cookie to mint here, so drop mintedSid.
    createContext: ({ req }) => buildContext(req.headers.cookie).ctx,
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
