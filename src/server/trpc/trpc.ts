import { initTRPC } from '@trpc/server';
import superjson from 'superjson';
import { db } from '../db';

export interface Context {
  db: typeof db;
  sessionId: string;
}

const t = initTRPC.context<Context>().create({ transformer: superjson });

export const router = t.router;
export const publicProcedure = t.procedure;
