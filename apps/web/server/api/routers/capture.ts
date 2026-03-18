import { z } from "zod";
import { router, venueProcedure } from "@/lib/trpc/server";
import { TRPCError } from "@trpc/server";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── TYPES ─────────────────────────────────────────────────────────────────────

export type CaptureFileType =
  | "knot_inquiry_screenshot"
  | "instagram_inquiry_screenshot"
  | "email_inquiry_screenshot"
  | "honeybook_csv"
  | "client_list_csv"
  | "financial_csv"
  | "review_screenshot"
  | "vendor_list_csv"
  | "inquiry_csv"
  | "analytics_chart"
  | "ads_dashboard"
  | "google_analytics"
  | "social_insights"
  | "platform_billing"
  | "unknown";

export interface ExtractedField {
  field: string;
  value: string | null;
  confidence: "high" | "medium" | "low";
}

export interface CaptureRow {
  id: string; // temp local id
  type: "client" | "inquiry" | "vendor" | "review" | "metric" | "spend" | "lead" | "unknown";
  fields: ExtractedField[];
  mapped: Record<string, string | null>; // field -> value, ready to write
  anomalies: CaptureAnomaly[];
}

export interface CaptureAnomaly {
  id: string;
  severity: "error" | "warning" | "question";
  message: string;
  field?: string;
  suggestion?: string;
  requiresAnswer: boolean;
  answer?: "yes" | "no" | "skip" | string;
}

export interface ClassifyResult {
  fileType: CaptureFileType;
  fileTypeLabel: string;
  confidence: "high" | "medium" | "low";
  rows: CaptureRow[];
  summary: string; // "Looks like 3 Knot inquiry screenshots. Found: Claire, Sophie, Maya."
  totalAnomalies: number;
  blockers: number; // anomalies that must be resolved before import
}

// ── HELPERS ──────────────────────────────────────────────────────────────────

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

function normalizeDate(raw: string | null): string | null {
  if (!raw) return null;
  // Try various date formats
  const cleaned = raw.replace(/(\d+)(st|nd|rd|th)/, "$1");
  const d = new Date(cleaned);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split("T")[0];
  }
  return null;
}

function normalizeCents(raw: string | null): number | null {
  if (!raw) return null;
  const num = parseFloat(raw.replace(/[$,\s]/g, ""));
  if (isNaN(num)) return null;
  return Math.round(num * 100);
}

async function checkDuplicates(
  supabase: any,
  venueId: string,
  namePrimary: string | null,
  eventDate: string | null,
  email: string | null
): Promise<{ exists: boolean; id?: string; name?: string }> {
  if (!namePrimary && !email) return { exists: false };

  let query = supabase
    .from("clients")
    .select("id, name_primary, email_primary, event_date")
    .eq("venue_id", venueId);

  if (email) {
    query = query.eq("email_primary", email.toLowerCase().trim());
  } else if (namePrimary) {
    query = query.ilike("name_primary", `%${namePrimary.split(" ")[0]}%`);
  }

  const { data } = await query.limit(3);
  if (!data || data.length === 0) return { exists: false };

  // Check if event date also matches
  const match = data.find((c: any) => {
    if (email && c.email_primary?.toLowerCase() === email.toLowerCase()) return true;
    if (eventDate && c.event_date === eventDate) return true;
    return false;
  });

  if (match) return { exists: true, id: match.id, name: match.name_primary };
  return { exists: false };
}

// ── CLASSIFY IMAGE (Claude Vision) ───────────────────────────────────────────

