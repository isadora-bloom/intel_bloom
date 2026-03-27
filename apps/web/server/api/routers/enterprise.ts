import { z } from "zod";
import { router, venueProcedure } from "@/lib/trpc/server";
import { TRPCError } from "@trpc/server";
import { DEMO_ORG_ID } from "@/lib/demo";

/** Resolve the org ID — in demo mode use the demo org, otherwise look up from venue_users */
async function resolveOrgId(ctx: any): Promise<string | null> {
  if (ctx.isDemo && ctx.demoSession) {
    return ctx.demoSession.orgId || DEMO_ORG_ID;
  }
  const { data } = await ctx.db
    .from("venue_users")
    .select("organisation_id")
    .eq("user_id", ctx.user.id)
    .not("organisation_id", "is", null)
    .limit(1)
    .single();
  return data?.organisation_id ?? null;
}

/** Get all venue IDs + names for an org */
async function getOrgVenues(ctx: any, orgId: string): Promise<{ id: string; name: string; city: string | null; state: string | null; region: string | null }[]> {
  const { data } = await ctx.db
    .from("venues")
    .select("id, name, city, state, region")
    .eq("organisation_id", orgId);
  return data ?? [];
}

// ── helpers ───────────────────────────────────────────────────────────────────

function startOfYear() {
  return `${new Date().getFullYear()}-01-01`;
}

function startOf30DaysAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function startOf90DaysAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 90);
  return d.toISOString().slice(0, 10);
}

