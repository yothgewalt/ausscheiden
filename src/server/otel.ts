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
const TRACER_NAME = 'ausscheiden';

/** True if this finished span belongs to a health-check request. */
export function isHealthSpan(span: Pick<ReadableSpan, 'name' | 'attributes'>): boolean {
  const route = span.attributes['http.route'] ?? span.attributes['next.route'];
  return route === HEALTH_ROUTE || span.name.endsWith(HEALTH_ROUTE);
}

type SpanShape = Pick<ReadableSpan, 'name' | 'attributes'> & {
  instrumentationScope?: { name?: string };
};

/**
 * Ours, identified POSITIVELY by the tracer that created it.
 *
 * The inverse test — "does it carry a `next.*` attribute" — fails open: any Next
 * span that has not had its attributes set yet would sail through as if it were
 * ours. Scope is assigned when the span is created and never changes.
 */
function isOwnSpan(span: SpanShape): boolean {
  return span.instrumentationScope?.name === TRACER_NAME;
}

/**
 * The Next-emitted spans worth keeping: the request lifecycle of an `/api/*`
 * call. Nothing else Next emits describes the API.
 *
 * BOTH are required, not just the root. The real parent chain is
 * `BaseServer.handleRequest → AppRouteRouteHandlers.runHandler → http.trpc`, so
 * dropping the middle one strands every span this app creates — Jaeger would
 * render the root and our subtree as two disconnected pieces of the same trace.
 */
const API_SPAN_TYPES = new Set(['BaseServer.handleRequest', 'AppRouteRouteHandlers.runHandler']);

function isApiRequestSpan(span: SpanShape): boolean {
  const type = span.attributes['next.span_type'];
  if (typeof type !== 'string' || !API_SPAN_TYPES.has(type)) return false;
  const route = span.attributes['http.route'] ?? span.attributes['next.route'];
  return typeof route === 'string' && route.startsWith('/api/');
}

/**
 * Keep API traces, drop page renders.
 *
 * Registering a global provider switches on Next's OWN instrumentation, and
 * there is no way to turn it off — `NEXT_OTEL_VERBOSE=1` only adds MORE spans,
 * and `NEXT_OTEL_FETCH_DISABLED=1` covers just the fetch span (Next 16
 * open-telemetry guide). So every page load was emitting `render route (app) /`,
 * `resolve page components`, `resolve segment modules`, `generateMetadata` and
 * `start response` — the framework rendering itself, which says nothing about
 * the API and buries the traces that do.
 *
 * The rule: keep everything this app instrumented by hand, plus the two request
 * lifecycle spans of an `/api/*` call, minus the health poll. A page render
 * therefore exports NOTHING, and an API call exports the full chain:
 *   POST /api/trpc/[trpc]
 *     └ executing api route (app) /api/trpc/[trpc]
 *         └ http.trpc
 *             └ trpc.<procedure>
 *                 └ redis.* / db.transaction.* / rdcw.* / storage.*
 *
 * Applied at EXPORT rather than in a Sampler because a Sampler cannot see the
 * route: Next opens the span as `BaseServer.handleRequest` with no attributes
 * and only later calls updateName() + setAttribute('http.route', …). Measured,
 * not assumed. By export time the span is final.
 */
export function shouldExport(span: SpanShape): boolean {
  if (isOwnSpan(span)) return true;
  return isApiRequestSpan(span) && !isHealthSpan(span);
}

class ApiOnlyExporter implements SpanExporter {
  constructor(private readonly inner: SpanExporter) {}

  export(spans: ReadableSpan[], done: (result: ExportResult) => void): void {
    const kept = spans.filter(shouldExport);
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
    spanProcessors: [new BatchSpanProcessor(new ApiOnlyExporter(new OTLPTraceExporter()))],
  });
  provider.register();

  // Batched spans live in memory until the next tick; flush them or the last
  // trace before a deploy — usually the interesting one — is lost.
  process.on('SIGTERM', () => {
    provider.shutdown().catch(() => {});
  });
}

