import { z } from "zod";
import { router, venueProcedure } from "@/lib/trpc/server";
import { TRPCError } from "@trpc/server";

export const analyticsRouter = router({
  // Source ROI breakdown — with spend, cost-per-outcome, and intent breakdown
  sourceROI: venueProcedure
    .input(z.object({
      yearFrom: z.number().int().optional(),
      yearTo: z.number().int().optional(),
      dateFrom: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      let clientQuery = ctx.supabase
        .from("clients")
        .select("resolved_source, status, revenue_cents, review_star_rating, review_left, referrals_generated, complexity_score")
        .eq("venue_id", ctx.venueId)
        .not("resolved_source", "is", null);

      if (input.dateFrom) {
        clientQuery = clientQuery.gte("inquired_at", input.dateFrom);
      } else {
        if (input.yearFrom) clientQuery = clientQuery.gte("event_year", input.yearFrom);
        if (input.yearTo)   clientQuery = clientQuery.lte("event_year", input.yearTo);
      }

      // Build date range for spend lookup
      const spendFrom = input.dateFrom
        ? input.dateFrom.slice(0, 7) + "-01"
        : input.yearFrom ? `${input.yearFrom}-01-01` : null;
      const spendTo = input.yearTo ? `${input.yearTo}-12-01` : null;

      const [
        { data, error },
        { data: venueData },
        { data: spendData },
        { data: inquiryIntentData },
      ] = await Promise.all([
        clientQuery,
        ctx.supabase.from("venues").select("venue_profile").eq("id", ctx.venueId).single(),
        // Channel spend — sum per channel over the period (graceful if table doesn't exist yet)
        ctx.supabase
          .from("channel_spend")
          .select("channel, amount_cents, month")
          .eq("venue_id", ctx.venueId)
          .then(r => {
            if (r.error?.message?.includes("does not exist")) return { data: [], error: null };
            return r;
          })
          .then(r => {
            if (!spendFrom && !spendTo) return r;
            // Filter in memory — simpler than chaining Supabase filters after .then()
            const filtered = (r.data ?? []).filter((row: any) => {
              if (spendFrom && row.month < spendFrom) return false;
              if (spendTo   && row.month > spendTo)   return false;
              return true;
            });
            return { data: filtered, error: null };
          }),
        // Inquiry intent breakdown per resolved_source
        ctx.supabase
          .from("inquiries")
          .select("resolved_source, inquiry_intent, first_contact_channel")
          .eq("venue_id", ctx.venueId)
          .not("resolved_source", "is", null)
          .then(r => {
            if (r.error?.message?.includes("does not exist") ||
                r.error?.message?.includes("column") ) return { data: [], error: null };
            return r;
          }),
      ]);

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

      // Spend: sum per channel in cents
      const spendByChannel = new Map<string, number>();
      for (const row of spendData ?? []) {
        spendByChannel.set(row.channel, (spendByChannel.get(row.channel) ?? 0) + row.amount_cents);
      }

      // Intent: chosen vs. also_contacted per source
      const intentBySource = new Map<string, { chosen: number; blast: number; unknown: number }>();
      for (const row of inquiryIntentData ?? []) {
        const src = row.resolved_source as string;
        if (!intentBySource.has(src)) intentBySource.set(src, { chosen: 0, blast: 0, unknown: 0 });
        const i = intentBySource.get(src)!;
        if (row.inquiry_intent === "chosen")         i.chosen++;
        else if (row.inquiry_intent === "also_contacted") i.blast++;
        else i.unknown++;
      }

      const bucketToMidpointCents: Record<string, number> = {
        "Under $5k": 250000, "$5–10k": 750000, "$10–15k": 1250000,
        "$15–20k": 1750000, "$20–30k": 2500000, "$30k+": 3500000,
      };
      const vp = (venueData?.venue_profile as Record<string, any>) ?? {};
      const estimatedRevCents = bucketToMidpointCents[vp.avg_package_value_bucket?.value] ?? null;

      const sourceMap = new Map<string, {
        inquiryCount: number; bookedCount: number;
        totalRevenue: number; revenueCount: number;
        totalComplexity: number; complexityCount: number;
        reviewCount: number; totalReferrals: number;
      }>();

      for (const client of data ?? []) {
        const source = client.resolved_source as string;
        if (!sourceMap.has(source)) sourceMap.set(source, {
          inquiryCount: 0, bookedCount: 0,
          totalRevenue: 0, revenueCount: 0,
          totalComplexity: 0, complexityCount: 0,
          reviewCount: 0, totalReferrals: 0,
        });
        const s = sourceMap.get(source)!;
        s.inquiryCount++;
        if (!["inquiry", "archived"].includes(client.status as string)) s.bookedCount++;
        if (client.revenue_cents) { s.totalRevenue += client.revenue_cents; s.revenueCount++; }
        if (client.complexity_score) { s.totalComplexity += client.complexity_score; s.complexityCount++; }
        if (client.review_left) s.reviewCount++;
        s.totalReferrals += client.referrals_generated ?? 0;
      }

      return Array.from(sourceMap.entries()).map(([source, stats]) => {
        const realAvgRev = stats.revenueCount > 0 ? Math.round(stats.totalRevenue / stats.revenueCount) : null;
        const avgRevenue = realAvgRev ?? estimatedRevCents;
        const spendCents = spendByChannel.get(source) ?? 0;
        const intent = intentBySource.get(source) ?? { chosen: 0, blast: 0, unknown: 0 };

        // Cost-per-outcome (null if no spend recorded)
        const cpp = (spendCents > 0 && stats.bookedCount > 0)
          ? Math.round(spendCents / stats.bookedCount) : null;
        const cpi = (spendCents > 0 && stats.inquiryCount > 0)
          ? Math.round(spendCents / stats.inquiryCount) : null;
        const cpr = (spendCents > 0 && stats.totalRevenue > 0)
          ? Math.round((spendCents / stats.totalRevenue) * 100) / 100 : null; // $ per $1 revenue

        return {
          source,
          inquiryCount:        stats.inquiryCount,
          bookedCount:         stats.bookedCount,
          conversionRate:      stats.inquiryCount > 0 ? stats.bookedCount / stats.inquiryCount : 0,
          avgRevenue,
          avgRevenueIsEstimate: realAvgRev === null && estimatedRevCents !== null,
          avgComplexityScore:  stats.complexityCount > 0 ? Math.round(stats.totalComplexity / stats.complexityCount) : null,
          reviewRate:          stats.bookedCount > 0 ? stats.reviewCount / stats.bookedCount : 0,
          totalReferrals:      stats.totalReferrals,
          // Spend & cost
          spendCents,
          costPerInquiry:      cpi,
          costPerBooking:      cpp,
          costPerRevenueDollar: cpr,
          // Intent breakdown
          intentChosen:        intent.chosen,
          intentBlast:         intent.blast,
          blastRate:           (intent.chosen + intent.blast) > 0
                                 ? intent.blast / (intent.chosen + intent.blast) : null,
          // Blast-adjusted conversion (chosen inquiries only)
          chosenConversionRate: intent.chosen > 0
                                 ? stats.bookedCount / intent.chosen : null,
        };
      });
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

          // Weather seasonality for this venue — fetch all years, pick 3 most recent
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
                .eq("noaa_station_id", v.noaa_station_id.replace(/^GHCND:/i, ""))
                .order("year", { ascending: false })
                .order("month", { ascending: true });
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

      // Build year×month lookup from raw weather rows — 3 most recent years
      const rawWeatherRows: any[] = (weatherRes as any).data ?? [];
      const allWeatherYears = [...new Set(rawWeatherRows.map((w: any) => w.year as number))].sort((a, b) => b - a);
      const recentWeatherYears = new Set(allWeatherYears.slice(0, 3));
      const allWeatherRows = rawWeatherRows.filter((w: any) => recentWeatherYears.has(w.year));
      const years = [...recentWeatherYears].sort();

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
    const [clientsRes, inquiriesRes, leadsRes, toursRes, venueRes] = await Promise.all([
      ctx.supabase
        .from("clients")
        .select("status, inquired_at, toured_at, held_at, contracted_at, event_date, hold_expires_at, revenue_cents")
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
      ctx.supabase
        .from("venues")
        .select("venue_profile")
        .eq("id", ctx.venueId)
        .single(),
    ]);

    const clients = clientsRes.data ?? [];
    const inquiries = inquiriesRes.data ?? [];
    const leads = leadsRes.data ?? [];
    const tours = toursRes.data ?? [];

    // Package value estimate for revenue-at-risk when revenue_cents is null
    const bucketToMidpointCents: Record<string, number> = {
      "Under $5k": 250000, "$5–10k": 750000, "$10–15k": 1250000,
      "$15–20k": 1750000, "$20–30k": 2500000, "$30k+": 3500000,
    };
    const vp = (venueRes?.data?.venue_profile as Record<string, any>) ?? {};
    const estimatedRevCents = bucketToMidpointCents[vp.avg_package_value_bucket?.value] ?? null;

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

    // Hold expiry analysis
    const now = new Date();
    const in14Days = new Date(now.getTime() + 14 * 86400000);
    const holdsWithExpiry = clients.filter(
      (c: any) => c.hold_expires_at && new Date(c.hold_expires_at) >= now
    );
    const holdsExpiringSoon = holdsWithExpiry.filter(
      (c: any) => new Date(c.hold_expires_at) <= in14Days
    ).length;
    const revenueAtRisk = holdsWithExpiry.reduce((sum: number, c: any) => {
      return sum + ((c.revenue_cents as number | null) ?? estimatedRevCents ?? 0);
    }, 0);

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
      holds: {
        total: holdsWithExpiry.length,
        expiringSoon: holdsExpiringSoon,
        revenueAtRiskCents: revenueAtRisk,
      },
    };
  }),

  // Hold alerts — couples on hold with expiry dates, ordered by urgency
  getHoldAlerts: venueProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const { data, error } = await ctx.supabase
      .from("clients")
      .select("id, name_primary, name_partner, event_date, revenue_cents, hold_expires_at, status")
      .eq("venue_id", ctx.venueId)
      .not("hold_expires_at", "is", null)
      .gte("hold_expires_at", now.toISOString())
      .order("hold_expires_at", { ascending: true });

    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

    return (data ?? []).map((c: any) => {
      const expires = new Date(c.hold_expires_at);
      const daysLeft = Math.round((expires.getTime() - now.getTime()) / 86400000);
      return {
        id: c.id as string,
        name: [c.name_primary, c.name_partner].filter(Boolean).join(" & "),
        eventDate: c.event_date as string | null,
        revenueCents: c.revenue_cents as number | null,
        holdExpiresAt: c.hold_expires_at as string,
        daysLeft,
        urgent: daysLeft <= 3,
      };
    });
  }),

  // Lost deal analysis — archived clients by reason
  getLostReasons: venueProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from("clients")
      .select("lost_reason, lost_reason_note, revenue_cents, name_primary, name_partner, event_date")
      .eq("venue_id", ctx.venueId)
      .eq("status", "archived")
      .not("lost_reason", "is", null);

    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

    // Aggregate by reason
    const reasonMap = new Map<string, { count: number; revenueLostCents: number }>();
    for (const c of data ?? []) {
      const r = (c.lost_reason as string) ?? "unknown";
      if (!reasonMap.has(r)) reasonMap.set(r, { count: 0, revenueLostCents: 0 });
      const entry = reasonMap.get(r)!;
      entry.count++;
      if (c.revenue_cents) entry.revenueLostCents += c.revenue_cents as number;
    }

    const total = (data ?? []).length;
    const breakdown = Array.from(reasonMap.entries())
      .map(([reason, s]) => ({
        reason,
        count: s.count,
        pct: total > 0 ? Math.round((s.count / total) * 1000) / 10 : 0,
        revenueLostCents: s.revenueLostCents,
      }))
      .sort((a, b) => b.count - a.count);

    return { total, breakdown };
  }),

  // Revenue by year/month
  revenueOverTime: venueProcedure
    .input(z.object({
      years: z.number().int().default(3),
      dateFrom: z.string().optional(),  // ISO date — filters by event_date when set
    }))
    .query(async ({ ctx, input }) => {
      const fromYear = input.dateFrom
        ? new Date(input.dateFrom).getFullYear()
        : new Date().getFullYear() - input.years + 1;

      let query = ctx.supabase
        .from("clients")
        .select("event_year, event_month, revenue_cents")
        .eq("venue_id", ctx.venueId)
        .gte("event_year", fromYear)
        .not("revenue_cents", "is", null)
        .not("event_year", "is", null);

      if (input.dateFrom) query = query.gte("event_date", input.dateFrom);

      const { data, error } = await query;

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

  // Booking horizon — how far in advance couples book
  getBookingHorizon: venueProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from("clients")
      .select("inquired_at, event_date, status")
      .eq("venue_id", ctx.venueId)
      .not("inquired_at", "is", null)
      .not("event_date", "is", null)
      .not("status", "in", '("inquiry","archived")');

    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

    const rows = data ?? [];
    const daysList: number[] = [];

    for (const row of rows) {
      const inquiry = new Date(row.inquired_at as string);
      const event = new Date(row.event_date as string);
      const days = Math.round((event.getTime() - inquiry.getTime()) / 86400000);
      if (days >= 0) daysList.push(days);
    }

    daysList.sort((a, b) => a - b);

    const total = daysList.length;

    const buckets: { label: string; min: number; max: number }[] = [
      { label: "Under 6 months", min: 0, max: 179 },
      { label: "6–12 months", min: 180, max: 364 },
      { label: "12–18 months", min: 365, max: 546 },
      { label: "18–24 months", min: 547, max: 729 },
      { label: "Over 24 months", min: 730, max: Infinity },
    ];

    const bucketCounts = buckets.map((b) => ({
      label: b.label,
      count: daysList.filter((d) => d >= b.min && d <= b.max).length,
    }));

    const result = bucketCounts.map((b) => ({
      label: b.label,
      count: b.count,
      pct: total > 0 ? Math.round((b.count / total) * 1000) / 10 : 0,
    }));

    const p = (pct: number) =>
      daysList.length > 0 ? daysList[Math.floor(daysList.length * pct)] ?? null : null;

    return {
      buckets: result,
      median: p(0.5),
      p25: p(0.25),
      p75: p(0.75),
    };
  }),

  // Capacity outlook — contracted events + scheduled tours per month for 18 months
  getCapacityOutlook: venueProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const monthStartIso = monthStart.toISOString().split("T")[0];

    const [clientsRes, toursRes] = await Promise.all([
      ctx.supabase
        .from("clients")
        .select("event_date, status")
        .eq("venue_id", ctx.venueId)
        .in("status", ["contracted", "booked", "planning", "event_complete"])
        .not("event_date", "is", null)
        .gte("event_date", monthStartIso),
      ctx.supabase
        .from("tours")
        .select("scheduled_at")
        .eq("venue_id", ctx.venueId)
        .eq("cancelled", false)
        .not("scheduled_at", "is", null)
        .gte("scheduled_at", monthStart.toISOString()),
    ]);

    if (clientsRes.error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: clientsRes.error.message });
    if (toursRes.error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: toursRes.error.message });

    // Build map for next 18 months
    const months: { month: string; contractedEvents: number; scheduledTours: number }[] = [];
    for (let i = 0; i < 18; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      months.push({ month: key, contractedEvents: 0, scheduledTours: 0 });
    }

    const monthMap = new Map(months.map((m) => [m.month, m]));

    for (const client of clientsRes.data ?? []) {
      const d = new Date(client.event_date as string);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const entry = monthMap.get(key);
      if (entry) entry.contractedEvents++;
    }

    for (const tour of toursRes.data ?? []) {
      const d = new Date(tour.scheduled_at as string);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const entry = monthMap.get(key);
      if (entry) entry.scheduledTours++;
    }

    return months;
  }),

  // Response time analytics for inquiries
  getResponseTimes: venueProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from("inquiries")
      .select("response_time_minutes, day_of_week")
      .eq("venue_id", ctx.venueId)
      .not("response_time_minutes", "is", null);

    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

    const rows = data ?? [];
    const times = rows.map((r: any) => r.response_time_minutes as number).sort((a, b) => a - b);
    const total = times.length;

    if (total === 0) {
      return {
        avg: null, median: null,
        under5min: 0, under1hr: 0, under24hr: 0, over24hr: 0,
        total: 0,
        byDayOfWeek: Array.from({ length: 7 }, (_, day) => ({ day, avgMinutes: null })),
      };
    }

    const avg = Math.round(times.reduce((a, b) => a + b, 0) / total);
    const median = times[Math.floor(total / 2)];
    const under5min = times.filter((t) => t < 5).length;
    const under1hr = times.filter((t) => t < 60).length;
    const under24hr = times.filter((t) => t < 1440).length;
    const over24hr = times.filter((t) => t >= 1440).length;

    // Average by day of week
    const dowAccum: number[][] = Array.from({ length: 7 }, () => []);
    for (const row of rows) {
      const dow = (row as any).day_of_week as number | null;
      const rt = (row as any).response_time_minutes as number;
      if (dow != null && dow >= 0 && dow < 7) dowAccum[dow].push(rt);
    }

    const byDayOfWeek = dowAccum.map((vals, day) => ({
      day,
      avgMinutes: vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null,
    }));

    return { avg, median, under5min, under1hr, under24hr, over24hr, total, byDayOfWeek };
  }),

  // Revenue projection — actual past 12 months + projected next 12 months
  getRevenueProjection: venueProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const past12Start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const future12End = new Date(now.getFullYear(), now.getMonth() + 12, 1);

    const bucketToMidpointCents: Record<string, number> = {
      "Under $5k": 250000, "$5–10k": 750000, "$10–15k": 1250000,
      "$15–20k": 1750000, "$20–30k": 2500000, "$30k+": 3500000,
    };

    const [clientsRes, venueRes] = await Promise.all([
      ctx.supabase
        .from("clients")
        .select("event_date, revenue_cents, status")
        .eq("venue_id", ctx.venueId)
        .in("status", ["contracted", "booked", "planning", "event_complete"])
        .not("event_date", "is", null)
        .gte("event_date", past12Start.toISOString().split("T")[0])
        .lte("event_date", future12End.toISOString().split("T")[0]),
      ctx.supabase
        .from("venues")
        .select("venue_profile")
        .eq("id", ctx.venueId)
        .single(),
    ]);

    if (clientsRes.error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: clientsRes.error.message });

    const vp = (venueRes.data?.venue_profile as Record<string, any>) ?? {};
    const estimatedRevCents = bucketToMidpointCents[vp.avg_package_value_bucket?.value] ?? null;

    // Build 24-month period array
    const periodMap = new Map<string, { actualRevenue: number; projectedRevenue: number; isProjection: boolean; eventCount: number }>();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    // Past 12 months
    for (let i = -11; i <= 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const isProjection = key > currentMonthKey;
      periodMap.set(key, { actualRevenue: 0, projectedRevenue: 0, isProjection, eventCount: 0 });
    }

    let totalContractedRevenue = 0;
    let totalProjectedRevenue = 0;

    for (const client of clientsRes.data ?? []) {
      const d = new Date(client.event_date as string);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const entry = periodMap.get(key);
      if (!entry) continue;

      entry.eventCount++;
      const rev = (client.revenue_cents as number | null) ?? estimatedRevCents ?? 0;

      if (entry.isProjection) {
        entry.projectedRevenue += rev;
        totalProjectedRevenue += rev;
      } else {
        entry.actualRevenue += rev;
        totalContractedRevenue += rev;
      }
    }

    const months = Array.from(periodMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, data]) => ({ period, ...data }));

    return { months, totalContractedRevenue, totalProjectedRevenue };
  }),

  // Review language analysis — word frequency from review text
  getReviewLanguage: venueProcedure.query(async ({ ctx }) => {
    const { data } = await ctx.supabase
      .from("clients")
      .select("review_text, review_star_rating")
      .eq("venue_id", ctx.venueId)
      .not("review_text", "is", null);

    const STOP = new Set([
      "the","a","an","and","or","but","in","on","at","to","for","of","with","by","from",
      "is","was","are","were","be","been","has","have","had","do","does","did","will",
      "would","could","should","may","might","this","that","these","those","it","its",
      "we","our","they","their","you","your","i","my","me","us","he","his","she","her",
      "very","so","just","not","no","as","up","if","out","about","than","then","also",
      "more","all","can","what","which","who","how","when","where","why","there","here",
      "get","got","go","went","come","came","see","say","said","know","think","made",
      "take","took","feel","felt","look","want","every","like","time","day","year",
      "help","great","good","much","many","some","such","into","over","after","before",
      "been","even","most","other","well","back","first","only","through","during","each",
    ]);

    const wordMap = new Map<string, { count: number; posCount: number; negCount: number }>();

    for (const client of data ?? []) {
      if (!client.review_text) continue;
      const rating = client.review_star_rating as number | null;
      const isPos = rating !== null && rating >= 4;
      const isNeg = rating !== null && rating <= 3;

      const words = (client.review_text as string)
        .toLowerCase()
        .replace(/[^a-z\s'-]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3 && !STOP.has(w) && !/^\d+$/.test(w));

      for (const word of words) {
        const clean = word.replace(/^'+|'+$/g, ""); // trim leading/trailing apostrophes
        if (clean.length < 4) continue;
        if (!wordMap.has(clean)) wordMap.set(clean, { count: 0, posCount: 0, negCount: 0 });
        const entry = wordMap.get(clean)!;
        entry.count++;
        if (isPos) entry.posCount++;
        if (isNeg) entry.negCount++;
      }
    }

    const reviewCount = (data ?? []).length;
    const words = Array.from(wordMap.entries())
      .filter(([, v]) => v.count >= 2)
      .map(([word, stats]) => ({ word, ...stats }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 80);

    return { reviewCount, words };
  }),

  // Website traffic — aggregate sessions/users by month for the venue
  getWebsiteTraffic: venueProcedure
    .input(z.object({ months: z.number().int().default(12) }))
    .query(async ({ ctx, input }) => {
      const fromDate = new Date();
      fromDate.setMonth(fromDate.getMonth() - input.months);
      const fromIso = fromDate.toISOString().split("T")[0];

      const { data, error } = await ctx.supabase
        .from("website_traffic")
        .select("date, sessions, users, new_users, pageviews, source, medium")
        .eq("venue_id", ctx.venueId)
        .gte("date", fromIso)
        .order("date");

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

      // Aggregate by month (sum across all sources)
      const monthMap = new Map<string, { sessions: number; users: number; newUsers: number; pageviews: number }>();
      for (const row of data ?? []) {
        const key = (row.date as string).slice(0, 7); // YYYY-MM
        const existing = monthMap.get(key) ?? { sessions: 0, users: 0, newUsers: 0, pageviews: 0 };
        existing.sessions  += (row.sessions  ?? 0) as number;
        existing.users     += (row.users     ?? 0) as number;
        existing.newUsers  += (row.new_users ?? 0) as number;
        existing.pageviews += (row.pageviews ?? 0) as number;
        monthMap.set(key, existing);
      }

      // Source breakdown (top 6)
      const sourceMap = new Map<string, number>();
      for (const row of data ?? []) {
        const src = (row.source as string) ?? "unknown";
        sourceMap.set(src, (sourceMap.get(src) ?? 0) + ((row.sessions as number) ?? 0));
      }
      const topSources = Array.from(sourceMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([source, sessions]) => ({ source, sessions }));

      const monthly = Array.from(monthMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([period, stats]) => ({ period, ...stats }));

      const totalSessions = monthly.reduce((s, m) => s + m.sessions, 0);
      const totalRows = (data ?? []).length;

      return { monthly, topSources, totalSessions, hasData: totalRows > 0 };
    }),

  // ── COMPETING VENUES MENTIONS ─────────────────────────────────────────────
  // Aggregates all competitor names mentioned across client records and tours.
  // Answers: "Which venues are couples comparing us to, and how often?"
  //
  // Sources:
  //   clients.competing_venues[]  — populated by confirmed upload signals
  //   tours.competing_venues[]    — self-reported at tour intake
  //
  // Returns venues ranked by total mentions, with a breakdown of how many
  // mentions came from client records (post-signal confirmation) vs. tour intake.
  getCompetingVenuesMentions: venueProcedure.query(async ({ ctx }) => {
    const [{ data: clients }, { data: tours }] = await Promise.all([
      ctx.supabase
        .from("clients")
        .select("competing_venues")
        .eq("venue_id", ctx.venueId)
        .not("competing_venues", "eq", "{}"),
      ctx.supabase
        .from("tours")
        .select("competing_venues")
        .eq("venue_id", ctx.venueId)
        .not("competing_venues", "eq", "{}"),
    ]);

    const counts = new Map<string, { clientMentions: number; tourMentions: number }>();

    const normalise = (name: string) => name.trim().toLowerCase();

    for (const row of clients ?? []) {
      for (const raw of (row.competing_venues as string[]) ?? []) {
        const key = normalise(raw);
        if (!counts.has(key)) counts.set(key, { clientMentions: 0, tourMentions: 0 });
        counts.get(key)!.clientMentions++;
      }
    }

    for (const row of tours ?? []) {
      for (const raw of (row.competing_venues as string[]) ?? []) {
        const key = normalise(raw);
        if (!counts.has(key)) counts.set(key, { clientMentions: 0, tourMentions: 0 });
        counts.get(key)!.tourMentions++;
      }
    }

    return Array.from(counts.entries())
      .map(([name, stats]) => ({
        name,
        totalMentions: stats.clientMentions + stats.tourMentions,
        clientMentions: stats.clientMentions,
        tourMentions: stats.tourMentions,
      }))
      .sort((a, b) => b.totalMentions - a.totalMentions);
  }),
});
