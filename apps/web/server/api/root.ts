import { router, publicProcedure } from "@/lib/trpc/server";
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
import { touchpointsRouter } from "./routers/touchpoints";
import { socialRouter } from "./routers/social";
import { reviewsRouter } from "./routers/reviews";
import { campaignsRouter } from "./routers/campaigns";
import { lostDealsRouter } from "./routers/lost-deals";
import { enterpriseRouter } from "./routers/enterprise";
import { anomaliesRouter } from "./routers/anomalies";
import { forecastsRouter } from "./routers/forecasts";

export const appRouter = router({
  debug: publicProcedure.query(async ({ ctx }) => ({
    userId: ctx.user?.id ?? null,
    venueId: ctx.venueId,
    hasSession: !!ctx.user,
    appMetaVenueId: (ctx.user?.app_metadata?.venue_id as string | undefined) ?? null,
  })),
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
  touchpoints: touchpointsRouter,
  social: socialRouter,
  reviews: reviewsRouter,
  campaigns: campaignsRouter,
  lostDeals: lostDealsRouter,
  enterprise: enterpriseRouter,
  anomalies: anomaliesRouter,
  forecasts: forecastsRouter,
});

export type AppRouter = typeof appRouter;
