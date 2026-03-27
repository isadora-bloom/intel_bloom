/**
 * Bloom Demo — Seed extra data tables
 *
 * Populates: weather_monthly, macro_economic, macro_search_trends,
 * macro_competitor_landscape, market_pulse, website_traffic
 * Also backfills assigned_coordinator names on clients
 *
 * Usage: npx tsx supabase/seed/seed-demo-extras.ts
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// ── Env ──────────────────────────────────────────────────────────────────
const envPath = path.resolve(__dirname, "../../apps/web/.env.local");
for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  if (!process.env[t.slice(0, eq)]) process.env[t.slice(0, eq)] = t.slice(eq + 1);
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// ── Demo IDs ─────────────────────────────────────────────────────────────
const VENUE = {
  stonehill:   "de000000-0000-0000-0000-000000000010",
  lakeview:    "de000000-0000-0000-0000-000000000020",
  marchetti:   "de000000-0000-0000-0000-000000000030",
  cooperfield: "de000000-0000-0000-0000-000000000040",
};
const ALL_VENUE_IDS = Object.values(VENUE);

const CONSULTANT_NAMES: Record<string, string> = {
  "de000000-0000-0000-0000-a00000000002": "Dana Okafor",
  "de000000-0000-0000-0000-a00000000003": "Marcus Trent",
  "de000000-0000-0000-0000-a00000000004": "Priya Desai",
  "de000000-0000-0000-0000-a00000000005": "Jordan Pace",
};

const NOAA_STATION = "USW00013740";

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function vary(base: number, pct = 0.15) {
  return Math.round(base * (1 - pct + Math.random() * pct * 2));
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. BACKFILL assigned_coordinator names
// ═══════════════════════════════════════════════════════════════════════════

async function backfillCoordinatorNames() {
  console.log("Backfilling assigned_coordinator names on clients...");
  let updated = 0;

  for (const [userId, name] of Object.entries(CONSULTANT_NAMES)) {
    const { count, error } = await db
      .from("clients")
      .update({ assigned_coordinator: name })
      .eq("assigned_to", userId)
      .in("venue_id", ALL_VENUE_IDS);

    if (error) {
      console.error(`  ERROR for ${name}: ${error.message}`);
    } else {
      updated += count ?? 0;
    }
  }

  // Also update inquiries
  for (const [userId, name] of Object.entries(CONSULTANT_NAMES)) {
    await db
      .from("inquiries")
      .update({ responded_by: name } as any)
      .eq("assigned_to", userId)
      .in("venue_id", ALL_VENUE_IDS)
      .then(() => {});
  }

  console.log(`  ✓ Updated ${updated} client records with coordinator names`);
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. WEATHER MONTHLY (36 months for the NOAA station)
// ═══════════════════════════════════════════════════════════════════════════

async function seedWeatherMonthly() {
  console.log("Seeding weather_monthly (36 months)...");

  // Clear existing demo station data
  await db.from("weather_monthly").delete().eq("station_id", NOAA_STATION);

  // Mid-Atlantic climate patterns (rough averages for central VA)
  const climate = [
    // [avgF, minF, maxF, precipInches, rainDays, weatherScore]
    [35, 22, 48, 3.2, 10, 35],  // Jan
    [38, 24, 52, 3.0, 9, 40],   // Feb
    [47, 32, 62, 3.8, 10, 55],  // Mar
    [57, 40, 73, 3.4, 10, 72],  // Apr
    [65, 50, 80, 4.2, 11, 80],  // May
    [74, 58, 88, 4.0, 10, 85],  // Jun
    [78, 63, 92, 4.5, 10, 78],  // Jul
    [76, 62, 90, 3.8, 9, 80],   // Aug
    [69, 54, 83, 3.6, 8, 85],   // Sep
    [57, 42, 72, 3.2, 7, 88],   // Oct
    [47, 33, 61, 3.0, 8, 60],   // Nov
    [38, 25, 50, 3.1, 9, 40],   // Dec
  ];

  const rows: Record<string, unknown>[] = [];
  for (let year = 2024; year <= 2026; year++) {
    const months = year === 2026 ? 3 : 12; // Only through March 2026
    for (let m = 0; m < months; m++) {
      const [avgF, minF, maxF, precip, rainDays, score] = climate[m];
      rows.push({
        station_id: NOAA_STATION,
        year,
        month: m + 1,
        temp_avg_f: vary(avgF, 0.08),
        temp_min_f: vary(minF, 0.10),
        temp_max_f: vary(maxF, 0.08),
        precipitation_inches: (precip * (0.7 + Math.random() * 0.6)).toFixed(2),
        days_precipitation: vary(rainDays, 0.2),
        weather_score: vary(score, 0.1),
      });
    }
  }

  const { error } = await db.from("weather_monthly").insert(rows);
  if (error) console.error("  ERROR:", error.message);
  else console.log(`  ✓ ${rows.length} weather records inserted`);
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. MACRO ECONOMIC (FRED-style data — 36 months)
// ═══════════════════════════════════════════════════════════════════════════

async function seedMacroEconomic() {
  console.log("Seeding macro_economic (FRED data)...");

  // Clear existing
  await db.from("macro_economic").delete().eq("geo_scope", "US-VA");

  const signals = [
    { type: "consumer_confidence", base: 102, trend: 0.3 },
    { type: "unemployment_rate", base: 3.8, trend: -0.02 },
    { type: "cpi_yoy", base: 3.2, trend: -0.05 },
    { type: "wedding_spend_index", base: 115, trend: 0.5 },
    { type: "disposable_income_yoy", base: 2.8, trend: 0.1 },
  ];

  const rows: Record<string, unknown>[] = [];
  for (let year = 2024; year <= 2026; year++) {
    const months = year === 2026 ? 3 : 12;
    for (let m = 0; m < months; m++) {
      const monthOffset = (year - 2024) * 12 + m;
      const dateStr = `${year}-${String(m + 1).padStart(2, "0")}-01`;

      for (const sig of signals) {
        const value = sig.base + sig.trend * monthOffset + (Math.random() - 0.5) * 2;
        rows.push({
          signal_type: sig.type,
          period_date: dateStr,
          value: parseFloat(value.toFixed(2)),
          geo_scope: "US-VA",
        });
      }
    }
  }

  const { error } = await db.from("macro_economic").insert(rows);
  if (error) console.error("  ERROR:", error.message);
  else console.log(`  ✓ ${rows.length} macro_economic records inserted`);
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. MACRO SEARCH TRENDS (Google Trends-style — weekly data)
// ═══════════════════════════════════════════════════════════════════════════

async function seedSearchTrends() {
  console.log("Seeding macro_search_trends (Google Trends)...");

  await db.from("macro_search_trends").delete().eq("geo", "US-VA-584");

  const terms = [
    { term: "wedding venues near me", base: 65, seasonal: [80,90,85,95,75,60,50,45,55,60,40,55] },
    { term: "barn wedding", base: 50, seasonal: [60,70,65,80,70,55,45,40,50,55,35,45] },
    { term: "outdoor wedding venue", base: 45, seasonal: [55,65,75,90,80,60,50,40,55,65,30,40] },
    { term: "wedding budget", base: 40, seasonal: [70,80,60,55,45,35,30,28,32,38,55,65] },
    { term: "engagement ring", base: 55, seasonal: [50,85,45,40,35,30,28,25,30,40,75,90] },
  ];

  const rows: Record<string, unknown>[] = [];
  // Generate weekly data for 24 months
  const start = new Date("2024-04-01");
  const end = new Date("2026-03-27");
  let d = new Date(start);

  while (d <= end) {
    // Find the Monday of this week
    const weekStart = new Date(d);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);

    const month = d.getMonth();
    for (const t of terms) {
      const seasonalFactor = t.seasonal[month] / 65; // normalize
      const value = Math.round(t.base * seasonalFactor * (0.85 + Math.random() * 0.3));
      rows.push({
        geo: "US-VA-584",
        week_start: weekStart.toISOString().split("T")[0],
        term: t.term,
        relative_interest: Math.min(100, Math.max(0, value)),
      });
    }

    d.setDate(d.getDate() + 7);
  }

  // Insert in batches
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const { error } = await db.from("macro_search_trends").insert(batch);
    if (error) console.error(`  ERROR batch ${Math.floor(i/200)+1}: ${error.message}`);
  }
  console.log(`  ✓ ${rows.length} search trend records inserted`);
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. MACRO COMPETITOR LANDSCAPE
// ═══════════════════════════════════════════════════════════════════════════

async function seedCompetitors() {
  console.log("Seeding macro_competitor_landscape...");

  for (const vid of ALL_VENUE_IDS) {
    await db.from("macro_competitor_landscape").delete().eq("venue_id", vid);
  }

  const competitors = [
    { name: "The Evergreen", rating: 4.7, reviews: 85, distance: 12 },
    { name: "River Bend Estate", rating: 4.5, reviews: 62, distance: 18 },
    { name: "Highland Farm", rating: 4.8, reviews: 48, distance: 22 },
    { name: "Oakwood Manor", rating: 4.3, reviews: 95, distance: 8 },
    { name: "Blue Ridge Hall", rating: 4.6, reviews: 72, distance: 25 },
    { name: "The Ashford", rating: 4.4, reviews: 55, distance: 15 },
    { name: "Meadow Creek", rating: 4.9, reviews: 38, distance: 30 },
    { name: "Willow Brook", rating: 4.2, reviews: 110, distance: 10 },
  ];

  const rows: Record<string, unknown>[] = [];
  for (const vid of ALL_VENUE_IDS) {
    for (const comp of competitors) {
      rows.push({
        venue_id: vid,
        scanned_at: new Date().toISOString(),
        competitor_name: comp.name,
        distance_miles: comp.distance + rand(-3, 5),
        google_rating: comp.rating,
        review_count: vary(comp.reviews, 0.1),
      });
    }
  }

  const { error } = await db.from("macro_competitor_landscape").insert(rows);
  if (error) console.error("  ERROR:", error.message);
  else console.log(`  ✓ ${rows.length} competitor records inserted`);
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. MARKET PULSE (monthly cache per venue)
// ═══════════════════════════════════════════════════════════════════════════

async function seedMarketPulse() {
  console.log("Seeding market_pulse...");

  for (const vid of ALL_VENUE_IDS) {
    await db.from("market_pulse").delete().eq("venue_id", vid);
  }

  const venueOutlooks: Record<string, { demand: string; score: number; summary: string }> = {
    [VENUE.stonehill]:   { demand: "strong", score: 82, summary: "Strong demand. Google searches for barn weddings up 12% YoY. Consumer confidence stable. Spring inquiry surge tracking above last year." },
    [VENUE.lakeview]:    { demand: "moderate", score: 58, summary: "Moderate demand with headwinds. Heavy reliance on paid listings is increasing costs. Off-season months showing particularly weak pipeline." },
    [VENUE.marchetti]:   { demand: "strong", score: 88, summary: "Excellent position. Referral pipeline is self-sustaining. Search trends for intimate/garden weddings trending up. Minimal competitive pressure." },
    [VENUE.cooperfield]: { demand: "building", score: 65, summary: "Growing awareness. Instagram driving discovery. Search interest in industrial/urban wedding venues up 22% regionally. Building momentum." },
  };

  const rows: Record<string, unknown>[] = [];
  for (const vid of ALL_VENUE_IDS) {
    const outlook = venueOutlooks[vid];
    rows.push({
      venue_id: vid,
      calculated_at: new Date().toISOString(),
      valid_until: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      demand_outlook: outlook.demand,
      demand_score: outlook.score,
      consumer_confidence_latest: 103.4,
      consumer_confidence_trend: "stable",
      search_volume_vs_seasonal: rand(95, 120),
      engagement_seasonality_signal: "spring_surge",
      marriage_rate_trend: "stable",
      regional_economy_summary: "Mid-Atlantic economy stable. Unemployment at 3.6%. Housing market moderating but wedding spend holding steady.",
      weather_caution_months: ["July", "August"],
      competitor_change_alert: null,
      full_summary: { text: outlook.summary },
    });
  }

  const { error } = await db.from("market_pulse").insert(rows);
  if (error) console.error("  ERROR:", error.message);
  else console.log(`  ✓ ${rows.length} market pulse records inserted`);
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. WEBSITE TRAFFIC (daily GA-style data, 6 months)
// ═══════════════════════════════════════════════════════════════════════════

async function seedWebsiteTraffic() {
  console.log("Seeding website_traffic (180 days)...");

  for (const vid of ALL_VENUE_IDS) {
    await db.from("website_traffic").delete().eq("venue_id", vid);
  }

  const venueTraffic: Record<string, { sessions: number; bounce: number }> = {
    [VENUE.stonehill]:   { sessions: 85, bounce: 42 },
    [VENUE.lakeview]:    { sessions: 110, bounce: 55 },
    [VENUE.marchetti]:   { sessions: 45, bounce: 35 },
    [VENUE.cooperfield]: { sessions: 60, bounce: 48 },
  };

  const sources = [
    { source: "google", medium: "organic", pct: 35 },
    { source: "google", medium: "cpc", pct: 20 },
    { source: "instagram", medium: "social", pct: 18 },
    { source: "theknot.com", medium: "referral", pct: 12 },
    { source: "(direct)", medium: "(none)", pct: 15 },
  ];

  const rows: Record<string, unknown>[] = [];
  const today = new Date("2026-03-27");

  for (const vid of ALL_VENUE_IDS) {
    const base = venueTraffic[vid];
    for (let dayOffset = 0; dayOffset < 180; dayOffset++) {
      const d = new Date(today);
      d.setDate(d.getDate() - dayOffset);
      const dateStr = d.toISOString().split("T")[0];
      const dow = d.getDay();
      const weekdayFactor = dow === 0 || dow === 6 ? 1.3 : 1.0;

      for (const src of sources) {
        const dailySessions = Math.max(1, Math.round(
          base.sessions * (src.pct / 100) * weekdayFactor * (0.7 + Math.random() * 0.6)
        ));
        const users = Math.round(dailySessions * 0.85);
        const newUsers = Math.round(users * 0.65);

        rows.push({
          venue_id: vid,
          date: dateStr,
          sessions: dailySessions,
          users,
          new_users: newUsers,
          pageviews: dailySessions * rand(2, 5),
          bounce_rate: (base.bounce + (Math.random() - 0.5) * 10).toFixed(1),
          avg_session_duration_seconds: rand(60, 240),
          source: src.source,
          medium: src.medium,
        });
      }
    }
  }

  // Insert in batches
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const { error } = await db.from("website_traffic").insert(batch);
    if (error && !error.message.includes("duplicate")) {
      console.error(`  ERROR batch ${Math.floor(i/200)+1}: ${error.message}`);
    }
  }
  console.log(`  ✓ ${rows.length} website traffic records inserted`);
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log("═".repeat(50));
  console.log("  Bloom Demo — Seeding extra data tables");
  console.log("═".repeat(50));

  await backfillCoordinatorNames();
  await seedWeatherMonthly();
  await seedMacroEconomic();
  await seedSearchTrends();
  await seedCompetitors();
  await seedMarketPulse();
  await seedWebsiteTraffic();

  console.log("\n" + "═".repeat(50));
  console.log("  DONE — All extra data seeded");
  console.log("═".repeat(50));
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
