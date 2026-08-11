// OpenTelemetry bootstrap + the one span helper every call site uses.
//
// MANUAL SPANS ONLY — no auto-instrumentation. It relies on require-hook
// monkey-patching that is unreliable under Bun, and none of the shipped
// instrumentations match this stack anyway: ioredis is v6 (they target 4/5),
// Drizzle runs on postgres-js (not instrumentation-pg), and rdcw.ts uses Bun's
// native fetch (not undici). AsyncLocalStorage — the one primitive context
// propagation actually needs — is verified working under Bun.
//
// Import this FIRST in server.ts, before `next`, so the global provider exists
// before anything can start a span. One registration covers both transports
// (Next route handlers and the tRPC WebSocket) since it is all one process.

import { createHash } from 'node:crypto';
import { trace, SpanStatusCode, type Attributes, type Span } from '@opentelemetry/api';
import {
  NodeTracerProvider,
  BatchSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-node';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

/**
 * Tracing is opt-in via OTEL_EXPORTER_OTLP_ENDPOINT (compose points it at
 * http://jaeger:4318). Unset ⇒ register NOTHING: with no global provider the
 * API hands back non-recording spans, so every traced() call below stays
 * correct and costs ~nothing. That is what keeps `bun run dev` without Jaeger
 * from either breaking or spamming export failures.
 */
export const tracingEnabled = Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT);

const HEALTH_ROUTE = '/api/health';

/** True if this finished span belongs to a health-check request. */
export function isHealthSpan(span: Pick<ReadableSpan, 'name' | 'attributes'>): boolean {
  const route = span.attributes['http.route'] ?? span.attributes['next.route'];
  return route === HEALTH_ROUTE || span.name.endsWith(HEALTH_ROUTE);
}

/**
 * Drop health-check traces at EXPORT time.
 *
 * Not a Sampler, deliberately. Registering a global provider switches on Next's
 * OWN request instrumentation, which traces every `/api/health` poll — excluded
 * by requirement, and at one poll per 10s (see the compose healthcheck) it would
 * drown the traces that matter. But a Sampler cannot see the route: Next opens
 * the span as `BaseServer.handleRequest` with NO attributes and only later calls
 * updateName('GET /api/health') + setAttribute('http.route', …). Measured, not
 * assumed. By export time the span is final, so that is where this belongs.
 *
 * Filtering is by TRACE id rather than per span, because Next nests a
 * `start response` span under the request that carries no route of its own —
 * dropping only the spans that name the route would strand it as an orphan.
 */
class DropHealthChecksExporter implements SpanExporter {
  // Health traces are ~4 spans that end microseconds apart, so they land in one
  // batch in practice; this set only catches stragglers. Bounded so it can never
  // grow into a leak.
  private healthTraces = new Set<string>();

  constructor(private readonly inner: SpanExporter) {}

  export(spans: ReadableSpan[], done: (result: ExportResult) => void): void {
    for (const s of spans) {
      if (isHealthSpan(s)) this.healthTraces.add(s.spanContext().traceId);
    }
    const kept = spans.filter((s) => !this.healthTraces.has(s.spanContext().traceId));
    if (this.healthTraces.size > 256) this.healthTraces.clear();
    if (kept.length === 0) {
      done({ code: ExportResultCode.SUCCESS });
      return;
    }
    this.inner.export(kept, done);
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }
}

if (tracingEnabled) {
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'ausscheiden',
    }),
    // No url here on purpose — the exporter reads OTEL_EXPORTER_OTLP_ENDPOINT
    // itself and appends `v1/traces`, which keeps us on the OTLP env spec.
    spanProcessors: [new BatchSpanProcessor(new DropHealthChecksExporter(new OTLPTraceExporter()))],
  });
  provider.register();

  // Batched spans live in memory until the next tick; flush them or the last
  // trace before a deploy — usually the interesting one — is lost.
  process.on('SIGTERM', () => {
    provider.shutdown().catch(() => {});
  });
}

const tracer = trace.getTracer('ausscheiden');

/**
 * Run `fn` inside a span named `name`.
 *
 * Records the outcome: OK on return; on throw it records the exception, sets
 * ERROR status with the message, and **re-throws** — instrumentation must never
 * swallow a failure. The span always ends.
 *
 * Never pass PII in `attributes` (buyerName / phone / email / slipImage) or a
 * raw sessionId — see sessionHash. Anyone who can read Jaeger reads these.
 */
export function traced<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      span.end();
    }
  });
}

/** Add an event to the span currently in context. No-op when nothing is active. */
export function event(name: string, attributes?: Attributes): void {
  trace.getActiveSpan()?.addEvent(name, attributes);
}

