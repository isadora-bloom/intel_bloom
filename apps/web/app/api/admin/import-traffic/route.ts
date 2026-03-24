/**
 * POST /api/admin/import-traffic
 * Accepts a Google Analytics CSV export (date-based or source/medium-based).
 * Parses and upserts into the website_traffic table.
 *
 * Supports two GA4 export formats:
 *   Format A (date rows): Date, Sessions, Users, New users, Pageviews, Bounce rate, ...
 *   Format B (source rows): Date, Session source / medium, Sessions, Users, ...
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { parse as csvParse } from "csv-parse/sync";

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function normalizeDate(raw: string): string | null {
  // Handle YYYYMMDD (GA format) and YYYY-MM-DD
  const s = raw.trim().replace(/\//g, "-");
  if (/^\d{8}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Try MM/DD/YYYY
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  return null;
}

function parseSourceMedium(raw: string): { source: string; medium: string } {
  // GA4 format: "google / organic" or "direct / (none)"
  const parts = raw.split("/").map((s) => s.trim().toLowerCase());
  if (parts.length >= 2) {
    return { source: parts[0], medium: parts.slice(1).join("/").replace(/^\(|\)$/g, "").trim() };
  }
  return { source: raw.trim().toLowerCase(), medium: "unknown" };
}

function parseNum(v: string | undefined): number | null {
  if (!v) return null;
  const n = parseFloat(v.replace(/,/g, "").replace(/%$/, ""));
  return isNaN(n) ? null : n;
}

export async function POST(req: NextRequest) {
  // Auth — user session only
  const cookieStore = await cookies();
  const userSupabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );
  const { data: { user } } = await userSupabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: venueUser } = await adminSupabase
    .from("venue_users")
    .select("venue_id")
    .eq("user_id", user.id)
    .single();
  if (!venueUser) return NextResponse.json({ error: "No venue" }, { status: 404 });
  const venueId = venueUser.venue_id as string;

  // Parse multipart form
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

  const text = await file.text();

  // Strip GA4 junk rows at top (lines beginning with "#" or blank lines before headers)
  const lines = text.split("\n");
  const headerIdx = lines.findIndex(
    (l) => /date|sessions|users/i.test(l) && !l.startsWith("#")
  );
  if (headerIdx === -1) {
    return NextResponse.json({ error: "Could not find header row in CSV" }, { status: 400 });
  }
  const cleanCsv = lines.slice(headerIdx).join("\n");

  let rows: Record<string, string>[];
  try {
    rows = csvParse(cleanCsv, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
  } catch {
    return NextResponse.json({ error: "Could not parse CSV" }, { status: 400 });
  }

  if (rows.length === 0) return NextResponse.json({ error: "CSV is empty" }, { status: 400 });

  // Detect format by inspecting column names
  const cols = Object.keys(rows[0]).map((c) => c.toLowerCase());
  const hasSourceMedium = cols.some((c) => c.includes("source") && c.includes("medium"));
  const hasSource = cols.some((c) => c === "source" || c.includes("session source"));
  const hasMedium = cols.some((c) => c === "medium");

  // Map column names (GA4 exports have verbose names)
  function findCol(row: Record<string, string>, ...candidates: string[]): string | undefined {
    const lower = Object.keys(row).reduce((acc, k) => { acc[k.toLowerCase()] = k; return acc; }, {} as Record<string, string>);
    for (const c of candidates) {
      const found = lower[c.toLowerCase()];
      if (found && row[found] !== undefined) return found;
    }
    // Fuzzy: startsWith
    for (const c of candidates) {
      const found = Object.keys(row).find((k) => k.toLowerCase().startsWith(c.toLowerCase()));
      if (found) return found;
    }
    return undefined;
  }

  const records: object[] = [];
  let skipped = 0;

  for (const row of rows) {
    const dateCol = findCol(row, "date", "day");
    if (!dateCol) { skipped++; continue; }
    const date = normalizeDate(row[dateCol] ?? "");
    if (!date) { skipped++; continue; }

    const sessionsCol   = findCol(row, "sessions", "sessions");
    const usersCol      = findCol(row, "users", "total users");
    const newUsersCol   = findCol(row, "new users", "new_users");
    const pageviewsCol  = findCol(row, "pageviews", "views", "screen views");
    const bounceCol     = findCol(row, "bounce rate", "bounce_rate");
    const durationCol   = findCol(row, "avg. session duration", "average session duration", "session duration");

    const sessions  = parseNum(sessionsCol ? row[sessionsCol] : undefined);
    const users     = parseNum(usersCol ? row[usersCol] : undefined);
    const newUsers  = parseNum(newUsersCol ? row[newUsersCol] : undefined);
    const pageviews = parseNum(pageviewsCol ? row[pageviewsCol] : undefined);
    const bounce    = parseNum(bounceCol ? row[bounceCol] : undefined);

    // Duration: GA4 returns "0:02:34" or seconds as number
    let durationSec: number | null = null;
    if (durationCol) {
      const raw = row[durationCol] ?? "";
      const timeMatch = raw.match(/^(\d+):(\d{2}):(\d{2})$/);
      if (timeMatch) {
        durationSec = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3]);
      } else {
        durationSec = parseNum(raw);
      }
    }

    let source = "all";
    let medium = "all";

    if (hasSourceMedium) {
      const smCol = findCol(row, "session source / medium", "source / medium", "source/medium");
      if (smCol) {
        const parsed = parseSourceMedium(row[smCol] ?? "");
        source = parsed.source;
        medium = parsed.medium;
      }
    } else if (hasSource && hasMedium) {
      const srcCol = findCol(row, "session source", "source");
      const medCol = findCol(row, "session medium", "medium");
      if (srcCol) source = (row[srcCol] ?? "direct").toLowerCase();
      if (medCol) medium = (row[medCol] ?? "none").toLowerCase().replace(/^\(|\)$/g, "");
    }

    records.push({
      venue_id: venueId,
      date,
      sessions: sessions !== null ? Math.round(sessions) : null,
      users: users !== null ? Math.round(users) : null,
      new_users: newUsers !== null ? Math.round(newUsers) : null,
      pageviews: pageviews !== null ? Math.round(pageviews) : null,
      bounce_rate: bounce,
      avg_session_duration_seconds: durationSec !== null ? Math.round(durationSec) : null,
      source,
      medium,
    });
  }

  if (records.length === 0) {
    return NextResponse.json({ error: "No valid rows found in CSV", skipped }, { status: 400 });
  }

  // Upsert in batches of 500
  let upserted = 0;
  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500);
    const { error } = await adminSupabase
      .from("website_traffic")
      .upsert(batch, { onConflict: "venue_id,date,source,medium" });
    if (error) {
      return NextResponse.json({ error: error.message, upserted, skipped }, { status: 500 });
    }
    upserted += batch.length;
  }

  return NextResponse.json({ ok: true, upserted, skipped });
}
