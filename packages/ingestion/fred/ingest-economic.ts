/**
 * FRED API Economic Signal Ingestion
 * Free API key at: https://fred.stlouisfed.org/docs/api/api_key.html
 *
 * Run: ts-node packages/ingestion/fred/ingest-economic.ts
 */

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

const FRED_BASE = "https://api.stlouisfed.org/fred";
const FRED_KEY = process.env.FRED_API_KEY!;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const FRED_SERIES: Record<string, string> = {
  consumer_sentiment: "UMCSENT",
  conference_board: "CSCICP03USM665S",
  cpi_services: "CPIFABSL",
  policy_uncertainty: "USEPUINDXD",
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ingestFredSeries(seriesId: string, signalType: string) {
  const url =
    `${FRED_BASE}/series/observations` +
    `?series_id=${seriesId}&api_key=${FRED_KEY}&file_type=json` +
    `&observation_start=2019-01-01&sort_order=desc`;

  const response = await fetch(url);
  if (!response.ok) {
    console.warn(`FRED error for ${seriesId}: ${response.status}`);
    return;
  }

  const { observations } = await response.json();

  const rows = [];
  for (const obs of observations ?? []) {
    if (obs.value === ".") continue; // FRED uses '.' for missing values

    rows.push({
      signal_type: signalType,
      period_date: obs.date,
      value: parseFloat(obs.value),
      geo_scope: "national",
    });
  }

  if (rows.length > 0) {
    const { error } = await supabase
      .from("macro_economic")
      .upsert(rows, { onConflict: "signal_type,period_date,geo_scope" });

    if (error) console.error(`DB error for ${signalType}:`, error.message);
    else console.log(`  ✓ ${signalType}: ${rows.length} observations`);
  }

  await sleep(500);
}

function getBeigeBookUrl(district: number, year: number, month: number): string {
  // Beige Books are published ~8x/year before FOMC meetings
  // URL pattern: https://www.federalreserve.gov/monetarypolicy/beigebook/{year}{month}0{district}.htm
  const districtPad = String(district).padStart(2, "0");
  return `https://www.federalreserve.gov/monetarypolicy/beigebook/${year}${String(month).padStart(2, "0")}${districtPad}.htm`;
}

function extractTextFromHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function ingestBeigeBook(district: number, year: number, month: number) {
  const url = getBeigeBookUrl(district, year, month);

  const response = await fetch(url);
  if (!response.ok) return; // Not every month has a Beige Book

  const html = await response.text();
  const text = extractTextFromHtml(html);

  if (text.length < 500) return; // Probably not a real page

  const summary = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: `Summarise this Federal Reserve Beige Book excerpt in 2-3 sentences focusing on: consumer spending, services sector, and hospitality/events industry sentiment. Be specific about direction (growing/declining/stable). Text:\n\n${text.substring(0, 8000)}`,
      },
    ],
  });

  const summaryText =
    summary.content[0].type === "text" ? summary.content[0].text : "";

  await supabase.from("macro_economic").upsert(
    {
      signal_type: "beige_book_summary",
      period_date: `${year}-${String(month).padStart(2, "0")}-01`,
      value: null,
      geo_scope: `district_${district}`,
      raw_data: { summary: summaryText, url },
    },
    { onConflict: "signal_type,period_date,geo_scope" }
  );

  console.log(`  ✓ Beige Book district ${district} ${year}-${month}`);
  await sleep(1000);
}

async function main() {
  console.log("Ingesting FRED economic signals...\n");

  for (const [signalType, seriesId] of Object.entries(FRED_SERIES)) {
    console.log(`Fetching ${signalType} (${seriesId})...`);
    await ingestFredSeries(seriesId, signalType);
  }

  console.log("\nIngesting Beige Books...");
  const currentYear = new Date().getFullYear();
  // Beige Books published roughly Jan, Mar, Apr, Jun, Jul, Sep, Oct, Dec
  const beigeBookMonths = [1, 3, 4, 6, 7, 9, 10, 12];

  for (let year = 2019; year <= currentYear; year++) {
    for (const month of beigeBookMonths) {
      for (let district = 1; district <= 12; district++) {
        await ingestBeigeBook(district, year, month);
      }
    }
  }

  console.log("\nFRED ingestion complete.");
}

main().catch(console.error);