/**
 * A session id is a bearer capability — confirmBooking authorizes on it — so it
 * must NEVER reach a span. This digest is enough to follow one buyer's journey
 * across traces without handing impersonation to anyone who can read Jaeger.
 */
export function sessionHash(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex').slice(0, 8);
}

// ── self-check: bun src/server/otel.ts ────────────────────────────────────
// Runs against an in-memory exporter, so it needs no Jaeger and no network.
if ((import.meta as { main?: boolean }).main) {
  const { InMemorySpanExporter, SimpleSpanProcessor } = await import('@opentelemetry/sdk-trace-node');
  const { NodeTracerProvider: P } = await import('@opentelemetry/sdk-trace-node');

  const memory = new InMemorySpanExporter();
  // `tracer` above is a ProxyTracer until a global provider exists, so
  // registering here still binds it.
  new P({ spanProcessors: [new SimpleSpanProcessor(memory)] }).register();

  const ok = (c: boolean, msg: string) => {
    if (!c) throw new Error(`FAIL: ${msg}`);
    console.log(`ok: ${msg}`);
  };

  ok((await traced('happy', { a: 1 }, async () => 42)) === 42, 'traced returns the value');

  const boom = new Error('kaboom');
  let rethrown: unknown;
  try {
    await traced('sad', {}, async () => {
      throw boom;
    });
  } catch (e) {
    rethrown = e;
  }
  ok(rethrown === boom, 'traced re-throws the original error (never swallows)');

  // nesting: a span started inside traced() must parent to it, which is the
  // whole reason AsyncLocalStorage has to work under Bun.
  await traced('parent', {}, async () => {
    await traced('child', {}, async () => undefined);
  });

  const spans = memory.getFinishedSpans();
  const byName = (n: string) => spans.find((s) => s.name === n)!;

  ok(byName('happy').status.code === SpanStatusCode.OK, 'success sets OK status');
  ok(byName('sad').status.code === SpanStatusCode.ERROR, 'failure sets ERROR status');
  ok(byName('sad').status.message === 'kaboom', 'failure status carries the message');
  ok(byName('sad').events.some((e) => e.name === 'exception'), 'failure records an exception event');
  ok(byName('happy').attributes.a === 1, 'attributes land on the span');
  ok(
    byName('child').parentSpanContext?.spanId === byName('parent').spanContext().spanId,
    'nested span parents correctly (AsyncLocalStorage context works)'
  );

  // The health check must stay untraced. Next auto-instruments it the moment a
  // global provider exists, so this exporter filter is the only thing keeping it
  // out — exercise it against the exact span shapes Next emits.
  const exported: string[] = [];
  const sink: SpanExporter = {
    export: (spans, cb) => {
      exported.push(...spans.map((s) => s.name));
      cb({ code: ExportResultCode.SUCCESS });
    },
    shutdown: () => Promise.resolve(),
  };
  const filtered = new DropHealthChecksExporter(sink);
  const mk = (name: string, traceId: string, attributes: Record<string, string> = {}) =>
    ({ name, attributes, spanContext: () => ({ traceId }) }) as unknown as ReadableSpan;

  filtered.export(
    [
      // one health request, exactly as Next nests it — note `start response`
      // carries no route, which is why filtering is by trace id.
      mk('GET /api/health', 'health1', { 'http.route': '/api/health' }),
      mk('executing api route (app) /api/health', 'health1', { 'next.route': '/api/health' }),
      mk('resolve page components', 'health1', { 'next.route': '/api/health' }),
      mk('start response', 'health1'),
      // and a real request that must survive
      mk('POST /api/trpc/[trpc]', 'real1', { 'http.route': '/api/trpc/[trpc]' }),
      mk('trpc.slips.verify', 'real1'),
      mk('rdcw.inquiry', 'real1'),
    ],
    () => {}
  );
  ok(!exported.some((n) => n.includes('/api/health')), 'no /api/health span is exported');
  ok(!exported.includes('start response'), 'the routeless health child is dropped too (by trace id)');
  ok(
    exported.length === 3 && exported.includes('trpc.slips.verify') && exported.includes('rdcw.inquiry'),
    `real spans survive untouched (got ${JSON.stringify(exported)})`
  );

  const sid = crypto.randomUUID();
  const h = sessionHash(sid);
  ok(!h.includes(sid) && h.length === 8, 'sessionHash never leaks the raw session id');
  ok(sessionHash(sid) === h, 'sessionHash is stable for the same session');
  ok(sessionHash(crypto.randomUUID()) !== h, 'different sessions hash differently');

  console.log('all otel self-checks passed');
  process.exit(0);
}
