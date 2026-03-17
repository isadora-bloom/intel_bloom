/**
 * FRED Economic Signal Ingestion
 * Fetches consumer sentiment, CPI, policy uncertainty + Richmond Fed Beige Books
 */

const SUPABASE_URL = "https://awawmtvynhwrahrekiso.supabase.co";
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3YXdtdHZ5bmh3cmFocmVraXNvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzY4OTIzNywiZXhwIjoyMDg5MjY1MjM3fQ.-LfGQ-K4gM0uU79M-Hl2lNGp2bT9NSzpGU0N5RSnL20";
const FRED_KEY = "faf4681cd1e053c96dc472ceb1c4e03f";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const FRED_BASE = "https://api.stlouisfed.org/fred";

const headers = {
  "Content-Type": "application/json",
  "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
  "apikey": SERVICE_ROLE_KEY,
};

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function upsertRows(rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/macro_economic`, {
    method: "POST",
    headers: { ...headers, "Prefer": "resolution=merge-duplicates" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error(`  DB error: ${err}`);
  }
}

async function ingestSeries(seriesId, signalType) {
  const url = `${FRED_BASE}/series/observations?series_id=${seriesId}&api_key=${FRED_KEY}&file_type=json&observation_start=2019-01-01&sort_order=desc`;
  const res = await fetch(url);
  if (!res.ok) { console.warn(`  FRED error ${res.status} for ${seriesId}`); return; }

  const { observations } = await res.json();
  const rows = (observations ?? [])
    .filter(o => o.value !== ".")
    .map(o => ({
      signal_type: signalType,
      period_date: o.date,
      value: parseFloat(o.value),
      geo_scope: "national",
    }));

  if (rows.length > 0) {
    await upsertRows(rows);
    console.log(`  ✓ ${signalType}: ${rows.length} observations`);
  }
  await sleep(500);
}

function extractText(html) {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function summariseWithClaude(text) {
  if (!ANTHROPIC_KEY) return "No ANTHROPIC_API_KEY set — summary skipped.";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      messages: [{
        role: "user",
        content: `Summarise this Federal Reserve Beige Book excerpt in 2-3 sentences focusing on: consumer spending, services sector, and hospitality/events industry sentiment. Be specific about direction (growing/declining/stable). Text:\n\n${text.substring(0, 8000)}`,
      }],
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.content?.[0]?.text ?? null;
}

async function ingestBeigeBook(district, year, month) {
  const districtPad = String(district).padStart(2, "0");
  const monthPad = String(month).padStart(2, "0");
  const url = `https://www.federalreserve.gov/monetarypolicy/beigebook/${year}${monthPad}${districtPad}.htm`;

  const res = await fetch(url);
  if (!res.ok) return false;

  const html = await res.text();
  const text = extractText(html);
  if (text.length < 500) return false;

  const summary = await summariseWithClaude(text);
  if (!summary) return false;

  const row = {
    signal_type: "beige_book_summary",
    period_date: `${year}-${monthPad}-01`,
    value: null,
    geo_scope: `district_${district}`,
    raw_data: { summary, url },
  };

  await upsertRows([row]);
  return true;
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log("=== FRED Economic Signal Ingestion ===\n");

const SERIES = {
  consumer_sentiment: "UMCSENT",
  conference_board: "CSCICP03USM665S",
  cpi_services: "CPIFABSL",
  policy_uncertainty: "USEPUINDXD",
};

console.log("Fetching FRED series...");
for (const [signalType, seriesId] of Object.entries(SERIES)) {
  process.stdout.write(`  ${signalType} (${seriesId})... `);
  await ingestSeries(seriesId, signalType);
}

// Beige Books — District 5 = Richmond Fed (covers Virginia)
// Published ~8x/year: Jan, Mar, Apr, Jun, Jul, Sep, Oct, Dec
if (ANTHROPIC_KEY) {
  console.log("\nFetching Richmond Fed Beige Books (district 5)...");
  const months = [1, 3, 4, 6, 7, 9, 10, 12];
  const currentYear = new Date().getFullYear();
  let found = 0;

  for (let year = 2019; year <= currentYear; year++) {
    for (const month of months) {
      const ok = await ingestBeigeBook(5, year, month);
      if (ok) {
        console.log(`  ✓ District 5 ${year}-${String(month).padStart(2,"0")}`);
        found++;
        await sleep(1200);
      }
    }
  }
  console.log(`  ${found} Beige Book entries saved`);
} else {
  console.log("\nSkipping Beige Books (no ANTHROPIC_API_KEY)");
}

console.log("\n✓ FRED ingestion complete.");