async function classifyImage(base64: string, mimeType: string): Promise<ClassifyResult> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mimeType as any, data: base64 },
          },
          {
            type: "text",
            text: `You are extracting data from a wedding venue business screenshot. You can read tabular data, visual charts (bar charts, line graphs), and billing/contract documents.

Identify the screenshot type:
- Inquiry screenshots (The Knot, WeddingWire, Instagram DMs, email) → inquiry rows
- Review screenshots (Google, The Knot, WeddingWire) → review rows
- Platform analytics/insights dashboards (The Knot/WeddingWire insights, impressions, saves, visitors, leads, link clicks, calls pages) → metric rows
- Ad performance dashboards (Google Ads, Meta Ads) → metric rows
- Billing/contract/invoice screenshots (showing what the venue PAYS for a listing or ad product) → spend rows
  NOTE: "WeddingPro" is The Knot/WeddingWire's business platform. A WeddingPro billing screenshot is spend for the_knot or wedding_wire depending on which product is named in the contract. If the product name mentions "The Knot", use spend_platform = "the_knot". If it mentions "WeddingWire", use "wedding_wire".
- Financial/booking spreadsheets → client rows

For CHART screenshots: Read axes, legend, labels, and data points carefully. Estimate values from bar heights or line positions. Read every labeled data point. Each KPI = separate metric row. Monthly time-series = one metric row with metric_breakdown array.

For BILLING/CONTRACT screenshots: Extract what the venue is paying, to whom, for what product, for what date range.

Respond with ONLY valid JSON:
{
  "fileType": "knot_inquiry_screenshot" | "instagram_inquiry_screenshot" | "email_inquiry_screenshot" | "review_screenshot" | "analytics_chart" | "ads_dashboard" | "google_analytics" | "social_insights" | "platform_billing" | "unknown",
  "fileTypeLabel": "human-readable label e.g. 'The Knot Billing Contract' or 'WeddingPro Impressions Chart'",
  "confidence": "high" | "medium" | "low",
  "summary": "One sentence — e.g. 'WeddingPro billing showing $15,132.60/year for Featured listing, Oct 2025–Oct 2026' or 'WeddingPro saves chart: 587 saves in 12 months, Apr 2025–Mar 2026'",
  "rows": [
    {
      "type": "inquiry" | "client" | "review" | "metric" | "spend" | "unknown",
      "fields": [
        // For inquiry/client rows:
        { "field": "name_primary", "value": "...", "confidence": "high" },
        { "field": "email_primary", "value": "...", "confidence": "high" },
        { "field": "phone_primary", "value": "...", "confidence": "medium" },
        { "field": "event_date", "value": "YYYY-MM-DD or raw text", "confidence": "high" },
        { "field": "guest_count_initial", "value": "...", "confidence": "medium" },
        { "field": "raw_message", "value": "full message text", "confidence": "high" },
        { "field": "first_touch_platform", "value": "the_knot|wedding_wire|instagram|google_ads|google_organic|referral|direct|other", "confidence": "high" },

        // For review rows:
        { "field": "review_star_rating", "value": "4.5", "confidence": "high" },
        { "field": "review_text", "value": "...", "confidence": "high" },
        { "field": "review_platform", "value": "google|the_knot|wedding_wire|other", "confidence": "high" },
        { "field": "name_primary", "value": "reviewer name if visible", "confidence": "medium" },

        // For metric rows (charts, analytics dashboards):
        { "field": "metric_name", "value": "impressions|saves|visitors|leads|link_clicks|calls|clicks|cpc|ctr|roas|reviews|inquiries|bookings", "confidence": "high" },
        { "field": "metric_value", "value": "total numeric value visible e.g. 37300 or 587 or 4364", "confidence": "high" },
        { "field": "metric_period", "value": "e.g. last 12 months, March 2025, Apr 2025–Mar 2026", "confidence": "medium" },
        { "field": "metric_platform", "value": "the_knot|wedding_wire|google_ads|meta|instagram|overall", "confidence": "high" },
        { "field": "metric_comparison", "value": "change vs prior period if visible, e.g. -2% vs last 30 days", "confidence": "medium" },
        { "field": "metric_breakdown", "value": "JSON array of monthly points e.g. [{\"label\":\"Apr\",\"value\":3000},{\"label\":\"May\",\"value\":3000}]", "confidence": "medium" },

        // For spend rows (billing/contract screenshots):
        { "field": "spend_platform", "value": "the_knot|wedding_wire|google_ads|meta|instagram|other", "confidence": "high" },
        { "field": "spend_amount", "value": "total contract value in dollars e.g. 15132.60", "confidence": "high" },
        { "field": "spend_period", "value": "annual|monthly|quarterly", "confidence": "high" },
        { "field": "spend_contract_start", "value": "YYYY-MM-DD", "confidence": "high" },
        { "field": "spend_contract_end", "value": "YYYY-MM-DD", "confidence": "high" },
        { "field": "spend_product_name", "value": "e.g. The Knot Featured All Venue DC/MD/VA Region", "confidence": "high" }
      ]
    }
  ]
}

IMPORTANT:
- For charts showing monthly data: create ONE metric row per KPI, with metric_breakdown containing all data points as a JSON array
- If a dashboard shows multiple KPIs (e.g. impressions page shows total + monthly breakdown), create one row for the total and include the monthly breakdown in metric_breakdown
- For billing: one spend row per contract/product line
- Read chart values as precisely as possible from the visual — use axis gridlines to estimate

Only include fields you can actually see.`,
          },
        ],
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in response");

  const parsed = JSON.parse(jsonMatch[0]);

  // Normalise rows
  const rows: CaptureRow[] = (parsed.rows ?? []).map((r: any) => {
    const mapped: Record<string, string | null> = {};
    for (const f of r.fields ?? []) {
      mapped[f.field] = f.value ?? null;
    }

    // Normalise dates and numbers
    if (mapped.event_date) mapped.event_date = normalizeDate(mapped.event_date);

    return {
      id: makeId(),
      type: r.type ?? "unknown",
      fields: r.fields ?? [],
      mapped,
      anomalies: [],
    };
  });

  return {
    fileType: parsed.fileType ?? "unknown",
    fileTypeLabel: parsed.fileTypeLabel ?? "Unknown file type",
    confidence: parsed.confidence ?? "low",
    rows,
    summary: parsed.summary ?? "Could not classify this file.",
    totalAnomalies: 0,
    blockers: 0,
  };
}

// ── CLASSIFY CSV ──────────────────────────────────────────────────────────────

// ── KNOT ACTIVITY LOG PARSER ──────────────────────────────────────────────────
// Handles the WeddingPro activity log export format:
//   "Mar 16, 2026"
//   C
//   Chelsey R. visited your Storefront on The Knot.
//   E
//   Esmeralda C. sent an inquiry to your Storefront on The Knot.

function isKnotActivityLog(content: string): boolean {
  // Detect by looking for the alternating letter/sentence pattern + date headers
  const lines = content.split("\n").slice(0, 30).map((l) => l.trim()).filter(Boolean);
  const hasDateHeader = lines.some((l) => /^"?\w+ \d+, \d{4}"?$/.test(l));
  const hasSentence = lines.some((l) => /your Storefront on (The Knot|WeddingWire)/i.test(l));
  return hasDateHeader && hasSentence;
}

