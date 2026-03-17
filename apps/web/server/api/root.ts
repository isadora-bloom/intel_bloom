import { router } from "@/lib/trpc/server";
import { venuesRouter } from "./routers/venues";
import { clientsRouter } from "./routers/clients";
import { inquiriesRouter } from "./routers/inquiries";
import { analyticsRouter } from "./routers/analytics";
import { macroRouter } from "./routers/macro";
import { annotationsRouter } from "./routers/annotations";
import { matchingRouter } from "./routers/matching";
import { uploadsRouter } from "./routers/uploads";
import { vendorsRouter } from "./routers/vendors";
import { insightsRouter } from "./routers/insights";

export const appRouter = router({
  venues: venuesRouter,
  clients: clientsRouter,
  inquiries: inquiriesRouter,
  analytics: analyticsRouter,
  macro: macroRouter,
  annotations: annotationsRouter,
  matching: matchingRouter,
  uploads: uploadsRouter,
  vendors: vendorsRouter,
  insights: insightsRouter,
});

export type AppRouter = typeof appRouter;