function startOfThisMonth() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-01`;
}

function startOfLastMonth() {
  const n = new Date();
  const d = new Date(n.getFullYear(), n.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function endOfLastMonth() {
  const n = new Date();
  const d = new Date(n.getFullYear(), n.getMonth(), 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Same month last year for inquiry trend
function startOfSameMonthLastYear() {
  const n = new Date();
  return `${n.getFullYear() - 1}-${String(n.getMonth() + 1).padStart(2, "0")}-01`;
}

function endOfSameMonthLastYear() {
  const n = new Date();
  const lastYear = n.getFullYear() - 1;
  const lastDayOfMonth = new Date(lastYear, n.getMonth() + 1, 0).getDate();
  return `${lastYear}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(lastDayOfMonth).padStart(2, "0")}`;
}

// ── enterprise router ─────────────────────────────────────────────────────────

export const enterpriseRouter = router({
  // ── getPortfolio ─────────────────────────────────────────────────────────
  // Returns all venues in the user's org with health + quick stats.
  getPortfolio: venueProcedure.query(async ({ ctx }) => {
    const orgId = await resolveOrgId(ctx);
    if (!orgId) return { venues: [], orgName: null };

    const { data: orgRow } = await ctx.db
      .from("organisations")
      .select("name")
      .eq("id", orgId)
      .single();

    const venues = await getOrgVenues(ctx, orgId);

    const thisMonth = startOfThisMonth();
    const lastMonthStart = startOfLastMonth();
    const lastMonthEnd = endOfLastMonth();
    const yearStart = startOfYear();

    // For each venue fetch health + client stats in parallel
    const venueResults = await Promise.all(
      venues.map(async (venue) => {
        const [healthResult, clientsResult] = await Promise.all([
          ctx.db
            .from("venue_health")
            .select("health_score, status, alerts, calculated_at")
            .eq("venue_id", venue.id)
            .order("calculated_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          ctx.db
            .from("clients")
            .select("status, revenue_cents, inquired_at")
            .eq("venue_id", venue.id),
        ]);

        const health = healthResult.data;
        const clients = clientsResult.data ?? [];

        // Status counts
        const statusCounts: Record<string, number> = {};
        for (const c of clients) {
          statusCounts[c.status] = (statusCounts[c.status] ?? 0) + 1;
        }

        // Revenue YTD (contracted + event_complete)
        const revenueYTD = clients
          .filter(
            (c) =>
              (c.status === "contracted" || c.status === "event_complete") &&
              c.inquired_at >= yearStart
          )
          .reduce((sum, c) => sum + (c.revenue_cents ?? 0), 0);

        // Inquiries this month
        const inquiriesThisMonth = clients.filter(
          (c) => c.inquired_at >= thisMonth
        ).length;

        // Inquiries last month
        const inquiriesLastMonth = clients.filter(
          (c) => c.inquired_at >= lastMonthStart && c.inquired_at <= lastMonthEnd
        ).length;

        // Booking rate: (contracted + event_complete + toured + held) / total
        const bookedStatuses = ["contracted", "event_complete", "held"];
        const booked = clients.filter((c) => bookedStatuses.includes(c.status)).length;
        const total = clients.length;
        const bookingRate = total > 0 ? booked / total : 0;

        return {
          id: venue.id,
          name: venue.name,
          city: venue.city,
          state: venue.state,
          region: venue.region,
          healthScore: health?.health_score ?? null,
          healthStatus: health?.status ?? null,
          alerts: (health?.alerts as string[] | null) ?? [],
          statusCounts,
          revenueYTD,
          inquiriesThisMonth,
          inquiriesLastMonth,
          bookingRate,
          totalClients: total,
        };
      })
    );

    // Sort: red first, then amber, then green, then null. Within same bucket sort by health score asc.
    const statusOrder: Record<string, number> = { red: 0, amber: 1, green: 2 };
    venueResults.sort((a, b) => {
      const ao = statusOrder[a.healthStatus ?? ""] ?? 3;
      const bo = statusOrder[b.healthStatus ?? ""] ?? 3;
      if (ao !== bo) return ao - bo;
      return (a.healthScore ?? 100) - (b.healthScore ?? 100);
    });

    return { venues: venueResults, orgName: orgRow?.name ?? null };
  }),

  // ── getCompanyMetrics ─────────────────────────────────────────────────────
  getCompanyMetrics: venueProcedure.query(async ({ ctx }) => {
    const orgId = await resolveOrgId(ctx);
    if (!orgId) return null;

    const orgVenues = await getOrgVenues(ctx, orgId);
    const venueIds = orgVenues.map((v) => v.id);
    if (venueIds.length === 0) return null;

    const yearStart = startOfYear();
    const thirtyDaysAgo = startOf30DaysAgo();
    const ninetyDaysAgo = startOf90DaysAgo();

    // All clients across org
    const { data: allClients } = await ctx.db
      .from("clients")
      .select("venue_id, status, revenue_cents, inquired_at, resolved_source, first_response_at, response_time_minutes")
      .in("venue_id", venueIds);

    const clients = allClients ?? [];

    // All venue health
    const healthResults = await Promise.all(
      venueIds.map((vid) =>
        ctx.db
          .from("venue_health")
          .select("venue_id, health_score, status")
          .eq("venue_id", vid)
          .order("calculated_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      )
    );
    const healthByVenue: Record<string, { health_score: number; status: string }> = {};
    for (const r of healthResults) {
      if (r.data) healthByVenue[r.data.venue_id] = r.data;
    }

    // Inquiries counts
    const inquiriesLast30 = clients.filter((c) => c.inquired_at >= thirtyDaysAgo).length;
    const inquiriesLast90 = clients.filter((c) => c.inquired_at >= ninetyDaysAgo).length;
    const inquiriesYTD = clients.filter((c) => c.inquired_at >= yearStart).length;

    // Revenue YTD
    const revenueYTD = clients
      .filter(
        (c) =>
          (c.status === "contracted" || c.status === "event_complete") &&
          c.inquired_at >= yearStart
      )
      .reduce((sum, c) => sum + (c.revenue_cents ?? 0), 0);

    // Total bookings YTD
    const bookedYTD = clients.filter(
      (c) =>
        ["contracted", "event_complete"].includes(c.status) &&
        c.inquired_at >= yearStart
    ).length;

    // Avg booking rate
    const total = clients.length;
    const booked = clients.filter((c) =>
      ["contracted", "event_complete", "held"].includes(c.status)
    ).length;
    const avgBookingRate = total > 0 ? booked / total : 0;

    // Avg response time (minutes)
    const withResponseTime = clients.filter(
      (c) => typeof c.response_time_minutes === "number"
    );
    const avgResponseTime =
      withResponseTime.length > 0
        ? withResponseTime.reduce((s, c) => s + (c.response_time_minutes ?? 0), 0) /
          withResponseTime.length
        : null;

    // Top channel
    const sourceCounts: Record<string, number> = {};
    for (const c of clients) {
      if (c.resolved_source) {
        sourceCounts[c.resolved_source] = (sourceCounts[c.resolved_source] ?? 0) + 1;
      }
    }
    const topChannel =
      Object.entries(sourceCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    // Month-by-month revenue for last 12 months
    const monthlyRevenue: Record<string, number> = {};
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      monthlyRevenue[key] = 0;
    }
    for (const c of clients) {
      if (
        (c.status === "contracted" || c.status === "event_complete") &&
        c.inquired_at
      ) {
        const key = c.inquired_at.slice(0, 7);
        if (key in monthlyRevenue) {
          monthlyRevenue[key] += c.revenue_cents ?? 0;
        }
      }
    }
    const monthlyRevenueArr = Object.entries(monthlyRevenue)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, revenue_cents]) => ({ month, revenue_cents }));

    // Per-venue comparison
    const orgVenueList = orgVenues ?? [];
    const venueMap: Record<string, (typeof orgVenueList)[0]> = {};
    for (const v of orgVenueList) venueMap[v.id] = v;

    const perVenue = venueIds.map((vid) => {
      const vc = clients.filter((c) => c.venue_id === vid);
      const vtotal = vc.length;
      const vbooked = vc.filter((c) =>
        ["contracted", "event_complete", "held"].includes(c.status)
      ).length;
      const vtouredStatuses = ["toured", "held", "contracted", "event_complete"];
      const vtouredCount = vc.filter((c) => vtouredStatuses.includes(c.status)).length;
      const vtourRate = vtotal > 0 ? vtouredCount / vtotal : 0;
      const vbookRate = vtotal > 0 ? vbooked / vtotal : 0;
      const vrevenue = vc
        .filter((c) => ["contracted", "event_complete"].includes(c.status))
        .reduce((s, c) => s + (c.revenue_cents ?? 0), 0);
      const vbookedCount = vc.filter((c) =>
        ["contracted", "event_complete"].includes(c.status)
      ).length;
      const avgRevenue = vbookedCount > 0 ? vrevenue / vbookedCount : 0;
      const health = healthByVenue[vid];

      return {
        venueId: vid,
        venueName: venueMap[vid]?.name ?? vid,
        inquiries: vtotal,
        tourRate: vtourRate,
        bookingRate: vbookRate,
        avgRevenueCents: Math.round(avgRevenue),
        healthScore: health?.health_score ?? null,
        healthStatus: health?.status ?? null,
      };
    });

    return {
      inquiriesLast30,
      inquiriesLast90,
      inquiriesYTD,
      revenueYTD,
      bookedYTD,
      avgBookingRate,
      avgResponseTime,
      topChannel,
      sourceCounts,
      monthlyRevenue: monthlyRevenueArr,
      perVenue,
    };
  }),

  // ── getTeamPerformance ───────────────────────────────────────────────────
  getTeamPerformance: venueProcedure.query(async ({ ctx }) => {
    const orgId = await resolveOrgId(ctx);
    if (!orgId) return { coordinators: [] };

    const orgVenues = await getOrgVenues(ctx, orgId);
    const venueIds = orgVenues.map((v) => v.id);
    if (venueIds.length === 0) return { coordinators: [] };

    const venueNameMap: Record<string, string> = {};
    for (const v of orgVenues) venueNameMap[v.id] = v.name;

    const { data: allClients } = await ctx.db
      .from("clients")
      .select(
        "venue_id, status, revenue_cents, assigned_coordinator, inquired_at, first_response_at, response_time_minutes"
      )
      .in("venue_id", venueIds);

    const clients = allClients ?? [];

    // Group by coordinator
    const coordinatorMap: Record<
      string,
      {
        name: string;
        venueIds: Set<string>;
        clients: typeof clients;
      }
    > = {};

    for (const c of clients) {
      const key = c.assigned_coordinator ?? "__unassigned__";
      if (!coordinatorMap[key]) {
        coordinatorMap[key] = {
          name: c.assigned_coordinator ?? "Unassigned",
          venueIds: new Set(),
          clients: [],
        };
      }
      coordinatorMap[key].venueIds.add(c.venue_id);
      coordinatorMap[key].clients.push(c);
    }

    const coordinators = Object.entries(coordinatorMap).map(([key, data]) => {
      const total = data.clients.length;
      const touredStatuses = ["toured", "held", "contracted", "event_complete"];
      const toured = data.clients.filter((c) => touredStatuses.includes(c.status)).length;
      const booked = data.clients.filter((c) =>
        ["contracted", "event_complete"].includes(c.status)
      ).length;
      const conversionRate = total > 0 ? booked / total : 0;

      const revenueClients = data.clients.filter((c) =>
        ["contracted", "event_complete"].includes(c.status)
      );
      const totalRevenue = revenueClients.reduce(
        (s, c) => s + (c.revenue_cents ?? 0),
        0
      );
      const avgRevenue = revenueClients.length > 0 ? totalRevenue / revenueClients.length : 0;

      const withResponseTime = data.clients.filter(
        (c) => typeof c.response_time_minutes === "number"
      );
      const avgResponseTime =
        withResponseTime.length > 0
          ? withResponseTime.reduce((s, c) => s + (c.response_time_minutes ?? 0), 0) /
            withResponseTime.length
          : null;

      return {
        coordinatorKey: key,
        name: data.name,
        venues: Array.from(data.venueIds).map((vid) => venueNameMap[vid] ?? vid),
        totalClients: total,
        toured,
        booked,
        conversionRate,
        avgRevenueCents: Math.round(avgRevenue),
        avgResponseTimeMinutes: avgResponseTime ? Math.round(avgResponseTime) : null,
        isUnassigned: key === "__unassigned__",
      };
    });

    // Sort: named coordinators by booking rate desc, unassigned at bottom
    coordinators.sort((a, b) => {
      if (a.isUnassigned) return 1;
      if (b.isUnassigned) return -1;
      return b.conversionRate - a.conversionRate;
    });

    return { coordinators };
  }),

  // ── getRegions ──────────────────────────────────────────────────────────
  getRegions: venueProcedure.query(async ({ ctx }) => {
    const orgId = await resolveOrgId(ctx);
    if (!orgId) return { regions: [], hasNoRegions: true };

    const venues = await getOrgVenues(ctx, orgId);
    const venueIds = venues.map((v) => v.id);

    if (venueIds.length === 0) return { regions: [], hasNoRegions: false };

    const venueRegionMap: Record<string, string | null> = {};
    for (const v of venues) venueRegionMap[v.id] = v.region ?? null;

    const { data: allClients } = await ctx.db
      .from("clients")
      .select("venue_id, status, revenue_cents, resolved_source")
      .in("venue_id", venueIds);

    const clients = allClients ?? [];

    const healthResults = await Promise.all(
      venueIds.map((vid) =>
        ctx.db
          .from("venue_health")
          .select("venue_id, health_score")
          .eq("venue_id", vid)
          .order("calculated_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      )
    );
    const healthScoreByVenue: Record<string, number> = {};
    for (const r of healthResults) {
      if (r.data) healthScoreByVenue[r.data.venue_id] = r.data.health_score;
    }

    // Group by region
    const regionMap: Record<
      string,
      { venueIds: Set<string>; clients: typeof clients }
    > = {};

    for (const v of venues) {
      const region = v.region ?? "__none__";
      if (!regionMap[region]) {
        regionMap[region] = { venueIds: new Set(), clients: [] };
      }
      regionMap[region].venueIds.add(v.id);
    }

    for (const c of clients) {
      const region = venueRegionMap[c.venue_id] ?? "__none__";
      regionMap[region]?.clients.push(c);
    }

    const hasNoRegions =
      venues.every((v) => !v.region) || Object.keys(regionMap).length === 0;

    const regions = Object.entries(regionMap)
      .filter(([key]) => key !== "__none__")
      .map(([region, data]) => {
        const totalInquiries = data.clients.length;
        const totalRevenue = data.clients
          .filter((c) => ["contracted", "event_complete"].includes(c.status))
          .reduce((s, c) => s + (c.revenue_cents ?? 0), 0);

        // Avg health score for venues in this region
        const venueHealthScores = Array.from(data.venueIds)
          .map((vid) => healthScoreByVenue[vid])
          .filter((s): s is number => typeof s === "number");
        const avgHealthScore =
          venueHealthScores.length > 0
            ? Math.round(
                venueHealthScores.reduce((a, b) => a + b, 0) / venueHealthScores.length
              )
            : null;

        // Top source
        const sourceCounts: Record<string, number> = {};
        for (const c of data.clients) {
          if (c.resolved_source) {
            sourceCounts[c.resolved_source] = (sourceCounts[c.resolved_source] ?? 0) + 1;
          }
        }
        const topSource =
          Object.entries(sourceCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

        return {
          region,
          venueCount: data.venueIds.size,
          totalInquiries,
          totalRevenueCents: totalRevenue,
          avgHealthScore,
          topSource,
        };
      });

    return { regions, hasNoRegions };
  }),

  // ── calculateVenueHealth ─────────────────────────────────────────────────
  calculateVenueHealth: venueProcedure
    .input(z.object({ venueId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { venueId } = input;
      const now = new Date();
      const yearStart = startOfYear();
      const ninetyDaysAgo = startOf90DaysAgo();
      const thisMonthStart = startOfThisMonth();
      const sameMonthLastYearStart = startOfSameMonthLastYear();
      const sameMonthLastYearEnd = endOfSameMonthLastYear();
      const priorYearStart = `${now.getFullYear() - 1}-01-01`;
      const priorYearSameDay = `${now.getFullYear() - 1}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

      const [clientsResult, reviewsResult] = await Promise.all([
        ctx.db
          .from("clients")
          .select("status, inquired_at, response_time_minutes, event_date")
          .eq("venue_id", venueId),
        ctx.db
          .from("reviews")
          .select("review_star_rating, published_at")
          .eq("venue_id", venueId)
          .gte("published_at", ninetyDaysAgo)
          .not("review_star_rating", "is", null),
      ]);

      const clients = clientsResult.data ?? [];
      const reviews = reviewsResult.data ?? [];

      // ── Booking pace score ──────────────────────────────────────────────
      // YTD bookings vs same point last year
      const ytdBooked = clients.filter(
        (c) =>
          ["contracted", "event_complete", "held"].includes(c.status) &&
          c.inquired_at >= yearStart
      ).length;

      const priorYearBooked = clients.filter(
        (c) =>
          ["contracted", "event_complete", "held"].includes(c.status) &&
          c.inquired_at >= priorYearStart &&
          c.inquired_at <= priorYearSameDay
      ).length;

      let bookingPaceScore = 50; // default if no prior year data
      if (priorYearBooked > 0) {
        const ratio = ytdBooked / priorYearBooked;
        bookingPaceScore = Math.min(100, Math.max(0, Math.round(ratio * 100)));
      }

      // ── Conversion score ────────────────────────────────────────────────
      const totalClients = clients.length;
      const bookedClients = clients.filter((c) =>
        ["contracted", "event_complete", "held"].includes(c.status)
      ).length;
      const bookingRate = totalClients > 0 ? bookedClients / totalClients : 0;
      const conversionScore = Math.min(100, Math.max(0, Math.round((bookingRate / 0.4) * 100)));

      // ── Response time score ─────────────────────────────────────────────
      const withRT = clients.filter(
        (c) => typeof c.response_time_minutes === "number" && c.response_time_minutes !== null
      );
      let responseTimeScore = 50;
      if (withRT.length > 0) {
        const avgRT =
          withRT.reduce((s, c) => s + (c.response_time_minutes ?? 0), 0) / withRT.length;
        // Under 30min = 100, over 240min = 0, linear
        responseTimeScore = Math.min(
          100,
          Math.max(0, Math.round(((240 - avgRT) / (240 - 30)) * 100))
        );
      }

      // ── Review trend score ──────────────────────────────────────────────
      let reviewTrendScore = 50; // default if no reviews
      if (reviews.length > 0) {
        const avgRating =
          reviews.reduce((s, r) => s + (r.review_star_rating ?? 0), 0) / reviews.length;
        // 5.0 = 100, 3.0 = 0, linear
        reviewTrendScore = Math.min(
          100,
          Math.max(0, Math.round(((avgRating - 3.0) / (5.0 - 3.0)) * 100))
        );
      }

      // ── Inquiry trend score ─────────────────────────────────────────────
      const thisMonthInquiries = clients.filter(
        (c) => c.inquired_at >= thisMonthStart
      ).length;

      const sameMonthLastYearInquiries = clients.filter(
        (c) =>
          c.inquired_at >= sameMonthLastYearStart &&
          c.inquired_at <= sameMonthLastYearEnd
      ).length;

      let inquiryTrendScore = 50;
      if (sameMonthLastYearInquiries > 0) {
        const change =
          (thisMonthInquiries - sameMonthLastYearInquiries) / sameMonthLastYearInquiries;
        // Up 10%+ = 100, down 30%+ = 0, linear between -30% and +10%
        inquiryTrendScore = Math.min(
          100,
          Math.max(0, Math.round(((change + 0.3) / (0.1 + 0.3)) * 100))
        );
      }

      // ── Composite ───────────────────────────────────────────────────────
      const healthScore = Math.round(
        bookingPaceScore * 0.3 +
          conversionScore * 0.2 +
          responseTimeScore * 0.15 +
          reviewTrendScore * 0.15 +
          inquiryTrendScore * 0.2
      );

      const status: "green" | "amber" | "red" =
        healthScore >= 80 ? "green" : healthScore >= 50 ? "amber" : "red";

      // ── Alerts ──────────────────────────────────────────────────────────
      const alerts: string[] = [];
      if (bookingPaceScore < 50)
        alerts.push("Booking pace is lagging vs. prior year");
      if (conversionScore < 40)
        alerts.push(`Low conversion rate (${Math.round(bookingRate * 100)}% vs 40% target)`);
      if (responseTimeScore < 40) {
        const avgRT =
          withRT.length > 0
            ? withRT.reduce((s, c) => s + (c.response_time_minutes ?? 0), 0) / withRT.length
            : null;
        alerts.push(
          `Slow average response time${avgRT ? ` (${Math.round(avgRT)} min avg)` : ""}`
        );
      }
      if (reviewTrendScore < 40 && reviews.length > 0)
        alerts.push("Recent review ratings are below 4.0");
      if (inquiryTrendScore < 40)
        alerts.push("Inquiries down vs. same month last year");

      const recommendations: string[] = [];
      if (bookingPaceScore < 60)
        recommendations.push("Run a targeted campaign to catch up on bookings");
      if (conversionScore < 50)
        recommendations.push("Review tour follow-up cadence to improve conversion");
      if (responseTimeScore < 50)
        recommendations.push("Set up auto-reply to reduce initial response time");
      if (reviewTrendScore < 50)
        recommendations.push("Reach out to recent clients to encourage positive reviews");

      // ── Upsert into venue_health ─────────────────────────────────────────
      const { data: upserted, error: upsertError } = await ctx.db
        .from("venue_health")
        .upsert(
          {
            venue_id: venueId,
            calculated_at: new Date().toISOString(),
            health_score: healthScore,
            status,
            booking_pace_score: bookingPaceScore,
            conversion_score: conversionScore,
            response_time_score: responseTimeScore,
            review_trend_score: reviewTrendScore,
            inquiry_trend_score: inquiryTrendScore,
            lost_deal_score: null,
            alerts,
            recommendations,
          },
          { onConflict: "venue_id" }
        )
        .select()
        .single();

      if (upsertError) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: upsertError.message,
        });
      }

      return upserted;
    }),
});
