import { z } from "zod";
import { router, venueProcedure } from "@/lib/trpc/server";
import { TRPCError } from "@trpc/server";

export const macroRouter = router({
  // Get latest market pulse (from cache)
  getMarketPulse: venueProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from("market_pulse")
      .select("*")
      .eq("venue_id", ctx.venueId)
      .order("calculated_at", { ascending: false })
      .limit(1)
      .single();

    if (error) return null;
    return data;
  }),

  // Get consumer sentiment trend (last 12 months)
  getConsumerSentiment: venueProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from("macro_economic")
      .select("period_date, value, signal_type")
      .eq("geo_scope", "national")
      .in("signal_type", ["consumer_sentiment", "conference_board"])
      .order("period_date", { ascending: false })
      .limit(24);

    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    return data ?? [];
  }),

  // Get search trends for venue's metro — all categories, 2 years
  getSearchTrends: venueProcedure.query(async ({ ctx }) => {
    const { data: venue } = await ctx.supabase
      .from("venues")
      .select("google_trends_metro")
      .eq("id", ctx.venueId)
      .single();

    if (!venue?.google_trends_metro) return null;

    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    const fromIso = twoYearsAgo.toISOString().split("T")[0];

    const { data, error } = await ctx.supabase
      .from("macro_search_trends")
      .select("week_start, term, relative_interest")
      .eq("geo", venue.google_trends_metro)
      .in("term", [
        "wedding venue", "wedding venues",
        "engagement ring", "how to propose",
        "divorce lawyer",
      ])
      .gte("week_start", fromIso)
      .order("week_start", { ascending: true });

    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    const rows = data ?? [];

    // Aggregate weekly data into monthly averages per category
    const VENUE_TERMS = ["wedding venue", "wedding venues"];
    const ENGAGEMENT_TERMS = ["engagement ring", "how to propose"];
    const DIVORCE_TERMS = ["divorce lawyer"];

    // Build monthly chart data
    const monthMap = new Map<string, { venue: number[]; engagement: number[]; divorce: number[] }>();
    for (const row of rows) {
      const key = row.week_start.slice(0, 7); // "YYYY-MM"
      if (!monthMap.has(key)) monthMap.set(key, { venue: [], engagement: [], divorce: [] });
      const bucket = monthMap.get(key)!;
      if (VENUE_TERMS.includes(row.term)) bucket.venue.push(row.relative_interest);
      if (ENGAGEMENT_TERMS.includes(row.term)) bucket.engagement.push(row.relative_interest);
      if (DIVORCE_TERMS.includes(row.term)) bucket.divorce.push(row.relative_interest);
    }

    const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;

    const monthly = Array.from(monthMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, b]) => ({
        month,
        label: new Date(month + "-15").toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
        venue: avg(b.venue),
        engagement: avg(b.engagement),
        divorce: avg(b.divorce),
      }));

    // YoY: compare most recent month with same month last year
    const now = new Date();
    const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const lastYearKey  = `${now.getFullYear() - 1}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const thisMonth = monthMap.get(thisMonthKey);
    const lastYear  = monthMap.get(lastYearKey);

    function yoyPct(curr: number | null, prev: number | null): number | null {
      if (!curr || !prev) return null;
      return Math.round(((curr - prev) / prev) * 100);
    }

    const venueThis = thisMonth ? avg(thisMonth.venue) : null;
    const venueLast = lastYear  ? avg(lastYear.venue)  : null;
    const engThis   = thisMonth ? avg(thisMonth.engagement) : null;
    const engLast   = lastYear  ? avg(lastYear.engagement)  : null;

    return {
      monthly,
      yoy: {
        venueThis,
        venueLast,
        venuePct: yoyPct(venueThis, venueLast),
        engagementThis: engThis,
        engagementLast: engLast,
        engagementPct: yoyPct(engThis, engLast),
        divorceThis: thisMonth ? avg(thisMonth.divorce) : null,
        divorceLast: lastYear  ? avg(lastYear.divorce)  : null,
        divorcePct: yoyPct(
          thisMonth ? avg(thisMonth.divorce) : null,
          lastYear  ? avg(lastYear.divorce)  : null
        ),
      },
      geo: venue.google_trends_metro,
    };
  }),

  // Get weather seasonality for venue's station
  getWeatherSeasonality: venueProcedure.query(async ({ ctx }) => {
    const { data: venue } = await ctx.supabase
      .from("venues")
      .select("noaa_station_id")
      .eq("id", ctx.venueId)
      .single();

    if (!venue?.noaa_station_id) return [];

    const { data, error } = await ctx.supabase
      .from("weather_monthly")
      .select("year, month, precipitation_inches, temp_avg_f, weather_score")
      .eq("noaa_station_id", venue.noaa_station_id)
      .order("year", { ascending: false })
      .order("month", { ascending: true })
      .limit(120); // 10 years

    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    return data ?? [];
  }),

  // Get competitor landscape
  getCompetitors: venueProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from("macro_competitor_landscape")
      .select("*")
      .eq("venue_id", ctx.venueId)
      .order("scanned_at", { ascending: false })
      .limit(50);

    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    return data ?? [];
  }),

  // Get economic signals by Fed district
  getRegionalEconomics: venueProcedure.query(async ({ ctx }) => {
    const { data: venue } = await ctx.supabase
      .from("venues")
      .select("fed_district")
      .eq("id", ctx.venueId)
      .single();

    const districtScope = venue?.fed_district ? `district_${venue.fed_district}` : "national";

    const { data, error } = await ctx.supabase
      .from("macro_economic")
      .select("period_date, value, signal_type, geo_scope, raw_data")
      .in("geo_scope", ["national", districtScope])
      .order("period_date", { ascending: false })
      .limit(36);

    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    return data ?? [];
  }),
});
