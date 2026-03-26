/**
 * POST /api/macro/fred
 * Cron endpoint — fetches FRED economic series and upserts into macro_economic table.
 * Authorization: Bearer <CRON_SECRET>
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";

const SERIES: { id: string; signalType: string; geoScope: string }[] = [
  { id: "UNRATE",   signalType: "unemployment_rate",      geoScope: "national" },
  { id: "PSAVERT",  signalType: "personal_savings_rate",  geoScope: "national" },
  { id: "DSPIC96",  signalType: "disposable_income_real", geoScope: "national" },
  { id: "HOUST",    signalType: "housing_starts",         geoScope: "national" },
  // Consumer sentiment — used by getConsumerSentiment query
  { id: "UMCSENT",  signalType: "consumer_sentiment",     geoScope: "national" },
];

function verifyCronAuth(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  // Dev mode: skip check if no secret configured
  if (!cronSecret) return true;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${cronSecret}`;
}

export async function POST(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const fredApiKey = process.env.FRED_API_KEY;
  if (!fredApiKey) {
    return NextResponse.json({ error: "FRED_API_KEY not configured" }, { status: 500 });
  }

  const supabase = createServiceClient();

  // Observation start: 3 years ago
  const threeYearsAgo = new Date();
  threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
  const observationStart = threeYearsAgo.toISOString().split("T")[0];

  let totalIngested = 0;
  const seriesResults: { name: string; count: number }[] = [];
  const errors: string[] = [];

  for (const series of SERIES) {
    try {
      const params = new URLSearchParams({
        series_id: series.id,
        observation_start: observationStart,
        file_type: "json",
        api_key: fredApiKey,
      });

      const res = await fetch(`${FRED_BASE}?${params.toString()}`);
      if (!res.ok) {
        const text = await res.text();
        errors.push(`FRED API error for ${series.id} (${res.status}): ${text}`);
        continue;
      }

      const json = await res.json();
      const observations: { date: string; value: string }[] = json.observations ?? [];

      // Filter out missing values (".")
      const validRows = observations
        .filter((obs) => obs.value !== ".")
        .map((obs) => ({
          series_id: series.id,
          date: obs.date,
          value: parseFloat(obs.value),
          region: series.geoScope,
        }));

      if (validRows.length === 0) {
        seriesResults.push({ name: series.id, count: 0 });
        continue;
      }

      const { error: upsertError } = await supabase
        .from("macro_economic")
        .upsert(validRows, {
          onConflict: "series_id,date",
        });

      if (upsertError) {
        errors.push(`Upsert error for ${series.id}: ${upsertError.message}`);
        seriesResults.push({ name: series.id, count: 0 });
      } else {
        totalIngested += validRows.length;
        seriesResults.push({ name: series.id, count: validRows.length });
      }
    } catch (err: any) {
      errors.push(`Unexpected error for ${series.id}: ${err.message}`);
      seriesResults.push({ name: series.id, count: 0 });
    }
  }

  return NextResponse.json({ ingested: totalIngested, series: seriesResults, errors });
}
