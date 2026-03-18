/**
 * Google Trends ingestion via SerpAPI
 *
 * Fetches weekly search interest for wedding-related terms
 * per venue geo (stored in venues.google_trends_metro as SerpAPI geo code,
 * e.g. "US-DC", "US-VA", "US-NY").
 *
 * SerpAPI geo codes:
 *   US-DC  → Washington DC / Northern Virginia market
 *   US-VA  → Virginia (broader)
 *   US-MD  → Maryland
 *   US-NY  → New York
 *   US-CA  → California
 *   US-GA  → Georgia (Atlanta market)
 *   US-TX  → Texas
 *   US-IL  → Illinois (Chicago)
 *   US-NC  → North Carolina
 *
 * Rate limits: SerpAPI free tier = 100 searches/mo. Paid ($50/mo) = 5,000/mo.
 * Each venue × term × call = ~1 search. We fetch 5 terms per venue = 5 searches/venue/run.
 * Weekly runs: 5 × 52 = 260 searches/venue/year — well within $50/mo at multiple venues.
 */

import { createClient } from "@supabase/supabase-js";

const SERPAPI_BASE = "https://serpapi.com/search.json";

const WEDDING_TERMS = [
  "wedding venue",
  "wedding venues",
  "barn wedding venue",
  "outdoor wedding venue",
  "wedding photographer",   // proxy for overall market engagement
];

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseWeekStart(dateStr: string): string | null {
  // SerpAPI returns dates like "Jan 1 – 7, 2023" or "2023-01-01"
  try {
    // Try ISO format first
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;

    // Try timestamp
    const ts = parseInt(dateStr);
    if (!isNaN(ts)) {
      return new Date(ts * 1000).toISOString().split("T")[0];
    }

    // Try natural language "Jan 1, 2023" or "Jan 1 – 7, 2023"
    const cleaned = dateStr.replace(/\s*–.*/, "").trim();
    const d = new Date(cleaned);
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];

    return null;
  } catch {
    return null;
  }
}

export async function ingestTrendsForGeo(
  supabase: any,
  geo: string,
  apiKey: string,
  log: string[]
): Promise<void> {
  let inserted = 0;

  for (const term of WEDDING_TERMS) {
    const params = new URLSearchParams({
      engine: "google_trends",
      q: term,
      geo,
      date: "today 5-y",    // 5 years of weekly data
      data_type: "TIMESERIES",
      api_key: apiKey,
    });

    const res = await fetch(`${SERPAPI_BASE}?${params}`);

    if (!res.ok) {
      if (res.status === 429) {
        log.push(`SerpAPI rate limit hit on term "${term}" (geo: ${geo}). Stopping.`);
        return;
      }
      log.push(`SerpAPI error ${res.status} for "${term}" (${geo})`);
      await sleep(1000);
      continue;
    }

    const data = await res.json();

    if (data.error) {
      log.push(`SerpAPI error for "${term}" (${geo}): ${data.error}`);
      await sleep(1000);
      continue;
    }

    const timeline: any[] = data.interest_over_time?.timeline_data ?? [];

    if (timeline.length === 0) {
      log.push(`No data for "${term}" (${geo})`);
      await sleep(500);
      continue;
    }

    const rows = timeline
      .map((point: any) => {
        // Each point has a date string and values array
        const weekStart = parseWeekStart(point.timestamp ?? point.date ?? "");
        const value = point.values?.[0]?.extracted_value ?? point.values?.[0]?.value;
        const interest = typeof value === "number" ? value : parseInt(String(value));

        if (!weekStart || isNaN(interest)) return null;

        return {
          geo,
          week_start: weekStart,
          term,
          relative_interest: interest,
        };
      })
      .filter(Boolean);

    if (rows.length > 0) {
      const { error } = await supabase
        .from("macro_search_trends")
        .upsert(rows, { onConflict: "geo,week_start,term" });

      if (error) {
        log.push(`DB error for "${term}" (${geo}): ${error.message}`);
      } else {
        inserted += rows.length;
      }
    }

    await sleep(800); // stay well within SerpAPI rate limits
  }

  log.push(`Trends (${geo}): ${inserted} data points upserted across ${WEDDING_TERMS.length} terms`);
}

export async function ingestTrendsAllVenues(log: string[] = []): Promise<void> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) { log.push("SERPAPI_KEY not set"); return; }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Get all unique geos from venues (de-duped — multiple venues in same market share data)
  const { data: venues } = await supabase
    .from("venues")
    .select("google_trends_metro")
    .not("google_trends_metro", "is", null);

  const uniqueGeos = [...new Set((venues ?? []).map((v: any) => v.google_trends_metro as string))];

  log.push(`Fetching trends for ${uniqueGeos.length} geo(s): ${uniqueGeos.join(", ")}`);

  for (const geo of uniqueGeos) {
    await ingestTrendsForGeo(supabase, geo, apiKey, log);
    await sleep(1000);
  }
}
