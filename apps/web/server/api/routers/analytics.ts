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

  // Funnel seasonality — monthly volume at each stage, averaged across years.
  // Reveals that saves peak in Feb, inquiries in Mar, tours in Apr/May, events in Sep/Oct.
  funnelSeasonality: venueProcedure
    .input(z.object({ years: z.number().int().min(1).max(5).default(3) }))
    .query(async ({ ctx, input }) => {
      const fromDate = new Date();
      fromDate.setFullYear(fromDate.getFullYear() - input.years);
      const fromIso = fromDate.toISOString().split("T")[0];

      const [savesRes, inquiriesRes, toursRes, eventsRes, weatherRes, trendsRes] =
        await Promise.all([
          // Discovery: saves + storefront visits from leads table
          ctx.supabase
            .from("leads")
            .select("source_date")
            .eq("venue_id", ctx.venueId)
            .in("touch_type", ["save", "storefront_visit"])
            .gte("source_date", fromIso)
            .not("source_date", "is", null),

          // Consideration: inquiries
          ctx.supabase
            .from("inquiries")
            .select("received_at")
            .eq("venue_id", ctx.venueId)
            .gte("received_at", fromIso),

          // Serious intent: tours from tours table
          ctx.supabase
            .from("tours")
            .select("scheduled_at")
            .eq("venue_id", ctx.venueId)
            .eq("completed", true)
            .gte("scheduled_at", fromIso),

          // Events: clients with event_date in range
          ctx.supabase
            .from("clients")
            .select("event_month, event_year, status, contracted_at, toured_at")
            .eq("venue_id", ctx.venueId)
            .gte("event_date", fromIso)
            .not("event_month", "is", null),

          // Weather seasonality for this venue
          ctx.supabase
            .from("venues")
            .select("noaa_station_id")
            .eq("id", ctx.venueId)
            .single()
            .then(async ({ data: v }) => {
              if (!v?.noaa_station_id) return { data: [] };
              return ctx.supabase
                .from("weather_monthly")
                .select("month, year, temp_max_f, precipitation_inches")
                .eq("noaa_station_id", v.noaa_station_id)
                .gte("year", fromDate.getFullYear())
                .order("year").order("month");
            }),

          // Google Trends — all tracked terms
          ctx.supabase
            .from("venues")
            .select("google_trends_metro")
            .eq("id", ctx.venueId)
            .single()
            .then(async ({ data: v }) => {
              if (!v?.google_trends_metro) return { data: [] };
              return ctx.supabase
                .from("macro_search_trends")
                .select("week_start, term, relative_interest")
                .eq("geo", v.google_trends_metro)
                .in("term", [
                  "wedding venue", "wedding venues",
                  "engagement ring", "how to propose",
                  "divorce lawyer",
                ])
                .gte("week_start", fromIso)
                .order("week_start");
            }),
        ]);

      const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

      // Helper: count by month (1-12) → monthly totals
      function countByMonth(dates: (string | null)[]): number[] {
        const counts = Array(12).fill(0);
        for (const d of dates) {
          if (!d) continue;
          const m = new Date(d).getMonth(); // 0-11
          if (m >= 0 && m < 12) counts[m]++;
        }
        return counts;
      }

      const savesByMonth = countByMonth(
        (savesRes.data ?? []).map((r: any) => r.source_date)
      );
      const inquiriesByMonth = countByMonth(
        (inquiriesRes.data ?? []).map((r: any) => r.received_at)
      );
      const toursByMonth = countByMonth(
        (toursRes.data ?? []).map((r: any) => r.scheduled_at)
      );

      // Event counts and split: events with held/contracted status = high-intent bookings
      const eventsByMonth = Array(12).fill(0);
      const bookedByMonth = Array(12).fill(0);
      const contractedByMonth = Array(12).fill(0);
      for (const c of eventsRes.data ?? []) {
        const m = (c.event_month as number) - 1; // convert 1-12 to 0-11
        if (m >= 0 && m < 12) {
          eventsByMonth[m]++;
          if (["contracted", "event_complete"].includes(c.status as string)) bookedByMonth[m]++;
        }
        if (c.contracted_at) {
          const cm = new Date(c.contracted_at).getMonth();
          contractedByMonth[cm]++;
        }
      }

      // Score helpers — computed from raw readings, not stored weather_score
      function rainScore(precipInches: number): number {
        // 0 = very dry (<0.5"), 10 = extremely wet (5"+)
        return Math.min(10, Math.round(precipInches * 2));
      }
      // Based on avg daily TMAX (afternoon peak ~3pm)
      // Ideal outdoor ceremony: 65–75°F at 3pm (centred on 70°F)
      function heatScore(tmax: number): number {
        if (tmax >= 65 && tmax <= 75) return 0;
        if (tmax < 65) return Math.min(10, Math.round((65 - tmax) / 4));
        return Math.min(10, Math.round((tmax - 75) / 2));
      }
      function linearTrend(vals: (number | null)[]): "rising" | "falling" | "stable" | null {
        const pts = vals.map((v, i) => ({ x: i, y: v })).filter(p => p.y !== null) as { x: number; y: number }[];
        if (pts.length < 3) return null;
        const n = pts.length;
        const sumX = pts.reduce((a, p) => a + p.x, 0);
        const sumY = pts.reduce((a, p) => a + p.y, 0);
        const sumXY = pts.reduce((a, p) => a + p.x * p.y, 0);
        const sumX2 = pts.reduce((a, p) => a + p.x * p.x, 0);
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        if (slope > 0.3) return "rising";
        if (slope < -0.3) return "falling";
        return "stable";
      }

      // Build year×month lookup from raw weather rows
      const allWeatherRows: any[] = (weatherRes as any).data ?? [];
      const years = [...new Set(allWeatherRows.map((w: any) => w.year as number))].sort();

      // weatherGrid[monthIndex] = { label, years: [{year, heatScore, rainScore, tempAvg, precip}], rainTrend, heatTrend }
      const mean = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

      // avgTemp here is TMAX (afternoon peak), labelled as "3pm avg" in UI
      const weatherByMonth: { avgTemp: number | null; avgPrecip: number | null; avgHeatScore: number | null; avgRainScore: number | null }[] =
        Array(12).fill(null).map(() => ({ avgTemp: null, avgPrecip: null, avgHeatScore: null, avgRainScore: null }));

      const weatherGrid = Array(12).fill(null).map((_, mi) => {
        const monthRows = allWeatherRows.filter((w: any) => (w.month as number) - 1 === mi);
        const byYear = years.map(yr => {
          const row = monthRows.find((w: any) => w.year === yr);
          const temp = row?.temp_max_f ?? null;
          const precip = row?.precipitation_inches ?? null;
          return {
            year: yr,
            tempAvg: temp !== null ? Math.round(temp) : null,
            precip: precip !== null ? Math.round(precip * 10) / 10 : null,
            heatScore: temp !== null ? heatScore(temp) : null,
            rainScore: precip !== null ? rainScore(precip) : null,
          };
        });

        const heatScores = byYear.map(y => y.heatScore).filter((v): v is number => v !== null);
        const rainScores = byYear.map(y => y.rainScore).filter((v): v is number => v !== null);
        const temps = byYear.map(y => y.tempAvg).filter((v): v is number => v !== null);
        const precips = byYear.map(y => y.precip).filter((v): v is number => v !== null);

        weatherByMonth[mi] = {
          avgTemp: temps.length ? Math.round(mean(temps)!) : null,
          avgPrecip: precips.length ? Math.round(mean(precips)! * 10) / 10 : null,
          avgHeatScore: heatScores.length ? Math.round(mean(heatScores)!) : null,
          avgRainScore: rainScores.length ? Math.round(mean(rainScores)!) : null,
        };

        return {
          monthNum: mi + 1,
          month: MONTHS[mi],
          years: byYear,
          rainTrend: linearTrend(byYear.map(y => y.rainScore)),
          heatTrend: linearTrend(byYear.map(y => y.heatScore)),
        };
      });

      // Search trends: split by category, average by month across all years
      const VENUE_TERMS = ["wedding venue", "wedding venues"];
      const ENGAGEMENT_TERMS = ["engagement ring", "how to propose"];
      const DIVORCE_TERMS = ["divorce lawyer"];

      function avgTrendsByMonth(terms: string[]): (number | null)[] {
        const acc: number[][] = Array(12).fill(null).map(() => []);
        for (const t of (trendsRes as any).data ?? []) {
          if (!terms.includes(t.term)) continue;
          const m = new Date(t.week_start).getMonth();
          if (m >= 0 && m < 12 && t.relative_interest != null) acc[m].push(t.relative_interest);
        }
        return acc.map(a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
      }

      // YoY: current calendar year vs prior calendar year, count by month
      const currentYear = new Date().getFullYear();
      const priorYear = currentYear - 1;
      function countByMonthYear(dates: (string | null)[], year: number): number[] {
        const counts = Array(12).fill(0);
        for (const d of dates) {
          if (!d) continue;
          const dt = new Date(d);
          if (dt.getFullYear() === year) counts[dt.getMonth()]++;
        }
        return counts;
      }
      const savesThisYear  = countByMonthYear((savesRes.data ?? []).map((r: any) => r.source_date), currentYear);
      const savesLastYear  = countByMonthYear((savesRes.data ?? []).map((r: any) => r.source_date), priorYear);
      const inqThisYear    = countByMonthYear((inquiriesRes.data ?? []).map((r: any) => r.received_at), currentYear);
      const inqLastYear    = countByMonthYear((inquiriesRes.data ?? []).map((r: any) => r.received_at), priorYear);

      const trendsByMonth      = avgTrendsByMonth(VENUE_TERMS);
      const engagementByMonth  = avgTrendsByMonth(ENGAGEMENT_TERMS);
      const divorceByMonth     = avgTrendsByMonth(DIVORCE_TERMS);

      return {
        months: MONTHS.map((label, m) => ({
          month: label,
          monthNum: m + 1,
          saves: savesByMonth[m],
          inquiries: inquiriesByMonth[m],
          tours: toursByMonth[m],
          events: eventsByMonth[m],
          booked: bookedByMonth[m],
          contractedAt: contractedByMonth[m],
          weather: weatherByMonth[m],
          searchTrend: trendsByMonth[m],
          engagementTrend: engagementByMonth[m],
          divorceTrend: divorceByMonth[m],
          // YoY for current vs prior calendar year
          yoy: {
            savesThis: savesThisYear[m],
            savesLast: savesLastYear[m],
            inqThis: inqThisYear[m],
            inqLast: inqLastYear[m],
          },
        })),
        weatherGrid,
        weatherYears: years,
        currentYear,
        priorYear,
      };
    }),

  // Stage pipeline — current snapshot of how many records sit at each stage
  // and average lead times between them
  stagePipeline: venueProcedure.query(async ({ ctx }) => {
    const [clientsRes, inquiriesRes, leadsRes, toursRes] = await Promise.all([
      ctx.supabase
        .from("clients")
        .select("status, inquired_at, toured_at, held_at, contracted_at, event_date")
        .eq("venue_id", ctx.venueId),
      ctx.supabase
        .from("inquiries")
        .select("id, received_at, match_status")
        .eq("venue_id", ctx.venueId),
      ctx.supabase
        .from("leads")
        .select("id, touch_type")
        .eq("venue_id", ctx.venueId),
      ctx.supabase
        .from("tours")
        .select("scheduled_at, completed, booking_conversion_days")
        .eq("venue_id", ctx.venueId),
    ]);

    const clients = clientsRes.data ?? [];
    const inquiries = inquiriesRes.data ?? [];
    const leads = leadsRes.data ?? [];
    const tours = toursRes.data ?? [];

    // Stage counts
    const stageCounts = {
      discovery: leads.filter((l: any) => ["save", "storefront_visit"].includes(l.touch_type)).length,
      inquiries: inquiries.length,
      unmatchedInquiries: inquiries.filter((i: any) => i.match_status === "unmatched").length,
      touring: clients.filter((c: any) => c.status === "touring").length,
      hold: clients.filter((c: any) => c.status === "hold").length,
      contracted: clients.filter((c: any) => c.status === "contracted").length,
      completed: clients.filter((c: any) => c.status === "event_complete").length,
    };

    // Lead time distributions (days between stages) from clients that have dates
    function medianDays(pairs: Array<[string | null, string | null]>): number | null {
      const diffs = pairs
        .filter(([a, b]) => a && b)
        .map(([a, b]) => Math.abs(new Date(a!).getTime() - new Date(b!).getTime()) / 86400000)
        .sort((a, b) => a - b);
      if (!diffs.length) return null;
      return Math.round(diffs[Math.floor(diffs.length / 2)]);
    }

    const inquiryToEvent = medianDays(
      clients.map((c: any) => [c.inquired_at, c.event_date] as [string | null, string | null])
    );
    const tourToContract = medianDays(
      clients.map((c: any) => [c.toured_at, c.contracted_at] as [string | null, string | null])
    );
    const contractToEvent = medianDays(
      clients.map((c: any) => [c.contracted_at, c.event_date] as [string | null, string | null])
    );
    const tourConversionDays = tours
      .filter((t: any) => t.booking_conversion_days != null)
      .map((t: any) => t.booking_conversion_days as number)
      .sort((a, b) => a - b);
    const medianTourBooking =
      tourConversionDays.length
        ? tourConversionDays[Math.floor(tourConversionDays.length / 2)]
        : null;

    // Conversion rates between stages
    const discoveryToInquiryRate =
      stageCounts.discovery > 0 ? stageCounts.inquiries / stageCounts.discovery : null;
    const inquiryToTourRate =
      inquiries.length > 0
        ? (stageCounts.touring + stageCounts.hold + stageCounts.contracted + stageCounts.completed) /
          inquiries.length
        : null;
    const tourToBookRate =
      (stageCounts.touring + stageCounts.hold + stageCounts.contracted + stageCounts.completed) > 0
        ? (stageCounts.contracted + stageCounts.completed) /
          (stageCounts.touring + stageCounts.hold + stageCounts.contracted + stageCounts.completed)
        : null;

    return {
      stageCounts,
      leadTimes: {
        inquiryToEventDays: inquiryToEvent,
        tourToContractDays: tourToContract,
        contractToEventDays: contractToEvent,
        medianTourBookingDays: medianTourBooking,
      },
      conversionRates: {
        discoveryToInquiry: discoveryToInquiryRate,
        inquiryToTour: inquiryToTourRate,
        tourToBook: tourToBookRate,
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
