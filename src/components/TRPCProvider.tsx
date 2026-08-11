'use client';

import React, { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createWSClient, wsLink, httpBatchLink, splitLink } from '@trpc/client';
import superjson from 'superjson';
import { trpc } from '../lib/trpc';

/**
 * @trpc/client's httpBatchLink calls `res.json()` with no `res.ok` and no
 * content-type check, so anything the reverse proxy answers with — an nginx 504
 * page, a 413, a captive portal — became
 * `Unexpected token '<', "<html> <h"... is not valid JSON` rendered verbatim in
 * the payment modal's Thai error banner. Intercept before tRPC sees the body and
 * throw real copy instead; the message survives TRPCClientError.from unchanged.
 *
 * Only non-JSON responses are touched — tRPC's own error envelopes are JSON and
 * pass straight through, so procedure-level errors keep their server message.
 */
const PROXY_ERROR_TH: Record<number, string> = {
  413: 'ไฟล์สลิปมีขนาดใหญ่เกินไป กรุณาถ่ายภาพใหม่หรือย่อขนาดรูปแล้วลองอีกครั้ง',
  429: 'มีการใช้งานหนาแน่น กรุณารอสักครู่แล้วลองใหม่อีกครั้ง',
  502: 'เซิร์ฟเวอร์ไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่อีกครั้ง',
  503: 'เซิร์ฟเวอร์ไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่อีกครั้ง',
  504: 'เซิร์ฟเวอร์ใช้เวลาตอบกลับนานเกินไป กรุณาลองใหม่อีกครั้ง',
};

const jsonOnlyFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const res = await fetch(input, init);
  if (!res.headers.get('content-type')?.includes('application/json')) {
    throw new Error(
      PROXY_ERROR_TH[res.status] ??
        `เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ (HTTP ${res.status}) กรุณาลองใหม่อีกครั้ง`
    );
  }
  return res;
};

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
          false: httpBatchLink({ url: '/api/trpc', transformer: superjson, fetch: jsonOnlyFetch }),
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
