'use client';

import React, { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createWSClient, wsLink, httpBatchLink, splitLink } from '@trpc/client';
import superjson from 'superjson';
import { trpc } from '../lib/trpc';

export function TRPCProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Freshness is push-driven: the tables.onLockChange WS subscription
            // invalidates tables.list + zoneAvailability on every lock change, and
            // invalidate() forces a refetch regardless of staleTime. A bounded 30s
            // (not Infinity) still lets the individual-tier badge — which has NO WS
            // invalidation, since individual confirms emit no lock event — self-heal
            // on remount. refetchOnReconnect stays default (true) as the outage net.
            staleTime: 30_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  const [trpcClient] = useState(() => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3000/api/trpc';
    const wsClient = createWSClient({ url: wsUrl });
    return trpc.createClient({
      links: [
        splitLink({
          condition: (op) => op.type === 'subscription',
          true: wsLink({ client: wsClient, transformer: superjson }),
          false: httpBatchLink({ url: '/api/trpc', transformer: superjson }),
        }),
      ],
    });
  });

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
