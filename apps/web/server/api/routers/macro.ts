import { z } from "zod";
import { router, venueProcedure } from "@/lib/trpc/server";
import { TRPCError } from "@trpc/server";

export const macroRouter = router({
  // Get latest market pulse (from cache)
  getMarketPulse: venueProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.db
      .from("market_pulse")
      .select("*")
      .eq("venue_id", ctx.venueId)
      .order("calculated_at", { ascending: false })
      .limit(1)
      .single();

    if (error) return null;
    return data;
  }),

  // Get consumer sentiment trend (last 24 months)
  // macro_economic columns: series_id, date, value, region
  getConsumerSentiment: venueProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.db
      .from("macro_economic")
      .select("date, value, series_id")
      .in("region", ["national", "us"])
      .in("series_id", ["UMCSENT", "CONCCONF"])  // Michigan Consumer Sentiment + Conference Board
      .order("date", { ascending: false })
      .limit(24);

    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    return data ?? [];
  }),

  // Get search trends for venue's metro — all categories, 2 years
  // macro_search_trends columns: metro, term, week (DATE), interest
  getSearchTrends: venueProcedure.query(async ({ ctx }) => {
    const { data: venue } = await ctx.db
      .from("venues")
      .select("google_trends_metro")
      .eq("id", ctx.venueId)
      .single();

    if (!venue?.google_trends_metro) return null;

    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    const fromIso = twoYearsAgo.toISOString().split("T")[0];

    const coreTerms = ["wedding venue", "wedding venues", "engagement ring", "how to propose", "divorce lawyer"];

    const { data, error } = await ctx.db
      .from("macro_search_trends")
      .select("week, term, interest")
      .eq("metro", venue.google_trends_metro)
      .in("term", coreTerms)
      .gte("week", fromIso)
      .order("week", { ascending: true });

    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    const rows = data ?? [];

    // Aggregate weekly → monthly averages per category
    const VENUE_TERMS      = ["wedding venue", "wedding venues"];
    const ENGAGEMENT_TERMS = ["engagement ring", "how to propose"];
    const DIVORCE_TERMS    = ["divorce lawyer"];

    const monthMap = new Map<string, { venue: number[]; engagement: number[]; divorce: number[] }>();
    for (const row of rows) {
      const key = (row.week as string).slice(0, 7); // "YYYY-MM"
      if (!monthMap.has(key)) monthMap.set(key, { venue: [], engagement: [], divorce: [] });
      const bucket = monthMap.get(key)!;
      if (VENUE_TERMS.includes(row.term))      bucket.venue.push(row.interest ?? 0);
      if (ENGAGEMENT_TERMS.includes(row.term)) bucket.engagement.push(row.interest ?? 0);
      if (DIVORCE_TERMS.includes(row.term))    bucket.divorce.push(row.interest ?? 0);
    }

    const avg = (arr: number[]) => arr.length
      ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length)
      : null;

    const monthly = Array.from(monthMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, b]) => ({
        month,
        label: new Date(month + "-15").toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
        venue:      avg(b.venue),
        engagement: avg(b.engagement),
        divorce:    avg(b.divorce),
      }));

    // YoY comparison
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
      customTerms: [],
      yoy: {
        venueThis,
        venueLast,
        venuePct:       yoyPct(venueThis, venueLast),
        engagementThis: engThis,
        engagementLast: engLast,
        engagementPct:  yoyPct(engThis, engLast),
        divorceThis:    thisMonth ? avg(thisMonth.divorce) : null,
        divorceLast:    lastYear  ? avg(lastYear.divorce)  : null,
        divorcePct:     yoyPct(
          thisMonth ? avg(thisMonth.divorce) : null,
          lastYear  ? avg(lastYear.divorce)  : null
        ),
      },
      geo: venue.google_trends_metro,
    };
  }),

  // Get weather seasonality for venue's station — 3-year averages
  // weather_monthly columns: station_id, month (DATE), avg_temp_4pm_f, total_precip, avg_rain_chance_pct, outdoor_score
  getWeatherSeasonality: venueProcedure.query(async ({ ctx }) => {
    const { data: venue } = await ctx.db
      .from("venues")
      .select("noaa_station_id")
      .eq("id", ctx.venueId)
      .single();

    if (!venue?.noaa_station_id) return null;

    const stationId = (venue.noaa_station_id as string).replace(/^GHCND:/i, "");

    // Try new schema columns first, fall back to old schema
    let data: any[] | null = null;
    let error: any = null;

    // Try new schema: station_id, month (DATE), total_precip, avg_temp_4pm_f
    const newResult = await ctx.db
      .from("weather_monthly")
      .select("month, total_precip, avg_temp_4pm_f, outdoor_score")
      .eq("station_id", stationId)
      .order("month", { ascending: false });

    if (!newResult.error && newResult.data && newResult.data.length > 0) {
      data = newResult.data;
    } else {
      // Fall back to old schema: noaa_station_id, year, month (INT), precipitation_inches, temp_max_f
      const oldResult = await ctx.db
        .from("weather_monthly")
        .select("year, month, precipitation_inches, temp_avg_f, temp_max_f, weather_score")
        .eq("noaa_station_id", stationId)
        .order("year", { ascending: false })
        .order("month", { ascending: true });

      if (oldResult.error) {
        error = oldResult.error;
      } else {
        data = oldResult.data;
      }
    }

    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

    // Normalize rows — handle both old and new schema shapes
    const rows = (data ?? []).map((r: any) => {
      // New schema: month is a DATE string "YYYY-MM-DD"
      if (typeof r.month === "string" && r.month.includes("-")) {
        return {
          year:   parseInt(r.month.slice(0, 4)),
          month:  parseInt(r.month.slice(5, 7)),
          precip: (r.total_precip ?? r.precipitation_inches) as number | null,
          temp:   (r.avg_temp_4pm_f ?? r.temp_max_f) as number | null,  // temp_max_f ≈ 4pm temp
          score:  r.outdoor_score as number | null,
        };
      }
      // Old schema: year and month are integers
      return {
        year:   r.year as number,
        month:  r.month as number,
        precip: (r.precipitation_inches ?? r.total_precip) as number | null,
        temp:   (r.temp_max_f ?? r.avg_temp_4pm_f ?? r.temp_avg_f) as number | null,
        score:  (r.weather_score ?? r.outdoor_score) as number | null,
      };
    });

    // Take the 3 most recent years of data
    const allYears = [...new Set(rows.map(r => r.year))].sort((a, b) => b - a);
    const recentYears = new Set(allYears.slice(0, 3));
    const filtered = rows.filter(r => recentYears.has(r.year));

    // Rain risk: 0 = dry (0"), 10 = very wet (5"+)
    function rainScore(p: number) { return Math.min(10, Math.round(p * 2)); }
    // Temperature discomfort: 0 = ideal (70-80°F), 10 = far from ideal
    function heatScore(temp: number) {
      if (temp >= 70 && temp <= 80) return 0;
      if (temp < 70) return Math.min(10, Math.round((70 - temp) / 4));
      return Math.min(10, Math.round((temp - 80) / 3));
    }
    // Outdoor event score: 10 = perfect, 0 = terrible (inverse of risk)
    function outdoorScore(temp: number | null, precip: number | null): number | null {
      if (temp === null && precip === null) return null;
      const tScore = temp !== null ? 10 - heatScore(temp) : 5;
      const rScore = precip !== null ? 10 - rainScore(precip) : 5;
      return Math.round((tScore * 0.5 + rScore * 0.5) * 10) / 10;
    }
    function trend(vals: (number | null)[]): "rising" | "falling" | "stable" | null {
      const pts = vals.map((v, i) => ({ x: i, y: v })).filter((p): p is { x: number; y: number } => p.y !== null);
      if (pts.length < 2) return null;
      const n = pts.length;
      const sx = pts.reduce((a, p) => a + p.x, 0);
      const sy = pts.reduce((a, p) => a + p.y, 0);
      const sxy = pts.reduce((a, p) => a + p.x * p.y, 0);
      const sx2 = pts.reduce((a, p) => a + p.x * p.x, 0);
      const slope = (n * sxy - sx * sy) / (n * sx2 - sx * sx);
      if (slope > 0.3) return "rising";
      if (slope < -0.3) return "falling";
      return "stable";
    }

    const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const years = [...new Set(filtered.map(r => r.year))].sort();

    const monthly = MONTHS.map((label, i) => {
      const monthNum = i + 1;
      const monthRows = filtered.filter(r => r.month === monthNum);
      const byYear = years.map(yr => {
        const r = monthRows.find(row => row.year === yr);
        const p = r?.precip ?? null;
        const t = r?.temp   ?? null;
        return {
          year: yr,
          rain: p !== null ? rainScore(p) : null,
          heat: t !== null ? heatScore(t) : null,
          precip: p !== null ? Math.round(p * 10) / 10 : null,
          temp:   t !== null ? Math.round(t) : null,
        };
      });

      const avgArr = (arr: (number | null)[]) => {
        const nums = arr.filter((x): x is number => x !== null);
        return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null;
      };

      const avgRain = avgArr(byYear.map(y => y.rain));
      const avgHeat = avgArr(byYear.map(y => y.heat));
      const avgP = byYear.map(y => y.precip).filter((x): x is number => x !== null);
      const avgT = byYear.map(y => y.temp).filter((x): x is number => x !== null);

      return {
        month:        label,
        monthNum,
        avgRainScore: avgRain,
        avgHeatScore: avgHeat,
        avgPrecip:    avgP.length ? Math.round(avgP.reduce((a, b) => a + b, 0) / avgP.length * 10) / 10 : null,
        avgTemp:      avgT.length ? Math.round(avgT.reduce((a, b) => a + b, 0) / avgT.length) : null,
        // Outdoor event score: 10 = perfect conditions, 0 = terrible
        eventScore:   avgT.length && avgP.length
          ? outdoorScore(
              avgT.reduce((a, b) => a + b, 0) / avgT.length,
              avgP.reduce((a, b) => a + b, 0) / avgP.length
            )
          : null,
        rainTrend:    trend(byYear.map(y => y.rain)),
        heatTrend:    trend(byYear.map(y => y.heat)),
        byYear,
      };
    });

    return { monthly, years };
  }),

  // Competitor landscape — not yet implemented in new schema
  getCompetitors: venueProcedure.query(async () => {
    return [];
  }),

  // Get economic signals by region
  // macro_economic columns: series_id, date, value, region
  getRegionalEconomics: venueProcedure.query(async ({ ctx }) => {
    const { data: venue } = await ctx.db
      .from("venues")
      .select("fed_district, state")
      .eq("id", ctx.venueId)
      .single();

    const regions = ["national"];
    if (venue?.state) regions.push(venue.state);

    const { data, error } = await ctx.db
      .from("macro_economic")
      .select("date, value, series_id, region")
      .in("region", regions)
      .order("date", { ascending: false })
      .limit(36);

    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    return data ?? [];
  }),
});
