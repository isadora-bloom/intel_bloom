/**
 * NOAA CDO API Historical Ingestion
 * Ingests monthly weather data for all stations in station-list.json
 * Rate limits: 5 req/sec, 1000 req/day
 *
 * Run: ts-node packages/ingestion/noaa/ingest-historical.ts [stationId]
 */

import { createClient } from "@supabase/supabase-js";
import stations from "./station-list.json";

const NOAA_TOKEN = process.env.NOAA_CDO_TOKEN!;
const CDO_BASE = "https://www.ncei.noaa.gov/cdo-web/api/v2";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getLastDayOfMonth(year: number, month: number): string {
  const date = new Date(year, month, 0);
  return `${year}-${String(month).padStart(2, "0")}-${date.getDate()}`;
}

export function calculateWeatherScore(
  precipInches: number | null,
  tempMaxF: number | null,
  tempMinF: number | null
): number {
  // 0 = perfect conditions, 10 = severe adverse weather
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

async function fetchMonthlyData(stationId: string, year: number, month: number) {
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = getLastDayOfMonth(year, month);

  const url =
    `${CDO_BASE}/data?datasetid=GSOM&stationid=GHCND:${stationId}` +
    `&startdate=${startDate}&enddate=${endDate}` +
    `&datatypeid=PRCP,TMAX,TMIN,TAVG&units=standard&limit=1000`;

  const response = await fetch(url, {
    headers: { token: NOAA_TOKEN },
  });

  if (!response.ok) {
    if (response.status === 429) {
      // Rate limited — back off 30 seconds
      console.log(`Rate limited, waiting 30s...`);
      await sleep(30000);
      return null;
    }
    console.warn(`NOAA error ${response.status} for ${stationId} ${year}-${month}`);
    return null;
  }

  const data = await response.json();
  return data.results ?? [];
}

async function upsertWeatherMonthly(
  stationId: string,
  year: number,
  month: number,
  results: any[]
) {
  if (!results || results.length === 0) return;

  // Parse results into named values
  let precip: number | null = null;
  let tempMax: number | null = null;
  let tempMin: number | null = null;
  let tempAvg: number | null = null;

  for (const r of results) {
    const val = parseFloat(r.value);
    if (isNaN(val)) continue;
    switch (r.datatype) {
      case "PRCP": precip = val / 10; break; // NOAA stores in 0.1mm, convert to inches
      case "TMAX": tempMax = (val / 10) * 1.8 + 32; break; // 0.1°C to °F
      case "TMIN": tempMin = (val / 10) * 1.8 + 32; break;
      case "TAVG": tempAvg = (val / 10) * 1.8 + 32; break;
    }
  }

  const weatherScore = calculateWeatherScore(precip, tempMax, tempMin);

  const { error } = await supabase.from("weather_monthly").upsert(
    {
      noaa_station_id: stationId,
      year,
      month,
      precipitation_inches: precip,
      temp_avg_f: tempAvg,
      temp_max_f: tempMax,
      temp_min_f: tempMin,
      weather_score: weatherScore,
    },
    { onConflict: "noaa_station_id,year,month" }
  );

  if (error) {
    console.error(`DB error for ${stationId} ${year}-${month}:`, error.message);
  }
}

async function ingestStationHistory(
  stationId: string,
  startYear = 2014
) {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  console.log(`\nIngesting ${stationId} from ${startYear} to ${currentYear}...`);

  let requestsToday = 0;
  const MAX_DAILY = 990; // leave buffer

  for (let year = startYear; year <= currentYear; year++) {
    const endMonth = year === currentYear ? currentMonth - 1 : 12;

    for (let month = 1; month <= endMonth; month++) {
      if (requestsToday >= MAX_DAILY) {
        console.log("Daily limit reached. Resume tomorrow.");
        process.exit(0);
      }

      const results = await fetchMonthlyData(stationId, year, month);
      if (results) {
        await upsertWeatherMonthly(stationId, year, month, results);
        requestsToday++;
      }

      await sleep(200); // 5 req/sec max
    }
  }

  console.log(`  ✓ ${stationId} complete`);
}

async function main() {
  const targetStation = process.argv[2];

  if (targetStation) {
    // Ingest single station
    await ingestStationHistory(targetStation);
  } else {
    // Ingest all stations (takes multiple days due to rate limits)
    for (const station of stations) {
      await ingestStationHistory(station.id);
    }
  }

  console.log("\nIngestion complete.");
}

main().catch(console.error);
