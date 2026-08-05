import { router } from './trpc';
import { tablesRouter } from './routers/tables';
import { slipsRouter } from './routers/slips';

export const appRouter = router({
  tables: tablesRouter,
  slips: slipsRouter,
});

export type AppRouter = typeof appRouter;
