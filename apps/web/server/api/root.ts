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
import { captureRouter } from "./routers/capture";
import { emailRouter } from "./routers/email";
import { calendlyRouter } from "./routers/calendly";

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
  capture: captureRouter,
  email: emailRouter,
  calendly: calendlyRouter,
});

export type AppRouter = typeof appRouter;
