import { z } from "zod";
import { router, venueProcedure } from "@/lib/trpc/server";
import { TRPCError } from "@trpc/server";

export const analyticsRouter = router({
  // Source ROI breakdown
  sourceROI: venueProcedure
    .input(z.object({ yearFrom: z.number().int().optional(), yearTo: z.number().int().optional() }))
    .query(async ({ ctx, input }) => {
      let query = ctx.supabase
        .from("clients")
        .select("resolved_source, status, revenue_cents, review_star_rating, review_left, referrals_generated, complexity_score")
        .eq("venue_id", ctx.venueId)
        .not("resolved_source", "is", null);

      if (input.yearFrom) query = query.gte("event_year", input.yearFrom);
      if (input.yearTo) query = query.lte("event_year", input.yearTo);

      const { data, error } = await query;
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

      // Aggregate by source
      const sourceMap = new Map<string, {
        inquiryCount: number;
        bookedCount: number;
        totalRevenue: number;
        revenueCount: number;
        totalComplexity: number;
        complexityCount: number;
        reviewCount: number;
        totalReferrals: number;
      }>();

      for (const client of data ?? []) {
        const source = client.resolved_source as string;
        if (!sourceMap.has(source)) {
          sourceMap.set(source, {
            inquiryCount: 0, bookedCount: 0,
            totalRevenue: 0, revenueCount: 0,
            totalComplexity: 0, complexityCount: 0,
            reviewCount: 0, totalReferrals: 0,
          });
        }
        const s = sourceMap.get(source)!;
        s.inquiryCount++;
        if (!["inquiry", "archived"].includes(client.status as string)) s.bookedCount++;
        if (client.revenue_cents) { s.totalRevenue += client.revenue_cents; s.revenueCount++; }
        if (client.complexity_score) { s.totalComplexity += client.complexity_score; s.complexityCount++; }
        if (client.review_left) s.reviewCount++;
        s.totalReferrals += client.referrals_generated ?? 0;
      }

      return Array.from(sourceMap.entries()).map(([source, stats]) => ({
        source,
        inquiryCount: stats.inquiryCount,
        bookedCount: stats.bookedCount,
        conversionRate: stats.inquiryCount > 0 ? stats.bookedCount / stats.inquiryCount : 0,
        avgRevenue: stats.revenueCount > 0 ? Math.round(stats.totalRevenue / stats.revenueCount) : null,
        avgComplexityScore: stats.complexityCount > 0 ? Math.round(stats.totalComplexity / stats.complexityCount) : null,
        reviewRate: stats.bookedCount > 0 ? stats.reviewCount / stats.bookedCount : 0,
        totalReferrals: stats.totalReferrals,
      }));
    }),

  // Inquiry day/time heatmap
  inquiryDayTime: venueProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from("inquiries")
      .select("day_of_week, hour_of_day")
      .eq("venue_id", ctx.venueId)
      .not("day_of_week", "is", null)
      .not("hour_of_day", "is", null);

    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

    // Build 7x24 heatmap
    const heatmap: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const row of data ?? []) {
      heatmap[row.day_of_week][row.hour_of_day]++;
    }
    return heatmap;
  }),

  // Timeline benchmarks (inquiry → tour → booking)
  timelineBenchmarks: venueProcedure.query(async ({ ctx }) => {
    const { data: clients, error } = await ctx.supabase
      .from("clients")
      .select("id, created_at, status")
      .eq("venue_id", ctx.venueId)
      .neq("status", "inquiry");

    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

    const { data: tours } = await ctx.supabase
      .from("tours")
      .select("client_id, scheduled_at, booking_date, booking_conversion_days")
      .eq("venue_id", ctx.venueId)
      .eq("completed", true);

    const tourMap = new Map(tours?.map((t) => [t.client_id, t]) ?? []);

    const conversionDays: number[] = [];
    for (const client of clients ?? []) {
      const tour = tourMap.get(client.id);
      if (tour?.booking_conversion_days) {
        conversionDays.push(tour.booking_conversion_days);
      }
    }

    conversionDays.sort((a, b) => a - b);
    const p = (arr: number[], pct: number) => arr[Math.floor(arr.length * pct)] ?? null;

    return {
      tourToBookingDays: {
        p25: p(conversionDays, 0.25),
        p50: p(conversionDays, 0.5),
        p75: p(conversionDays, 0.75),
        mean: conversionDays.length > 0
          ? Math.round(conversionDays.reduce((a, b) => a + b, 0) / conversionDays.length)
          : null,
        sampleSize: conversionDays.length,
      },
    };
  }),

  // Revenue by year/month
  revenueOverTime: venueProcedure
    .input(z.object({ years: z.number().int().default(3) }))
    .query(async ({ ctx, input }) => {
      const fromYear = new Date().getFullYear() - input.years + 1;

      const { data, error } = await ctx.supabase
        .from("clients")
        .select("event_year, event_month, revenue_cents")
        .eq("venue_id", ctx.venueId)
        .gte("event_year", fromYear)
        .not("revenue_cents", "is", null)
        .not("event_year", "is", null);

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

      const monthMap = new Map<string, { totalRevenue: number; count: number }>();
      for (const row of data ?? []) {
        const key = `${row.event_year}-${String(row.event_month).padStart(2, "0")}`;
        const existing = monthMap.get(key) ?? { totalRevenue: 0, count: 0 };
        existing.totalRevenue += row.revenue_cents ?? 0;
        existing.count++;
        monthMap.set(key, existing);
      }

      return Array.from(monthMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([period, stats]) => ({
          period,
          totalRevenue: stats.totalRevenue,
          eventCount: stats.count,
          avgRevenue: Math.round(stats.totalRevenue / stats.count),
        }));
    }),
});
