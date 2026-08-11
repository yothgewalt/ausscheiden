import { initTRPC, TRPCError } from '@trpc/server';
import { SpanStatusCode } from '@opentelemetry/api';
import superjson from 'superjson';
import { db } from '../db';
import { traced, sessionHash } from '../otel';

export interface Context {
  db: typeof db;
  sessionId: string;
  ip: string; // client IP (from x-forwarded-for behind nginx) for rate limiting
  isAdmin: boolean; // backoffice cookie verified against ADMIN_TOKEN (see server/admin.ts)
}

const t = initTRPC.context<Context>().create({ transformer: superjson });

/**
 * One span per procedure call, for every procedure, on BOTH transports — HTTP
 * via the Next route handler and WebSocket via applyWSSHandler. This middleware
 * is the only place that sees both, which is why tracing lives here and not in
 * the route handler (which would miss tables.onLockChange entirely).
 *
 * /api/health is not a tRPC procedure, so it is excluded by construction.
 *
 * Two details worth keeping:
 *  - next() RETURNS `{ok:false, error}` instead of throwing, so traced() would
 *    otherwise record a rejected procedure as a success. Handled explicitly.
 *  - for the subscription (tables.onLockChange) the resolver is an async
 *    generator, so next() resolves when the generator is CREATED. The span
 *    measures establishment, not the socket's multi-hour lifetime.
 */
const tracing = t.middleware(({ ctx, path, type, next }) =>
  traced(
    `trpc.${path}`,
    {
      'rpc.system': 'trpc',
      'rpc.method': path,
      'trpc.type': type,
      // NEVER ctx.sessionId — it is a bearer capability. See otel.sessionHash.
      'session.hash': sessionHash(ctx.sessionId),
      'client.ip': ctx.ip,
    },
    async (span) => {
      const result = await next();
      if (!result.ok) {
        span.recordException(result.error);
        span.setAttribute('trpc.error_code', result.error.code);
        span.setStatus({ code: SpanStatusCode.ERROR, message: result.error.message });
      }
      return result;
    }
  )
);

export const router = t.router;
export const publicProcedure = t.procedure.use(tracing);

/**
 * Backoffice-only procedures. This is the real security boundary — the
 * /backoffice pages redirect on a missing cookie for UX, but every byte of
 * buyer data leaves through here, so the check must live on the procedure.
 * Traced like everything else, and a rejection surfaces as an ERROR span with
 * code UNAUTHORIZED.
 */
export const adminProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.isAdmin) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'ต้องเข้าสู่ระบบผู้ดูแลก่อน' });
  }
  return next();
});
