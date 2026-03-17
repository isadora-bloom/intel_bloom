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
  | "unknown";

export interface ExtractedField {
  field: string;
  value: string | null;
  confidence: "high" | "medium" | "low";
}

export interface CaptureRow {
  id: string; // temp local id
  type: "client" | "inquiry" | "vendor" | "review" | "metric" | "unknown";
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
            text: `You are extracting data from a wedding venue business screenshot. You can read both tabular data AND visual charts (bar charts, line graphs, pie charts, tables with numbers).

First, identify what type of screenshot this is:
- Inquiry screenshots (The Knot, WeddingWire, Instagram DMs, email) → extract contact/inquiry rows
- Review screenshots (Google, The Knot, WeddingWire) → extract review rows
- Analytics/chart screenshots (Google Analytics, Google Ads, The Knot stats, Meta Insights, ad performance dashboards, booking reports) → extract metric rows by reading values from charts/tables
- Financial/booking spreadsheets → extract client/financial rows

For CHART/ANALYTICS screenshots: Read the axes, legend, labels, and data points carefully. Estimate bar heights, read line graph values at each point, extract all visible numbers from tables. Each distinct metric or data series becomes a separate "metric" row.

Respond with ONLY valid JSON:
{
  "fileType": "knot_inquiry_screenshot" | "instagram_inquiry_screenshot" | "email_inquiry_screenshot" | "review_screenshot" | "analytics_chart" | "ads_dashboard" | "google_analytics" | "social_insights" | "unknown",
  "fileTypeLabel": "human-readable label e.g. 'Google Ads Performance' or 'The Knot Inquiry'",
  "confidence": "high" | "medium" | "low",
  "summary": "One sentence — e.g. 'Google Ads dashboard showing 847 clicks and $12.40 CPC for March 2025'",
  "rows": [
    {
      "type": "inquiry" | "client" | "review" | "metric" | "unknown",
      "fields": [
        // For inquiry/client rows:
        { "field": "name_primary", "value": "...", "confidence": "high" },
        { "field": "email_primary", "value": "...", "confidence": "high" },
        { "field": "phone_primary", "value": "...", "confidence": "medium" },
        { "field": "event_date", "value": "YYYY-MM-DD or raw text", "confidence": "high" },
        { "field": "guest_count_initial", "value": "...", "confidence": "medium" },
        { "field": "self_reported_source", "value": "...", "confidence": "high" },
        { "field": "raw_message", "value": "full message text", "confidence": "high" },
        { "field": "first_touch_platform", "value": "the_knot|wedding_wire|instagram|google_ads|google_organic|referral|direct|other", "confidence": "high" },

        // For review rows:
        { "field": "review_star_rating", "value": "4.5", "confidence": "high" },
        { "field": "review_text", "value": "...", "confidence": "high" },
        { "field": "review_platform", "value": "google|the_knot|wedding_wire|other", "confidence": "high" },
        { "field": "name_primary", "value": "reviewer name if visible", "confidence": "medium" },

        // For metric rows (charts, analytics, ads):
        { "field": "metric_name", "value": "e.g. Clicks, Impressions, Cost Per Click, Inquiries, Bookings, CTR, ROAS, Reach, Leads", "confidence": "high" },
        { "field": "metric_value", "value": "the numeric value, e.g. 847 or 12.40 or 3.2%", "confidence": "high" },
        { "field": "metric_period", "value": "e.g. March 2025, Q1 2025, last 30 days, 2024", "confidence": "medium" },
        { "field": "metric_platform", "value": "e.g. Google Ads, Meta, The Knot, WeddingWire, Instagram, Overall", "confidence": "high" },
        { "field": "metric_comparison", "value": "change vs prior period if visible, e.g. +12% vs last month", "confidence": "medium" },
        { "field": "metric_breakdown", "value": "if it's a breakdown chart, list all segments as JSON array string e.g. [{label:Mon,value:45},{label:Tue,value:52}]", "confidence": "medium" }
      ]
    }
  ]
}

IMPORTANT for charts: If a chart shows multiple data points (e.g. clicks by month for 6 months), create ONE metric row with metric_breakdown containing all points. If a dashboard shows multiple distinct KPIs (clicks, cost, CTR, conversions), create a SEPARATE metric row for each KPI. Read values as precisely as you can from the visual.

Only include fields you can actually see. Extract every visible person/inquiry/review/metric.`,
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

async function classifyCSV(
  content: string,
  fileName: string
): Promise<ClassifyResult> {
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
            type: z.enum(["client", "inquiry", "vendor", "review", "metric", "unknown"]),
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
              received_at: new Date().toISOString(),
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
            // Store analytics/chart metrics as annotations
            const period = row.mapped.metric_period ?? null;
            // Try to parse a date from the period string; default to current month
            const now = new Date();
            let periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
            let periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];
            if (period) {
              const parsed = new Date(period);
              if (!isNaN(parsed.getTime())) {
                periodStart = new Date(parsed.getFullYear(), parsed.getMonth(), 1).toISOString().split("T")[0];
                periodEnd = new Date(parsed.getFullYear(), parsed.getMonth() + 1, 0).toISOString().split("T")[0];
              }
            }
            const metricVal = row.mapped.metric_value
              ? parseFloat(row.mapped.metric_value.replace(/[^0-9.-]/g, ""))
              : null;
            const notes = JSON.stringify({
              metric_name: row.mapped.metric_name,
              metric_value: row.mapped.metric_value,
              metric_period: period,
              metric_comparison: row.mapped.metric_comparison,
              metric_breakdown: row.mapped.metric_breakdown,
            });
            const { error } = await ctx.supabase.from("annotations").insert({
              venue_id: ctx.venueId,
              period_start: periodStart,
              period_end: periodEnd,
              annotation_type: "captured_metric",
              category_detail: row.mapped.metric_platform ?? "unknown",
              notes,
              source: "capture_upload",
              detected_signal: row.mapped.metric_name ?? null,
              detected_value: !isNaN(metricVal!) ? metricVal : null,
              exclude_from_patterns: false,
              propagate_to_aggregate: false,
            });
            if (error) {
              results.errors.push(`Metric (${row.mapped.metric_name}): ${error.message}`);
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

      return results;
    }),
});