// Same constant the exporter filters on — they must never drift, or every span
// this app creates would be silently dropped as "not ours".
const tracer = trace.getTracer(TRACER_NAME);

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

  // Next instruments ITSELF the moment a global provider exists and offers no
  // way to switch that off, so this exporter filter is the only thing standing
  // between Jaeger and a flood of page-render spans. Exercise it against the
  // exact shapes Next 16 documents (open-telemetry guide, "Default Spans").
  const exported: string[] = [];
  const sink: SpanExporter = {
    export: (spans, cb) => {
      exported.push(...spans.map((s) => s.name));
      cb({ code: ExportResultCode.SUCCESS });
    },
    shutdown: () => Promise.resolve(),
  };
  const filtered = new ApiOnlyExporter(sink);
  /** A span Next emitted: foreign scope + the next.span_type it documents. */
  const nx = (name: string, spanType: string, attributes: Record<string, string> = {}) =>
    ({
      name,
      attributes: { ...attributes, 'next.span_type': spanType },
      instrumentationScope: { name: 'next.js' },
      spanContext: () => ({ traceId: 't' }),
    }) as unknown as ReadableSpan;
  /** A span this app created through traced(). */
  const own = (name: string) =>
    ({
      name,
      attributes: {},
      instrumentationScope: { name: TRACER_NAME },
      spanContext: () => ({ traceId: 't' }),
    }) as unknown as ReadableSpan;

  filtered.export(
    [
      // A page load: root plus the render machinery. ALL of it must go.
      nx('GET /', 'BaseServer.handleRequest', { 'http.route': '/' }),
      nx('render route (app) /', 'AppRender.getBodyResult', { 'next.route': '/' }),
      nx('resolve page components', 'NextNodeServer.findPageComponents', { 'next.route': '/' }),
      nx('resolve segment modules', 'NextNodeServer.getLayoutOrPageModule', {}),
      nx('generateMetadata /layout', 'ResolveMetadata.generateMetadata', {}),
      nx('start response', 'NextNodeServer.startResponse'),
      // The health poll, every 10s per the compose healthcheck.
      nx('GET /api/health', 'BaseServer.handleRequest', { 'http.route': '/api/health' }),
      // A real API call: keep the root, drop Next's handler wrapper, keep ours.
      nx('POST /api/trpc/[trpc]', 'BaseServer.handleRequest', { 'http.route': '/api/trpc/[trpc]' }),
      nx('executing api route (app) /api/trpc/[trpc]', 'AppRouteRouteHandlers.runHandler', {
        'next.route': '/api/trpc/[trpc]',
      }),
      own('http.trpc'),
      own('trpc.slips.verify'),
      own('rdcw.inquiry'),
      own('redis.rateLimitHit'),
      // A tRPC subscription over the WebSocket never touches Next's HTTP layer.
      own('trpc.tables.onLockChange'),
    ],
    () => {}
  );

  ok(!exported.some((n) => n.includes('render route')), 'page render spans are dropped');
  ok(!exported.includes('resolve page components'), 'page component resolution is dropped');
  ok(!exported.includes('resolve segment modules'), 'segment module loading is dropped');
  ok(!exported.some((n) => n.startsWith('generateMetadata')), 'metadata generation is dropped');
  ok(!exported.includes('start response'), 'the zero-length start-response span is dropped');
  ok(!exported.includes('GET /'), 'the page request root is dropped (not an /api/ route)');
  ok(!exported.some((n) => n.includes('/api/health')), 'the health poll is still dropped');
  ok(exported.includes('POST /api/trpc/[trpc]'), 'the API request root SURVIVES, so traces have a root');
  ok(
    exported.includes('executing api route (app) /api/trpc/[trpc]'),
    "Next's API route-handler span survives — it is http.trpc's parent, and dropping it would orphan every span below"
  );
  ok(
    ['http.trpc', 'trpc.slips.verify', 'rdcw.inquiry', 'redis.rateLimitHit', 'trpc.tables.onLockChange']
      .every((n) => exported.includes(n)),
    `every hand-instrumented span survives (got ${JSON.stringify(exported)})`
  );
  ok(exported.length === 7, `exactly 7 spans kept, got ${exported.length}: ${JSON.stringify(exported)}`);

  // A Next span whose attributes were never populated must NOT be mistaken for
  // ours — the filter identifies our spans by scope, not by absence of next.*.
  ok(
    !shouldExport({ name: 'BaseServer.handleRequest', attributes: {}, instrumentationScope: { name: 'next.js' } }),
    'an attribute-less Next span is still dropped (scope, not attributes, decides)'
  );

  const sid = crypto.randomUUID();
  const h = sessionHash(sid);
  ok(!h.includes(sid) && h.length === 8, 'sessionHash never leaks the raw session id');
  ok(sessionHash(sid) === h, 'sessionHash is stable for the same session');
  ok(sessionHash(crypto.randomUUID()) !== h, 'different sessions hash differently');

  console.log('all otel self-checks passed');
  process.exit(0);
}
