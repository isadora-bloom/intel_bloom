/**
 * NOAA CDO Historical Weather Ingestion
 *
 * Uses two stations for Rixey Manor:
 *   US1VACP0002  — Rixeyville 2.5 N (2.5 miles away, precip only, 100% coverage)
 *   USW00093736  — Charlottesville Airport (31 miles, full temp+precip, since 1955)
 *
 * Stores records under the venue's configured noaa_station_id ("RIXEY")
 * so the app has a single station key to query.
 */

const SUPABASE_URL = "https://awawmtvynhwrahrekiso.supabase.co";
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3YXdtdHZ5bmh3cmFocmVraXNvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzY4OTIzNywiZXhwIjoyMDg5MjY1MjM3fQ.-LfGQ-K4gM0uU79M-Hl2lNGp2bT9NSzpGU0N5RSnL20";
const NOAA_TOKEN = "tvHccuTlmmAhVFyOMEUiGysAvdikjzhq";
const CDO_BASE = "https://www.ncei.noaa.gov/cdo-web/api/v2";

// Rixeyville observer — precipitation only, closest to the venue
const PRECIP_STATION = "US1VACP0002";
// Charlottesville Airport — full temp + precip, long record
const TEMP_STATION   = "USW00093736";
// The key we store in the DB (matches venues.noaa_station_id)
const VENUE_STATION  = "RIXEY";

const dbHeaders = {
  "Content-Type": "application/json",
  "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
  "apikey": SERVICE_ROLE_KEY,
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getLastDay(year, month) { return new Date(year, month, 0).getDate(); }

function weatherScore(precip, tempMax, tempMin) {
  let score = 0;
  if (precip !== null) {
    if (precip > 0.5) score += 3;
    if (precip > 1.5) score += 2;
    if (precip > 3.0) score += 2;
  }
  if (tempMax !== null) {
    if (tempMax > 95) score += 2;
    if (tempMax < 32) score += 2;
  }
  if (tempMin !== null && tempMin < 20) score += 1;
  return Math.min(score, 10);
}

async function fetchMonth(stationId, year, month) {
  const mm = String(month).padStart(2, "0");
  const lastDay = getLastDay(year, month);
  const url = `${CDO_BASE}/data?datasetid=GSOM&stationid=GHCND:${stationId}&startdate=${year}-${mm}-01&enddate=${year}-${mm}-${lastDay}&datatypeid=PRCP,TMAX,TMIN,TAVG&units=standard&limit=100`;

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { token: NOAA_TOKEN } });
    if (res.status === 429) { console.log("  Rate limited, waiting 30s..."); await sleep(30000); continue; }
    if (!res.ok) return null;
    const data = await res.json();
    return data.results ?? [];
  }
  return null;
}

function parseResults(results) {
  let precip = null, tempMax = null, tempMin = null, tempAvg = null;
  for (const r of results ?? []) {
    const val = parseFloat(r.value);
    if (isNaN(val)) continue;
    switch (r.datatype) {
      case "PRCP": precip  = val; break;   // already in inches (units=standard)
      case "TMAX": tempMax = val; break;   // already in °F (units=standard)
      case "TMIN": tempMin = val; break;
      case "TAVG": tempAvg = val; break;
    }
  }
  return { precip, tempMax, tempMin, tempAvg };
}

async function upsert(row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/weather_monthly`, {
    method: "POST",
    headers: { ...dbHeaders, "Prefer": "resolution=merge-duplicates" },
    body: JSON.stringify(row),
  });
  if (!res.ok) console.error(`  DB error: ${await res.text()}`);
}

const START_YEAR = parseInt(process.argv[2] || "2014");
const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;

console.log(`=== NOAA Historical Ingestion for Rixey Manor ===`);
console.log(`Precip: ${PRECIP_STATION} (Rixeyville 2.5N)`);
console.log(`Temp:   ${TEMP_STATION} (Charlottesville Airport)`);
console.log(`Stored as: ${VENUE_STATION} | ${START_YEAR} → ${currentYear}\n`);

let saved = 0;
let requests = 0;
const MAX_DAILY = 980; // two requests per month

for (let year = START_YEAR; year <= currentYear; year++) {
  const endMonth = year === currentYear ? currentMonth - 1 : 12;

  for (let month = 1; month <= endMonth; month++) {
    if (requests + 2 > MAX_DAILY) {
      console.log("\nApproaching daily limit. Re-run tomorrow.");
      process.exit(0);
    }

    const mm = String(month).padStart(2, "0");
    process.stdout.write(`  ${year}-${mm}... `);

    // Fetch both stations in parallel
    const [precipResults, tempResults] = await Promise.all([
      fetchMonth(PRECIP_STATION, year, month),
      fetchMonth(TEMP_STATION, year, month),
    ]);
    requests += 2;
    await sleep(210); // stay under 5 req/sec

    const local = parseResults(precipResults);
    const chova = parseResults(tempResults);

    // Prefer local precip, fall back to Charlottesville
    const precip  = local.precip  ?? chova.precip;
    const tempMax = chova.tempMax ?? local.tempMax;
    const tempMin = chova.tempMin ?? local.tempMin;
    const tempAvg = chova.tempAvg ?? local.tempAvg;

    if (precip === null && tempMax === null) {
      process.stdout.write(`no data\n`);
      continue;
    }

    await upsert({
      noaa_station_id: VENUE_STATION,
      year,
      month,
      precipitation_inches: precip !== null ? Math.round(precip * 100) / 100 : null,
      temp_avg_f: tempAvg !== null ? Math.round(tempAvg * 10) / 10 : null,
      temp_max_f: tempMax !== null ? Math.round(tempMax * 10) / 10 : null,
      temp_min_f: tempMin !== null ? Math.round(tempMin * 10) / 10 : null,
      weather_score: weatherScore(precip, tempMax, tempMin),
    });

    saved++;
    const parts = [];
    if (precip  !== null) parts.push(`${precip.toFixed(1)}"`);
    if (tempAvg !== null) parts.push(`avg ${tempAvg.toFixed(0)}°F`);
    process.stdout.write(`✓ ${parts.join(", ")}\n`);
  }
}

console.log(`\n✓ Done — ${saved} months saved as station "${VENUE_STATION}".`);
