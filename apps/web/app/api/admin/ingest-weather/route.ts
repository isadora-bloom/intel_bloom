/**
 * POST /api/admin/ingest-weather
 * Triggers NOAA historical weather ingestion for the current venue's station.
 * Protected by CRON_SECRET or user session (venue-scoped).
 *
 * Body: { stationId?: string }  — if omitted, uses venue's noaa_station_id
 * Runs ingestion for the last 3 years.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const CDO_BASE = "https://www.ncei.noaa.gov/cdo-web/api/v2";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getLastDayOfMonth(year: number, month: number): string {
  const date = new Date(year, month, 0);
  return `${year}-${String(month).padStart(2, "0")}-${date.getDate()}`;
}

function calculateWeatherScore(
  precipInches: number | null,
  tempMaxF: number | null,
  tempMinF: number | null
): number {
  let score = 0;
  if (precipInches !== null) {
    if (precipInches > 0.5) score += 3;
    if (precipInches > 1.5) score += 2;
    if (precipInches > 3.0) score += 2;
  }
  if (tempMaxF !== null) {
    if (tempMaxF > 95) score += 2;
    if (tempMaxF < 32) score += 2;
  }
  if (tempMinF !== null) {
    if (tempMinF < 20) score += 1;
  }
  return Math.min(score, 10);
}

async function fetchAndUpsertMonth(
  supabase: ReturnType<typeof createClient>,
  stationId: string,
  year: number,
  month: number,
  noaaToken: string
): Promise<boolean> {
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = getLastDayOfMonth(year, month);

  const url =
    `${CDO_BASE}/data?datasetid=GSOM&stationid=GHCND:${stationId}` +
    `&startdate=${startDate}&enddate=${endDate}` +
    `&datatypeid=PRCP,TMAX,TMIN,TAVG&units=standard&limit=1000`;

  const response = await fetch(url, { headers: { token: noaaToken } });

  if (!response.ok) {
    if (response.status === 429) {
      await sleep(30000);
      return false;
    }
    return false;
  }

  const data = await response.json();
  const results = data.results ?? [];
  if (results.length === 0) return true;

  let precip: number | null = null;
  let tempMax: number | null = null;
  let tempMin: number | null = null;
  let tempAvg: number | null = null;

  for (const r of results) {
    const val = parseFloat(r.value);
    if (isNaN(val)) continue;
    switch (r.datatype) {
      case "PRCP": precip = val / 10; break;
      case "TMAX": tempMax = (val / 10) * 1.8 + 32; break;
      case "TMIN": tempMin = (val / 10) * 1.8 + 32; break;
      case "TAVG": tempAvg = (val / 10) * 1.8 + 32; break;
    }
  }

  await (supabase.from("weather_monthly") as any).upsert(
    {
      noaa_station_id: stationId,
      year,
      month,
      precipitation_inches: precip,
      temp_avg_f: tempAvg,
      temp_max_f: tempMax,
      temp_min_f: tempMin,
      weather_score: calculateWeatherScore(precip, tempMax, tempMin),
    },
    { onConflict: "noaa_station_id,year,month" }
  );

  return true;
}

export async function POST(req: NextRequest) {
  const noaaToken = process.env.NOAA_CDO_TOKEN;
  if (!noaaToken) {
    return NextResponse.json({ error: "NOAA_CDO_TOKEN not configured" }, { status: 503 });
  }

  // Auth: accept CRON_SECRET header OR valid user session
  const cronSecret = req.headers.get("x-cron-secret");
  let venueId: string | null = null;
  let stationId: string | null = null;

  const adminSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  if (cronSecret && cronSecret === process.env.CRON_SECRET) {
    // Cron/admin call — stationId must be provided in body
    const body = await req.json().catch(() => ({}));
    stationId = body.stationId ?? null;
    if (!stationId) {
      return NextResponse.json({ error: "stationId required" }, { status: 400 });
    }
  } else {
    // User session — get their venue's station
    const cookieStore = await cookies();
    const userSupabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll() } }
    );
    const { data: { user } } = await userSupabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: venueUser } = await adminSupabase
      .from("venue_users")
      .select("venue_id")
      .eq("user_id", user.id)
      .single();

    if (!venueUser) {
      return NextResponse.json({ error: "No venue found" }, { status: 404 });
    }

    venueId = venueUser.venue_id;

    const body = await req.json().catch(() => ({}));
    stationId = body.stationId ?? null;

    if (!stationId) {
      // Use venue's assigned station
      const { data: venue } = await adminSupabase
        .from("venues")
        .select("noaa_station_id")
        .eq("id", venueId)
        .single();

      stationId = venue?.noaa_station_id ?? null;
    }

    if (!stationId) {
      return NextResponse.json(
        { error: "No NOAA station configured. Set one in Settings → Intelligence Calibration." },
        { status: 400 }
      );
    }
  }

  // Run ingestion for last 3 years (non-blocking response — stream progress)
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  const startYear = currentYear - 3;

  let ingested = 0;
  let errors = 0;

  for (let year = startYear; year <= currentYear; year++) {
    const endMonth = year === currentYear ? currentMonth - 1 : 12;
    for (let month = 1; month <= endMonth; month++) {
      const ok = await fetchAndUpsertMonth(adminSupabase, stationId, year, month, noaaToken);
      if (ok) ingested++; else errors++;
      await sleep(250); // 4 req/sec — within NOAA's 5/sec limit
    }
  }

  return NextResponse.json({
    ok: true,
    stationId,
    monthsIngested: ingested,
    errors,
  });
}
