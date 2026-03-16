/**
 * Market Pulse Calculator
 * Refreshes weekly. Cached in market_pulse table.
 * Only recalculates if valid_until is in the past.
 */

import { createClient } from "@supabase/supabase-js";
import { addDays, subDays, format } from "date-fns";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function getLatestConsumerSentiment() {
  const { data } = await supabase
    .from("macro_economic")
    .select("value, period_date")
    .eq("signal_type", "consumer_sentiment")
    .eq("geo_scope", "national")
    .order("period_date", { ascending: false })
    .limit(3);

  if (!data || data.length < 2) return { value: null, trend: "stable" };

  const latest = Number(data[0].value);
  const previous = Number(data[1].value);
  const trend = latest > previous + 1 ? "rising" : latest < previous - 1 ? "falling" : "stable";

  return { value: latest, trend };
}

async function getSearchTrendForMetro(metro: string | null) {
  if (!metro) return { vs_seasonal_avg: 0 };

  // Get last 8 weeks of data
  const { data } = await supabase
    .from("macro_search_trends")
    .select("relative_interest, week_start")
    .eq("geo", metro)
    .in("term", ["wedding venue", "wedding venues"])
    .order("week_start", { ascending: false })
    .limit(16);

  if (!data || data.length < 8) return { vs_seasonal_avg: 0 };

  const recent = data.slice(0, 4); // last 4 weeks
  const baseline = data.slice(4); // 4-8 weeks ago (seasonal baseline)

  const recentAvg = recent.reduce((sum, r) => sum + r.relative_interest, 0) / recent.length;
  const baselineAvg = baseline.reduce((sum, r) => sum + r.relative_interest, 0) / baseline.length;

  const vsSeasonalAvg = baselineAvg > 0
    ? Math.round(((recentAvg - baselineAvg) / baselineAvg) * 100)
    : 0;

  return { vs_seasonal_avg: vsSeasonalAvg };
}

async function getMarriageRateTrend(state: string | null) {
  if (!state) return { trend: "stable" };

  // Simple: check if national marriage data (from CDC NCHS) shows trend
  // For now derive from demographic table
  const { data } = await supabase
    .from("macro_demographic")
    .select("year, marriage_rate")
    .order("year", { ascending: false })
    .limit(5);

  if (!data || data.length < 2) return { trend: "stable" };

  const recent = data.filter((d) => d.marriage_rate);
  if (recent.length < 2) return { trend: "stable" };

  const latest = Number(recent[0].marriage_rate);
  const older = Number(recent[recent.length - 1].marriage_rate);
  const trend = latest > older * 1.02 ? "growing" : latest < older * 0.98 ? "contracting" : "stable";

  return { trend };
}

async function getLatestBeigeBook(district: number | null) {
  if (!district) return null;

  const { data } = await supabase
    .from("macro_economic")
    .select("raw_data, period_date")
    .eq("signal_type", "beige_book_summary")
    .eq("geo_scope", `district_${district}`)
    .order("period_date", { ascending: false })
    .limit(1)
    .single();

  if (!data) return null;
  return (data.raw_data as any)?.summary ?? null;
}

async function calculateWeatherOutlook(stationId: string | null) {
  if (!stationId) return { cautionMonths: [] };

  const { data } = await supabase
    .from("weather_monthly")
    .select("month, weather_score")
    .eq("noaa_station_id", stationId)
    .order("month", { ascending: true });

  if (!data) return { cautionMonths: [] };

  // Average score per month across all years
  const monthScores: Record<number, number[]> = {};
  for (const row of data) {
    if (!monthScores[row.month]) monthScores[row.month] = [];
    if (row.weather_score !== null) monthScores[row.month].push(row.weather_score);
  }

  const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const cautionMonths = Object.entries(monthScores)
    .filter(([, scores]) => {
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      return avg >= 5; // threshold for caution
    })
    .map(([month]) => MONTH_NAMES[parseInt(month) - 1]);

  return { cautionMonths };
}

