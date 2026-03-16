/**
 * PUBLIC DATA SPRINT — One-time pre-launch ingestion script
 *
 * Ingests all public data sources before any venue signs up.
 * This script is resumable — it skips data that's already been ingested.
 *
 * Run: npm run ingest:public-data
 * Expected duration: Multiple days due to NOAA rate limits (1000 req/day)
 *
 * Progress is logged to console. Safe to interrupt and resume.
 */

import { ingestStationHistory } from "../noaa/ingest-historical";
import stations from "../noaa/station-list.json";

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("=== BLOOM PUBLIC DATA SPRINT ===");
  console.log(`Started: ${new Date().toISOString()}\n`);

  // 1. NOAA Historical Weather
  // Rate limit: 1000 req/day. 52 stations × 12 months × ~12 years = ~7,488 requests total
  // Estimate: 8+ days if running from scratch
  console.log("--- NOAA Historical Weather ---");
  console.log(`Stations to process: ${stations.length}`);
  console.log("Note: 1000 req/day limit — will auto-stop and resume required.\n");

  const priorityStations = ["KCJR", "KIAD", "KDCA", "KRIC", "KORF", "KBNA", "KATL"];

  // Priority stations first (for Rixey Manor + partners)
  for (const stationId of priorityStations) {
    const station = stations.find((s) => s.id === stationId);
    if (!station) continue;
    console.log(`Processing priority station: ${stationId} (${station.name})`);
    await ingestStationHistory(stationId);
  }

  // Remaining stations
  for (const station of stations) {
    if (priorityStations.includes(station.id)) continue;
    console.log(`Processing: ${station.id} (${station.name})`);
    await ingestStationHistory(station.id);
  }

  // 2. Census demographics
  console.log("\n--- Census Demographics ---");
  const { default: censusIngest } = await import("../census/ingest-demographics");

  // 3. FRED Economic signals
  console.log("\n--- FRED Economic Signals ---");
  const { default: fredIngest } = await import("../fred/ingest-economic");

  console.log("\n=== PUBLIC DATA SPRINT COMPLETE ===");
  console.log(`Finished: ${new Date().toISOString()}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
