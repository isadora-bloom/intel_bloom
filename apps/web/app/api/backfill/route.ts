/**
 * Manual backfill endpoint — seed historical weather (NOAA) and economic (FRED) data.
 * Hit this once after adding API keys. Secured with CRON_SECRET.
 *
 * POST /api/backfill
 * Authorization: Bearer <CRON_SECRET>
 * Body: { "job": "noaa" | "fred" | "all" }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 300; // 5 min — enough for 12 years of monthly weather

const CDO_BASE = "https://www.ncei.noaa.gov/cdo-web/api/v2";
const FRED_BASE = "https://api.stlouisfed.org/fred";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function getLastDay(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function weatherScore(precip: number | null, tempMax: number | null, tempMin: number | null) {
  let s = 0;
  if (precip !== null) {
    if (precip > 0.5) s += 3;
    if (precip > 1.5) s += 2;
    if (precip > 3.0) s += 2;
  }
  if (tempMax !== null && tempMax > 95) s += 2;
  if (tempMax !== null && tempMax < 32) s += 2;
  if (tempMin !== null && tempMin < 20) s += 1;
  return Math.min(s, 10);
}

// ── NOAA backfill ─────────────────────────────────────────────────────────────

async function backfillNOAA(supabase: any, stationId: string, log: string[]) {
  const token = process.env.NOAA_CDO_TOKEN;
  if (!token) { log.push("NOAA_CDO_TOKEN not set"); return; }

  const startYear = 2014;
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  let inserted = 0;
  let skipped = 0;

  for (let year = startYear; year <= currentYear; year++) {
    const endMonth = year === currentYear ? currentMonth - 1 : 12;

    for (let month = 1; month <= endMonth; month++) {
      const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
      const endDate = `${year}-${String(month).padStart(2, "0")}-${getLastDay(year, month)}`;

      // stationId already includes "GHCND:" prefix from venues table
      const url =
        `${CDO_BASE}/data?datasetid=GSOM&stationid=${stationId}` +
        `&startdate=${startDate}&enddate=${endDate}` +
        `&datatypeid=PRCP,TMAX,TMIN,TAVG&units=standard&limit=1000`;

      const res = await fetch(url, { headers: { token } });

      if (res.status === 429) {
        log.push(`Rate limited at ${year}-${month}. Stopped.`);
        log.push(`Inserted: ${inserted}, skipped: ${skipped}`);
        return;
      }

      if (!res.ok) {
        skipped++;
        await sleep(200);
        continue;
      }

      const data = await res.json();
      const results: any[] = data.results ?? [];

      if (results.length === 0) { skipped++; await sleep(200); continue; }

      let precip: number | null = null;
      let tempMax: number | null = null;
      let tempMin: number | null = null;
      let tempAvg: number | null = null;

      for (const r of results) {
        const val = parseFloat(r.value);
        if (isNaN(val)) continue;
        // NOAA GSOM units: PRCP in mm, TMAX/TMIN/TAVG in 0.1°C
        switch (r.datatype) {
          case "PRCP": precip = val / 25.4; break;       // mm → inches
          case "TMAX": tempMax = val * 1.8 + 32; break;  // °C → °F
          case "TMIN": tempMin = val * 1.8 + 32; break;
          case "TAVG": tempAvg = val * 1.8 + 32; break;
        }
      }

      const { error } = await supabase.from("weather_monthly").upsert(
        {
          noaa_station_id: stationId,
          year,
          month,
          precipitation_inches: precip !== null ? Math.round(precip * 100) / 100 : null,
          temp_avg_f: tempAvg !== null ? Math.round(tempAvg * 10) / 10 : null,
          temp_max_f: tempMax !== null ? Math.round(tempMax * 10) / 10 : null,
          temp_min_f: tempMin !== null ? Math.round(tempMin * 10) / 10 : null,
          weather_score: weatherScore(precip, tempMax, tempMin),
        },
        { onConflict: "noaa_station_id,year,month" }
      );

      if (error) log.push(`DB error ${year}-${month}: ${error.message}`);
      else inserted++;

      await sleep(210); // stay under 5 req/sec
    }
  }

  log.push(`NOAA complete. Inserted/updated: ${inserted}, skipped: ${skipped}`);
}

// ── FRED backfill ─────────────────────────────────────────────────────────────

async function backfillFRED(supabase: any, log: string[]) {
  const key = process.env.FRED_API_KEY;
  if (!key) { log.push("FRED_API_KEY not set"); return; }

  const series: Record<string, string> = {
    consumer_sentiment: "UMCSENT",
    conference_board: "CSCICP03USM665S",
    cpi_services: "CPIFABSL",
    policy_uncertainty: "USEPUINDXD",
  };

  for (const [signalType, seriesId] of Object.entries(series)) {
    const url =
      `${FRED_BASE}/series/observations` +
      `?series_id=${seriesId}&api_key=${key}&file_type=json` +
      `&observation_start=2019-01-01&sort_order=asc`;

    const res = await fetch(url);
    if (!res.ok) { log.push(`FRED error for ${seriesId}: ${res.status}`); continue; }

    const { observations } = await res.json();
    const rows = (observations ?? [])
      .filter((o: any) => o.value !== ".")
      .map((o: any) => ({
        signal_type: signalType,
        period_date: o.date,
        value: parseFloat(o.value),
        geo_scope: "national",
      }));

    if (rows.length > 0) {
      const { error } = await supabase
        .from("macro_economic")
        .upsert(rows, { onConflict: "signal_type,period_date,geo_scope" });
      if (error) log.push(`FRED DB error ${signalType}: ${error.message}`);
      else log.push(`FRED ${signalType}: ${rows.length} observations upserted`);
    }

    await sleep(500);
  }
}

// ── HANDLER ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { job } = await req.json();
  if (!job || !["noaa", "fred", "all"].includes(job)) {
    return NextResponse.json({ error: "job must be 'noaa', 'fred', or 'all'" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Get the venue's station ID
  const { data: venues } = await supabase
    .from("venues")
    .select("id, noaa_station_id")
    .not("noaa_station_id", "is", null);

  const log: string[] = [];

  if (job === "noaa" || job === "all") {
    for (const venue of venues ?? []) {
      log.push(`\nBackfilling NOAA for station ${venue.noaa_station_id}...`);
      await backfillNOAA(supabase, venue.noaa_station_id, log);
    }
  }

  if (job === "fred" || job === "all") {
    log.push("\nBackfilling FRED...");
    await backfillFRED(supabase, log);
  }

  return NextResponse.json({ ok: true, log });
}
