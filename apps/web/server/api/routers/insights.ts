import { z } from "zod";
import { router, venueProcedure } from "@/lib/trpc/server";
import { callAI, callAIJson } from "@/lib/ai";
import { subDays, startOfWeek } from "date-fns";

export interface BriefingInsight {
  id: string;
  type:
    | "source_performance"
    | "weather_explainer"
    | "seasonal_pricing"
    | "leading_indicator"
    | "macro_context"
    | "platform_activity"
    | "recommendation";
  timeframe: "past" | "present" | "future" | "recommendation";
  headline: string;
  body: string;
  action?: string;
  supporting: { label: string; value: string }[];
  sentiment: "positive" | "neutral" | "caution" | "negative";
  dataAvailable: boolean;
}

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function avg(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function pctChange(a: number, b: number): number {
  if (b === 0) return 0;
  return Math.round(((a - b) / b) * 100);
}

export const insightsRouter = router({
  getBriefing: venueProcedure.query(async ({ ctx }): Promise<BriefingInsight[]> => {
    // ── CACHE CHECK: return cached weekly insights if less than 7 days old ──
    const { data: cachedRow } = await ctx.db
      .from("weekly_insights")
      .select("insights, generated_at")
      .eq("venue_id", ctx.venueId)
      .order("generated_at", { ascending: false })
      .limit(1)
      .single();

    if (cachedRow?.insights && cachedRow.generated_at) {
      const generatedAt = new Date(cachedRow.generated_at);
      const sevenDaysAgo = subDays(new Date(), 7);
      if (generatedAt >= sevenDaysAgo) {
        // Validate that the cached JSONB is an array of BriefingInsight-shaped objects
        const cached = cachedRow.insights as unknown;
        if (Array.isArray(cached) && cached.length > 0 && cached[0].id && cached[0].type && cached[0].headline) {
          return cached as BriefingInsight[];
        }
      }
    }

    const insights: BriefingInsight[] = [];

    // Venues schema: id, organisation_id, name, slug, city, state, zip, lat, lng,
    // noaa_station_id, google_trends_metro, county_fips, fed_district, primary_color,
    // secondary_color, sage_tone, sage_auto_reply, timezone, onboarding_complete
    const { data: venueRaw } = await ctx.db
      .from("venues")
      .select("noaa_station_id, google_trends_metro, fed_district, state, name, city")
      .eq("id", ctx.venueId)
      .single();

    const venue = venueRaw
      ? { ...venueRaw, noaa_station_id: venueRaw.noaa_station_id?.replace(/^GHCND:/i, "") ?? null }
      : venueRaw;

    const [
      { data: sourceClients },
      weatherResult,
      { data: recentInquiries },
      { data: prevInquiries },
      searchTrendsResult,
      macroResult,
    ] = await Promise.all([
      ctx.db
        .from("clients")
        .select("resolved_source, status, revenue_cents, acquisition_cost_cents")
        .eq("venue_id", ctx.venueId)
        .not("resolved_source", "is", null),

      // weather_monthly — try new schema (station_id) then old (noaa_station_id)
      venue?.noaa_station_id
        ? ctx.db
            .from("weather_monthly")
            .select("month, year, precipitation_inches, temp_avg_f, temp_max_f, weather_score")
            .eq("noaa_station_id", venue.noaa_station_id)
            .then(r => {
              // Normalize to common shape
              if (r.data && r.data.length > 0) {
                r.data = r.data.map((row: any) => ({
                  ...row,
                  outdoor_score: row.weather_score,
                  avg_temp_4pm_f: row.temp_max_f ?? row.temp_avg_f,
                  total_precip: row.precipitation_inches,
                }));
              }
              return r;
            })
        : Promise.resolve({ data: null }),

      ctx.db
        .from("inquiries")
        .select("id, received_at")
        .eq("venue_id", ctx.venueId)
        .gte("received_at", subDays(new Date(), 30).toISOString()),

      ctx.db
        .from("inquiries")
        .select("id, received_at")
        .eq("venue_id", ctx.venueId)
        .gte("received_at", subDays(new Date(), 90).toISOString())
        .lt("received_at", subDays(new Date(), 30).toISOString()),

      // macro_search_trends: id, metro, term, week, interest
      venue?.google_trends_metro
        ? ctx.db
            .from("macro_search_trends")
            .select("week, term, interest")
            .eq("metro", venue.google_trends_metro)
            .order("week", { ascending: false })
            .limit(52)
        : Promise.resolve({ data: null }),

      // macro_economic: id, series_id, date, value, region
      ctx.db
        .from("macro_economic")
        .select("series_id, date, value, region")
        .in("series_id", ["UMCSENT", "CSCICP03USM665S"])  // UMich + Conference Board
        .order("date", { ascending: false })
        .limit(6),
    ]);

    const weatherData    = weatherResult.data as any[] | null;
    const searchTrends   = searchTrendsResult.data as any[] | null;
    const macroData      = macroResult.data as any[] | null;

    // ── INSIGHT 1: SOURCE PERFORMANCE ────────────────────────────────────────
    if (sourceClients && sourceClients.length > 0) {
      const sourceMap = new Map<
        string,
        { inquiries: number; booked: number; revenue: number[]; acquisitionCosts: number[] }
      >();

      for (const c of sourceClients) {
        const s = c.resolved_source as string;
        if (!sourceMap.has(s)) sourceMap.set(s, { inquiries: 0, booked: 0, revenue: [], acquisitionCosts: [] });
        const entry = sourceMap.get(s)!;
        entry.inquiries++;
        if (!["inquiry", "archived", "lost"].includes(c.status as string)) entry.booked++;
        if (c.revenue_cents)          entry.revenue.push(c.revenue_cents as number);
        if (c.acquisition_cost_cents) entry.acquisitionCosts.push(c.acquisition_cost_cents as number);
      }

      // Pull channel_spend for additional spend data
      const { data: spendData } = await ctx.db
        .from("channel_spend")
        .select("channel, amount_cents")
        .eq("venue_id", ctx.venueId);

      const channelSpendMap = new Map<string, number>();
      for (const row of spendData ?? []) {
        channelSpendMap.set(
          row.channel,
          (channelSpendMap.get(row.channel) ?? 0) + (row.amount_cents ?? 0)
        );
      }

      const rows = Array.from(sourceMap.entries())
        .map(([source, s]) => {
          const totalAcqCost = s.acquisitionCosts.reduce((a, b) => a + b, 0);
          const channelSpend = channelSpendMap.get(source) ?? 0;
          // Prefer channel_spend; fall back to sum of per-client acquisition costs
          const totalSpendCents = channelSpend > 0 ? channelSpend : totalAcqCost;
          const costPerBooking: number | null =
            totalSpendCents > 0 && s.booked > 0
              ? Math.round(totalSpendCents / 100 / s.booked)
              : null;

          return {
            source,
            inquiries:      s.inquiries,
            booked:         s.booked,
            convRate:       s.inquiries > 0 ? s.booked / s.inquiries : 0,
            avgRevenue:     s.revenue.length ? Math.round(avg(s.revenue) / 100) : null,
            totalSpendCents,
            costPerBooking,
          };
        })
        .sort((a, b) => b.booked - a.booked);

      const best      = rows.find((r) => r.convRate === Math.max(...rows.map((x) => x.convRate)));
      const costRows  = rows.filter((r) => r.costPerBooking !== null);
      const zeroCostRows = rows.filter((r) => r.costPerBooking === null && r.source !== "direct");

      let headline = "";
      let body     = "";
      let sentiment: BriefingInsight["sentiment"] = "neutral";
      const supporting: { label: string; value: string }[] = [];

      if (costRows.length > 0) {
        const sorted    = [...costRows].sort((a, b) => a.costPerBooking! - b.costPerBooking!);
        const cheapest  = sorted[0];
        const priciest  = sorted[sorted.length - 1];
        const cheapName = cheapest.source.replace(/_/g, " ");
        const priName   = priciest.source.replace(/_/g, " ");
        if (sorted.length > 1) {
          headline = `${cheapName} costs $${cheapest.costPerBooking?.toLocaleString()} per booking — ${priName} costs $${priciest.costPerBooking?.toLocaleString()}`;
        } else {
          headline = `${cheapName} costs $${cheapest.costPerBooking?.toLocaleString()} per booked wedding`;
        }
        body = `Your paid channel ${cheapName} is costing $${cheapest.costPerBooking?.toLocaleString()} per booked wedding, converting at ${Math.round(cheapest.convRate * 100)}%.`;
        if (zeroCostRows.length > 0) {
          body += ` ${zeroCostRows.map((r) => r.source.replace(/_/g, " ")).join(" and ")} cost nothing and convert at ${Math.round(avg(zeroCostRows.map((r) => r.convRate)) * 100)}%.`;
        }
        sentiment = cheapest.costPerBooking! < 1500 ? "positive" : cheapest.costPerBooking! > 5000 ? "caution" : "neutral";
        for (const r of rows.slice(0, 5)) {
          const parts = [`${Math.round(r.convRate * 100)}% conv`];
          if (r.costPerBooking) parts.push(`$${r.costPerBooking.toLocaleString()}/booking`);
          supporting.push({ label: r.source.replace(/_/g, " "), value: parts.join(" · ") });
        }
      } else if (best) {
        headline = `${best.source.replace(/_/g, " ")} converts at ${Math.round(best.convRate * 100)}% — your best performing source`;
        body = `Across ${rows.reduce((s, r) => s + r.inquiries, 0)} total inquiries, ${best.source.replace(/_/g, " ")} has the highest booking rate at ${Math.round(best.convRate * 100)}%.`;
        if (zeroCostRows.length > 0) {
          body += ` Add spend data in Settings to see cost per booking.`;
        }
        sentiment = best.convRate > 0.4 ? "positive" : "neutral";
        for (const r of rows.slice(0, 5)) {
          supporting.push({
            label: r.source.replace(/_/g, " "),
            value: `${r.booked}/${r.inquiries} booked (${Math.round(r.convRate * 100)}%)`,
          });
        }
      }

      if (headline) {
        insights.push({
          id:            "source_performance",
          type:          "source_performance",
          timeframe:     "past",
          headline,
          body,
          action:        costRows.length === 0 ? "Add spend data in Settings to see cost per booking" : undefined,
          supporting,
          sentiment,
          dataAvailable: true,
        });
      }
    } else {
      insights.push({
        id:            "source_performance",
        type:          "source_performance",
        timeframe:     "past",
        headline:      "Connect your booking data to see acquisition costs by channel",
        body:          "Once your booking data is synced, Bloom will show you the cost per inquiry, tour, and booking for The Knot, Google Ads, Instagram, and every other source you use.",
        supporting:    [],
        sentiment:     "neutral",
        dataAvailable: false,
      });
    }

    // ── INSIGHT 2: WEATHER EXPLAINER ─────────────────────────────────────────
    // weather_monthly has one row per month (no year column) — use outdoor_score (higher = better)
    if (weatherData && weatherData.length > 0 && recentInquiries !== null) {
      const currentMonth = new Date().getMonth() + 1; // 1-12
      const monthName    = MONTH_NAMES[currentMonth - 1];

      // Find the row for this month (month is 1-12)
      const thisMonthRow = weatherData.find((r) => (r.month as number) === currentMonth);

      let outdoorScore: number | null = null;
      let totalPrecip: number | null  = null;

      if (thisMonthRow) {
        outdoorScore = thisMonthRow.outdoor_score as number | null;
        totalPrecip  = thisMonthRow.total_precip as number | null;
      } else if (weatherData.length > 0) {
        // Fall back to the average outdoor_score across all available months
        const scores = weatherData
          .map((r) => r.outdoor_score as number | null)
          .filter((v): v is number => v !== null);
        outdoorScore = scores.length ? Math.round(avg(scores) * 10) / 10 : null;
      }

      const recentCount = recentInquiries.length;
      const avgPrev     = prevInquiries ? prevInquiries.length / 2 : null;

      let headline = "";
      let body     = "";
      let sentiment: BriefingInsight["sentiment"] = "neutral";
      const supporting: { label: string; value: string }[] = [];

      if (outdoorScore === null) {
        headline  = `${monthName} weather data not yet available`;
        body      = `Weather data for ${monthName} hasn't been ingested yet. Check back once the monthly ingestion has run.`;
        sentiment = "neutral";
      } else if (outdoorScore <= 3) {
        // Low outdoor score = poor conditions
        headline = `${monthName} weather conditions are difficult — expect inquiry suppression`;
        body     = `Outdoor score is ${outdoorScore}/10 for ${monthName}.`;
        if (totalPrecip != null) body += ` ${totalPrecip.toFixed(1)}" total precipitation typical.`;
        if (avgPrev !== null && recentCount < avgPrev * 0.8) {
          const drop = Math.abs(Math.round(pctChange(recentCount, avgPrev)));
          body += ` Inquiries are down ${drop}% vs your recent average — consistent with weather suppression.`;
          sentiment = "caution";
        } else {
          body += ` If inquiries are soft, weather is a likely contributing factor.`;
          sentiment = "caution";
        }
        supporting.push({ label: "Outdoor score", value: `${outdoorScore}/10` });
        if (totalPrecip != null) supporting.push({ label: "Avg precip", value: `${totalPrecip.toFixed(1)}"` });
        if (avgPrev !== null) {
          supporting.push({ label: "Inquiries (30d)", value: String(recentCount) });
          supporting.push({ label: "Prior avg",       value: Math.round(avgPrev).toString() });
        }
      } else if (outdoorScore >= 7) {
        headline = `${monthName} weather is favourable — no suppression expected`;
        body     = `Outdoor score is ${outdoorScore}/10 for ${monthName}.`;
        if (avgPrev !== null && recentCount >= avgPrev) {
          body     += ` Inquiries are tracking at or above your recent average — no weather headwinds.`;
          sentiment = "positive";
        } else {
          body     += ` If inquiries are softer than expected, weather isn't the cause — look at macro signals or campaign activity.`;
          sentiment = "neutral";
        }
        supporting.push({ label: "Outdoor score", value: `${outdoorScore}/10` });
        if (avgPrev !== null) supporting.push({ label: "Inquiries (30d)", value: String(recentCount) });
      } else {
        headline  = `${monthName} weather is moderate — minor impact on inquiry volume`;
        body      = `Outdoor score is ${outdoorScore}/10 for ${monthName}. Some weather effect is possible but not significant enough to fully explain volume changes.`;
        sentiment = "neutral";
        supporting.push({ label: "Outdoor score", value: `${outdoorScore}/10` });
        if (avgPrev !== null) supporting.push({ label: "Inquiries (30d)", value: String(recentCount) });
      }

      insights.push({
        id:            "weather_explainer",
        type:          "weather_explainer",
        timeframe:     "present",
        headline,
        body,
        supporting,
        sentiment,
        dataAvailable: outdoorScore !== null,
      });
    } else {
      insights.push({
        id:            "weather_explainer",
        type:          "weather_explainer",
        timeframe:     "present",
        headline:      "Weather data not yet loaded for your station",
        body:          "Once NOAA data is ingested for your station, Bloom will automatically explain inquiry volume changes using local weather patterns.",
        supporting:    [],
        sentiment:     "neutral",
        dataAvailable: false,
      });
    }

    // ── INSIGHT 3: SEASONAL PRICING SIGNAL ───────────────────────────────────
    if (weatherData && weatherData.length > 0) {
      // weather_monthly has one row per month — outdoor_score: higher = better (0-10 or similar)
      const monthSummaries = weatherData
        .map((row) => ({
          month:        row.month as number,
          name:         MONTH_NAMES[(row.month as number) - 1] ?? "Unknown",
          outdoorScore: row.outdoor_score as number | null,
          rainChance:   row.avg_rain_chance_pct as number | null,
        }))
        .filter((m) => m.outdoorScore !== null)
        .sort((a, b) => a.month - b.month);

      // Low outdoor_score = difficult months
      const highRisk = monthSummaries
        .filter((m) => (m.outdoorScore as number) <= 4)
        .sort((a, b) => (a.outdoorScore as number) - (b.outdoorScore as number));
      const ideal = monthSummaries
        .filter((m) => (m.outdoorScore as number) >= 8)
        .sort((a, b) => (b.outdoorScore as number) - (a.outdoorScore as number));

      let headline = "";
      let body     = "";
      let sentiment: BriefingInsight["sentiment"] = "neutral";
      const supporting: { label: string; value: string }[] = [];

      if (highRisk.length > 0) {
        const top = highRisk[0];
        headline = `${top.name} is your most weather-challenged month (outdoor score ${top.outdoorScore}/10)`;
        body     = `Historically, ${top.name} at your location has an outdoor score of ${top.outdoorScore}/10.`;
        if (highRisk.length > 1) {
          body += ` ${highRisk.slice(1, 3).map((m) => m.name).join(" and ")} are also challenging.`;
        }
        body     += ` Couples who experience poor weather tend to leave lower reviews — consider modest pricing adjustments for these months to maintain booking velocity and set expectations.`;
        sentiment = "caution";
        for (const m of monthSummaries) {
          if (m.outdoorScore !== null)
            supporting.push({ label: m.name, value: `${m.outdoorScore}/10` });
        }
      } else if (ideal.length > 0) {
        headline = `${ideal.slice(0, 2).map((m) => m.name).join(" and ")} are your most weather-reliable months`;
        body     = `Based on NOAA data, these months average an outdoor score of ${ideal[0].outdoorScore}/10 — your strongest candidates for peak pricing.`;
        sentiment = "positive";
        for (const m of ideal.slice(0, 4)) {
          supporting.push({ label: m.name, value: `${m.outdoorScore}/10` });
        }
      } else {
        headline  = "Weather seasonality is relatively consistent across your calendar";
        body      = "No single month stands out as significantly more difficult than others. Your pricing can be driven by demand rather than weather risk.";
        sentiment = "neutral";
      }

      insights.push({
        id:            "seasonal_pricing",
        type:          "seasonal_pricing",
        timeframe:     "past",
        headline,
        body,
        action:        highRisk.length > 0
          ? `Consider 8–15% lower pricing for ${highRisk.map((m) => m.name).join(", ")} to maintain booking velocity`
          : undefined,
        supporting,
        sentiment,
        dataAvailable: true,
      });
    } else {
      insights.push({
        id:            "seasonal_pricing",
        type:          "seasonal_pricing",
        timeframe:     "past",
        headline:      "Seasonal pricing intelligence needs weather history",
        body:          "Once NOAA data loads for your station, Bloom will identify which months carry weather risk and suggest pricing adjustments accordingly.",
        supporting:    [],
        sentiment:     "neutral",
        dataAvailable: false,
      });
    }

    // ── INSIGHT 4: LEADING INDICATOR ─────────────────────────────────────────
    // macro_search_trends: metro, term, week (date string), interest (0-100)
    if (searchTrends && searchTrends.length >= 8) {
      const engagementData = searchTrends.filter((t) =>
        (t.term as string).toLowerCase().includes("engagement")
      );
      const weddingData = searchTrends.filter((t) =>
        (t.term as string).toLowerCase().includes("wedding")
      );

      const targetData = engagementData.length >= 4 ? engagementData : weddingData;
      const termLabel  = engagementData.length >= 4 ? "engagement ring" : "wedding venue";

      if (targetData.length >= 8) {
        const recent4 = targetData.slice(0, 4);
        const prev4   = targetData.slice(4, 8);

        const recentAvg      = avg(recent4.map((t) => t.interest as number));
        const prevAvg        = avg(prev4.map((t)  => t.interest as number));
        const vsSeasonalPct  = pctChange(recentAvg, prevAvg);

        const metro          = venue?.google_trends_metro ?? "your market";
        const leadTimeMonths = termLabel === "engagement ring" ? 9 : 3;
        const futureDate     = new Date();
        futureDate.setMonth(futureDate.getMonth() + leadTimeMonths);
        const futurePeriod   = futureDate.toLocaleString("default", { month: "long", year: "numeric" });

        let headline = "";
        let body     = "";
        let sentiment: BriefingInsight["sentiment"] = "neutral";

        if (vsSeasonalPct <= -15) {
          headline  = `"${termLabel}" searches in ${metro} are ${Math.abs(vsSeasonalPct)}% below recent average`;
          body      = `Google Trends shows "${termLabel}" search volume in ${metro} running ${Math.abs(vsSeasonalPct)}% below the prior 4-week level. With a typical ${leadTimeMonths}-month lead time, this signals softer inquiry volume around ${futurePeriod}. This is a leading indicator, not a guarantee — but worth watching.`;
          sentiment = "caution";
        } else if (vsSeasonalPct >= 15) {
          headline  = `"${termLabel}" searches in ${metro} are ${vsSeasonalPct}% above recent average`;
          body      = `Search interest for "${termLabel}" in ${metro} is running ${vsSeasonalPct}% above the prior 4-week level. With a ${leadTimeMonths}-month lead time, this suggests stronger-than-usual inquiry volume around ${futurePeriod}. Consider whether your enquiry capacity and response speed is ready.`;
          sentiment = "positive";
        } else {
          headline  = `"${termLabel}" searches in ${metro} are tracking in line with recent weeks`;
          body      = `Search volume for "${termLabel}" in ${metro} is ${vsSeasonalPct > 0 ? "+" : ""}${vsSeasonalPct}% vs the prior 4-week average — no significant deviation. Inquiry volume in ${futurePeriod} is on track with current trends.`;
          sentiment = "neutral";
        }

        insights.push({
          id:            "leading_indicator",
          type:          "leading_indicator",
          timeframe:     "future",
          headline,
          body,
          supporting: [
            { label: "Last 4 weeks avg",  value: Math.round(recentAvg).toString() },
            { label: "Prior 4 weeks avg", value: Math.round(prevAvg).toString() },
            { label: "Change",            value: `${vsSeasonalPct > 0 ? "+" : ""}${vsSeasonalPct}%` },
            { label: "Lead time",         value: `~${leadTimeMonths} months` },
          ],
          sentiment,
          dataAvailable: true,
        });
      }
    }

    if (!insights.find((i) => i.id === "leading_indicator")) {
      insights.push({
        id:            "leading_indicator",
        type:          "leading_indicator",
        timeframe:     "future",
        headline:      "Search trend data not yet loaded for your market",
        body:          "Once Google Trends data is pulled for your metro area, Bloom will show you leading indicator signals — like engagement ring search volume — that predict inquiry volume months in advance.",
        supporting:    [],
        sentiment:     "neutral",
        dataAvailable: false,
      });
    }

    // ── INSIGHT 5: MACRO CONTEXT ──────────────────────────────────────────────
    // macro_economic: series_id, date, value, region
    // UMCSENT = UMich Consumer Sentiment; CSCICP03USM665S = Conference Board
    if (macroData && macroData.length >= 2) {
      const sentimentRows = macroData
        .filter((r) => r.series_id === "UMCSENT" || r.series_id === "CSCICP03USM665S")
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      if (sentimentRows.length >= 2) {
        const latest = Number(sentimentRows[0].value);
        const prev   = Number(sentimentRows[1].value);
        const change = Math.round((latest - prev) * 10) / 10;
        const trend  = change > 1 ? "rising" : change < -1 ? "falling" : "stable";

        const latestDate = new Date(sentimentRows[0].date as string).toLocaleString(
          "default", { month: "long", year: "numeric" }
        );
        const seriesLabel = sentimentRows[0].series_id === "UMCSENT"
          ? "University of Michigan Consumer Sentiment Index"
          : "Conference Board Consumer Confidence";

        let headline = "";
        let body     = "";
        let sentiment: BriefingInsight["sentiment"] = "neutral";
        const supporting: { label: string; value: string }[] = [];

        if (trend === "falling") {
          headline  = `Consumer confidence fell ${Math.abs(change)} points in ${latestDate} — spending caution ahead`;
          body      = `The ${seriesLabel} is at ${latest.toFixed(1)}, down ${Math.abs(change)} from last month. When confidence falls, discretionary spending — including weddings — tends to soften over the following 3–6 months. Election cycles and Fed rate decisions are the most common macro disruptors for the wedding industry.`;
          sentiment = "caution";
        } else if (trend === "rising") {
          headline  = `Consumer confidence rose ${change} points in ${latestDate} — positive for bookings`;
          body      = `${seriesLabel} is at ${latest.toFixed(1)}, up ${change} from last month. Rising confidence typically translates to increased willingness to commit to large discretionary purchases like weddings.`;
          sentiment = "positive";
        } else {
          headline  = `Consumer confidence is stable at ${latest.toFixed(1)} — no macro headwinds`;
          body      = `The ${seriesLabel} is holding steady at ${latest.toFixed(1)} — within 1 point of last month. No significant consumer confidence headwinds to watch for.`;
          sentiment = "neutral";
        }

        // Fed district context if available (region field)
        const fedRow = macroData.find((r) =>
          r.series_id?.toString().includes("district") ||
          (r.region?.toString().includes(venue?.fed_district ?? "__none__"))
        );
        if (fedRow?.value) {
          body += ` Fed District ${venue?.fed_district ?? ""}: current index at ${fedRow.value}.`;
        }

        supporting.push({ label: "Sentiment index", value: latest.toFixed(1) });
        supporting.push({ label: "Month-over-month", value: `${change > 0 ? "+" : ""}${change}` });
        if (sentimentRows.length >= 4) {
          const threeMonthsAgo = Number(sentimentRows[3].value);
          const trend3m        = Math.round((latest - threeMonthsAgo) * 10) / 10;
          supporting.push({ label: "3-month change", value: `${trend3m > 0 ? "+" : ""}${trend3m}` });
        }

        insights.push({
          id:            "macro_context",
          type:          "macro_context",
          timeframe:     "present",
          headline,
          body,
          supporting,
          sentiment,
          dataAvailable: true,
        });
      }
    }

    if (!insights.find((i) => i.id === "macro_context")) {
      insights.push({
        id:            "macro_context",
        type:          "macro_context",
        timeframe:     "present",
        headline:      "Macro signals load once FRED economic data is ingested",
        body:          "Consumer confidence and wedding industry trends will appear here once the FRED ingestion script has run.",
        supporting:    [],
        sentiment:     "neutral",
        dataAvailable: false,
      });
    }

    // ── RECOMMENDATIONS ───────────────────────────────────────────────────────
    const leadingInsight  = insights.find(i => i.id === "leading_indicator");
    const seasonalInsight = insights.find(i => i.id === "seasonal_pricing");
    const macroInsight    = insights.find(i => i.id === "macro_context");
    const sourceInsight   = insights.find(i => i.id === "source_performance");

    // Rec 1: pipeline urgency from leading indicator
    if (leadingInsight?.dataAvailable) {
      if (leadingInsight.sentiment === "positive") {
        const futureDate = new Date();
        futureDate.setMonth(futureDate.getMonth() + 9);
        const month = futureDate.toLocaleString("default", { month: "long" });
        insights.push({
          id:            "rec_response_speed",
          type:          "recommendation",
          timeframe:     "recommendation",
          headline:      "Tighten your inquiry response time now",
          body:          `Engagement searches are elevated — a surge of newly-engaged couples will start reaching out around ${month}. Venues that respond within 2 hours convert at 2–3× the rate of those who respond the next day. Review your inquiry workflow before the volume arrives.`,
          action:        "Aim for sub-2hr first response on all new inquiries",
          supporting:    [],
          sentiment:     "positive",
          dataAvailable: true,
        });
      } else if (leadingInsight.sentiment === "caution") {
        insights.push({
          id:            "rec_pipeline_now",
          type:          "recommendation",
          timeframe:     "recommendation",
          headline:      "Soft demand ahead — work what's already in your pipeline",
          body:          "Search interest is below recent levels, which typically means fewer new inquiries in the coming months. Your best lever right now is converting the couples already talking to you. Review any inquiry that hasn't had a follow-up in 2+ weeks.",
          action:        "Audit open inquiries — follow up on anyone who's gone quiet",
          supporting:    [],
          sentiment:     "caution",
          dataAvailable: true,
        });
      }
    }

    // Rec 2: weather-driven pricing
    if (seasonalInsight?.dataAvailable && seasonalInsight.sentiment === "caution") {
      const highRiskMonths = seasonalInsight.supporting
        .filter(s => parseFloat(s.value) <= 4)
        .map(s => s.label);
      if (highRiskMonths.length > 0) {
        const monthList = highRiskMonths.slice(0, 3).join(", ");
        insights.push({
          id:            "rec_weather_pricing",
          type:          "recommendation",
          timeframe:     "recommendation",
          headline:      `Price ${monthList} to reflect the weather risk`,
          body:          `These months historically score low for outdoor conditions. Couples who experience a rough weather day tend to leave lower reviews even when everything else goes perfectly. A modest price reduction (8–15%) for these dates sets expectations appropriately and keeps booking velocity strong.`,
          action:        `Consider a 10% reduction on ${monthList} or reframe them for intimate/elopement packages`,
          supporting:    seasonalInsight.supporting.filter(s => parseFloat(s.value) <= 4),
          sentiment:     "caution",
          dataAvailable: true,
        });
      }
    }

    // Rec 3: consumer confidence → reduce friction
    if (macroInsight?.dataAvailable && macroInsight.sentiment === "caution"
        && !insights.find(i => i.id === "rec_response_speed" || i.id === "rec_pipeline_now")) {
      insights.push({
        id:            "rec_macro",
        type:          "recommendation",
        timeframe:     "recommendation",
        headline:      "Confidence is soft — make committing feel easy",
        body:          "When discretionary spending confidence drops, couples don't stop wanting to get married — they become more deliberate. The venues that win in this environment have fast responses, clear pricing, and flexible holds. Review your inquiry-to-tour pipeline for anything that adds unnecessary friction.",
        action:        "Audit your inquiry-to-tour flow — remove any step that isn't essential",
        supporting:    macroInsight.supporting,
        sentiment:     "caution",
        dataAvailable: true,
      });
    }

    // Rec 4: attribution discipline
    if (sourceInsight?.dataAvailable && sourceInsight.supporting.length >= 2
        && sourceInsight.supporting.some(s => s.value.includes("$"))
        && !insights.find(i => i.id.startsWith("rec_"))) {
      insights.push({
        id:            "rec_attribution",
        type:          "recommendation",
        timeframe:     "recommendation",
        headline:      "Ask every inquiry how they found you — your attribution likely has gaps",
        body:          "Many couples self-report \"Google\" when they mean \"Instagram, then Googled your name, then found you on The Knot.\" Add \"How did you first hear about us?\" as the first question in your inquiry form and train your team to probe past the obvious answer. Better attribution data directly improves the ROI calculation above.",
        action:        "Make source the first question on your inquiry form",
        supporting:    [],
        sentiment:     "neutral",
        dataAvailable: true,
      });
    }

    // ── CROSS-DATA INSIGHTS: response speed, referrals, competitors ────────
    // Pull response time vs conversion data
    const { data: rtClients } = await ctx.db
      .from("clients")
      .select("status, response_time_minutes, resolved_source")
      .eq("venue_id", ctx.venueId)
      .not("response_time_minutes", "is", null);

    if (rtClients && rtClients.length >= 10) {
      const fast = rtClients.filter(c => (c.response_time_minutes as number) <= 30);
      const slow = rtClients.filter(c => (c.response_time_minutes as number) > 240);
      const bk = (arr: any[]) => arr.filter(c => ["contracted", "event_complete"].includes(c.status)).length;

      if (fast.length >= 3 && slow.length >= 3) {
        const fastRate = bk(fast) / fast.length;
        const slowRate = bk(slow) / slow.length;
        if (fastRate > slowRate && (fastRate - slowRate) > 0.1) {
          insights.push({
            id: "cross_response_speed",
            type: "recommendation",
            timeframe: "present",
            headline: `Responding in under 30 minutes converts at ${Math.round(fastRate * 100)}%`,
            body: `Your data shows a clear pattern: inquiries you respond to within 30 minutes convert at ${Math.round(fastRate * 100)}% (${fast.length} inquiries). When response takes over 4 hours, conversion drops to ${Math.round(slowRate * 100)}% (${slow.length} inquiries). Speed is your biggest controllable conversion lever.`,
            action: "Set a 15-minute response target for all new inquiries",
            supporting: [
              { label: "Under 30min", value: `${Math.round(fastRate * 100)}% book (${fast.length} inquiries)` },
              { label: "Over 4hrs", value: `${Math.round(slowRate * 100)}% book (${slow.length} inquiries)` },
            ],
            sentiment: fastRate > 0.4 ? "positive" : "caution",
            dataAvailable: true,
          });
        }
      }
    }

    // Referral value insight
    const { data: refClients } = await ctx.db
      .from("clients")
      .select("status, revenue_cents, resolved_source, review_submitted")
      .eq("venue_id", ctx.venueId);

    if (refClients && refClients.length >= 10) {
      const referred = refClients.filter(c => c.resolved_source === "referral");
      const nonReferred = refClients.filter(c => c.resolved_source && c.resolved_source !== "referral");
      const avgRev = (arr: any[]) => {
        const bk = arr.filter(c => ["contracted", "event_complete"].includes(c.status) && c.revenue_cents);
        return bk.length >= 2 ? Math.round(bk.reduce((s: number, c: any) => s + c.revenue_cents, 0) / bk.length) : null;
      };

      const refAvg = avgRev(referred);
      const nonRefAvg = avgRev(nonReferred);

      if (refAvg && nonRefAvg && referred.length >= 3 && refAvg > nonRefAvg) {
        const pctMore = Math.round(((refAvg - nonRefAvg) / nonRefAvg) * 100);
        if (pctMore > 5) {
          const refReviewRate = referred.filter(c => c.review_submitted).length / Math.max(1, referred.filter(c => ["contracted", "event_complete"].includes(c.status)).length);
          insights.push({
            id: "cross_referral_value",
            type: "recommendation",
            timeframe: "past",
            headline: `Referred couples spend ${pctMore}% more than other sources`,
            body: `Your ${referred.length} referred clients average $${Math.round(refAvg / 100).toLocaleString()} per wedding vs $${Math.round(nonRefAvg / 100).toLocaleString()} from other sources. They also leave reviews ${Math.round(refReviewRate * 100)}% of the time. Your post-wedding outreach sequence is your referral engine — invest in it.`,
            action: "Strengthen your post-wedding follow-up to generate more referrals",
            supporting: [
              { label: "Referral avg", value: `$${Math.round(refAvg / 100).toLocaleString()}` },
              { label: "Other avg", value: `$${Math.round(nonRefAvg / 100).toLocaleString()}` },
              { label: "Referred clients", value: String(referred.length) },
            ],
            sentiment: "positive",
            dataAvailable: true,
          });
        }
      }
    }

    // ── CACHE WRITE: store generated insights for future cache hits ────────
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 }); // Monday
    const weekStartStr = weekStart.toISOString().split("T")[0];
    try {
      await ctx.db
        .from("weekly_insights")
        .upsert(
          {
            venue_id: ctx.venueId,
            week_start: weekStartStr,
            insights: insights as unknown as Record<string, unknown>[],
          },
          { onConflict: "venue_id,week_start" }
        );
    } catch (err) {
      console.error("Failed to cache weekly insights:", err);
    }

    return insights;
  }),

  // ── WEEKLY INSIGHT HISTORY ──────────────────────────────────────────────
  getWeeklyInsightHistory: venueProcedure.query(async ({ ctx }) => {
    const { data } = await ctx.db
      .from("weekly_insights")
      .select("id, venue_id, generated_at, insights, week_start")
      .eq("venue_id", ctx.venueId)
      .order("week_start", { ascending: false })
      .limit(4);

    return (data ?? []).map((row) => ({
      id: row.id as string,
      venueId: row.venue_id as string,
      generatedAt: row.generated_at as string,
      weekStart: row.week_start as string,
      insights: row.insights as unknown as BriefingInsight[],
    }));
  }),

  // ── ASK AN INSIGHT ────────────────────────────────────────────────────────
  ask: venueProcedure
    .input(z.object({ question: z.string().min(3).max(1000) }))
    .mutation(async ({ ctx, input }) => {
      // Fetch venue
      const { data: venueRaw } = await ctx.db
        .from("venues")
        .select("name, city, state, noaa_station_id, google_trends_metro, fed_district")
        .eq("id", ctx.venueId)
        .single();

      const venue = venueRaw
        ? { ...venueRaw, noaa_station_id: venueRaw.noaa_station_id?.replace(/^GHCND:/i, "") ?? null }
        : venueRaw;

      // Gather context snapshot
      const [
        { data: clients },
        { data: recentInquiries },
        { data: prevInquiries },
        weatherResult,
        { data: macroData },
        { data: sourceSummary },
        { data: holdAlerts },
        channelSpendResult,
      ] = await Promise.all([
        ctx.db
          .from("clients")
          .select("status, revenue_cents, resolved_source, review_star_rating, event_year, event_month, complexity_score, guest_count_final")
          .eq("venue_id", ctx.venueId),

        ctx.db
          .from("inquiries")
          .select("id, platform, received_at, response_time_minutes, match_status")
          .eq("venue_id", ctx.venueId)
          .gte("received_at", subDays(new Date(), 30).toISOString()),

        ctx.db
          .from("inquiries")
          .select("id")
          .eq("venue_id", ctx.venueId)
          .gte("received_at", subDays(new Date(), 60).toISOString())
          .lt("received_at", subDays(new Date(), 30).toISOString()),

        // weather_monthly — use old schema column names
        venue?.noaa_station_id
          ? ctx.db
              .from("weather_monthly")
              .select("month, year, precipitation_inches, temp_avg_f, temp_max_f, weather_score")
              .eq("noaa_station_id", venue.noaa_station_id)
              .order("year", { ascending: false })
              .order("month", { ascending: false })
              .limit(12)
              .then(r => {
                if (r.data) r.data = r.data.map((row: any) => ({
                  ...row,
                  outdoor_score: row.weather_score,
                  avg_temp_4pm_f: row.temp_max_f ?? row.temp_avg_f,
                  total_precip: row.precipitation_inches,
                }));
                return r;
              })
          : Promise.resolve({ data: null }),

        // macro_economic: series_id, date, value, region
        ctx.db
          .from("macro_economic")
          .select("series_id, date, value, region")
          .order("date", { ascending: false })
          .limit(20),

        ctx.db
          .from("clients")
          .select("resolved_source, status, revenue_cents")
          .eq("venue_id", ctx.venueId)
          .not("resolved_source", "is", null),

        // Holds: clients in held status expiring soon
        ctx.db
          .from("clients")
          .select("id, name_primary, name_partner, revenue_cents, event_date")
          .eq("venue_id", ctx.venueId)
          .eq("status", "held")
          .order("event_date", { ascending: true })
          .limit(10),

        // Channel spend for cost context
        ctx.db
          .from("channel_spend")
          .select("channel, amount_cents, month")
          .eq("venue_id", ctx.venueId),
      ]);

      const weatherData = weatherResult.data as any[] | null;

      // Build compact context
      const totalClients      = clients?.length ?? 0;
      const bookedClients     = clients?.filter((c) => !["inquiry", "archived", "lost"].includes(c.status as string)) ?? [];
      const completedClients  = clients?.filter((c) => c.status === "event_complete") ?? [];

      const avgRevenue =
        completedClients.filter((c) => c.revenue_cents).length > 0
          ? Math.round(
              avg(completedClients.filter((c) => c.revenue_cents).map((c) => c.revenue_cents as number)) / 100
            )
          : null;

      const avgReview =
        completedClients.filter((c) => c.review_star_rating).length > 0
          ? Math.round(
              avg(completedClients.filter((c) => c.review_star_rating).map((c) => c.review_star_rating as number)) * 10
            ) / 10
          : null;

      // Source breakdown
      const sourceBreakdown: Record<string, { count: number; revenue: number[] }> = {};
      for (const c of sourceSummary ?? []) {
        const s = c.resolved_source as string;
        if (!sourceBreakdown[s]) sourceBreakdown[s] = { count: 0, revenue: [] };
        sourceBreakdown[s].count++;
        if (c.revenue_cents) sourceBreakdown[s].revenue.push(c.revenue_cents as number);
      }

      // Channel spend by channel
      const channelSpendByChannel: Record<string, number> = {};
      for (const row of channelSpendResult.data ?? []) {
        channelSpendByChannel[row.channel] =
          (channelSpendByChannel[row.channel] ?? 0) + (row.amount_cents ?? 0);
      }

      const context = {
        venue: {
          name:         venue?.name,
          location:     `${venue?.city}, ${venue?.state}`,
          noaa_station: venue?.noaa_station_id,
          metro:        venue?.google_trends_metro,
          fed_district: venue?.fed_district,
        },
        clients: {
          total:             totalClients,
          booked:            bookedClients.length,
          completed_events:  completedClients.length,
          avg_revenue_usd:   avgRevenue,
          avg_review_score:  avgReview,
        },
        inquiries: {
          last_30_days: recentInquiries?.length ?? 0,
          prev_30_days: prevInquiries?.length ?? 0,
          pct_change:
            prevInquiries && prevInquiries.length > 0
              ? pctChange(recentInquiries?.length ?? 0, prevInquiries.length)
              : null,
        },
        sources: Object.entries(sourceBreakdown).map(([source, s]) => ({
          source,
          bookings:       s.count,
          avg_revenue_usd: s.revenue.length ? Math.round(avg(s.revenue) / 100) : null,
        })),
        channel_spend: Object.entries(channelSpendByChannel).map(([channel, cents]) => ({
          channel,
          total_spend_usd: Math.round(cents / 100),
        })),
        holds_active: (holdAlerts ?? []).map((h: any) => ({
          name:         [h.name_primary, h.name_partner].filter(Boolean).join(" & "),
          event_date:   h.event_date,
          revenue_cents: h.revenue_cents,
        })),
        weather: weatherData
          ? weatherData.slice(0, 6).map((w) => ({
              month:         MONTH_NAMES[(w.month as number) - 1],
              outdoor_score: w.outdoor_score,
              avg_temp_f:    w.avg_temp_4pm_f,
              rain_chance:   w.avg_rain_chance_pct,
            }))
          : [],
        macro: macroData
          ? macroData.slice(0, 6).map((m) => ({
              series:  m.series_id,
              date:    m.date,
              value:   m.value,
              region:  m.region,
            }))
          : [],
      };

      const systemPrompt = `You are Bloom Intelligence, an analytics assistant for wedding venue owners. You have access to the venue's real data and speak directly, plainly, and concisely.

Rules:
- Answer in plain English. No bullet points unless the question specifically asks for a list.
- Be specific — use the numbers from the context. Don't be vague.
- If the data to answer the question isn't available, say so plainly and explain what data would be needed.
- Don't hedge excessively. Give the best answer the data supports.
- Keep answers to 3–5 sentences unless a longer answer is genuinely needed.
- Never say "As an AI..." or refer to yourself as an AI. You are Bloom Intelligence.

Venue context (JSON):
${JSON.stringify(context, null, 2)}`;

      const result = await callAI(input.question, {
        systemPrompt,
        maxTokens:  600,
        venueId:    ctx.venueId,
        taskType:   "insight_ask",
        temperature: 0.3,
      });

      return { answer: result.text, context };
    }),

  // Full journey timeline for a person — inquiry → tour → client
  getJourney: venueProcedure
    .input(z.object({
      name:      z.string().optional(),
      inquiryId: z.string().uuid().optional(),
      clientId:  z.string().uuid().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const { name, inquiryId, clientId } = input;

      let searchName       = name ?? null;
      let resolvedInquiry: any = null;
      let resolvedClient:  any = null;

      if (inquiryId) {
        const { data } = await ctx.db
          .from("inquiries")
          .select("*")
          .eq("id", inquiryId)
          .eq("venue_id", ctx.venueId)
          .single();
        resolvedInquiry = data;
        if (data?.name_extracted && !searchName) searchName = data.name_extracted;
      }

      if (clientId) {
        const { data } = await ctx.db
          .from("clients")
          .select("*")
          .eq("id", clientId)
          .eq("venue_id", ctx.venueId)
          .single();
        resolvedClient = data;
        if (data?.name_primary && !searchName) searchName = data.name_primary;
      }

      if (!searchName && !inquiryId && !clientId) {
        return { events: [], summary: "No search criteria provided." };
      }

      const firstName = searchName
        ? searchName.trim().split(/\s+/)[0].toLowerCase()
        : null;

      const [inquiriesRes, clientsRes] = await Promise.all([
        inquiryId
          ? { data: resolvedInquiry ? [resolvedInquiry] : [] as any[] }
          : firstName
          ? ctx.db
              .from("inquiries")
              .select("*")
              .eq("venue_id", ctx.venueId)
              .ilike("name_extracted", `${firstName}%`)
              .order("received_at", { ascending: true })
          : { data: [] as any[] },

        clientId
          ? { data: resolvedClient ? [resolvedClient] : [] as any[] }
          : firstName
          ? ctx.db
              .from("clients")
              .select("*")
              .eq("venue_id", ctx.venueId)
              .ilike("name_primary", `${firstName}%`)
              .order("event_date", { ascending: true })
          : { data: [] as any[] },
      ]);

      // Also fetch tours for any matched clients
      const clientIds = [
        ...((clientsRes.data as any[]) ?? []).map((c: any) => c.id),
        ...(resolvedInquiry?.matched_client_id ? [resolvedInquiry.matched_client_id] : []),
      ].filter(Boolean);

      const toursRes = clientIds.length > 0
        ? await ctx.db
            .from("tours")
            .select("*")
            .eq("venue_id", ctx.venueId)
            .in("client_id", clientIds)
            .order("scheduled_at", { ascending: true })
        : { data: [] as any[] };

      type JourneyEvent = {
        id:          string;
        stage:       "inquiry" | "tour" | "booked" | "event_complete";
        date:        string | null;
        label:       string;
        platform:    string | null;
        detail:      string | null;
        sourceTable: "inquiries" | "tours" | "clients";
        sourceId:    string;
      };

      const events: JourneyEvent[] = [];

      // Inquiries
      for (const inq of (inquiriesRes.data ?? []) as any[]) {
        events.push({
          id:          inq.id,
          stage:       "inquiry",
          date:        inq.received_at ? new Date(inq.received_at).toISOString().split("T")[0] : null,
          label:       "Sent inquiry",
          platform:    inq.platform ?? null,
          detail:      inq.raw_message
            ? inq.raw_message.slice(0, 200)
            : inq.event_date_extracted
            ? `Event date: ${inq.event_date_extracted}`
            : null,
          sourceTable: "inquiries",
          sourceId:    inq.id,
        });
      }

      // Tours
      for (const tour of (toursRes.data ?? []) as any[]) {
        events.push({
          id:          tour.id,
          stage:       "tour",
          date:        tour.scheduled_at ? new Date(tour.scheduled_at).toISOString().split("T")[0] : null,
          label:       tour.completed ? "Tour completed" : tour.cancel_reason ? "Tour cancelled" : "Tour scheduled",
          platform:    null,
          detail:      [
            tour.tour_type    ? `Type: ${tour.tour_type}` : null,
            tour.outcome      ? `Outcome: ${tour.outcome}` : null,
            tour.cancel_reason ? `Cancel reason: ${tour.cancel_reason}` : null,
          ].filter(Boolean).join(" · ") || null,
          sourceTable: "tours",
          sourceId:    tour.id,
        });
      }

      // Clients
      for (const client of (clientsRes.data ?? []) as any[]) {
        const stageMap: Record<string, JourneyEvent["stage"]> = {
          inquiry:        "inquiry",
          tour_booked:    "tour",
          toured:         "tour",
          held:           "tour",
          contracted:     "booked",
          event_complete: "event_complete",
          archived:       "booked",
          lost:           "booked",
        };
        const stage = stageMap[client.status] ?? "booked";
        events.push({
          id:          client.id,
          stage,
          date:        client.event_date ?? null,
          label:       stage === "event_complete"
            ? "Wedding held"
            : stage === "booked"
            ? "Contracted / booked"
            : stage === "tour"
            ? "Touring / on hold"
            : "Client record",
          platform:    client.first_touch_platform ?? null,
          detail:      [
            client.package        ? `Package: ${client.package}` : null,
            client.revenue_cents  ? `Revenue: $${(client.revenue_cents / 100).toLocaleString()}` : null,
            client.guest_count_final ? `Guests: ${client.guest_count_final}` : null,
          ].filter(Boolean).join(" · ") || null,
          sourceTable: "clients",
          sourceId:    client.id,
        });
      }

      // Sort by date ascending (nulls last)
      events.sort((a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return a.date.localeCompare(b.date);
      });

      const stageOrder = ["inquiry", "tour", "booked", "event_complete"];
      const latestStage = events.reduce((best, e) => {
        return stageOrder.indexOf(e.stage) > stageOrder.indexOf(best) ? e.stage : best;
      }, "inquiry" as string);

      const stageSummary: Record<string, string> = {
        inquiry:        "has inquired but not yet toured",
        tour:           "is actively touring / on hold",
        booked:         "is contracted and booked",
        event_complete: "has had their wedding here",
      };

      const summary = events.length === 0
        ? `No journey data found for "${searchName}".`
        : `${searchName ?? "This person"} ${stageSummary[latestStage] ?? "is in the system"}. ${events.length} recorded touchpoint${events.length === 1 ? "" : "s"}.`;

      return { events, summary, searchName };
    }),

  // AI-powered CSV column mapper
  mapCsvColumns: venueProcedure
    .input(z.object({
      headers:    z.array(z.string()),
      sampleRows: z.array(z.array(z.string())).max(8),
    }))
    .mutation(async ({ input }) => {
      const headerLine  = input.headers.join(" | ");
      const sampleLines = input.sampleRows
        .map((r) => r.map((v) => v.slice(0, 80)).join(" | "))
        .join("\n");

      const prompt = `You are helping import a wedding venue's client spreadsheet into a CRM.

The spreadsheet has these columns:
${headerLine}

Sample rows (first ${input.sampleRows.length}):
${sampleLines}

Map the spreadsheet columns to these CRM fields. For each field, return the EXACT column header string that best matches, or null if nothing fits.

CRM fields:
- name: primary contact's full name or first name
- partner: partner/spouse name
- email: primary email (if multiple email columns exist, pick the real personal one over platform relay addresses like @member.theknot.com, @reply.weddingwire.com, @vmkt-message.zola.com)
- phone: phone number
- event_date: wedding or event date
- inquiry_date: date of first contact / when they first reached out
- guest_count: number of guests (may be a range like "50-100")
- status: booking status (may need derivation — e.g. a "Tour Booked" yes/no column)
- source: how they heard about the venue
- revenue: contract value, invoice total, price paid
- package: package name or service tier

Also return:
- notes: 1-2 sentences about anything unusual in this spreadsheet (e.g. "Dates are stored as Excel serial numbers", "Guest count is a range — we'll use the midpoint", "Status is derived from the Tour Booked column")
- status_derivation: if status must be derived from a non-status column, explain how (e.g. "Use Tour Booked column: Yes=tour_booked, No=archived, blank=inquiry")

Respond with ONLY valid JSON, no markdown:
{
  "mapping": {
    "name": "...",
    "partner": "...",
    "email": "...",
    "phone": null,
    "event_date": "...",
    "inquiry_date": "...",
    "guest_count": "...",
    "status": "...",
    "source": "...",
    "revenue": null,
    "package": null
  },
  "notes": "...",
  "status_derivation": "..."
}`;

      const parsed = await callAIJson<{
        mapping: Record<string, string | null>;
        notes: string;
        status_derivation: string;
      }>(prompt, {
        maxTokens: 800,
        taskType:  "csv_column_map",
        temperature: 0.1,
      });

      return {
        mapping:           parsed.mapping,
        notes:             parsed.notes ?? "",
        statusDerivation:  parsed.status_derivation ?? "",
      };
    }),
});
