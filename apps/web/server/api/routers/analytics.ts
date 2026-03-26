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
      let clientQuery = ctx.db
        .from("clients")
        .select("resolved_source, status, revenue_cents, acquisition_cost_cents, review_submitted, referrals_generated, complexity_score, first_touch_platform")
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
        spendResult,
        inquiryIntentResult,
      ] = await Promise.all([
        clientQuery,
        // Channel spend — sum per channel over the period
        ctx.db
          .from("channel_spend")
          .select("channel, amount_cents, month")
          .eq("venue_id", ctx.venueId)
          .then(r => {
            if (r.error?.message?.includes("does not exist")) return { data: [] as any[], error: null };
            if (!spendFrom && !spendTo) return r;
            const filtered = (r.data ?? []).filter((row: any) => {
              if (spendFrom && row.month < spendFrom) return false;
              if (spendTo   && row.month > spendTo)   return false;
              return true;
            });
            return { data: filtered, error: null };
          }),
        // Inquiry intent breakdown per source
        ctx.db
          .from("inquiries")
          .select("inquiry_intent, first_contact_channel, matched_client_id")
          .eq("venue_id", ctx.venueId)
          .then(r => {
            if (r.error?.message?.includes("does not exist") ||
                r.error?.message?.includes("column")) return { data: [] as any[], error: null };
            return r;
          }),
      ]);

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

      // Spend: sum per channel in cents (keyed by channel ID AND by normalized label)
      // Channel IDs are snake_case (e.g. "the_knot"); resolved_source is user-entered (e.g. "The Knot")
      // We normalize both to a common key for matching.
      function normalizeKey(s: string): string {
        return s.toLowerCase().replace(/[\s\-–—&]+/g, "_").replace(/[^a-z0-9_]/g, "").replace(/_+/g, "_");
      }
      const spendByChannel = new Map<string, number>();
      for (const row of spendResult.data ?? []) {
        const key = normalizeKey(row.channel ?? "");
        spendByChannel.set(key, (spendByChannel.get(key) ?? 0) + (row.amount_cents ?? 0));
      }

      // Intent: chosen vs. also_contacted per source — join via matched_client_id
      // Build a map of client_id → resolved_source for intent enrichment
      const clientSourceMap = new Map<string, string>();
      for (const client of data ?? []) {
        if (client.resolved_source) clientSourceMap.set(client.resolved_source, client.resolved_source);
      }

      const intentBySource = new Map<string, { chosen: number; blast: number; unknown: number }>();
      for (const row of inquiryIntentResult.data ?? []) {
        // Map inquiry intent to its matched client's source
        // Since inquiries don't have resolved_source, group by first_contact_channel as proxy
        const src = (row.first_contact_channel as string) ?? "unknown";
        if (!intentBySource.has(src)) intentBySource.set(src, { chosen: 0, blast: 0, unknown: 0 });
        const i = intentBySource.get(src)!;
        if (row.inquiry_intent === "chosen")              i.chosen++;
        else if (row.inquiry_intent === "also_contacted") i.blast++;
        else                                              i.unknown++;
      }

      const sourceMap = new Map<string, {
        inquiryCount: number; touredCount: number; bookedCount: number;
        totalRevenue: number; revenueCount: number;
        totalAcquisitionCost: number; acquisitionCostCount: number;
        totalComplexity: number; complexityCount: number;
        reviewCount: number; totalReferrals: number;
      }>();

      for (const client of data ?? []) {
        const source = client.resolved_source as string;
        if (!sourceMap.has(source)) sourceMap.set(source, {
          inquiryCount: 0, touredCount: 0, bookedCount: 0,
          totalRevenue: 0, revenueCount: 0,
          totalAcquisitionCost: 0, acquisitionCostCount: 0,
          totalComplexity: 0, complexityCount: 0,
          reviewCount: 0, totalReferrals: 0,
        });
        const s = sourceMap.get(source)!;
        s.inquiryCount++;
        // Toured = any stage past tour_booked (toured, held, contracted, event_complete, lost)
        if (["toured", "held", "contracted", "event_complete", "lost"].includes(client.status as string)) s.touredCount++;
        if (!["inquiry", "tour_booked", "archived", "lost"].includes(client.status as string)) s.bookedCount++;
        if (client.revenue_cents)          { s.totalRevenue += client.revenue_cents; s.revenueCount++; }
        if (client.acquisition_cost_cents) { s.totalAcquisitionCost += client.acquisition_cost_cents; s.acquisitionCostCount++; }
        if (client.complexity_score)       { s.totalComplexity += client.complexity_score; s.complexityCount++; }
        if (client.review_submitted)       s.reviewCount++;
        s.totalReferrals += client.referrals_generated ?? 0;
      }

      return Array.from(sourceMap.entries()).map(([source, stats]) => {
        const avgRevenue = stats.revenueCount > 0
          ? Math.round(stats.totalRevenue / stats.revenueCount)
          : null;
        // Spend: normalize source to channel key for matching
        // e.g. "The Knot" → "the_knot", "WeddingWire" → "weddingwire", "Google Ads" → "google_ads"
        const sourceKey = normalizeKey(source);
        const spendCents = spendByChannel.get(sourceKey)
          ?? (stats.acquisitionCostCount > 0 ? stats.totalAcquisitionCost : 0);
        const intent = intentBySource.get(source) ?? { chosen: 0, blast: 0, unknown: 0 };

        // Cost-per-outcome metrics (null if no spend recorded for this source)
        const cpt = (spendCents > 0 && stats.touredCount > 0)
          ? Math.round(spendCents / stats.touredCount) : null;
        const cpp = (spendCents > 0 && stats.bookedCount > 0)
          ? Math.round(spendCents / stats.bookedCount) : null;
        const cpr = (spendCents > 0 && stats.totalRevenue > 0)
          ? Math.round((spendCents / stats.totalRevenue) * 100) / 100 : null;

        return {
          source,
          inquiryCount:         stats.inquiryCount,
          touredCount:          stats.touredCount,
          bookedCount:          stats.bookedCount,
          conversionRate:       stats.inquiryCount > 0 ? stats.bookedCount / stats.inquiryCount : 0,
          tourRate:             stats.inquiryCount > 0 ? stats.touredCount / stats.inquiryCount : 0,
          avgRevenue,
          avgRevenueIsEstimate: false,
          avgComplexityScore:   stats.complexityCount > 0
            ? Math.round(stats.totalComplexity / stats.complexityCount) : null,
          reviewRate:           stats.bookedCount > 0 ? stats.reviewCount / stats.bookedCount : 0,
          totalReferrals:       stats.totalReferrals,
          // Spend & cost
          spendCents,
          costPerTour:          cpt,
          costPerBooking:       cpp,
          costPerRevenueDollar: cpr,
          // Intent breakdown
          intentChosen:         intent.chosen,
          intentBlast:          intent.blast,
          blastRate:            (intent.chosen + intent.blast) > 0
            ? intent.blast / (intent.chosen + intent.blast) : null,
          // Blast-adjusted conversion (chosen inquiries only)
          chosenConversionRate: intent.chosen > 0
            ? stats.bookedCount / intent.chosen : null,
        };
      });
    }),

  // Inquiry day/time heatmap
  inquiryDayTime: venueProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.db
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
    const { data: clients, error } = await ctx.db
      .from("clients")
      .select("id, inquired_at, status, toured_at, contracted_at")
      .eq("venue_id", ctx.venueId)
      .neq("status", "inquiry");

    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

    const { data: tours } = await ctx.db
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
        p25:        p(conversionDays, 0.25),
        p50:        p(conversionDays, 0.5),
        p75:        p(conversionDays, 0.75),
        mean:       conversionDays.length > 0
          ? Math.round(conversionDays.reduce((a, b) => a + b, 0) / conversionDays.length)
          : null,
        sampleSize: conversionDays.length,
      },
    };
  }),

  // Funnel seasonality — monthly volume at each stage, averaged across years.
  // Reveals that inquiries peak in Mar, tours in Apr/May, events in Sep/Oct.
  funnelSeasonality: venueProcedure
    .input(z.object({ years: z.number().int().min(1).max(5).default(3) }))
    .query(async ({ ctx, input }) => {
      const fromDate = new Date();
      fromDate.setFullYear(fromDate.getFullYear() - input.years);
      const fromIso = fromDate.toISOString().split("T")[0];

      const [inquiriesRes, toursRes, eventsRes, weatherRes, trendsRes] = await Promise.all([
        // Consideration: inquiries
        ctx.db
          .from("inquiries")
          .select("received_at")
          .eq("venue_id", ctx.venueId)
          .gte("received_at", fromIso),

        // Serious intent: completed tours
        ctx.db
          .from("tours")
          .select("scheduled_at")
          .eq("venue_id", ctx.venueId)
          .eq("completed", true)
          .gte("scheduled_at", fromIso),

        // Events: clients with event_month data
        ctx.db
          .from("clients")
          .select("event_month, event_year, status, contracted_at, toured_at, inquired_at")
          .eq("venue_id", ctx.venueId)
          .not("event_month", "is", null),

        // Weather seasonality — fetch via noaa_station_id on venues
        ctx.db
          .from("venues")
          .select("noaa_station_id")
          .eq("id", ctx.venueId)
          .single()
          .then(async ({ data: v }) => {
            if (!v?.noaa_station_id) return { data: [] as any[] };
            const stationId = v.noaa_station_id.replace(/^GHCND:/i, "");
            return ctx.db
              .from("weather_monthly")
              .select("month, avg_temp_4pm_f, avg_rain_chance_pct, total_precip, outdoor_score")
              .eq("station_id", stationId)
              .order("month", { ascending: true });
          }),

        // Google Trends — all tracked terms
        ctx.db
          .from("venues")
          .select("google_trends_metro")
          .eq("id", ctx.venueId)
          .single()
          .then(async ({ data: v }) => {
            if (!v?.google_trends_metro) return { data: [] as any[] };
            return ctx.db
              .from("macro_search_trends")
              .select("week, term, interest")
              .eq("metro", v.google_trends_metro)
              .in("term", [
                "wedding venue", "wedding venues",
                "engagement ring", "how to propose",
                "divorce lawyer",
              ])
              .gte("week", fromIso)
              .order("week");
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

      const inquiriesByMonth = countByMonth(
        (inquiriesRes.data ?? []).map((r: any) => r.received_at)
      );
      const toursByMonth = countByMonth(
        (toursRes.data ?? []).map((r: any) => r.scheduled_at)
      );

      // Event counts split by status
      const eventsByMonth  = Array(12).fill(0);
      const bookedByMonth  = Array(12).fill(0);
      const contractedByMonth = Array(12).fill(0);
      // Inquiries bucketed by month they were sent (from clients)
      const inquiriesByMonthFromClients = Array(12).fill(0);

      for (const c of eventsRes.data ?? []) {
        const m = (c.event_month as number) - 1; // 1-12 → 0-11
        if (m >= 0 && m < 12) {
          eventsByMonth[m]++;
          if (["contracted", "event_complete"].includes(c.status as string)) bookedByMonth[m]++;
        }
        if (c.contracted_at) {
          const cm = new Date(c.contracted_at).getMonth();
          if (cm >= 0 && cm < 12) contractedByMonth[cm]++;
        }
        if (c.inquired_at) {
          const im = new Date(c.inquired_at).getMonth();
          if (im >= 0 && im < 12) inquiriesByMonthFromClients[im]++;
        }
      }

      // Weather: weather_monthly has one row per month (month 1-12), no year column
      // outdoor_score: higher = better. Build avg per month from the rows.
      const rawWeatherRows: any[] = (weatherRes as any).data ?? [];

      // weatherByMonth[monthIndex] aggregated across all rows for that month
      const weatherByMonth: {
        avgTemp: number | null;
        avgPrecip: number | null;
        outdoorScore: number | null;
        avgRainChance: number | null;
      }[] = Array(12).fill(null).map(() => ({
        avgTemp: null, avgPrecip: null, outdoorScore: null, avgRainChance: null,
      }));

      // Group rows by month index
      const weatherByMonthAcc: Record<number, { temps: number[]; precips: number[]; scores: number[]; rain: number[] }> = {};
      for (const w of rawWeatherRows) {
        const mi = (w.month as number) - 1;
        if (mi < 0 || mi > 11) continue;
        if (!weatherByMonthAcc[mi]) weatherByMonthAcc[mi] = { temps: [], precips: [], scores: [], rain: [] };
        if (w.avg_temp_4pm_f   != null) weatherByMonthAcc[mi].temps.push(w.avg_temp_4pm_f);
        if (w.total_precip     != null) weatherByMonthAcc[mi].precips.push(w.total_precip);
        if (w.outdoor_score    != null) weatherByMonthAcc[mi].scores.push(w.outdoor_score);
        if (w.avg_rain_chance_pct != null) weatherByMonthAcc[mi].rain.push(w.avg_rain_chance_pct);
      }
      const meanArr = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
      for (const [mi, acc] of Object.entries(weatherByMonthAcc)) {
        const idx = Number(mi);
        weatherByMonth[idx] = {
          avgTemp:      acc.temps.length   ? Math.round(meanArr(acc.temps)!)   : null,
          avgPrecip:    acc.precips.length  ? Math.round(meanArr(acc.precips)! * 10) / 10 : null,
          outdoorScore: acc.scores.length   ? Math.round(meanArr(acc.scores)! * 10) / 10  : null,
          avgRainChance: acc.rain.length    ? Math.round(meanArr(acc.rain)!)   : null,
        };
      }

      // Search trends: split by category, average by month across all weeks
      const VENUE_TERMS      = ["wedding venue", "wedding venues"];
      const ENGAGEMENT_TERMS = ["engagement ring", "how to propose"];
      const DIVORCE_TERMS    = ["divorce lawyer"];

      function avgTrendsByMonth(terms: string[]): (number | null)[] {
        const acc: number[][] = Array(12).fill(null).map(() => []);
        for (const t of (trendsRes as any).data ?? []) {
          if (!terms.includes(t.term)) continue;
          const weekStr: string = t.week;
          if (!weekStr) continue;
          const m = new Date(weekStr).getMonth();
          if (m >= 0 && m < 12 && t.interest != null) acc[m].push(t.interest);
        }
        return acc.map(a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
      }

      // YoY: current calendar year vs prior calendar year, count by month
      const currentYear = new Date().getFullYear();
      const priorYear   = currentYear - 1;
      function countByMonthYear(dates: (string | null)[], year: number): number[] {
        const counts = Array(12).fill(0);
        for (const d of dates) {
          if (!d) continue;
          const dt = new Date(d);
          if (dt.getFullYear() === year) counts[dt.getMonth()]++;
        }
        return counts;
      }
      const inqThisYear = countByMonthYear(
        (inquiriesRes.data ?? []).map((r: any) => r.received_at), currentYear
      );
      const inqLastYear = countByMonthYear(
        (inquiriesRes.data ?? []).map((r: any) => r.received_at), priorYear
      );

      const trendsByMonth     = avgTrendsByMonth(VENUE_TERMS);
      const engagementByMonth = avgTrendsByMonth(ENGAGEMENT_TERMS);
      const divorceByMonth    = avgTrendsByMonth(DIVORCE_TERMS);

      return {
        months: MONTHS.map((label, m) => ({
          month:          label,
          monthNum:       m + 1,
          // Saves removed — leads table has no data yet; return 0 gracefully
          saves:          0,
          inquiries:      inquiriesByMonth[m],
          tours:          toursByMonth[m],
          events:         eventsByMonth[m],
          booked:         bookedByMonth[m],
          contractedAt:   contractedByMonth[m],
          weather:        weatherByMonth[m],
          searchTrend:    trendsByMonth[m],
          engagementTrend: engagementByMonth[m],
          divorceTrend:   divorceByMonth[m],
          yoy: {
            savesThis: 0,
            savesLast: 0,
            inqThis:  inqThisYear[m],
            inqLast:  inqLastYear[m],
          },
        })),
        weatherGrid:  [],
        weatherYears: [],
        currentYear,
        priorYear,
      };
    }),

  // Stage pipeline — current snapshot of how many records sit at each stage
  stagePipeline: venueProcedure.query(async ({ ctx }) => {
    const [clientsRes, inquiriesRes, toursRes] = await Promise.all([
      ctx.db
        .from("clients")
        .select("status, inquired_at, toured_at, held_at, contracted_at, event_date, revenue_cents")
        .eq("venue_id", ctx.venueId),
      ctx.db
        .from("inquiries")
        .select("id, received_at, match_status")
        .eq("venue_id", ctx.venueId),
      ctx.db
        .from("tours")
        .select("scheduled_at, completed, booking_conversion_days")
        .eq("venue_id", ctx.venueId),
    ]);

    const clients   = clientsRes.data  ?? [];
    const inquiries = inquiriesRes.data ?? [];
    const tours     = toursRes.data    ?? [];

    // Stage counts — using authoritative status values
    const stageCounts = {
      discovery:           0,  // leads table has no data yet
      inquiries:           inquiries.length,
      unmatchedInquiries:  inquiries.filter((i: any) => i.match_status === "unmatched").length,
      tourBooked:          clients.filter((c: any) => c.status === "tour_booked").length,
      toured:              clients.filter((c: any) => c.status === "toured").length,
      held:                clients.filter((c: any) => c.status === "held").length,
      contracted:          clients.filter((c: any) => c.status === "contracted").length,
      completed:           clients.filter((c: any) => c.status === "event_complete").length,
    };

    // Lead time distributions
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
    const postInquiryCount =
      stageCounts.tourBooked + stageCounts.toured + stageCounts.held +
      stageCounts.contracted + stageCounts.completed;

    const inquiryToTourRate =
      inquiries.length > 0 ? postInquiryCount / inquiries.length : null;
    const tourToBookRate =
      postInquiryCount > 0
        ? (stageCounts.contracted + stageCounts.completed) / postInquiryCount
        : null;

    // Revenue at risk: clients in held status
    const heldClients = clients.filter((c: any) => c.status === "held");
    const revenueAtRisk = heldClients.reduce((sum: number, c: any) => {
      return sum + ((c.revenue_cents as number | null) ?? 0);
    }, 0);

    return {
      stageCounts,
      leadTimes: {
        inquiryToEventDays:     inquiryToEvent,
        tourToContractDays:     tourToContract,
        contractToEventDays:    contractToEvent,
        medianTourBookingDays:  medianTourBooking,
      },
      conversionRates: {
        discoveryToInquiry: null,
        inquiryToTour:      inquiryToTourRate,
        tourToBook:         tourToBookRate,
      },
      holds: {
        total:              heldClients.length,
        expiringSoon:       0,  // hold_expires_at not in schema
        revenueAtRiskCents: revenueAtRisk,
      },
    };
  }),

  // Hold alerts — clients on held status, ordered by event date urgency
  // Note: hold_expires_at is not in the schema; we surface held clients by event date proximity
  getHoldAlerts: venueProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const { data, error } = await ctx.db
      .from("clients")
      .select("id, name_primary, name_partner, event_date, revenue_cents, status")
      .eq("venue_id", ctx.venueId)
      .eq("status", "held")
      .not("event_date", "is", null)
      .order("event_date", { ascending: true });

    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

    return (data ?? []).map((c: any) => {
      const eventDate = new Date(c.event_date);
      const daysToEvent = Math.round((eventDate.getTime() - now.getTime()) / 86400000);
      return {
        id:            c.id as string,
        name:          [c.name_primary, c.name_partner].filter(Boolean).join(" & "),
        eventDate:     c.event_date as string | null,
        revenueCents:  c.revenue_cents as number | null,
        holdExpiresAt: null,  // not in schema
        daysLeft:      daysToEvent,
        urgent:        daysToEvent <= 30,
      };
    });
  }),

  // Lost deal analysis — lost clients
  getLostReasons: venueProcedure.query(async ({ ctx }) => {
    const { data: toursData, error: toursError } = await ctx.db
      .from("tours")
      .select("lost_reason, client_id")
      .eq("venue_id", ctx.venueId)
      .not("lost_reason", "is", null);

    if (toursError) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: toursError.message });

    // Also pull lost status clients
    const { data: clientsData } = await ctx.db
      .from("clients")
      .select("name_primary, name_partner, event_date, revenue_cents")
      .eq("venue_id", ctx.venueId)
      .eq("status", "lost");

    // Aggregate tour lost_reasons
    const reasonMap = new Map<string, { count: number; revenueLostCents: number }>();
    for (const t of toursData ?? []) {
      const r = (t.lost_reason as string) ?? "unknown";
      if (!reasonMap.has(r)) reasonMap.set(r, { count: 0, revenueLostCents: 0 });
      reasonMap.get(r)!.count++;
    }

    const total = (toursData ?? []).length;
    const breakdown = Array.from(reasonMap.entries())
      .map(([reason, s]) => ({
        reason,
        count:             s.count,
        pct:               total > 0 ? Math.round((s.count / total) * 1000) / 10 : 0,
        revenueLostCents:  s.revenueLostCents,
      }))
      .sort((a, b) => b.count - a.count);

    return { total, breakdown, lostClientCount: (clientsData ?? []).length };
  }),

  // Revenue by year/month
  revenueOverTime: venueProcedure
    .input(z.object({
      years: z.number().int().default(3),
      dateFrom: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const fromYear = input.dateFrom
        ? new Date(input.dateFrom).getFullYear()
        : new Date().getFullYear() - input.years + 1;

      let query = ctx.db
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
          eventCount:   stats.count,
          avgRevenue:   Math.round(stats.totalRevenue / stats.count),
        }));
    }),

  // Booking horizon — how far in advance couples book
  getBookingHorizon: venueProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.db
      .from("clients")
      .select("inquired_at, event_date, status")
      .eq("venue_id", ctx.venueId)
      .not("inquired_at", "is", null)
      .not("event_date", "is", null)
      .not("status", "in", '("inquiry","archived","lost")');

    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

    const rows = data ?? [];
    const daysList: number[] = [];

    for (const row of rows) {
      const inquiry = new Date(row.inquired_at as string);
      const event   = new Date(row.event_date as string);
      const days    = Math.round((event.getTime() - inquiry.getTime()) / 86400000);
      if (days >= 0) daysList.push(days);
    }

    daysList.sort((a, b) => a - b);

    const total = daysList.length;

    const buckets: { label: string; min: number; max: number }[] = [
      { label: "Under 6 months",  min: 0,   max: 179      },
      { label: "6–12 months",     min: 180, max: 364      },
      { label: "12–18 months",    min: 365, max: 546      },
      { label: "18–24 months",    min: 547, max: 729      },
      { label: "Over 24 months",  min: 730, max: Infinity },
    ];

    const bucketCounts = buckets.map((b) => ({
      label: b.label,
      count: daysList.filter((d) => d >= b.min && d <= b.max).length,
    }));

    const result = bucketCounts.map((b) => ({
      label: b.label,
      count: b.count,
      pct:   total > 0 ? Math.round((b.count / total) * 1000) / 10 : 0,
    }));

    const p = (pct: number) =>
      daysList.length > 0 ? daysList[Math.floor(daysList.length * pct)] ?? null : null;

    return {
      buckets: result,
      median:  p(0.5),
      p25:     p(0.25),
      p75:     p(0.75),
    };
  }),

  // Capacity outlook — contracted events + scheduled tours per month for 18 months
  getCapacityOutlook: venueProcedure.query(async ({ ctx }) => {
    const now        = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const monthStartIso = monthStart.toISOString().split("T")[0];

    const [clientsRes, toursRes] = await Promise.all([
      ctx.db
        .from("clients")
        .select("event_date, status")
        .eq("venue_id", ctx.venueId)
        .in("status", ["contracted", "event_complete"])
        .not("event_date", "is", null)
        .gte("event_date", monthStartIso),
      ctx.db
        .from("tours")
        .select("scheduled_at")
        .eq("venue_id", ctx.venueId)
        .eq("completed", false)
        .is("cancel_reason", null)
        .not("scheduled_at", "is", null)
        .gte("scheduled_at", monthStart.toISOString()),
    ]);

    if (clientsRes.error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: clientsRes.error.message });
    if (toursRes.error)   throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: toursRes.error.message });

    // Build map for next 18 months
    const months: { month: string; contractedEvents: number; scheduledTours: number }[] = [];
    for (let i = 0; i < 18; i++) {
      const d   = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      months.push({ month: key, contractedEvents: 0, scheduledTours: 0 });
    }

    const monthMap = new Map(months.map((m) => [m.month, m]));

    for (const client of clientsRes.data ?? []) {
      const d   = new Date(client.event_date as string);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const entry = monthMap.get(key);
      if (entry) entry.contractedEvents++;
    }

    for (const tour of toursRes.data ?? []) {
      const d   = new Date(tour.scheduled_at as string);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const entry = monthMap.get(key);
      if (entry) entry.scheduledTours++;
    }

    return months;
  }),

  // Response time analytics — combines inquiries.response_time_minutes + clients.response_time_minutes
  getResponseTimes: venueProcedure.query(async ({ ctx }) => {
    const [inquiriesRes, clientsRes] = await Promise.all([
      ctx.db
        .from("inquiries")
        .select("response_time_minutes, day_of_week, responded_by")
        .eq("venue_id", ctx.venueId)
        .not("response_time_minutes", "is", null),
      ctx.db
        .from("clients")
        .select("response_time_minutes, first_response_at, inquired_at")
        .eq("venue_id", ctx.venueId)
        .not("response_time_minutes", "is", null),
    ]);

    // Merge response times from both sources; prefer inquiry rows (they have day_of_week)
    type ResponseRow = { response_time_minutes: number; day_of_week: number | null; responded_by: string | null };
    const rows: ResponseRow[] = [];

    for (const r of inquiriesRes.data ?? []) {
      rows.push({
        response_time_minutes: r.response_time_minutes as number,
        day_of_week:           r.day_of_week as number | null,
        responded_by:          (r as any).responded_by as string | null,
      });
    }
    // Add client-level response times not already covered by inquiries
    for (const r of clientsRes.data ?? []) {
      rows.push({
        response_time_minutes: r.response_time_minutes as number,
        day_of_week:           null,
        responded_by:          null,
      });
    }

    const times = rows.map(r => r.response_time_minutes).sort((a, b) => a - b);
    const total = times.length;

    if (total === 0) {
      return {
        avg: null, median: null,
        under5min: 0, under1hr: 0, under24hr: 0, over24hr: 0,
        total: 0,
        byDayOfWeek: Array.from({ length: 7 }, (_, day) => ({ day, avgMinutes: null })),
      };
    }

    const avg    = Math.round(times.reduce((a, b) => a + b, 0) / total);
    const median = times[Math.floor(total / 2)];
    const under5min  = times.filter((t) => t < 5).length;
    const under1hr   = times.filter((t) => t < 60).length;
    const under24hr  = times.filter((t) => t < 1440).length;
    const over24hr   = times.filter((t) => t >= 1440).length;

    // Average by day of week
    const dowAccum: number[][] = Array.from({ length: 7 }, () => []);
    for (const row of rows) {
      const dow = row.day_of_week;
      if (dow != null && dow >= 0 && dow < 7) dowAccum[dow].push(row.response_time_minutes);
    }

    const byDayOfWeek = dowAccum.map((vals, day) => ({
      day,
      avgMinutes: vals.length > 0
        ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
        : null,
    }));

    // Average response time per coordinator
    const coordAccum = new Map<string, number[]>();
    for (const row of rows) {
      if (row.responded_by) {
        if (!coordAccum.has(row.responded_by)) coordAccum.set(row.responded_by, []);
        coordAccum.get(row.responded_by)!.push(row.response_time_minutes);
      }
    }
    const byCoordinator = Array.from(coordAccum.entries())
      .map(([name, vals]) => ({
        name,
        avgMinutes: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
        count: vals.length,
      }))
      .sort((a, b) => a.avgMinutes - b.avgMinutes);

    return { avg, median, under5min, under1hr, under24hr, over24hr, total, byDayOfWeek, byCoordinator };
  }),

  // Revenue projection — actual past 12 months + projected next 12 months
  getRevenueProjection: venueProcedure.query(async ({ ctx }) => {
    const now         = new Date();
    const past12Start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const future12End = new Date(now.getFullYear(), now.getMonth() + 12, 1);

    const { data: clients, error } = await ctx.db
      .from("clients")
      .select("event_date, revenue_cents, status")
      .eq("venue_id", ctx.venueId)
      .in("status", ["contracted", "event_complete"])
      .not("event_date", "is", null)
      .gte("event_date", past12Start.toISOString().split("T")[0])
      .lte("event_date", future12End.toISOString().split("T")[0]);

    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

    // Build 24-month period array
    const periodMap = new Map<string, {
      actualRevenue: number; projectedRevenue: number; isProjection: boolean; eventCount: number;
    }>();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    for (let i = -11; i <= 12; i++) {
      const d   = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const isProjection = key > currentMonthKey;
      periodMap.set(key, { actualRevenue: 0, projectedRevenue: 0, isProjection, eventCount: 0 });
    }

    let totalContractedRevenue = 0;
    let totalProjectedRevenue  = 0;

    for (const client of clients ?? []) {
      const d   = new Date(client.event_date as string);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const entry = periodMap.get(key);
      if (!entry) continue;

      entry.eventCount++;
      const rev = (client.revenue_cents as number | null) ?? 0;

      if (entry.isProjection) {
        entry.projectedRevenue += rev;
        totalProjectedRevenue  += rev;
      } else {
        entry.actualRevenue      += rev;
        totalContractedRevenue   += rev;
      }
    }

    const months = Array.from(periodMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, data]) => ({ period, ...data }));

    return { months, totalContractedRevenue, totalProjectedRevenue };
  }),

  // Review language analysis — word frequency from clients.review_text
  getReviewLanguage: venueProcedure.query(async ({ ctx }) => {
    const { data } = await ctx.db
      .from("clients")
      .select("review_text, review_star_rating")
      .eq("venue_id", ctx.venueId)
      .not("review_text", "is", null);

    // Also pull from dedicated reviews table if it has data
    const { data: reviewsData } = await ctx.db
      .from("reviews")
      .select("review_text, rating")
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

    const processText = (text: string, rating: number | null) => {
      const isPos = rating !== null && rating >= 4;
      const isNeg = rating !== null && rating <= 3;

      const words = text
        .toLowerCase()
        .replace(/[^a-z\s'-]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3 && !STOP.has(w) && !/^\d+$/.test(w));

      for (const word of words) {
        const clean = word.replace(/^'+|'+$/g, "");
        if (clean.length < 4) continue;
        if (!wordMap.has(clean)) wordMap.set(clean, { count: 0, posCount: 0, negCount: 0 });
        const entry = wordMap.get(clean)!;
        entry.count++;
        if (isPos) entry.posCount++;
        if (isNeg) entry.negCount++;
      }
    };

    for (const client of data ?? []) {
      if (client.review_text) processText(client.review_text as string, client.review_star_rating as number | null);
    }
    for (const rev of reviewsData ?? []) {
      if (rev.review_text) processText(rev.review_text as string, rev.rating as number | null);
    }

    const reviewCount = (data ?? []).length + (reviewsData ?? []).length;
    const words = Array.from(wordMap.entries())
      .filter(([, v]) => v.count >= 2)
      .map(([word, stats]) => ({ word, ...stats }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 80);

    return { reviewCount, words };
  }),

  // Website traffic — reads from website_traffic table (GA import data)
  getWebsiteTraffic: venueProcedure
    .input(z.object({ months: z.number().int().default(12) }))
    .query(async ({ ctx, input }) => {
      const fromDate = new Date();
      fromDate.setMonth(fromDate.getMonth() - input.months);
      const fromStr = fromDate.toISOString().split("T")[0];

      const { data, error } = await ctx.db
        .from("website_traffic")
        .select("date, sessions, users, new_users, pageviews, bounce_rate, avg_session_duration_seconds, source, medium")
        .eq("venue_id", ctx.venueId)
        .gte("date", fromStr)
        .order("date", { ascending: true });

      if (error || !data || data.length === 0) {
        return { monthly: [], topSources: [], totalSessions: 0, hasData: false };
      }

      // Aggregate by month
      const monthMap = new Map<string, { sessions: number; users: number; pageviews: number; newUsers: number }>();
      for (const row of data) {
        const ym = (row.date as string).substring(0, 7);
        if (!monthMap.has(ym)) monthMap.set(ym, { sessions: 0, users: 0, pageviews: 0, newUsers: 0 });
        const m = monthMap.get(ym)!;
        m.sessions += (row.sessions as number) ?? 0;
        m.users += (row.users as number) ?? 0;
        m.pageviews += (row.pageviews as number) ?? 0;
        m.newUsers += (row.new_users as number) ?? 0;
      }

      const monthly = Array.from(monthMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, stats]) => ({ month, ...stats }));

      // Top sources
      const sourceMap = new Map<string, number>();
      for (const row of data) {
        const src = (row.source as string) ?? "direct";
        sourceMap.set(src, (sourceMap.get(src) ?? 0) + ((row.sessions as number) ?? 0));
      }
      const topSources = Array.from(sourceMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([source, sessions]) => ({ source, sessions }));

      const totalSessions = data.reduce((s, r) => s + ((r.sessions as number) ?? 0), 0);

      return { monthly, topSources, totalSessions, hasData: true };
    }),

  // Competing venue mentions — from clients.competing_venues + tours.competing_venues
  getCompetingVenuesMentions: venueProcedure.query(async ({ ctx }) => {
    const [{ data: clients }, { data: tours }] = await Promise.all([
      ctx.db
        .from("clients")
        .select("competing_venues")
        .eq("venue_id", ctx.venueId)
        .not("competing_venues", "eq", "{}"),
      ctx.db
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
        totalMentions:  stats.clientMentions + stats.tourMentions,
        clientMentions: stats.clientMentions,
        tourMentions:   stats.tourMentions,
      }))
      .sort((a, b) => b.totalMentions - a.totalMentions);
  }),

  // Capacity & Yield — monthly occupancy and pricing signals for a given year
  getCapacityYield: venueProcedure
    .input(z.object({ year: z.number().int().default(new Date().getFullYear()) }))
    .query(async ({ ctx, input }) => {
      // Fetch venue's configured capacity alongside clients
      const [{ data: venue }, { data: clients }] = await Promise.all([
        ctx.db
          .from("venues")
          .select("max_events_per_month")
          .eq("id", ctx.venueId)
          .single(),
        ctx.db
          .from("clients")
          .select("event_date, status, revenue_cents")
          .eq("venue_id", ctx.venueId)
          .gte("event_date", `${input.year}-01-01`)
          .lte("event_date", `${input.year}-12-31`),
      ]);

      const maxPerMonth: number = (venue as any)?.max_events_per_month ?? 4;

      type MonthData = {
        month: number;
        bookedDates: number;
        heldDates: number;
        revenueCents: number;
        totalAvailableDates: number;
      };

      const byMonth = new Map<number, MonthData>();
      for (let m = 1; m <= 12; m++) {
        byMonth.set(m, { month: m, bookedDates: 0, heldDates: 0, revenueCents: 0, totalAvailableDates: maxPerMonth });
      }

      for (const client of clients ?? []) {
        if (!client.event_date) continue;
        const month = new Date(client.event_date).getMonth() + 1;
        const row = byMonth.get(month)!;
        if (["contracted", "event_complete"].includes(client.status)) {
          row.bookedDates++;
          row.revenueCents += (client.revenue_cents as number) ?? 0;
        } else if (client.status === "held") {
          row.heldDates++;
        }
      }

      const months = Array.from(byMonth.values()).map((row) => {
        const occupancyPct = row.totalAvailableDates > 0
          ? Math.round(((row.bookedDates + row.heldDates) / row.totalAvailableDates) * 100)
          : 0;
        const avgRevenue = row.bookedDates > 0 ? Math.round(row.revenueCents / row.bookedDates) : null;
        const isPeak = [4, 5, 6, 9, 10].includes(row.month);
        const suggestedAdj = occupancyPct >= 75 ? 10 : occupancyPct >= 50 ? 5 : occupancyPct <= 25 ? -10 : 0;
        return {
          month: row.month,
          bookedDates: row.bookedDates,
          heldDates: row.heldDates,
          totalAvailableDates: row.totalAvailableDates,
          occupancyPct,
          avgRevenueCents: avgRevenue,
          isPeak,
          suggestedPriceAdjPct: suggestedAdj,
        };
      });

      const totalBooked = months.reduce((s, m) => s + m.bookedDates, 0);
      const totalRevenue = Array.from(byMonth.values()).reduce((s, m) => s + m.revenueCents, 0);
      const totalSlots = maxPerMonth * 12;
      const overallOccupancy = totalSlots > 0 ? Math.round((totalBooked / totalSlots) * 100) : 0;

      return { months, totalBooked, totalRevenue, overallOccupancy, year: input.year };
    }),

  // ── VENUE HEALTH SCORE ─────────────────────────────────────────────────────
  // Composite 0–100 score across 5 dimensions with per-dimension breakdown.
  getHealthScore: venueProcedure.query(async ({ ctx }) => {
    const [
      { data: clients },
      { data: reviews },
      { data: inquiries },
    ] = await Promise.all([
      ctx.db
        .from("clients")
        .select("status, resolved_source, revenue_cents")
        .eq("venue_id", ctx.venueId),
      ctx.db
        .from("reviews")
        .select("rating")
        .eq("venue_id", ctx.venueId),
      ctx.db
        .from("inquiries")
        .select("response_time_minutes")
        .eq("venue_id", ctx.venueId)
        .not("response_time_minutes", "is", null),
    ]);

    const all = clients ?? [];
    const rev = reviews ?? [];
    const inq = inquiries ?? [];

    // 1. Reputation (25 pts) — avg review rating / 5 * 25
    const rated = rev.filter((r) => r.rating !== null);
    const avgRating = rated.length > 0
      ? rated.reduce((s, r) => s + r.rating, 0) / rated.length
      : null;
    const reputationScore = avgRating !== null ? Math.round((avgRating / 5) * 25) : 0;

    // 2. Conversion (25 pts) — contracted+event_complete / active pipeline
    const active = all.filter(c => !["archived", "lost"].includes(c.status));
    const converted = all.filter(c => ["contracted", "event_complete"].includes(c.status));
    const conversionRate = active.length > 0 ? converted.length / active.length : 0;
    const conversionScore = Math.round(Math.min(conversionRate / 0.4, 1) * 25);

    // 3. Attribution (20 pts) — % of clients with resolved_source
    const attributed = all.filter(c => c.resolved_source).length;
    const attributionRate = all.length > 0 ? attributed / all.length : 0;
    const attributionScore = Math.round(attributionRate * 20);

    // 4. Response speed (15 pts) — avg response time (0 min=15pts, 480 min=0pts)
    const withTimes = inq.filter(i => i.response_time_minutes !== null);
    const avgResponseMin = withTimes.length > 0
      ? withTimes.reduce((s, i) => s + (i.response_time_minutes as number), 0) / withTimes.length
      : null;
    const responseScore = avgResponseMin !== null
      ? Math.round(Math.max(0, 1 - avgResponseMin / 480) * 15)
      : 0;

    // 5. Revenue data completeness (15 pts)
    const billable = all.filter(c => ["contracted", "event_complete"].includes(c.status));
    const withRevenue = billable.filter(c => c.revenue_cents && (c.revenue_cents as number) > 0);
    const revenueScore = billable.length > 0
      ? Math.round((withRevenue.length / billable.length) * 15)
      : 0;

    const total = reputationScore + conversionScore + attributionScore + responseScore + revenueScore;

    return {
      total,
      grade: total >= 85 ? "A" : total >= 70 ? "B" : total >= 55 ? "C" : total >= 40 ? "D" : "F",
      dimensions: [
        { label: "Reputation",   score: reputationScore,  max: 25, detail: avgRating !== null ? `${avgRating.toFixed(1)}★ avg (${rated.length} reviews)` : "No reviews yet" },
        { label: "Conversion",   score: conversionScore,  max: 25, detail: active.length > 0 ? `${Math.round(conversionRate * 100)}% close rate` : "No data" },
        { label: "Attribution",  score: attributionScore, max: 20, detail: all.length > 0 ? `${Math.round(attributionRate * 100)}% sources tracked` : "No data" },
        { label: "Speed",        score: responseScore,    max: 15, detail: avgResponseMin !== null ? `${Math.round(avgResponseMin)} min avg response` : "No response data" },
        { label: "Revenue data", score: revenueScore,     max: 15, detail: billable.length > 0 ? `${withRevenue.length}/${billable.length} clients have revenue` : "No bookings yet" },
      ],
    };
  }),

  // ── SOURCE DETAIL ─────────────────────────────────────────────────────────
  // Deep-dive on a single resolved_source: monthly trend, funnel, intent split,
  // touchpoint depth, spend, cost metrics, and individual clients.
  getSourceDetail: venueProcedure
    .input(z.object({
      source: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const [
        { data: clients },
        { data: spend },
        { data: touchpoints },
        { data: inquiryRows },
      ] = await Promise.all([
        // All clients attributed to this source, all time
        ctx.db
          .from("clients")
          .select("id, name_primary, name_partner, event_date, status, revenue_cents, inquired_at, inquiry_intent, inquiry_channel, complexity_score")
          .eq("venue_id", ctx.venueId)
          .eq("resolved_source", input.source)
          .order("inquired_at", { ascending: false }),
        // All channel spend for this source (normalized key match handled in-memory)
        ctx.db
          .from("channel_spend")
          .select("month, amount_cents, channel")
          .eq("venue_id", ctx.venueId)
          .order("month", { ascending: true }),
        // Touchpoints linked to clients for this source
        ctx.db
          .from("client_source_touchpoints")
          .select("client_id, platform, touchpoint_date, cost_cents")
          .eq("venue_id", ctx.venueId),
        // Inquiry-level data to get intent breakdown
        ctx.db
          .from("inquiries")
          .select("matched_client_id, inquiry_intent, first_contact_channel, received_at")
          .eq("venue_id", ctx.venueId)
          .not("matched_client_id", "is", null),
      ]);

      const clientList = clients ?? [];
      const clientIds = new Set(clientList.map((c) => c.id));

      // Normalize spend channel → source matching
      function normalizeKey(s: string): string {
        return s.toLowerCase().replace(/[\s\-–—&]+/g, "_").replace(/[^a-z0-9_]/g, "").replace(/_+/g, "_");
      }
      const sourceKey = normalizeKey(input.source);

      // Spend per month for this source
      const spendByMonth = new Map<string, number>();
      for (const row of spend ?? []) {
        if (normalizeKey(row.channel ?? "") === sourceKey) {
          const m = (row.month ?? "").substring(0, 7);
          spendByMonth.set(m, (spendByMonth.get(m) ?? 0) + (row.amount_cents ?? 0));
        }
      }

      // Touchpoints per client (only for clients in this source)
      const touchpointsByClient = new Map<string, number>();
      for (const tp of touchpoints ?? []) {
        if (clientIds.has(tp.client_id)) {
          touchpointsByClient.set(tp.client_id, (touchpointsByClient.get(tp.client_id) ?? 0) + 1);
        }
      }

      // Intent breakdown from inquiries table (for clients in this source)
      const intentByClient = new Map<string, string>();
      for (const row of inquiryRows ?? []) {
        if (row.matched_client_id && clientIds.has(row.matched_client_id)) {
          intentByClient.set(row.matched_client_id, row.inquiry_intent ?? "unknown");
        }
      }

      // Monthly breakdown — keyed YYYY-MM
      const monthMap = new Map<string, {
        yearMonth: string;
        inquiries: number;
        toured: number;
        booked: number;
        revenueCents: number;
        chosen: number;
        blast: number;
        spendCents: number;
      }>();

      for (const c of clientList) {
        const rawDate = c.inquired_at ?? c.event_date;
        if (!rawDate) continue;
        const ym = String(rawDate).substring(0, 7);
        if (!monthMap.has(ym)) monthMap.set(ym, {
          yearMonth: ym, inquiries: 0, toured: 0, booked: 0, revenueCents: 0,
          chosen: 0, blast: 0, spendCents: spendByMonth.get(ym) ?? 0,
        });
        const m = monthMap.get(ym)!;
        m.inquiries++;
        if (["toured", "held", "contracted", "event_complete", "lost"].includes(c.status ?? "")) m.toured++;
        if (["contracted", "event_complete"].includes(c.status ?? "")) {
          m.booked++;
          m.revenueCents += (c.revenue_cents as number) ?? 0;
        }
        const intent = intentByClient.get(c.id) ?? c.inquiry_intent ?? "unknown";
        if (intent === "chosen") m.chosen++;
        else if (intent === "also_contacted") m.blast++;
      }

      // Fill in spend for months with spend but no inquiries
      for (const [ym, cents] of spendByMonth) {
        if (!monthMap.has(ym)) monthMap.set(ym, {
          yearMonth: ym, inquiries: 0, toured: 0, booked: 0, revenueCents: 0,
          chosen: 0, blast: 0, spendCents: cents,
        });
        else monthMap.get(ym)!.spendCents = cents;
      }

      const months = Array.from(monthMap.values()).sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));

      // Overall funnel totals
      const totalInquiries  = clientList.length;
      const totalToured     = clientList.filter(c => ["toured","held","contracted","event_complete","lost"].includes(c.status ?? "")).length;
      const totalBooked     = clientList.filter(c => ["contracted","event_complete"].includes(c.status ?? "")).length;
      const totalRevenue    = clientList.reduce((s, c) => s + ((c.revenue_cents as number) ?? 0), 0);
      const totalSpend      = Array.from(spendByMonth.values()).reduce((s, v) => s + v, 0);
      const totalChosen     = clientList.filter(c => (intentByClient.get(c.id) ?? c.inquiry_intent) === "chosen").length;
      const totalBlast      = clientList.filter(c => (intentByClient.get(c.id) ?? c.inquiry_intent) === "also_contacted").length;

      // Intent-filtered conversion rates
      const chosenBooked    = clientList.filter(c =>
        ["contracted","event_complete"].includes(c.status ?? "") &&
        (intentByClient.get(c.id) ?? c.inquiry_intent) === "chosen"
      ).length;
      const blastBooked     = clientList.filter(c =>
        ["contracted","event_complete"].includes(c.status ?? "") &&
        (intentByClient.get(c.id) ?? c.inquiry_intent) === "also_contacted"
      ).length;

      // Avg touchpoints per inquiry
      const clientsWithTouchpoints = clientList.filter(c => (touchpointsByClient.get(c.id) ?? 0) > 0);
      const avgTouchpoints = clientsWithTouchpoints.length > 0
        ? Math.round(clientsWithTouchpoints.reduce((s, c) => s + (touchpointsByClient.get(c.id) ?? 0), 0) / clientsWithTouchpoints.length * 10) / 10
        : null;

      // 12-month rolling average inquiries/month
      const recentMonths = months.slice(-12);
      const avgInquiriesPerMonth = recentMonths.length > 0
        ? Math.round((recentMonths.reduce((s, m) => s + m.inquiries, 0) / recentMonths.length) * 10) / 10
        : 0;

      return {
        source: input.source,
        months,
        // Funnel totals
        totalInquiries,
        totalToured,
        totalBooked,
        totalRevenue,
        totalSpend,
        tourRate: totalInquiries > 0 ? totalToured / totalInquiries : 0,
        bookingRate: totalInquiries > 0 ? totalBooked / totalInquiries : 0,
        avgRevenueCents: totalBooked > 0 ? Math.round(totalRevenue / totalBooked) : null,
        costPerTour: (totalSpend > 0 && totalToured > 0) ? Math.round(totalSpend / totalToured) : null,
        costPerBooking: (totalSpend > 0 && totalBooked > 0) ? Math.round(totalSpend / totalBooked) : null,
        // Intent breakdown
        totalChosen,
        totalBlast,
        blastRate: (totalChosen + totalBlast) > 0 ? totalBlast / (totalChosen + totalBlast) : 0,
        chosenBookingRate: totalChosen > 0 ? chosenBooked / totalChosen : null,
        blastBookingRate: totalBlast > 0 ? blastBooked / totalBlast : null,
        // Touchpoints
        avgTouchpoints,
        avgInquiriesPerMonth,
        // Individual clients (most recent 50)
        clients: clientList.slice(0, 50).map(c => ({
          id: c.id,
          name: c.name_primary,
          partner: c.name_partner,
          status: c.status,
          eventDate: c.event_date,
          inquiredAt: c.inquired_at,
          revenueCents: c.revenue_cents,
          intent: intentByClient.get(c.id) ?? c.inquiry_intent ?? "unknown",
          touchpointCount: touchpointsByClient.get(c.id) ?? 0,
        })),
      };
    }),

  // List all unique resolved_source values for this venue (for dropdown)
  listSources: venueProcedure.query(async ({ ctx }) => {
    const { data } = await ctx.db
      .from("clients")
      .select("resolved_source")
      .eq("venue_id", ctx.venueId)
      .not("resolved_source", "is", null);

    const counts = new Map<string, number>();
    for (const row of data ?? []) {
      const s = row.resolved_source as string;
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }

    // Also include channels from channel_spend that may not yet have attributed clients
    const { data: spendData } = await ctx.db
      .from("channel_spend")
      .select("channel")
      .eq("venue_id", ctx.venueId);

    const sources = Array.from(counts.entries())
      .map(([source, count]) => ({ source, clientCount: count, hasSpend: false }))
      .sort((a, b) => b.clientCount - a.clientCount);

    // Mark which have spend
    const spendChannels = new Set((spendData ?? []).map((r: any) => r.channel));
    function normalizeKey(s: string) {
      return s.toLowerCase().replace(/[\s\-–—&]+/g, "_").replace(/[^a-z0-9_]/g, "").replace(/_+/g, "_");
    }
    for (const s of sources) {
      s.hasSpend = spendChannels.has(s.source) || Array.from(spendChannels).some(ch => normalizeKey(ch) === normalizeKey(s.source));
    }

    return sources;
  }),

  // ═══════════════════════════════════════════════════════════════════════
  // CROSS-TABLE INTELLIGENCE
  // Connects data across tables to tell stories about speed, efficiency,
  // ROI, and performance. Each insight links multiple data sources.
  // ═══════════════════════════════════════════════════════════════════════
  getCrossIntelligence: venueProcedure.query(async ({ ctx }) => {
    // Pull everything we need in parallel
    const [
      { data: clients },
      { data: inquiries },
      { data: tours },
      { data: reviews },
      { data: referralRows },
      { data: socialPosts },
    ] = await Promise.all([
      ctx.db.from("clients")
        .select("id, status, revenue_cents, resolved_source, response_time_minutes, assigned_coordinator, event_date, event_month, inquired_at, referrals_generated, review_star_rating, review_submitted, competing_venues, guest_count_initial, first_touch_platform")
        .eq("venue_id", ctx.venueId),
      ctx.db.from("inquiries")
        .select("id, response_time_minutes, matched_client_id, inquiry_intent, received_at, day_of_week, hour_of_day, responded_by")
        .eq("venue_id", ctx.venueId),
      ctx.db.from("tours")
        .select("client_id, conducted_by, completed, outcome, competing_venues")
        .eq("venue_id", ctx.venueId),
      ctx.db.from("reviews")
        .select("matched_client_id, rating, review_text")
        .eq("venue_id", ctx.venueId)
        .not("rating", "is", null),
      ctx.db.from("referrals")
        .select("referring_client_id, referred_client_id, converted")
        .eq("venue_id", ctx.venueId),
      ctx.db.from("social_posts")
        .select("id, posted_at, saves, website_clicks, reach, engagement_rate")
        .eq("venue_id", ctx.venueId),
    ]);

    const allClients = clients ?? [];
    const allInquiries = inquiries ?? [];
    const allTours = tours ?? [];
    const allReviews = reviews ?? [];
    const allReferrals = referralRows ?? [];

    const booked = (s: string) => ["contracted", "event_complete"].includes(s);
    const bookedClients = allClients.filter(c => booked(c.status));

    // ── A) Response Time → Conversion ──────────────────────────────────
    // "Respond in <15min → 58% convert. >4hrs → 18%"
    const responseConversion = (() => {
      const buckets = [
        { label: "Under 15 min", max: 15, clients: [] as any[] },
        { label: "15 min – 1 hr", max: 60, clients: [] as any[] },
        { label: "1 – 4 hrs", max: 240, clients: [] as any[] },
        { label: "4 – 24 hrs", max: 1440, clients: [] as any[] },
        { label: "Over 24 hrs", max: Infinity, clients: [] as any[] },
      ];

      for (const c of allClients) {
        const rt = c.response_time_minutes as number | null;
        if (rt == null) continue;
        const bucket = buckets.find(b => rt <= b.max);
        if (bucket) bucket.clients.push(c);
      }

      return buckets
        .filter(b => b.clients.length >= 2)
        .map(b => ({
          label: b.label,
          total: b.clients.length,
          booked: b.clients.filter(c => booked(c.status)).length,
          conversionRate: b.clients.length > 0
            ? b.clients.filter(c => booked(c.status)).length / b.clients.length
            : 0,
          avgRevenue: (() => {
            const bk = b.clients.filter(c => booked(c.status) && c.revenue_cents);
            return bk.length > 0 ? Math.round(bk.reduce((s, c) => s + c.revenue_cents, 0) / bk.length) : null;
          })(),
        }));
    })();

    // ── B) Coordinator Performance ─────────────────────────────────────
    // "Sarah: 30min avg response, 65% conversion. Mike: 25min, 40%"
    const coordinatorPerformance = (() => {
      const coordMap = new Map<string, { clients: any[]; responseTimes: number[] }>();

      for (const c of allClients) {
        const coord = c.assigned_coordinator as string | null;
        if (!coord) continue;
        if (!coordMap.has(coord)) coordMap.set(coord, { clients: [], responseTimes: [] });
        coordMap.get(coord)!.clients.push(c);
        if (c.response_time_minutes != null) coordMap.get(coord)!.responseTimes.push(c.response_time_minutes as number);
      }

      return Array.from(coordMap.entries())
        .filter(([, v]) => v.clients.length >= 3)
        .map(([name, v]) => {
          const bk = v.clients.filter(c => booked(c.status));
          const avgRT = v.responseTimes.length > 0
            ? Math.round(v.responseTimes.reduce((a, b) => a + b, 0) / v.responseTimes.length)
            : null;
          const rev = bk.filter(c => c.revenue_cents).map(c => c.revenue_cents as number);
          return {
            name,
            totalClients: v.clients.length,
            bookedCount: bk.length,
            conversionRate: v.clients.length > 0 ? bk.length / v.clients.length : 0,
            avgResponseMinutes: avgRT,
            avgRevenueCents: rev.length > 0 ? Math.round(rev.reduce((a, b) => a + b, 0) / rev.length) : null,
            reviewRate: bk.length > 0 ? bk.filter(c => c.review_submitted).length / bk.length : 0,
          };
        })
        .sort((a, b) => b.conversionRate - a.conversionRate);
    })();

    // ── C) Referral vs Non-Referral LTV ────────────────────────────────
    // "Referred couples spend 15% more and review 2x more often"
    const referralLTV = (() => {
      const referredIds = new Set(allReferrals.map(r => r.referred_client_id).filter(Boolean));
      const referred = allClients.filter(c => referredIds.has(c.id) || c.resolved_source === "referral");
      const nonReferred = allClients.filter(c => !referredIds.has(c.id) && c.resolved_source !== "referral");

      const avgRev = (arr: any[]) => {
        const bk = arr.filter(c => booked(c.status) && c.revenue_cents);
        return bk.length > 0 ? Math.round(bk.reduce((s, c) => s + c.revenue_cents, 0) / bk.length) : null;
      };
      const reviewRate = (arr: any[]) => {
        const bk = arr.filter(c => booked(c.status));
        return bk.length > 0 ? bk.filter(c => c.review_submitted).length / bk.length : 0;
      };
      const convRate = (arr: any[]) => {
        return arr.length > 0 ? arr.filter(c => booked(c.status)).length / arr.length : 0;
      };

      return {
        referredCount: referred.length,
        nonReferredCount: nonReferred.length,
        referredAvgRevenue: avgRev(referred),
        nonReferredAvgRevenue: avgRev(nonReferred),
        referredConversion: convRate(referred),
        nonReferredConversion: convRate(nonReferred),
        referredReviewRate: reviewRate(referred),
        nonReferredReviewRate: reviewRate(nonReferred),
        totalReferrals: allReferrals.length,
        convertedReferrals: allReferrals.filter(r => r.converted).length,
      };
    })();

    // ── D) Competing Venues Win/Loss ───────────────────────────────────
    // "When [X] is mentioned, you win 35% vs 55% baseline"
    const competitorWinLoss = (() => {
      const compMap = new Map<string, { total: number; won: number }>();
      const normalize = (s: string) => s.trim().toLowerCase();

      for (const c of allClients) {
        const comps = c.competing_venues as string[] | null;
        if (!comps || comps.length === 0) continue;
        for (const comp of comps) {
          const key = normalize(comp);
          if (!compMap.has(key)) compMap.set(key, { total: 0, won: 0 });
          compMap.get(key)!.total++;
          if (booked(c.status)) compMap.get(key)!.won++;
        }
      }

      // Also check tours for competing venues
      for (const t of allTours) {
        const comps = t.competing_venues as string[] | null;
        if (!comps || comps.length === 0) continue;
        for (const comp of comps) {
          const key = normalize(comp);
          if (!compMap.has(key)) compMap.set(key, { total: 0, won: 0 });
          // Don't double-count if already counted from client
        }
      }

      const baselineConversion = allClients.length > 0
        ? bookedClients.length / allClients.length
        : 0;

      return {
        baselineConversion,
        competitors: Array.from(compMap.entries())
          .filter(([, v]) => v.total >= 2)
          .map(([name, v]) => ({
            name,
            mentionCount: v.total,
            winCount: v.won,
            winRate: v.total > 0 ? v.won / v.total : 0,
            vsBaseline: v.total > 0 ? (v.won / v.total) - baselineConversion : 0,
          }))
          .sort((a, b) => b.mentionCount - a.mentionCount),
      };
    })();

    // ── E) Booking Horizon by Season ───────────────────────────────────
    // "Oct weddings inquire 14 months ahead"
    const bookingHorizonBySeason = (() => {
      const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      const byMonth = Array.from({ length: 12 }, (_, i) => ({
        month: monthNames[i],
        monthNum: i + 1,
        horizonDays: [] as number[],
      }));

      for (const c of allClients) {
        if (!c.event_date || !c.inquired_at) continue;
        const eventDate = new Date(c.event_date as string);
        const inquiryDate = new Date(c.inquired_at as string);
        const days = Math.round((eventDate.getTime() - inquiryDate.getTime()) / 86400000);
        if (days < 0 || days > 1095) continue; // skip invalid
        const m = eventDate.getMonth();
        byMonth[m].horizonDays.push(days);
      }

      return byMonth
        .filter(m => m.horizonDays.length >= 2)
        .map(m => {
          m.horizonDays.sort((a, b) => a - b);
          const median = m.horizonDays[Math.floor(m.horizonDays.length / 2)];
          return {
            month: m.month,
            monthNum: m.monthNum,
            medianDays: median,
            medianMonths: Math.round(median / 30.4),
            sampleSize: m.horizonDays.length,
          };
        });
    })();

    // ── F) Social → Inquiry Uplift (aggregate) ─────────────────────────
    // "Posts with saves >50 correlate with 2.3x inquiry uplift"
    const socialInquiryUplift = (() => {
      const posts = socialPosts ?? [];
      if (posts.length < 3 || allInquiries.length < 5) return null;

      // For each post, count inquiries in 14 days after vs baseline
      const inqDates = allInquiries.map(i => new Date(i.received_at as string).getTime());
      const baselinePerDay = inqDates.length / 365; // rough daily baseline

      let highSavePosts = 0;
      let highSaveUpliftSum = 0;
      let lowSavePosts = 0;
      let lowSaveUpliftSum = 0;

      for (const post of posts) {
        const postTime = new Date(post.posted_at as string).getTime();
        const after14d = postTime + 14 * 86400000;
        const inqsAfter = inqDates.filter(d => d >= postTime && d <= after14d).length;
        const expected = baselinePerDay * 14;
        const uplift = expected > 0 ? inqsAfter / expected : 0;

        const saves = (post.saves as number) ?? 0;
        if (saves >= 50) {
          highSavePosts++;
          highSaveUpliftSum += uplift;
        } else {
          lowSavePosts++;
          lowSaveUpliftSum += uplift;
        }
      }

      return {
        highSaveAvgUplift: highSavePosts > 0 ? Math.round((highSaveUpliftSum / highSavePosts) * 10) / 10 : null,
        lowSaveAvgUplift: lowSavePosts > 0 ? Math.round((lowSaveUpliftSum / lowSavePosts) * 10) / 10 : null,
        highSaveCount: highSavePosts,
        lowSaveCount: lowSavePosts,
        totalPosts: posts.length,
      };
    })();

    // ── G) Time-of-Day Inquiry Patterns ────────────────────────────────
    // "Friday 5pm inquiries wait 4hrs for response, convert 18% vs 28% for Wed"
    const timeOfDayPatterns = (() => {
      const dayNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
      const dayMap = new Map<number, { inquiries: number; withResponse: number; totalResponseMin: number; matched: string[] }>();

      for (let d = 0; d < 7; d++) dayMap.set(d, { inquiries: 0, withResponse: 0, totalResponseMin: 0, matched: [] });

      for (const inq of allInquiries) {
        const dow = inq.day_of_week as number | null;
        if (dow == null) continue;
        const entry = dayMap.get(dow)!;
        entry.inquiries++;
        if (inq.response_time_minutes != null) {
          entry.withResponse++;
          entry.totalResponseMin += inq.response_time_minutes as number;
        }
        if (inq.matched_client_id) entry.matched.push(inq.matched_client_id as string);
      }

      const clientStatusMap = new Map(allClients.map(c => [c.id, c.status]));

      return dayNames.map((name, dow) => {
        const e = dayMap.get(dow)!;
        const bookedFromDay = e.matched.filter(id => {
          const s = clientStatusMap.get(id);
          return s && booked(s);
        }).length;
        return {
          day: name,
          inquiries: e.inquiries,
          avgResponseMinutes: e.withResponse > 0 ? Math.round(e.totalResponseMin / e.withResponse) : null,
          conversionRate: e.matched.length > 0 ? bookedFromDay / e.matched.length : null,
        };
      });
    })();

    return {
      responseConversion,
      coordinatorPerformance,
      referralLTV,
      competitorWinLoss,
      bookingHorizonBySeason,
      socialInquiryUplift,
      timeOfDayPatterns,
      clientCount: allClients.length,
      bookedCount: bookedClients.length,
    };
  }),
});