async function getCompetitorAlert(venueId: string) {
  // Check if new competitors appeared since last scan
  const lastMonth = format(subDays(new Date(), 30), "yyyy-MM-dd");

  const { data: newCompetitors } = await supabase
    .from("macro_competitor_landscape")
    .select("competitor_name, google_rating, review_count")
    .eq("venue_id", venueId)
    .gte("scanned_at", lastMonth)
    .order("review_count", { ascending: false })
    .limit(3);

  if (!newCompetitors || newCompetitors.length === 0) return null;

  const topNew = newCompetitors[0];
  if ((topNew.review_count ?? 0) > 50) {
    return `New competitor detected: ${topNew.competitor_name} (${topNew.google_rating}★, ${topNew.review_count} reviews)`;
  }

  return null;
}

export async function calculateMarketPulse(venueId: string) {
  // Check if cache is still valid
  const { data: existing } = await supabase
    .from("market_pulse")
    .select("valid_until")
    .eq("venue_id", venueId)
    .order("calculated_at", { ascending: false })
    .limit(1)
    .single();

  if (existing?.valid_until && new Date(existing.valid_until) > new Date()) {
    return; // Cache still valid
  }

  const { data: venue } = await supabase
    .from("venues")
    .select("noaa_station_id, google_trends_metro, fed_district, state")
    .eq("id", venueId)
    .single();

  const [
    consumerSentiment,
    searchTrend,
    marriageRate,
    beigeBookSummary,
    weatherOutlook,
    competitorAlert,
  ] = await Promise.all([
    getLatestConsumerSentiment(),
    getSearchTrendForMetro(venue?.google_trends_metro ?? null),
    getMarriageRateTrend(venue?.state ?? null),
    getLatestBeigeBook(venue?.fed_district ?? null),
    calculateWeatherOutlook(venue?.noaa_station_id ?? null),
    getCompetitorAlert(venueId),
  ]);

  // Composite demand score
  let demandScore = 50;
  if (consumerSentiment.trend === "rising") demandScore += 10;
  if (consumerSentiment.trend === "falling") demandScore -= 10;
  if (searchTrend.vs_seasonal_avg > 10) demandScore += 8;
  if (searchTrend.vs_seasonal_avg < -10) demandScore -= 8;
  if (marriageRate.trend === "growing") demandScore += 5;
  if (marriageRate.trend === "contracting") demandScore -= 5;
  if (competitorAlert) demandScore -= 3;

  demandScore = Math.max(0, Math.min(100, demandScore));

  const demandOutlook =
    demandScore >= 60 ? "positive"
    : demandScore >= 45 ? "neutral"
    : demandScore >= 30 ? "cautionary"
    : "negative";

  const pulse = {
    venue_id: venueId,
    calculated_at: new Date().toISOString(),
    valid_until: addDays(new Date(), 7).toISOString(),
    demand_outlook: demandOutlook,
    demand_score: demandScore,
    consumer_confidence_latest: consumerSentiment.value,
    consumer_confidence_trend: consumerSentiment.trend,
    search_volume_vs_seasonal: searchTrend.vs_seasonal_avg,
    marriage_rate_trend: marriageRate.trend,
    regional_economy_summary: beigeBookSummary,
    weather_caution_months: weatherOutlook.cautionMonths,
    competitor_change_alert: competitorAlert,
    full_summary: {
      consumerSentiment,
      searchTrend,
      marriageRate,
      beigeBookSummary,
      weatherOutlook,
      competitorAlert,
    },
  };

  const { error } = await supabase
    .from("market_pulse")
    .upsert(pulse, { onConflict: "venue_id" });

  if (error) console.error("Market pulse save error:", error.message);
  else console.log(`Market pulse updated for venue ${venueId}: ${demandOutlook} (${demandScore})`);
}

export async function refreshMarketPulseAllVenues() {
  const { data: venues } = await supabase
    .from("venues")
    .select("id")
    .eq("onboarding_complete", true);

  for (const venue of venues ?? []) {
    await calculateMarketPulse(venue.id);
  }
}
