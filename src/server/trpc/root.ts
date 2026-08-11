import { router } from './trpc';
import { tablesRouter } from './routers/tables';
import { slipsRouter } from './routers/slips';
import { adminRouter } from './routers/admin';

export const appRouter = router({
  tables: tablesRouter,
  slips: slipsRouter,
  admin: adminRouter,
});

export type AppRouter = typeof appRouter;