function parseKnotActivityLog(content: string): ClassifyResult {
  const lines = content.split("\n").map((l) => l.trim().replace(/^"|"$/g, "")).filter(Boolean);

  const rows: CaptureRow[] = [];
  // Daily aggregate counters for metric rows
  const dailyStats: Record<string, { visits: number; saves: number; inquiries: number; linkClicks: number }> = {};

  let currentDate: string | null = null;

  // Month name → number
  const MONTHS: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  };

  function parseActivityDate(raw: string): string | null {
    // "Mar 16, 2026" → "2026-03-16"
    const m = raw.match(/^(\w+)\s+(\d+),\s+(\d{4})$/);
    if (!m) return null;
    const month = MONTHS[m[1]];
    if (month === undefined) return null;
    return `${m[3]}-${String(month + 1).padStart(2, "0")}-${String(parseInt(m[2])).padStart(2, "0")}`;
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Date header
    const dateIso = parseActivityDate(line);
    if (dateIso) {
      currentDate = dateIso;
      if (!dailyStats[currentDate]) {
        dailyStats[currentDate] = { visits: 0, saves: 0, inquiries: 0, linkClicks: 0 };
      }
      i++;
      continue;
    }

    // Aggregate lines: "3 other couples visited..."
    const aggMatch = line.match(/^(\d+)\s+other\s+couple[s]?\s+(visited|saved)/i);
    if (aggMatch && currentDate) {
      const count = parseInt(aggMatch[1]);
      const action = aggMatch[2].toLowerCase();
      if (!dailyStats[currentDate]) dailyStats[currentDate] = { visits: 0, saves: 0, inquiries: 0, linkClicks: 0 };
      if (action === "visited") dailyStats[currentDate].visits += count;
      if (action === "saved") dailyStats[currentDate].saves += count;
      i++;
      continue;
    }

    // Anonymous couple actions: "A couple visited..." / "A couple saved..."
    const anonMatch = line.match(/^A couple (visited|saved|sent an inquiry)/i);
    if (anonMatch && currentDate) {
      const action = anonMatch[1].toLowerCase();
      if (!dailyStats[currentDate]) dailyStats[currentDate] = { visits: 0, saves: 0, inquiries: 0, linkClicks: 0 };
      if (action === "visited") dailyStats[currentDate].visits += 1;
      else if (action === "saved") dailyStats[currentDate].saves += 1;
      else dailyStats[currentDate].inquiries += 1;
      i++;
      continue;
    }

    // Named activity lines: "Chelsey R. visited your Storefront on The Knot."
    const namedMatch = line.match(/^([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]*\.?)?)\.\s+(visited|saved|sent an inquiry|visited your website)/i);

    // The letter-initial lines before named events — skip single-letter lines
    if (/^[A-Z]$/.test(line)) { i++; continue; }

    if (namedMatch && currentDate) {
      const personName = namedMatch[1].trim();
      const action = namedMatch[2].toLowerCase();

      if (!dailyStats[currentDate]) dailyStats[currentDate] = { visits: 0, saves: 0, inquiries: 0, linkClicks: 0 };

      if (action.includes("inquiry")) {
        dailyStats[currentDate].inquiries += 1;
        rows.push({
          id: makeId(),
          type: "inquiry",
          fields: [
            { field: "name_primary", value: personName, confidence: "high" },
            { field: "first_touch_platform", value: "the_knot", confidence: "high" },
            { field: "received_at", value: currentDate, confidence: "high" },
          ],
          mapped: {
            name_primary: personName,
            first_touch_platform: "the_knot",
            received_at: currentDate,
            raw_message: line,
          },
          anomalies: [],
        });
      } else if (action === "saved") {
        dailyStats[currentDate].saves += 1;
        // Named save = pre-inquiry funnel touch, not an inquiry
        rows.push({
          id: makeId(),
          type: "lead",
          fields: [
            { field: "name", value: personName, confidence: "high" },
            { field: "touch_type", value: "save", confidence: "high" },
            { field: "source_date", value: currentDate, confidence: "high" },
          ],
          mapped: {
            lead_name: personName,
            lead_platform: "the_knot",
            lead_touch_type: "save",
            lead_source_date: currentDate,
            lead_raw_activity: line,
          },
          anomalies: [],
        });
      } else if (action === "visited") {
        dailyStats[currentDate].visits += 1;
        // Named storefront visit = pre-inquiry funnel touch
        rows.push({
          id: makeId(),
          type: "lead",
          fields: [
            { field: "name", value: personName, confidence: "high" },
            { field: "touch_type", value: "storefront_visit", confidence: "high" },
            { field: "source_date", value: currentDate, confidence: "high" },
          ],
          mapped: {
            lead_name: personName,
            lead_platform: "the_knot",
            lead_touch_type: "storefront_visit",
            lead_source_date: currentDate,
            lead_raw_activity: line,
          },
          anomalies: [],
        });
      } else if (action.includes("website")) {
        dailyStats[currentDate].linkClicks += 1;
        // Named website visit = link click lead
        rows.push({
          id: makeId(),
          type: "lead",
          fields: [
            { field: "name", value: personName, confidence: "high" },
            { field: "touch_type", value: "website_visit", confidence: "high" },
            { field: "source_date", value: currentDate, confidence: "high" },
          ],
          mapped: {
            lead_name: personName,
            lead_platform: "the_knot",
            lead_touch_type: "website_visit",
            lead_source_date: currentDate,
            lead_raw_activity: line,
          },
          anomalies: [],
        });
      }
      i++;
      continue;
    }

    i++;
  }

  // Build metric rows from daily aggregates — one per metric type
  const allDates = Object.keys(dailyStats).sort();
  const totalVisits = Object.values(dailyStats).reduce((s, d) => s + d.visits, 0);
  const totalSaves = Object.values(dailyStats).reduce((s, d) => s + d.saves, 0);
  const totalInquiries = Object.values(dailyStats).reduce((s, d) => s + d.inquiries, 0);
  const periodStart = allDates[0] ?? null;
  const periodEnd = allDates[allDates.length - 1] ?? null;
  const periodLabel = periodStart && periodEnd ? `${periodStart} to ${periodEnd}` : null;

  const breakdown = allDates.map((date) => ({
    label: date,
    visits: dailyStats[date].visits,
    saves: dailyStats[date].saves,
    inquiries: dailyStats[date].inquiries,
  }));

  if (totalVisits > 0) {
    rows.push({
      id: makeId(), type: "metric",
      fields: [{ field: "metric_name", value: "visitors", confidence: "high" }],
      mapped: {
        metric_name: "visitors", metric_platform: "the_knot",
        metric_value: String(totalVisits), metric_period: periodLabel,
        metric_breakdown: JSON.stringify(allDates.map((d) => ({ label: d, value: dailyStats[d].visits }))),
      },
      anomalies: [],
    });
  }
  if (totalSaves > 0) {
    rows.push({
      id: makeId(), type: "metric",
      fields: [{ field: "metric_name", value: "saves", confidence: "high" }],
      mapped: {
        metric_name: "saves", metric_platform: "the_knot",
        metric_value: String(totalSaves), metric_period: periodLabel,
        metric_breakdown: JSON.stringify(allDates.map((d) => ({ label: d, value: dailyStats[d].saves }))),
      },
      anomalies: [],
    });
  }
  if (totalInquiries > 0) {
    rows.push({
      id: makeId(), type: "metric",
      fields: [{ field: "metric_name", value: "inquiries", confidence: "high" }],
      mapped: {
        metric_name: "inquiries", metric_platform: "the_knot",
        metric_value: String(totalInquiries), metric_period: periodLabel,
        metric_breakdown: JSON.stringify(allDates.map((d) => ({ label: d, value: dailyStats[d].inquiries }))),
      },
      anomalies: [],
    });
  }

  const inquiryRows = rows.filter((r) => r.type === "inquiry");
  const saveLeads = rows.filter((r) => r.type === "lead" && r.mapped.lead_touch_type === "save");
  const visitLeads = rows.filter((r) => r.type === "lead" && r.mapped.lead_touch_type === "storefront_visit");

  return {
    fileType: "knot_activity_log" as any,
    fileTypeLabel: "The Knot Activity Log",
    confidence: "high",
    rows,
    summary: `The Knot activity log from ${periodStart ?? "?"} to ${periodEnd ?? "?"}. ${inquiryRows.length} named inquiries, ${saveLeads.length} named saves, ${visitLeads.length} named storefront visits across ${allDates.length} days.`,
    totalAnomalies: 0,
    blockers: 0,
  };
}

