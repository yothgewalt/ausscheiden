import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { event } from '../otel';

const client = postgres(process.env.DATABASE_URL!);

export const db = drizzle(client, {
  schema,
  // Drizzle's logger fires BEFORE the query and has no completion hook, so there
  // is nothing to time — these are span EVENTS, not spans, attached to whichever
  // procedure span is active.
  //
  // Params are dropped deliberately: the SQL text is parameterized ($1, $2…) so
  // it is safe to record, but the params array is exactly where buyerName,
  // phone, email and slipImage live. Never log it.
  logger: { logQuery: (query) => event('db.query', { 'db.statement': query }) },
});
export type DB = typeof db;
