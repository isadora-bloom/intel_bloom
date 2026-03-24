import { z } from "zod";
import { router, venueProcedure } from "@/lib/trpc/server";
import { subDays } from "date-fns";
import Anthropic from "@anthropic-ai/sdk";

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
    const insights: BriefingInsight[] = [];

    const { data: venueRaw } = await ctx.supabase
      .from("venues")
      .select("noaa_station_id, google_trends_metro, fed_district, state, name, funnel_config, venue_profile")
      .eq("id", ctx.venueId)
      .single();

    const venue = venueRaw
      ? { ...venueRaw, noaa_station_id: venueRaw.noaa_station_id?.replace(/^GHCND:/i, "") ?? null }
      : venueRaw;

    const [
      { data: sourceClients },
      { data: recentWeather },
      { data: historicalWeather },
      { data: recentInquiries },
      { data: prevInquiries },
      { data: searchTrends },
      { data: macroData },
      { data: beigeBook },
      { data: acquiCosts },
      { data: sourceSpend },
      { data: platformMetrics },
    ] = await Promise.all([
      ctx.supabase
        .from("clients")
        .select("resolved_source, status, revenue_cents, acquisition_cost_cents")
        .eq("venue_id", ctx.venueId)
        .not("resolved_source", "is", null),

      venue?.noaa_station_id
        ? ctx.supabase
            .from("weather_monthly")
            .select("month, year, precipitation_inches, weather_score, temp_avg_f")
            .eq("noaa_station_id", venue.noaa_station_id)
            .eq("month", new Date().getMonth() + 1)
            .order("year", { ascending: false })
            .limit(8)
        : Promise.resolve({ data: null }),

      venue?.noaa_station_id
        ? ctx.supabase
            .from("weather_monthly")
            .select("month, year, weather_score, temp_avg_f, precipitation_inches")
            .eq("noaa_station_id", venue.noaa_station_id)
            .gte("year", new Date().getFullYear() - 8)
        : Promise.resolve({ data: null }),

      ctx.supabase
        .from("inquiries")
        .select("id, received_at")
        .eq("venue_id", ctx.venueId)
        .gte("received_at", subDays(new Date(), 30).toISOString()),

      ctx.supabase
        .from("inquiries")
        .select("id, received_at")
        .eq("venue_id", ctx.venueId)
        .gte("received_at", subDays(new Date(), 90).toISOString())
        .lt("received_at", subDays(new Date(), 30).toISOString()),

      venue?.google_trends_metro
        ? ctx.supabase
            .from("macro_search_trends")
            .select("week_start, term, relative_interest")
            .eq("geo", venue.google_trends_metro)
            .order("week_start", { ascending: false })
            .limit(52)
        : Promise.resolve({ data: null }),

      ctx.supabase
        .from("macro_economic")
        .select("signal_type, period_date, value")
        .in("signal_type", ["consumer_sentiment", "conference_board"])
        .eq("geo_scope", "national")
        .order("period_date", { ascending: false })
        .limit(6),

      venue?.fed_district
        ? ctx.supabase
            .from("macro_economic")
            .select("raw_data, period_date")
            .eq("signal_type", "beige_book_summary")
            .eq("geo_scope", `district_${venue.fed_district}`)
            .order("period_date", { ascending: false })
            .limit(1)
            .single()
        : Promise.resolve({ data: null }),

      ctx.supabase
        .from("client_source_touchpoints")
        .select("platform, cost_cents")
        .eq("venue_id", ctx.venueId)
        .not("cost_cents", "is", null),

      // Annual spend per platform (from uploaded billing screenshots)
      ctx.supabase
        .from("source_spend")
        .select("platform, annual_spend_cents, contract_label, contract_start, contract_end")
        .eq("venue_id", ctx.venueId),

      // Platform performance metrics (impressions, saves, visitors etc from screenshots)
      ctx.supabase
        .from("platform_metrics")
        .select("platform, metric_name, metric_value, period_label, breakdown, comparison, captured_at")
        .eq("venue_id", ctx.venueId)
        .order("captured_at", { ascending: false }),
    ]);

    // ── INSIGHT 1: SOURCE PERFORMANCE ────────────────────────────────────────
    if (sourceClients && sourceClients.length > 0) {
      // Build per-source stats
      const sourceMap = new Map<
        string,
        { inquiries: number; booked: number; revenue: number[]; costs: number[] }
      >();

      for (const c of sourceClients) {
        const s = c.resolved_source as string;
        if (!sourceMap.has(s)) sourceMap.set(s, { inquiries: 0, booked: 0, revenue: [], costs: [] });
        const entry = sourceMap.get(s)!;
        entry.inquiries++;
        if (!["inquiry", "archived"].includes(c.status as string)) entry.booked++;
        if (c.revenue_cents) entry.revenue.push(c.revenue_cents);
      }

      // Supplement with per-booking touchpoint costs
      for (const t of acquiCosts ?? []) {
        const entry = sourceMap.get(t.platform as string);
        if (entry && t.cost_cents) entry.costs.push(t.cost_cents as number);
      }

      // Build annual spend map from captured billing screenshots
      // source_spend has annual_spend_cents for the whole contract period;
      // divide by booked count to get cost-per-booking
      const annualSpendMap = new Map<string, number>();
      for (const s of sourceSpend ?? []) {
        if (s.annual_spend_cents) {
          annualSpendMap.set(s.platform as string, s.annual_spend_cents as number);
        }
      }

      const rows = Array.from(sourceMap.entries())
        .map(([source, s]) => {
          // Prefer per-touchpoint costs; fall back to annual spend ÷ bookings
          let costPerBooking: number | null = null;
          if (s.costs.length > 0 && s.booked > 0) {
            costPerBooking = Math.round(s.costs.reduce((a, b) => a + b, 0) / 100 / s.booked);
          } else if (annualSpendMap.has(source) && s.booked > 0) {
            costPerBooking = Math.round((annualSpendMap.get(source)! / 100) / s.booked);
          }
          return {
            source,
            inquiries: s.inquiries,
            booked: s.booked,
            convRate: s.inquiries > 0 ? s.booked / s.inquiries : 0,
            avgRevenue: s.revenue.length ? Math.round(avg(s.revenue) / 100) : null,
            annualSpendUsd: annualSpendMap.has(source)
              ? Math.round(annualSpendMap.get(source)! / 100)
              : null,
            costPerBooking,
          };
        })
        .sort((a, b) => b.booked - a.booked);

      const best = rows.find((r) => r.convRate === Math.max(...rows.map((x) => x.convRate)));
      const costRows = rows.filter((r) => r.costPerBooking !== null);
      const zeroCostRows = rows.filter(
        (r) => r.costPerBooking === null && r.source !== "direct"
      );

      let headline = "";
      let body = "";
      let sentiment: BriefingInsight["sentiment"] = "neutral";
      const supporting: { label: string; value: string }[] = [];

      if (costRows.length > 0) {
        const sorted = [...costRows].sort((a, b) => a.costPerBooking! - b.costPerBooking!);
        const cheapest = sorted[0];
        const priciest = sorted[sorted.length - 1];
        const cheapestName = cheapest.source.replace(/_/g, " ");
        const prieiestName = priciest.source.replace(/_/g, " ");
        if (sorted.length > 1) {
          headline = `${cheapestName} costs $${cheapest.costPerBooking?.toLocaleString()} per booking — ${prieiestName} costs $${priciest.costPerBooking?.toLocaleString()}`;
        } else {
          headline = `${cheapestName} costs $${cheapest.costPerBooking?.toLocaleString()} per booked wedding`;
        }
        body = `Your paid channel ${cheapestName} is costing $${cheapest.costPerBooking?.toLocaleString()} per booked wedding`;
        if (cheapest.annualSpendUsd) {
          body += ` ($${cheapest.annualSpendUsd.toLocaleString()}/yr ÷ ${cheapest.booked} bookings)`;
        }
        body += `, converting at ${Math.round(cheapest.convRate * 100)}%.`;
        if (zeroCostRows.length > 0) {
          body += ` ${zeroCostRows.map((r) => r.source.replace(/_/g, " ")).join(" and ")} cost nothing and convert at ${Math.round(avg(zeroCostRows.map((r) => r.convRate)) * 100)}%.`;
        }
        sentiment = cheapest.costPerBooking! < 1500 ? "positive" : cheapest.costPerBooking! > 5000 ? "caution" : "neutral";
        for (const r of rows.slice(0, 5)) {
          const parts = [`${Math.round(r.convRate * 100)}% conv`];
          if (r.costPerBooking) parts.push(`$${r.costPerBooking.toLocaleString()}/booking`);
          if (r.annualSpendUsd && !r.costPerBooking) parts.push(`$${r.annualSpendUsd.toLocaleString()}/yr spend`);
          supporting.push({ label: r.source.replace(/_/g, " "), value: parts.join(" · ") });
        }
      } else if (best) {
        headline = `${best.source.replace(/_/g, " ")} converts at ${Math.round(best.convRate * 100)}% — your best performing source`;
        body = `Across ${rows.reduce((s, r) => s + r.inquiries, 0)} total inquiries, ${best.source.replace(/_/g, " ")} has the highest booking rate at ${Math.round(best.convRate * 100)}%.`;
        const uncostedPaidRows = rows.filter((r) => annualSpendMap.has(r.source) && r.booked === 0);
        if (uncostedPaidRows.length > 0) {
          body += ` Upload billing screenshots for ${uncostedPaidRows.map((r) => r.source.replace(/_/g, " ")).join(", ")} to see cost per booking.`;
        } else if (zeroCostRows.length > 0) {
          body += ` Upload billing screenshots in Quick Capture to see cost per booking.`;
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
          id: "source_performance",
          type: "source_performance",
          timeframe: "past",
          headline,
          body,
          action: costRows.length === 0 ? "Add spend data in Settings to see cost per booking" : undefined,
          supporting,
          sentiment,
          dataAvailable: true,
        });
      }
    } else {
      insights.push({
        id: "source_performance",
        type: "source_performance",
        timeframe: "past",
        headline: "Connect HoneyBook to see acquisition costs by channel",
        body: "Once your booking data is synced, Bloom will show you the cost per inquiry, tour, and booking for The Knot, Google Ads, Instagram, and every other source you use.",
        supporting: [],
        sentiment: "neutral",
        dataAvailable: false,
      });
    }

    // ── INSIGHT 1b: PLATFORM ACTIVITY ────────────────────────────────────────
    // Uses captured platform_metrics (impressions, saves, visitors etc)
    if (platformMetrics && platformMetrics.length > 0) {
      // Group by metric_name, take the most recently captured value per metric
      const metricMap = new Map<string, { platform: string; value: number; breakdown: any[]; comparison: string | null }>();
      for (const m of platformMetrics) {
        const key = `${m.platform}:${m.metric_name}`;
        if (!metricMap.has(key)) {
          metricMap.set(key, {
            platform: m.platform as string,
            value: parseFloat(String(m.metric_value ?? 0)),
            breakdown: (m.breakdown as any[]) ?? [],
            comparison: m.comparison as string | null,
          });
        }
      }

      // Look for notable signals in the breakdown data
      const signals: string[] = [];
      const supportingPlatform: { label: string; value: string }[] = [];

      for (const [key, m] of metricMap) {
        const metricLabel = key.split(":")[1].replace(/_/g, " ");
        const platformLabel = m.platform.replace(/_/g, " ");

        // Check if breakdown shows a recent drop (last 2 months vs prior 2 months)
        if (m.breakdown && m.breakdown.length >= 4) {
          const recent = m.breakdown.slice(-2).map((p: any) => Number(p.value ?? 0));
          const prior = m.breakdown.slice(-4, -2).map((p: any) => Number(p.value ?? 0));
          const recentAvg = avg(recent);
          const priorAvg = avg(prior);
          if (priorAvg > 0) {
            const change = pctChange(recentAvg, priorAvg);
            if (Math.abs(change) >= 15) {
              const dir = change > 0 ? "up" : "down";
              signals.push(`${platformLabel} ${metricLabel} is ${dir} ${Math.abs(change)}% over the last two months`);
            }
          }
        }

        // Surface comparison text if available
        if (m.comparison) {
          signals.push(`${platformLabel} ${metricLabel}: ${m.comparison}`);
        }

        if (m.value > 0) {
          supportingPlatform.push({
            label: `${platformLabel} ${metricLabel}`,
            value: m.value >= 1000
              ? `${(m.value / 1000).toFixed(1)}k`
              : String(Math.round(m.value)),
          });
        }
      }

      // Determine a lead signal for the headline
      const savesData = [...metricMap.entries()].find(([k]) => k.includes("saves"));
      const impressionsData = [...metricMap.entries()].find(([k]) => k.includes("impressions"));
      const visitorsData = [...metricMap.entries()].find(([k]) => k.includes("visitors"));

      let platformHeadline = "";
      let platformBody = "";
      let platformSentiment: BriefingInsight["sentiment"] = "neutral";

      if (signals.length > 0) {
        platformHeadline = signals[0].charAt(0).toUpperCase() + signals[0].slice(1);
        platformBody = signals.join(". ") + ".";
        platformSentiment = signals.some((s) => s.includes("down")) ? "caution" : "positive";
      } else if (savesData) {
        const [, s] = savesData;
        platformHeadline = `${Math.round(s.value).toLocaleString()} couples saved your listing in the last 12 months`;
        platformBody = `Saves are a leading indicator — couples who save typically inquire within 2–4 months.`;
        if (impressionsData) {
          const impressionVal = impressionsData[1].value;
          const saveRate = s.value / impressionVal * 100;
          platformBody += ` Your save rate is ${saveRate.toFixed(1)}% of impressions.`;
        }
        platformSentiment = s.value > 400 ? "positive" : "neutral";
      } else if (impressionsData) {
        const [, imp] = impressionsData;
        platformHeadline = `${(imp.value / 1000).toFixed(1)}k impressions in the last 12 months on ${imp.platform.replace(/_/g, " ")}`;
        platformBody = `Impressions show how often couples are seeing your listing. `;
        if (visitorsData) {
          const clickThrough = visitorsData[1].value / imp.value * 100;
          platformBody += `${clickThrough.toFixed(1)}% clicked through to your storefront.`;
        }
        platformSentiment = "neutral";
      }

      if (platformHeadline) {
        insights.push({
          id: "platform_activity",
          type: "platform_activity",
          timeframe: "present",
          headline: platformHeadline,
          body: platformBody,
          supporting: supportingPlatform.slice(0, 6),
          sentiment: platformSentiment,
          dataAvailable: true,
        });
      }
    }

    // ── INSIGHT 2: WEATHER EXPLAINER ─────────────────────────────────────────
    if (recentWeather && recentWeather.length > 0 && recentInquiries !== null) {
      const currentYear = new Date().getFullYear();
      const currentMonth = new Date().getMonth() + 1;

      // Prefer current year's data; fall back to historical average for this month
      const thisYearRow = recentWeather.find((r) => r.year === currentYear);
      const historicalRows = recentWeather.filter(
        (r) => r.year !== currentYear && r.weather_score !== null
      );

      let precipScore: number | null = null;
      let precipIn: number | null = null;
      let isHistoricalFallback = false;

      if (thisYearRow && thisYearRow.weather_score !== null) {
        // Current year data available
        precipScore = thisYearRow.weather_score as number;
        precipIn = thisYearRow.precipitation_inches as number | null;
      } else if (historicalRows.length > 0) {
        // Fall back to historical average for this month
        precipScore = Math.round(
          avg(historicalRows.map((r) => r.weather_score as number)) * 10
        ) / 10;
        precipIn = null;
        isHistoricalFallback = true;
      }

      const recentCount = recentInquiries.length;
      const avgPrev = prevInquiries ? prevInquiries.length / 2 : null;
      const monthName = MONTH_NAMES[currentMonth - 1];

      let headline = "";
      let body = "";
      let sentiment: BriefingInsight["sentiment"] = "neutral";
      const supporting: { label: string; value: string }[] = [];

      if (precipScore === null) {
        // No data at all for this month
        headline = `${monthName} weather data not yet available`;
        body = `NOAA data for ${monthName} ${currentYear} hasn't been ingested yet. Check back once the monthly ingestion has run.`;
        sentiment = "neutral";
      } else if (precipScore >= 5) {
        const dataLabel = isHistoricalFallback
          ? `${monthName} historically averages a difficulty score of ${precipScore}/10 (${historicalRows.length}-year average)`
          : `${monthName} difficulty score is ${precipScore}/10 at your NOAA station`;
        headline = `${monthName} weather is difficult — expect inquiry suppression`;
        body = `${dataLabel}. `;
        if (!isHistoricalFallback && precipIn !== null) {
          body += `${precipIn.toFixed(1)}" of precipitation recorded. `;
        }
        if (avgPrev !== null && recentCount < avgPrev * 0.8) {
          const drop = Math.abs(Math.round(pctChange(recentCount, avgPrev)));
          body += `Inquiries are down ${drop}% vs your recent average — consistent with weather suppression. Expect a rebound when conditions improve.`;
          sentiment = "caution";
        } else if (isHistoricalFallback) {
          body += `This month typically sees reduced inquiry volume due to weather. If your numbers are down, this is likely why.`;
          sentiment = "caution";
        } else {
          body += `Inquiries have held relatively steady despite conditions.`;
          sentiment = "neutral";
        }
        supporting.push({ label: "Difficulty score", value: `${precipScore}/10` });
        if (!isHistoricalFallback && precipIn !== null) supporting.push({ label: "Precip", value: `${precipIn.toFixed(1)}"` });
        if (isHistoricalFallback) supporting.push({ label: "Data", value: `${historicalRows.length}-yr avg` });
        if (avgPrev !== null) {
          supporting.push({ label: "Inquiries (30d)", value: String(recentCount) });
          supporting.push({ label: "Prior avg", value: Math.round(avgPrev).toString() });
        }
      } else if (precipScore <= 2) {
        const dataLabel = isHistoricalFallback
          ? `${monthName} historically has low weather difficulty (${precipScore}/10 average)`
          : `${monthName} difficulty score is ${precipScore}/10`;
        headline = `${monthName} weather is favourable — no suppression expected`;
        body = `${dataLabel}. `;
        if (avgPrev !== null && recentCount >= avgPrev) {
          body += `Inquiries are tracking at or above your recent average — no weather headwinds.`;
          sentiment = "positive";
        } else {
          body += `If inquiries are softer than expected, weather isn't the cause — look at macro signals or campaign activity.`;
          sentiment = "neutral";
        }
        supporting.push({ label: "Difficulty score", value: `${precipScore}/10` });
        if (isHistoricalFallback) supporting.push({ label: "Data", value: `${historicalRows.length}-yr avg` });
        if (avgPrev !== null) supporting.push({ label: "Inquiries (30d)", value: String(recentCount) });
      } else {
        headline = `${monthName} weather is moderate — minor impact on inquiry volume`;
        body = `Difficulty score is ${precipScore}/10${isHistoricalFallback ? ` (${historicalRows.length}-year ${monthName} average)` : ""}. Some weather effect is possible but not significant enough to fully explain volume changes.`;
        sentiment = "neutral";
        supporting.push({ label: "Difficulty score", value: `${precipScore}/10` });
        if (avgPrev !== null) supporting.push({ label: "Inquiries (30d)", value: String(recentCount) });
      }

      insights.push({
        id: "weather_explainer",
        type: "weather_explainer",
          timeframe: "present",
        headline,
        body,
        supporting,
        sentiment,
        dataAvailable: precipScore !== null,
      });
    } else {
      insights.push({
        id: "weather_explainer",
        type: "weather_explainer",
          timeframe: "present",
        headline: "Weather data not yet loaded for your station",
        body: "Once NOAA historical data is ingested for your station, Bloom will automatically explain inquiry volume changes using local weather patterns.",
        supporting: [],
        sentiment: "neutral",
        dataAvailable: false,
      });
    }

    // ── INSIGHT 3: SEASONAL PRICING SIGNAL ───────────────────────────────────
    if (historicalWeather && historicalWeather.length > 0) {
      // Average weather score per month across all years
      const monthAvgScore: Record<number, number[]> = {};
      for (const row of historicalWeather) {
        if (!monthAvgScore[row.month]) monthAvgScore[row.month] = [];
        if (row.weather_score !== null) monthAvgScore[row.month].push(row.weather_score);
      }

      const monthSummaries = Object.entries(monthAvgScore)
        .map(([m, scores]) => ({
          month: parseInt(m),
          name: MONTH_NAMES[parseInt(m) - 1],
          avgScore: Math.round(avg(scores) * 10) / 10,
          years: scores.length,
        }))
        .sort((a, b) => a.month - b.month);

      const highRisk = monthSummaries.filter((m) => m.avgScore >= 5).sort((a, b) => b.avgScore - a.avgScore);
      const ideal = monthSummaries.filter((m) => m.avgScore <= 1).sort((a, b) => a.avgScore - b.avgScore);

      let headline = "";
      let body = "";
      let sentiment: BriefingInsight["sentiment"] = "neutral";
      const supporting: { label: string; value: string }[] = [];

      if (highRisk.length > 0) {
        const top = highRisk[0];
        headline = `${top.name} is your highest-risk month (avg difficulty ${top.avgScore}/10 over ${top.years} years)`;
        body = `Historically, ${top.name} at your location averages a weather difficulty of ${top.avgScore}/10. `;
        if (highRisk.length > 1) {
          body += `${highRisk.slice(1, 3).map((m) => m.name).join(" and ")} are also elevated. `;
        }
        body += `Couples who book during difficult weather months tend to leave lower reviews — consider pricing these months at a modest discount to maintain booking velocity and temper expectations.`;
        sentiment = "caution";

        for (const m of monthSummaries) {
          supporting.push({ label: m.name, value: `${m.avgScore}/10` });
        }
      } else if (ideal.length > 0) {
        headline = `${ideal.slice(0, 2).map((m) => m.name).join(" and ")} are your most weather-reliable months`;
        body = `Based on ${ideal[0].years} years of NOAA data, these months average a difficulty score below 2/10. These are your strongest candidates for peak pricing.`;
        sentiment = "positive";
        for (const m of ideal.slice(0, 4)) {
          supporting.push({ label: m.name, value: `${m.avgScore}/10 avg` });
        }
      } else {
        headline = "Weather seasonality is relatively consistent across your calendar";
        body = `No single month stands out as significantly more difficult than others based on ${Object.values(monthAvgScore)[0]?.length ?? "N"} years of data. Your pricing can be driven by demand rather than weather risk.`;
        sentiment = "neutral";
      }

      insights.push({
        id: "seasonal_pricing",
        type: "seasonal_pricing",
          timeframe: "past",
        headline,
        body,
        action: highRisk.length > 0 ? `Consider 8–15% lower pricing for ${highRisk.map((m) => m.name).join(", ")} to maintain booking velocity` : undefined,
        supporting,
        sentiment,
        dataAvailable: true,
      });
    } else {
      insights.push({
        id: "seasonal_pricing",
        type: "seasonal_pricing",
          timeframe: "past",
        headline: "Seasonal pricing intelligence needs weather history",
        body: "Once NOAA data loads for your station, Bloom will identify which months carry weather risk and suggest pricing adjustments accordingly.",
        supporting: [],
        sentiment: "neutral",
        dataAvailable: false,
      });
    }

    // ── INSIGHT 4: LEADING INDICATOR ─────────────────────────────────────────
    if (searchTrends && searchTrends.length >= 8) {
      // Group by term, look for "engagement" or "wedding venue" terms
      const engagementData = searchTrends.filter((t) =>
        (t.term as string).toLowerCase().includes("engagement")
      );
      const weddingData = searchTrends.filter((t) =>
        (t.term as string).toLowerCase().includes("wedding")
      );

      const targetData = engagementData.length >= 4 ? engagementData : weddingData;
      const termLabel = engagementData.length >= 4 ? "engagement ring" : "wedding venue";

      if (targetData.length >= 8) {
        const recent4 = targetData.slice(0, 4);
        const prev4 = targetData.slice(4, 8);
        const recentAvg = avg(recent4.map((t) => t.relative_interest as number));
        const prevAvg = avg(prev4.map((t) => t.relative_interest as number));
        const vsSeasonalPct = pctChange(recentAvg, prevAvg);

        const metro = venue?.google_trends_metro ?? "your market";
        const leadTimeMonths = termLabel === "engagement ring" ? 9 : 3;
        const futureDate = new Date();
        futureDate.setMonth(futureDate.getMonth() + leadTimeMonths);
        const futurePeriod = futureDate.toLocaleString("default", { month: "long", year: "numeric" });

        let headline = "";
        let body = "";
        let sentiment: BriefingInsight["sentiment"] = "neutral";

        if (vsSeasonalPct <= -15) {
          headline = `"${termLabel}" searches in ${metro} are ${Math.abs(vsSeasonalPct)}% below recent average`;
          body = `Google Trends shows "${termLabel}" search volume in ${metro} running ${Math.abs(vsSeasonalPct)}% below the prior 4-week level. With a typical ${leadTimeMonths}-month lead time from search to inquiry, this signals softer inquiry volume around ${futurePeriod}. `;
          body += `This is a leading indicator, not a guarantee — but worth watching.`;
          sentiment = "caution";
        } else if (vsSeasonalPct >= 15) {
          headline = `"${termLabel}" searches in ${metro} are ${vsSeasonalPct}% above recent average`;
          body = `Search interest for "${termLabel}" in ${metro} is running ${vsSeasonalPct}% above the prior 4-week level. With a ${leadTimeMonths}-month lead time, this suggests stronger-than-usual inquiry volume around ${futurePeriod}.`;
          body += ` Consider whether your enquiry capacity and response speed is ready.`;
          sentiment = "positive";
        } else {
          headline = `"${termLabel}" searches in ${metro} are tracking in line with recent weeks`;
          body = `Search volume for "${termLabel}" in ${metro} is ${vsSeasonalPct > 0 ? "+" : ""}${vsSeasonalPct}% vs the prior 4-week average — no significant deviation. Inquiry volume in ${futurePeriod} is on track with current trends.`;
          sentiment = "neutral";
        }

        insights.push({
          id: "leading_indicator",
          type: "leading_indicator",
          timeframe: "future",
          headline,
          body,
          supporting: [
            { label: "Last 4 weeks avg", value: Math.round(recentAvg).toString() },
            { label: "Prior 4 weeks avg", value: Math.round(prevAvg).toString() },
            { label: "Change", value: `${vsSeasonalPct > 0 ? "+" : ""}${vsSeasonalPct}%` },
            { label: "Lead time", value: `~${leadTimeMonths} months` },
          ],
          sentiment,
          dataAvailable: true,
        });
      }
    }

    if (!insights.find((i) => i.id === "leading_indicator")) {
      insights.push({
        id: "leading_indicator",
        type: "leading_indicator",
          timeframe: "future",
        headline: "Search trend data not yet loaded for your market",
        body: "Once Google Trends data is pulled for your metro area, Bloom will show you leading indicator signals — like engagement ring search volume — that predict inquiry volume months in advance.",
        supporting: [],
        sentiment: "neutral",
        dataAvailable: false,
      });
    }

    // ── INSIGHT 5: MACRO CONTEXT ──────────────────────────────────────────────
    if (macroData && macroData.length >= 2) {
      const sentimentRows = macroData
        .filter((r) => r.signal_type === "consumer_sentiment")
        .sort((a, b) => new Date(b.period_date).getTime() - new Date(a.period_date).getTime());

      if (sentimentRows.length >= 2) {
        const latest = Number(sentimentRows[0].value);
        const prev = Number(sentimentRows[1].value);
        const change = Math.round((latest - prev) * 10) / 10;
        const trend = change > 1 ? "rising" : change < -1 ? "falling" : "stable";

        const latestDate = new Date(sentimentRows[0].period_date as string).toLocaleString(
          "default", { month: "long", year: "numeric" }
        );

        let headline = "";
        let body = "";
        let sentiment: BriefingInsight["sentiment"] = "neutral";
        const supporting: { label: string; value: string }[] = [];

        if (trend === "falling") {
          headline = `Consumer confidence fell ${Math.abs(change)} points in ${latestDate} — spending caution ahead`;
          body = `The University of Michigan Consumer Sentiment Index is at ${latest.toFixed(1)}, down ${Math.abs(change)} from last month. When confidence falls, discretionary spending — including weddings — tends to soften over the following 3–6 months. `;
          sentiment = "caution";
        } else if (trend === "rising") {
          headline = `Consumer confidence rose ${change} points in ${latestDate} — positive for bookings`;
          body = `Consumer sentiment is at ${latest.toFixed(1)}, up ${change} from last month. Rising confidence typically translates to increased willingness to commit to large discretionary purchases like weddings. `;
          sentiment = "positive";
        } else {
          headline = `Consumer confidence is stable at ${latest.toFixed(1)} — no macro headwinds`;
          body = `The University of Michigan Consumer Sentiment Index is holding steady at ${latest.toFixed(1)} — within 1 point of last month. No significant consumer confidence headwinds to watch for. `;
          sentiment = "neutral";
        }

        if (beigeBook?.raw_data) {
          const summary = (beigeBook.raw_data as any)?.summary;
          if (summary) {
            body += `\n\nFed District ${venue?.fed_district ?? ""} (Beige Book): "${summary}"`;
          }
        } else {
          body += `Election cycles and Fed rate decisions are the most common macro disruptors for the wedding industry — worth monitoring alongside your own inquiry trends.`;
        }

        supporting.push({ label: "UMich sentiment", value: latest.toFixed(1) });
        supporting.push({
          label: "Month-over-month",
          value: `${change > 0 ? "+" : ""}${change}`,
        });
        if (sentimentRows.length >= 4) {
          const threeMonthsAgo = Number(sentimentRows[3].value);
          const trend3m = Math.round((latest - threeMonthsAgo) * 10) / 10;
          supporting.push({
            label: "3-month change",
            value: `${trend3m > 0 ? "+" : ""}${trend3m}`,
          });
        }

        insights.push({
          id: "macro_context",
          type: "macro_context",
          timeframe: "present",
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
        id: "macro_context",
        type: "macro_context",
          timeframe: "present",
        headline: "Macro signals load once FRED economic data is ingested",
        body: "Consumer confidence, Fed district economic conditions, and wedding industry trends will appear here once the FRED ingestion script has run.",
        supporting: [],
        sentiment: "neutral",
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
          id: "rec_response_speed",
          type: "recommendation",
          timeframe: "recommendation",
          headline: "Tighten your inquiry response time now",
          body: `Engagement searches are elevated — a surge of newly-engaged couples will start reaching out around ${month}. Venues that respond within 2 hours convert at 2–3× the rate of those who respond the next day. Review your inquiry workflow before the volume arrives.`,
          action: "Aim for sub-2hr first response on all new inquiries",
          supporting: [],
          sentiment: "positive",
          dataAvailable: true,
        });
      } else if (leadingInsight.sentiment === "caution") {
        insights.push({
          id: "rec_pipeline_now",
          type: "recommendation",
          timeframe: "recommendation",
          headline: "Soft demand ahead — work what's already in your pipeline",
          body: `Search interest is below recent levels, which typically means fewer new inquiries in the coming months. Your best lever right now is converting the couples already talking to you. Review any inquiry that hasn't had a follow-up in 2+ weeks.`,
          action: "Audit open inquiries — follow up on anyone who's gone quiet",
          supporting: [],
          sentiment: "caution",
          dataAvailable: true,
        });
      }
    }

    // Rec 2: weather-driven pricing
    if (seasonalInsight?.dataAvailable && seasonalInsight.sentiment === "caution") {
      const highRiskMonths = seasonalInsight.supporting
        .filter(s => parseFloat(s.value) >= 5)
        .map(s => s.label);
      if (highRiskMonths.length > 0) {
        const monthList = highRiskMonths.slice(0, 3).join(", ");
        insights.push({
          id: "rec_weather_pricing",
          type: "recommendation",
          timeframe: "recommendation",
          headline: `Price ${monthList} to reflect the weather risk`,
          body: `These months historically score high for rain and temperature discomfort. Couples who experience a rough weather day tend to leave lower reviews even when everything else goes perfectly. A modest price reduction (8–15%) for these dates sets expectations appropriately and keeps booking velocity strong.`,
          action: `Consider a 10% reduction on ${monthList} or reframe them for intimate/elopement packages`,
          supporting: seasonalInsight.supporting.filter(s => parseFloat(s.value) >= 5),
          sentiment: "caution",
          dataAvailable: true,
        });
      }
    }

    // Rec 3: consumer confidence → reduce friction
    if (macroInsight?.dataAvailable && macroInsight.sentiment === "caution"
        && !insights.find(i => i.id === "rec_response_speed" || i.id === "rec_pipeline_now")) {
      insights.push({
        id: "rec_macro",
        type: "recommendation",
        timeframe: "recommendation",
        headline: "Confidence is soft — make committing feel easy",
        body: `When discretionary spending confidence drops, couples don't stop wanting to get married — they become more deliberate. The venues that win in this environment have fast responses, clear pricing, and flexible holds. Review your inquiry-to-tour pipeline for anything that adds unnecessary friction.`,
        action: "Audit your inquiry-to-tour flow — remove any step that isn't essential",
        supporting: macroInsight.supporting,
        sentiment: "caution",
        dataAvailable: true,
      });
    }

    // Rec 4: attribution discipline (if multi-source with cost data)
    if (sourceInsight?.dataAvailable && sourceInsight.supporting.length >= 2
        && sourceInsight.supporting.some(s => s.value.includes("$"))
        && !insights.find(i => i.id.startsWith("rec_"))) {
      insights.push({
        id: "rec_attribution",
        type: "recommendation",
        timeframe: "recommendation",
        headline: "Ask every inquiry how they found you — your attribution likely has gaps",
        body: `Many couples self-report "Google" when they mean "Instagram, then Googled your name, then found you on The Knot." Add "How did you first hear about us?" as the first question in your inquiry form and train your team to probe past the obvious answer. Better attribution data directly improves the ROI calculation above.`,
        action: "Make source the first question on your inquiry form",
        supporting: [],
        sentiment: "neutral",
        dataAvailable: true,
      });
    }

    return insights;
  }),

  // ── ASK AN INSIGHT ────────────────────────────────────────────────────────
  ask: venueProcedure
    .input(z.object({ question: z.string().min(3).max(1000) }))
    .mutation(async ({ ctx, input }) => {
      const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });

      // Fetch venue first (needed for conditional queries below)
      const { data: venueRaw } = await ctx.supabase
        .from("venues")
        .select("name, city, state, noaa_station_id, google_trends_metro, fed_district, funnel_config, venue_profile")
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
        { data: weatherData },
        { data: macroData },
        { data: pulse },
        { data: sourceSummary },
        { data: platformMetrics },
        { data: sourceSpend },
        { data: holdAlerts },
      ] = await Promise.all([
        ctx.supabase
          .from("clients")
          .select(
            "status, revenue_cents, resolved_source, review_star_rating, event_year, event_month, complexity_score, guest_count_final"
          )
          .eq("venue_id", ctx.venueId),

        ctx.supabase
          .from("inquiries")
          .select("id, platform, received_at, response_time_minutes, match_status")
          .eq("venue_id", ctx.venueId)
          .gte("received_at", subDays(new Date(), 30).toISOString()),

        ctx.supabase
          .from("inquiries")
          .select("id")
          .eq("venue_id", ctx.venueId)
          .gte("received_at", subDays(new Date(), 60).toISOString())
          .lt("received_at", subDays(new Date(), 30).toISOString()),

        venue?.noaa_station_id
          ? ctx.supabase
              .from("weather_monthly")
              .select("month, year, weather_score, precipitation_inches, temp_avg_f")
              .eq("noaa_station_id", venue.noaa_station_id)
              .order("year", { ascending: false })
              .order("month", { ascending: false })
              .limit(12)
          : Promise.resolve({ data: null }),

        ctx.supabase
          .from("macro_economic")
          .select("signal_type, period_date, value, raw_data, geo_scope")
          .order("period_date", { ascending: false })
          .limit(20),

        ctx.supabase
          .from("market_pulse")
          .select("*")
          .eq("venue_id", ctx.venueId)
          .order("calculated_at", { ascending: false })
          .limit(1)
          .single(),

        ctx.supabase
          .from("clients")
          .select("resolved_source, status, revenue_cents")
          .eq("venue_id", ctx.venueId)
          .not("resolved_source", "is", null),

        // Platform performance metrics captured from screenshots
        ctx.supabase
          .from("platform_metrics")
          .select("platform, metric_name, metric_value, period_label, period_start, period_end, breakdown, comparison, captured_at")
          .eq("venue_id", ctx.venueId)
          .order("captured_at", { ascending: false })
          .limit(50),

        // What the venue pays per platform
        ctx.supabase
          .from("source_spend")
          .select("platform, annual_spend_cents, contract_start, contract_end, contract_label")
          .eq("venue_id", ctx.venueId),

        // Holds expiring soon
        ctx.supabase
          .from("clients")
          .select("id, name_primary, name_partner, hold_expires_at, revenue_cents, event_date")
          .eq("venue_id", ctx.venueId)
          .not("hold_expires_at", "is", null)
          .gte("hold_expires_at", new Date().toISOString())
          .order("hold_expires_at", { ascending: true })
          .limit(10),
      ]);

      // Build compact context object
      const totalClients = clients?.length ?? 0;
      const bookedClients = clients?.filter((c) =>
        !["inquiry", "archived"].includes(c.status as string)
      ) ?? [];
      const completedClients = clients?.filter((c) => c.status === "event_complete") ?? [];

      const avgRevenue =
        completedClients.filter((c) => c.revenue_cents).length > 0
          ? Math.round(
              avg(completedClients.filter((c) => c.revenue_cents).map((c) => c.revenue_cents!)) /
                100
            )
          : null;

      const avgReview =
        completedClients.filter((c) => c.review_star_rating).length > 0
          ? Math.round(
              avg(
                completedClients
                  .filter((c) => c.review_star_rating)
                  .map((c) => c.review_star_rating as number)
              ) * 10
            ) / 10
          : null;

      // Source breakdown
      const sourceBreakdown: Record<string, { count: number; revenue: number[] }> = {};
      for (const c of sourceSummary ?? []) {
        const s = c.resolved_source as string;
        if (!sourceBreakdown[s]) sourceBreakdown[s] = { count: 0, revenue: [] };
        sourceBreakdown[s].count++;
        if (c.revenue_cents) sourceBreakdown[s].revenue.push(c.revenue_cents);
      }

      // Cost-per-booking calculations per platform
      const costPerBooking: Record<string, { spend_usd: number; bookings: number; cost_per_booking_usd: number | null }> = {};
      for (const spend of sourceSpend ?? []) {
        const p = spend.platform as string;
        const spendUsd = spend.annual_spend_cents ? spend.annual_spend_cents / 100 : 0;
        const bookings = sourceBreakdown[p]?.count ?? 0;
        costPerBooking[p] = {
          spend_usd: spendUsd,
          bookings,
          cost_per_booking_usd: bookings > 0 ? Math.round(spendUsd / bookings) : null,
        };
      }

      // Extract venue_profile economics with estimated fallbacks
      const vp: Record<string, any> = (venue?.venue_profile as Record<string, any>) ?? {};
      const fc: Record<string, any> = (venue?.funnel_config as Record<string, any>) ?? {};
      const estimatedPackageValue = vp.avg_package_value_bucket?.value ?? null;
      const estimatedAdSpend = vp.monthly_ad_spend_bucket?.value ?? null;
      const estimatedToursToBook = vp.typical_tours_per_booking_bucket?.value ?? null;

      const context = {
        venue: {
          name: venue?.name,
          location: `${venue?.city}, ${venue?.state}`,
          noaa_station: venue?.noaa_station_id,
          metro: venue?.google_trends_metro,
          fed_district: venue?.fed_district,
        },
        funnel: {
          awareness_channels: fc.awareness_channels ?? [],
          first_touch_methods: fc.first_touch_methods ?? [],
          tour_method: fc.tour_method ?? null,
          contract_method: fc.contract_method ?? null,
        },
        economics_estimates: {
          avg_package_value: estimatedPackageValue,
          monthly_ad_spend: estimatedAdSpend,
          tours_per_booking: estimatedToursToBook,
          note: estimatedPackageValue ? "venue estimates — will be refined as real data accumulates" : "not yet provided",
        },
        clients: {
          total: totalClients,
          booked: bookedClients.length,
          completed_events: completedClients.length,
          avg_revenue_usd: avgRevenue,
          avg_review_score: avgReview,
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
          bookings: s.count,
          avg_revenue_usd: s.revenue.length ? Math.round(avg(s.revenue) / 100) : null,
        })),
        platform_spend: Object.entries(costPerBooking).map(([platform, d]) => ({
          platform,
          annual_spend_usd: d.spend_usd,
          bookings_attributed: d.bookings,
          cost_per_booking_usd: d.cost_per_booking_usd,
        })),
        holds_expiring: (holdAlerts ?? []).map((h: any) => {
          const expires = new Date(h.hold_expires_at);
          const daysLeft = Math.round((expires.getTime() - Date.now()) / 86400000);
          return {
            name: [h.name_primary, h.name_partner].filter(Boolean).join(" & "),
            event_date: h.event_date,
            revenue_cents: h.revenue_cents,
            days_left: daysLeft,
          };
        }),
        platform_metrics: (platformMetrics ?? []).map((m) => ({
          platform: m.platform,
          metric: m.metric_name,
          value: m.metric_value,
          period: m.period_label,
          vs_prior: m.comparison,
          // Include breakdown only if it has data (keeps context compact)
          breakdown: m.breakdown ? (m.breakdown as any[]).slice(0, 24) : undefined,
        })),
        weather_recent:
          weatherData?.slice(0, 3).map((w) => ({
            month: MONTH_NAMES[(w.month as number) - 1],
            year: w.year,
            difficulty_score: w.weather_score,
            precipitation_in: w.precipitation_inches,
            avg_temp_f: w.temp_avg_f,
          })) ?? [],
        macro: {
          consumer_sentiment: macroData
            ?.filter((m) => m.signal_type === "consumer_sentiment")
            .slice(0, 3)
            .map((m) => ({ date: m.period_date, value: m.value })),
          beige_book: macroData
            ?.filter((m) => m.signal_type === "beige_book_summary")
            .slice(0, 1)
            .map((m) => ({
              date: m.period_date,
              summary: (m.raw_data as any)?.summary,
            }))[0],
        },
        market_pulse: pulse
          ? {
              outlook: pulse.demand_outlook,
              score: pulse.demand_score,
              search_vs_seasonal: pulse.search_volume_vs_seasonal,
              consumer_confidence_trend: pulse.consumer_confidence_trend,
            }
          : null,
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

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 600,
        system: systemPrompt,
        messages: [{ role: "user", content: input.question }],
      });

      const answer =
        response.content[0].type === "text" ? response.content[0].text : "Unable to generate answer.";

      return { answer, context };
    }),

  // Full journey timeline for a person — leads → inquiry → tour → client
  getJourney: venueProcedure
    .input(z.object({
      name: z.string().optional(),
      inquiryId: z.string().uuid().optional(),
      clientId: z.string().uuid().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const { name, inquiryId, clientId } = input;

      // Resolve to a canonical name to search with
      let searchName = name ?? null;
      let resolvedInquiry: any = null;
      let resolvedClient: any = null;

      if (inquiryId) {
        const { data } = await ctx.supabase
          .from("inquiries")
          .select("*")
          .eq("id", inquiryId)
          .eq("venue_id", ctx.venueId)
          .single();
        resolvedInquiry = data;
        if (data?.name_extracted && !searchName) searchName = data.name_extracted;
      }

      if (clientId) {
        const { data } = await ctx.supabase
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

      // Fetch all matching records in parallel
      const firstName = searchName
        ? searchName.trim().split(/\s+/)[0].toLowerCase()
        : null;

      const [leadsRes, inquiriesRes, clientsRes] = await Promise.all([
        // Leads: pre-inquiry funnel touches
        firstName
          ? ctx.supabase
              .from("leads")
              .select("*")
              .eq("venue_id", ctx.venueId)
              .ilike("name", `${firstName}%`)
              .order("source_date", { ascending: true })
          : { data: [] },

        // Inquiries: either the resolved one or name-matched
        inquiryId
          ? { data: resolvedInquiry ? [resolvedInquiry] : [] }
          : firstName
          ? ctx.supabase
              .from("inquiries")
              .select("*")
              .eq("venue_id", ctx.venueId)
              .ilike("name_extracted", `${firstName}%`)
              .order("received_at", { ascending: true })
          : { data: [] },

        // Clients
        clientId
          ? { data: resolvedClient ? [resolvedClient] : [] }
          : firstName
          ? ctx.supabase
              .from("clients")
              .select("*")
              .eq("venue_id", ctx.venueId)
              .ilike("name_primary", `${firstName}%`)
              .order("event_date", { ascending: true })
          : { data: [] },
      ]);

      type JourneyEvent = {
        id: string;
        stage: "lead" | "inquiry" | "tour" | "booked" | "event_complete";
        date: string | null;
        label: string;
        platform: string | null;
        detail: string | null;
        sourceTable: "leads" | "inquiries" | "clients";
        sourceId: string;
      };

      const events: JourneyEvent[] = [];

      // Leads → funnel touches
      for (const lead of (leadsRes.data ?? []) as any[]) {
        const touchLabel: Record<string, string> = {
          save: "Saved storefront",
          storefront_visit: "Visited storefront",
          website_visit: "Clicked through to website",
          link_click: "Clicked a link",
          social_follow: "Followed on social",
          social_dm: "Sent a DM",
          call: "Called",
          form_visit: "Visited contact form",
        };
        events.push({
          id: lead.id,
          stage: "lead",
          date: lead.source_date,
          label: touchLabel[lead.touch_type] ?? lead.touch_type,
          platform: lead.platform,
          detail: lead.raw_activity ?? null,
          sourceTable: "leads",
          sourceId: lead.id,
        });
      }

      // Inquiries
      for (const inq of (inquiriesRes.data ?? []) as any[]) {
        events.push({
          id: inq.id,
          stage: "inquiry",
          date: inq.received_at ? new Date(inq.received_at).toISOString().split("T")[0] : null,
          label: "Sent inquiry",
          platform: inq.platform ?? null,
          detail: inq.raw_message
            ? inq.raw_message.slice(0, 200)
            : inq.event_date_extracted
            ? `Event date: ${inq.event_date_extracted}`
            : null,
          sourceTable: "inquiries",
          sourceId: inq.id,
        });
      }

      // Clients — may represent tour booked, booked, or complete
      for (const client of (clientsRes.data ?? []) as any[]) {
        const stageMap: Record<string, JourneyEvent["stage"]> = {
          inquiry: "inquiry",
          touring: "tour",
          hold: "tour",
          contracted: "booked",
          event_complete: "event_complete",
        };
        const stage = stageMap[client.status] ?? "booked";
        events.push({
          id: client.id,
          stage,
          date: client.event_date ?? null,
          label: stage === "event_complete"
            ? "Wedding held"
            : stage === "booked"
            ? "Contracted / booked"
            : stage === "tour"
            ? "Touring / on hold"
            : "Client record",
          platform: client.first_touch_platform ?? null,
          detail: [
            client.package ? `Package: ${client.package}` : null,
            client.revenue_cents ? `Revenue: $${(client.revenue_cents / 100).toLocaleString()}` : null,
            client.guest_count_final ? `Guests: ${client.guest_count_final}` : null,
          ].filter(Boolean).join(" · ") || null,
          sourceTable: "clients",
          sourceId: client.id,
        });
      }

      // Sort by date ascending (nulls last)
      events.sort((a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return a.date.localeCompare(b.date);
      });

      // Build a plain-English summary
      const stageOrder = ["lead", "inquiry", "tour", "booked", "event_complete"];
      const latestStage = events.reduce((best, e) => {
        return stageOrder.indexOf(e.stage) > stageOrder.indexOf(best) ? e.stage : best;
      }, "lead" as string);

      const stageSummary: Record<string, string> = {
        lead: "still in the pre-inquiry funnel",
        inquiry: "has inquired but not yet toured",
        tour: "is actively touring / on hold",
        booked: "is contracted and booked",
        event_complete: "has had their wedding here",
      };

      const summary = events.length === 0
        ? `No journey data found for "${searchName}".`
        : `${searchName ?? "This person"} ${stageSummary[latestStage] ?? "is in the system"}. ${events.length} recorded touchpoint${events.length === 1 ? "" : "s"} across ${[...new Set(events.map(e => e.sourceTable))].join(", ")}.`;

      return { events, summary, searchName };
    }),
});