async function classifyCSV(
  content: string,
  fileName: string
): Promise<ClassifyResult> {
  // Detect and handle Knot activity log format before sending to Claude
  if (isKnotActivityLog(content)) {
    return parseKnotActivityLog(content);
  }

  // Take first 3000 chars to avoid token overflow
  const preview = content.slice(0, 3000);

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    messages: [
      {
        role: "user",
        content: `You are extracting data from a CSV export for a wedding venue.

File name: ${fileName}
CSV content (first 3000 chars):
${preview}

Classify this CSV and map all rows to our data model.

Respond with ONLY valid JSON:
{
  "fileType": "honeybook_csv" | "client_list_csv" | "inquiry_csv" | "financial_csv" | "vendor_list_csv" | "unknown",
  "fileTypeLabel": "human-readable label",
  "confidence": "high" | "medium" | "low",
  "summary": "e.g. HoneyBook export with 23 bookings from 2022-2024",
  "columnMapping": { "CSV column name": "our field name or null if irrelevant" },
  "rows": [
    {
      "type": "client" | "inquiry" | "vendor" | "unknown",
      "mapped": {
        "name_primary": "...",
        "name_partner": "...",
        "email_primary": "...",
        "phone_primary": "...",
        "event_date": "YYYY-MM-DD",
        "guest_count_initial": "number as string",
        "guest_count_final": "number as string",
        "revenue_cents": "dollars as string (e.g. 4200.00)",
        "status": "inquiry|tour_booked|booked|planning|event_complete|archived",
        "package": "...",
        "first_touch_platform": "the_knot|wedding_wire|instagram|google_organic|google_ads|referral|direct|other",
        "self_reported_source": "...",
        "review_star_rating": "number as string",
        "review_text": "...",
        "vendor_name": "...",
        "vendor_category": "..."
      }
    }
  ]
}

Only extract what you can actually see. Normalise statuses to our values. Parse all rows from the CSV.`,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in CSV response");

  const parsed = JSON.parse(jsonMatch[0]);

  const rows: CaptureRow[] = (parsed.rows ?? []).map((r: any) => {
    const mapped = { ...r.mapped };

    // Normalise types
    if (mapped.event_date) mapped.event_date = normalizeDate(mapped.event_date);

    return {
      id: makeId(),
      type: r.type ?? "unknown",
      fields: Object.entries(mapped).map(([field, value]) => ({
        field,
        value: value as string | null,
        confidence: "medium" as const,
      })),
      mapped,
      anomalies: [],
    };
  });

  return {
    fileType: parsed.fileType ?? "unknown",
    fileTypeLabel: parsed.fileTypeLabel ?? "Unknown CSV",
    confidence: parsed.confidence ?? "medium",
    rows,
    summary: parsed.summary ?? `CSV with ${rows.length} rows`,
    totalAnomalies: 0,
    blockers: 0,
  };
}

// ── ADD ANOMALIES ─────────────────────────────────────────────────────────────

async function addAnomalies(
  supabase: any,
  venueId: string,
  rows: CaptureRow[],
  avgRevenueCents: number | null
): Promise<CaptureRow[]> {
  const enriched: CaptureRow[] = [];

  for (const row of rows) {
    const anomalies: CaptureAnomaly[] = [];
    const m = row.mapped;

    // 1. Check for duplicate client
    if (row.type === "client" || row.type === "inquiry") {
      const dup = await checkDuplicates(
        supabase,
        venueId,
        m.name_primary ?? null,
        m.event_date ?? null,
        m.email_primary ?? null
      );

      if (dup.exists) {
        anomalies.push({
          id: makeId(),
          severity: "warning",
          message: `A client named "${dup.name}" already exists${m.event_date ? ` with an event date near ${m.event_date}` : ""}. Is this the same person?`,
          field: "name_primary",
          suggestion: "Merge with existing record, or create as new",
          requiresAnswer: true,
        });
      }
    }

    // 2. Revenue sanity check
    if (m.revenue_cents) {
      const rev = normalizeCents(m.revenue_cents);
      if (rev !== null && avgRevenueCents !== null) {
        if (rev < avgRevenueCents * 0.15) {
          anomalies.push({
            id: makeId(),
            severity: "question",
            message: `Revenue of $${(rev / 100).toLocaleString()} is much lower than your average of $${(avgRevenueCents / 100).toLocaleString()}. Is this a deposit, partial payment, or the full amount?`,
            field: "revenue_cents",
            suggestion: "Mark as deposit or confirm full payment",
            requiresAnswer: true,
          });
        }
      }
    }

    // 3. Missing event date
    if ((row.type === "client") && !m.event_date) {
      anomalies.push({
        id: makeId(),
        severity: "warning",
        message: `No event date found for ${m.name_primary ?? "this client"}. Skip or import without date?`,
        field: "event_date",
        requiresAnswer: false,
      });
    }

    // 4. Guest count anomaly
    if (m.guest_count_initial) {
      const gc = parseInt(m.guest_count_initial);
      if (!isNaN(gc) && gc > 350) {
        anomalies.push({
          id: makeId(),
          severity: "question",
          message: `Guest count of ${gc} seems very high. Is this correct?`,
          field: "guest_count_initial",
          requiresAnswer: false,
        });
      }
    }

    // 5. Future event date in completed status
    if (m.status === "event_complete" && m.event_date) {
      const eventDate = new Date(m.event_date);
      if (eventDate > new Date()) {
        anomalies.push({
          id: makeId(),
          severity: "error",
          message: `Status is "event_complete" but event date ${m.event_date} is in the future. Check status.`,
          field: "status",
          requiresAnswer: true,
        });
      }
    }

    // 6. Duplicate platform metric — check if this source+metric+period already exists
    if (row.type === "metric" && m.metric_name && m.metric_platform) {
      const platform = m.metric_platform.toLowerCase().replace(/\s+/g, "_");
      const metricName = m.metric_name.toLowerCase().replace(/\s+/g, "_");

      // Build date range from period label if we have it
      const period = m.metric_period ?? null;
      let periodStart: string | null = null;
      let periodEnd: string | null = null;
      if (period) {
        const rangeMatch = period.match(/(\w+\s+\d{4})\s*[-–]\s*(\w+\s+\d{4})/);
        const now = new Date();
        if (rangeMatch) {
          const s = new Date(rangeMatch[1]);
          const e = new Date(rangeMatch[2]);
          if (!isNaN(s.getTime())) periodStart = new Date(s.getFullYear(), s.getMonth(), 1).toISOString().split("T")[0];
          if (!isNaN(e.getTime())) periodEnd = new Date(e.getFullYear(), e.getMonth() + 1, 0).toISOString().split("T")[0];
        } else if (period.toLowerCase().includes("last 12 months")) {
          periodEnd = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
          periodStart = new Date(now.getFullYear() - 1, now.getMonth(), 1).toISOString().split("T")[0];
        }
      }

      let existingQuery = supabase
        .from("platform_metrics")
        .select("id, metric_value, captured_at")
        .eq("venue_id", venueId)
        .eq("platform", platform)
        .eq("metric_name", metricName);

      if (periodStart && periodEnd) {
        existingQuery = existingQuery.eq("period_start", periodStart).eq("period_end", periodEnd);
      }

      const { data: existing } = await existingQuery.limit(1);

      if (existing && existing.length > 0) {
        const prev = existing[0];
        const capturedDate = new Date(prev.captured_at).toLocaleDateString();
        const prevVal = prev.metric_value;
        const newVal = m.metric_value;
        const sameValue = prevVal !== null && newVal !== null &&
          Math.abs(parseFloat(String(prevVal)) - parseFloat(String(newVal))) < 1;

        anomalies.push({
          id: makeId(),
          severity: sameValue ? "warning" : "question",
          message: sameValue
            ? `You already have ${m.metric_platform} ${m.metric_name} for this period (captured ${capturedDate}, value: ${prevVal}). This looks like a duplicate — skip it?`
            : `You already have ${m.metric_platform} ${m.metric_name} for this period (captured ${capturedDate}, previous value: ${prevVal}, new value: ${newVal}). Import the updated figure?`,
          field: "metric_value",
          suggestion: sameValue ? "Skip this row" : "Import to update the existing value",
          requiresAnswer: true,
        });
      }
    }

    // 7. Duplicate spend — check if this platform contract period already exists
    if (row.type === "spend" && m.spend_platform) {
      const platform = m.spend_platform.toLowerCase().replace(/\s+/g, "_");

      let spendQuery = supabase
        .from("source_spend")
        .select("id, annual_spend_cents, contract_label, created_at")
        .eq("venue_id", venueId)
        .eq("platform", platform);

      if (m.spend_contract_start) {
        spendQuery = spendQuery.eq("contract_start", m.spend_contract_start);
      }

      const { data: existingSpend } = await spendQuery.limit(1);

      if (existingSpend && existingSpend.length > 0) {
        const prev = existingSpend[0];
        const prevAmount = prev.annual_spend_cents ? `$${(prev.annual_spend_cents / 100).toLocaleString()}` : "unknown";
        const capturedDate = new Date(prev.created_at).toLocaleDateString();
        anomalies.push({
          id: makeId(),
          severity: "warning",
          message: `${m.spend_platform} spend for this contract period already captured on ${capturedDate} (${prevAmount}/yr). Import again?`,
          field: "spend_amount",
          suggestion: "Skip if this is the same contract",
          requiresAnswer: true,
        });
      }
    }

    enriched.push({ ...row, anomalies });
  }

  return enriched;
}

// ── ROUTER ────────────────────────────────────────────────────────────────────

export const captureRouter = router({
  // Classify and extract from image (base64)
  classifyImage: venueProcedure
    .input(
      z.object({
        base64: z.string(),
        mimeType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await classifyImage(input.base64, input.mimeType);

      // Get venue avg revenue for anomaly checks
      const { data: revenueData } = await ctx.supabase
        .from("clients")
        .select("revenue_cents")
        .eq("venue_id", ctx.venueId)
        .not("revenue_cents", "is", null)
        .eq("status", "event_complete");

      const avgRevenue =
        revenueData && revenueData.length > 0
          ? revenueData.reduce((s: number, c: any) => s + c.revenue_cents, 0) / revenueData.length
          : null;

      result.rows = await addAnomalies(ctx.supabase, ctx.venueId, result.rows, avgRevenue);
      result.totalAnomalies = result.rows.reduce((s, r) => s + r.anomalies.length, 0);
      result.blockers = result.rows.reduce(
        (s, r) => s + r.anomalies.filter((a) => a.severity === "error" || a.requiresAnswer).length,
        0
      );

      return result;
    }),

  // Classify and extract from CSV text
  classifyCSV: venueProcedure
    .input(z.object({ content: z.string().max(500000), fileName: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await classifyCSV(input.content, input.fileName);

      const { data: revenueData } = await ctx.supabase
        .from("clients")
        .select("revenue_cents")
        .eq("venue_id", ctx.venueId)
        .not("revenue_cents", "is", null)
        .eq("status", "event_complete");

      const avgRevenue =
        revenueData && revenueData.length > 0
          ? revenueData.reduce((s: number, c: any) => s + c.revenue_cents, 0) / revenueData.length
          : null;

      result.rows = await addAnomalies(ctx.supabase, ctx.venueId, result.rows, avgRevenue);
      result.totalAnomalies = result.rows.reduce((s, r) => s + r.anomalies.length, 0);
      result.blockers = result.rows.reduce(
        (s, r) => s + r.anomalies.filter((a) => a.severity === "error" || a.requiresAnswer).length,
        0
      );

      return result;
    }),

  // Commit reviewed rows to the database
  commit: venueProcedure
    .input(
      z.object({
        rows: z.array(
          z.object({
            id: z.string(),
            type: z.enum(["client", "inquiry", "vendor", "review", "metric", "spend", "lead", "unknown"]),
            skip: z.boolean().default(false),
            mapped: z.record(z.string().nullable()),
            anomalyAnswers: z.record(z.string()), // anomaly.id -> answer
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const results = { inserted: 0, skipped: 0, errors: [] as string[] };

      for (const row of input.rows) {
        if (row.skip) { results.skipped++; continue; }

        try {
          if (row.type === "client") {
            const revStr = row.mapped.revenue_cents;
            const revCents = revStr ? normalizeCents(revStr) : null;
            const guestInitial = row.mapped.guest_count_initial
              ? parseInt(row.mapped.guest_count_initial)
              : null;
            const guestFinal = row.mapped.guest_count_final
              ? parseInt(row.mapped.guest_count_final)
              : null;

            const { error } = await ctx.supabase.from("clients").insert({
              venue_id: ctx.venueId,
              name_primary: row.mapped.name_primary ?? null,
              name_partner: row.mapped.name_partner ?? null,
              email_primary: row.mapped.email_primary ?? null,
              phone_primary: row.mapped.phone_primary ?? null,
              event_date: row.mapped.event_date ?? null,
              status: row.mapped.status ?? "inquiry",
              package: row.mapped.package ?? null,
              guest_count_initial: !isNaN(guestInitial!) ? guestInitial : null,
              guest_count_final: !isNaN(guestFinal!) ? guestFinal : null,
              revenue_cents: revCents,
              first_touch_platform: row.mapped.first_touch_platform ?? null,
              self_reported_source: row.mapped.self_reported_source ?? null,
              review_star_rating: row.mapped.review_star_rating
                ? parseFloat(row.mapped.review_star_rating)
                : null,
              review_text: row.mapped.review_text ?? null,
              review_left: !!row.mapped.review_star_rating,
              review_platform: row.mapped.review_platform ?? null,
            });

            if (error) {
              results.errors.push(`${row.mapped.name_primary}: ${error.message}`);
            } else {
              results.inserted++;
            }
          } else if (row.type === "inquiry") {
            const { error } = await ctx.supabase.from("inquiries").insert({
              venue_id: ctx.venueId,
              platform: row.mapped.first_touch_platform ?? "direct",
              name_extracted: row.mapped.name_primary ?? null,
              email_extracted: row.mapped.email_primary ?? null,
              phone_extracted: row.mapped.phone_primary ?? null,
              event_date_extracted: row.mapped.event_date ?? null,
              guest_count_extracted: row.mapped.guest_count_initial
                ? parseInt(row.mapped.guest_count_initial)
                : null,
              raw_message: row.mapped.raw_message ?? null,
              self_reported_source: row.mapped.self_reported_source ?? null,
              received_at: row.mapped.received_at
                ? new Date(row.mapped.received_at).toISOString()
                : new Date().toISOString(),
              match_status: "unmatched",
            });

            if (error) {
              results.errors.push(`Inquiry ${row.mapped.name_primary}: ${error.message}`);
            } else {
              results.inserted++;
            }
          } else if (row.type === "vendor") {
            const { error } = await ctx.supabase.from("vendors").insert({
              venue_id: ctx.venueId,
              name: row.mapped.vendor_name ?? row.mapped.name_primary ?? "Unknown",
              category: row.mapped.vendor_category ?? null,
              email: row.mapped.email_primary ?? null,
              website: row.mapped.website ?? null,
            });

            if (error) {
              results.errors.push(`Vendor ${row.mapped.vendor_name}: ${error.message}`);
            } else {
              results.inserted++;
            }
          } else if (row.type === "review") {
            // Reviews go into clients table with review fields populated
            const { error } = await ctx.supabase.from("clients").insert({
              venue_id: ctx.venueId,
              name_primary: row.mapped.name_primary ?? null,
              email_primary: row.mapped.email_primary ?? null,
              status: "event_complete",
              review_star_rating: row.mapped.review_star_rating
                ? parseFloat(row.mapped.review_star_rating)
                : null,
              review_text: row.mapped.review_text ?? null,
              review_left: true,
              review_platform: row.mapped.review_platform ?? null,
            });

            if (error) {
              results.errors.push(`Review (${row.mapped.name_primary ?? "unknown"}): ${error.message}`);
            } else {
              results.inserted++;
            }
          } else if (row.type === "metric") {
            // Store into platform_metrics table
            const period = row.mapped.metric_period ?? null;
            const now = new Date();

            // Attempt to parse period into a date range
            let periodStart: string | null = null;
            let periodEnd: string | null = null;

            if (period) {
              // Try "Apr 2025-Mar 2026" style
              const rangeMatch = period.match(/(\w+\s+\d{4})\s*[-–]\s*(\w+\s+\d{4})/);
              if (rangeMatch) {
                const s = new Date(rangeMatch[1]);
                const e = new Date(rangeMatch[2]);
                if (!isNaN(s.getTime())) periodStart = new Date(s.getFullYear(), s.getMonth(), 1).toISOString().split("T")[0];
                if (!isNaN(e.getTime())) periodEnd = new Date(e.getFullYear(), e.getMonth() + 1, 0).toISOString().split("T")[0];
              } else if (period.toLowerCase().includes("last 12 months")) {
                periodEnd = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
                periodStart = new Date(now.getFullYear() - 1, now.getMonth(), 1).toISOString().split("T")[0];
              } else {
                const parsed = new Date(period);
                if (!isNaN(parsed.getTime())) {
                  periodStart = new Date(parsed.getFullYear(), parsed.getMonth(), 1).toISOString().split("T")[0];
                  periodEnd = new Date(parsed.getFullYear(), parsed.getMonth() + 1, 0).toISOString().split("T")[0];
                }
              }
            }

            const metricVal = row.mapped.metric_value
              ? parseFloat(row.mapped.metric_value.replace(/[^0-9.]/g, ""))
              : null;

            let breakdown: any = null;
            if (row.mapped.metric_breakdown) {
              try { breakdown = JSON.parse(row.mapped.metric_breakdown); } catch {}
            }

            const { error } = await ctx.supabase.from("platform_metrics").insert({
              venue_id: ctx.venueId,
              platform: (row.mapped.metric_platform ?? "unknown").toLowerCase().replace(/\s+/g, "_"),
              metric_name: (row.mapped.metric_name ?? "unknown").toLowerCase().replace(/\s+/g, "_"),
              metric_value: !isNaN(metricVal!) ? metricVal : null,
              period_start: periodStart,
              period_end: periodEnd,
              period_label: period,
              breakdown: breakdown,
              comparison: row.mapped.metric_comparison ?? null,
              source: "capture_upload",
            });

            if (error) {
              // If it's a duplicate, that's fine — already have this data
              if (error.code === "23505") {
                results.skipped++;
              } else {
                results.errors.push(`Metric (${row.mapped.metric_name}): ${error.message}`);
              }
            } else {
              results.inserted++;
            }
          } else if (row.type === "spend") {
            // Store into source_spend table
            const amount = row.mapped.spend_amount
              ? Math.round(parseFloat(row.mapped.spend_amount.replace(/[^0-9.]/g, "")) * 100)
              : null;

            const { error } = await ctx.supabase.from("source_spend").insert({
              venue_id: ctx.venueId,
              platform: (row.mapped.spend_platform ?? "unknown").toLowerCase().replace(/\s+/g, "_"),
              annual_spend_cents: amount,
              contract_start: row.mapped.spend_contract_start ?? null,
              contract_end: row.mapped.spend_contract_end ?? null,
              contract_label: row.mapped.spend_product_name ?? null,
              source: "capture_upload",
            });

            if (error) {
              if (error.code === "23505") {
                results.skipped++;
              } else {
                results.errors.push(`Spend (${row.mapped.spend_platform}): ${error.message}`);
              }
            } else {
              results.inserted++;
            }
          } else if (row.type === "lead") {
            // Pre-inquiry funnel touch — save, storefront visit, website visit, etc.
            const { error } = await ctx.supabase.from("leads").insert({
              venue_id: ctx.venueId,
              platform: (row.mapped.lead_platform ?? "unknown").toLowerCase().replace(/\s+/g, "_"),
              touch_type: row.mapped.lead_touch_type ?? "storefront_visit",
              name: row.mapped.lead_name ?? null,
              source_date: row.mapped.lead_source_date ?? null,
              raw_activity: row.mapped.lead_raw_activity ?? null,
              source: "capture_upload",
            });

            if (error) {
              results.errors.push(`Lead (${row.mapped.lead_name ?? "unknown"}): ${error.message}`);
            } else {
              results.inserted++;
            }
          } else {
            // unknown type — count as skipped so user sees it in the result
            results.skipped++;
          }
        } catch (e: any) {
          results.errors.push(e.message);
        }
      }

      // Fire-and-forget duplicate scan after any new clients are added
      if (results.inserted > 0) {
        runDuplicateScan(ctx.supabase, ctx.venueId).catch(() => {});
      }

      return results;
    }),
});

// ── BACKGROUND DUPLICATE SCAN ─────────────────────────────────────────────────
// Called after every commit — finds client/metric duplicates and queues them

async function runDuplicateScan(supabase: any, venueId: string) {
  const [{ data: clients }, { data: existing }] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name_primary, email_primary, event_date")
      .eq("venue_id", venueId),
    supabase
      .from("matching_queue")
      .select("record_a_id, record_b_id")
      .eq("venue_id", venueId)
      .neq("status", "rejected"),
  ]);

  const alreadyQueued = new Set<string>(
    (existing ?? []).map((e: any) => [e.record_a_id, e.record_b_id].sort().join(":"))
  );

  const toInsert: any[] = [];
  const clientList = clients ?? [];

  for (let i = 0; i < clientList.length; i++) {
    for (let j = i + 1; j < clientList.length; j++) {
      const a = clientList[i];
      const b = clientList[j];
      const pairKey = [a.id, b.id].sort().join(":");
      if (alreadyQueued.has(pairKey)) continue;

      let score = 0;
      const signals: string[] = [];

      if (
        a.email_primary && b.email_primary &&
        a.email_primary.toLowerCase().trim() === b.email_primary.toLowerCase().trim()
      ) { score += 85; signals.push("same email"); }

      if (a.event_date && b.event_date && a.event_date === b.event_date) {
        score += 45; signals.push("same event date");
      }

      if (a.name_primary && b.name_primary) {
        const aFirst = a.name_primary.trim().split(/\s+/)[0].toLowerCase();
        const bFirst = b.name_primary.trim().split(/\s+/)[0].toLowerCase();
        if (aFirst.length >= 3 && aFirst === bFirst) {
          score += 25; signals.push("same first name");
        }
      }

      if (score >= 60) {
        toInsert.push({
          venue_id: venueId,
          record_a_type: "client",
          record_a_id: a.id,
          record_b_type: "client",
          record_b_id: b.id,
          match_score: score,
          signals_matched: signals,
          status: "pending",
        });
        alreadyQueued.add(pairKey);
      }
    }
  }

  if (toInsert.length > 0) {
    await supabase.from("matching_queue").insert(toInsert);
  }
}
