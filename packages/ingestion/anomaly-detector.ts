/**
 * Anomaly Detection Engine
 * Watches all venue metrics for significant deviations.
 * Writes to anomaly_detections table with AI-generated explanations.
 * Brief: packages/pulse/anomaly-detect.ts (placed here alongside other ingestion jobs)
 */

import { createClient } from "@supabase/supabase-js";
import { subDays, subMonths, format } from "date-fns";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ── Types ────────────────────────────────────────────────────────────────

interface MetricResult {
  current: number;
  baseline: number;
  changePct: number;
  periodCurrent: string;
  periodBaseline: string;
  baselineType: "prior_period" | "same_period_prior_year" | "rolling_average";
}

interface AnomalyRecord {
  venue_id: string;
  metric: string;
  direction: "up" | "down";
  magnitude_pct: number;
  period_current: string;
  period_baseline: string;
  baseline_type: string;
  current_value: number;
  baseline_value: number;
  severity: "info" | "warning" | "critical";
  ai_possible_causes: string[] | null;
  ai_recommendation: string | null;
  ai_confidence: number | null;
}

// ── Severity thresholds ──────────────────────────────────────────────────

function getSeverity(changePct: number): "info" | "warning" | "critical" {
  const abs = Math.abs(changePct);
  if (abs >= 50) return "critical";
  if (abs >= 25) return "warning";
  return "info";
}

// ── AI analysis (optional — only if ANTHROPIC_API_KEY is set) ────────────

async function getAIAnalysis(
  venueId: string,
  metric: string,
  changePct: number,
  current: number,
  baseline: number,
): Promise<{ causes: string[]; recommendation: string; confidence: number } | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  try {
    // Dynamic import to avoid breaking if ai.ts isn't available in this context
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const direction = changePct > 0 ? "increased" : "decreased";
    const prompt = `A wedding venue's ${metric.replace(/_/g, " ")} has ${direction} by ${Math.abs(changePct).toFixed(1)}% compared to baseline.
Current value: ${current}. Baseline: ${baseline}.

Suggest 2-3 possible causes ranked by likelihood. For each cause, suggest one concrete action.
Be specific to the wedding industry. Don't be generic.

Respond in JSON: { "causes": ["cause1", "cause2"], "recommendation": "top action", "confidence": 70 }`;

    const res = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      temperature: 0.3,
      messages: [{ role: "user", content: prompt }],
    });

    const text = res.content[0].type === "text" ? res.content[0].text : "";
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    const parsed = JSON.parse(cleaned);
    return {
      causes: parsed.causes ?? [],
      recommendation: parsed.recommendation ?? null,
      confidence: parsed.confidence ?? 50,
    };
  } catch {
    return null;
  }
}

// ── Metric getters ───────────────────────────────────────────────────────

async function getInquiryVolume(venueId: string, from: string, to: string): Promise<number> {
  const { count } = await supabase
    .from("inquiries")
    .select("id", { count: "exact", head: true })
    .eq("venue_id", venueId)
    .gte("received_at", from)
    .lte("received_at", to);
  return count ?? 0;
}

async function getAvgResponseTime(venueId: string, from: string, to: string): Promise<number> {
  const { data } = await supabase
    .from("inquiries")
    .select("response_time_minutes")
    .eq("venue_id", venueId)
    .gte("received_at", from)
    .lte("received_at", to)
    .not("response_time_minutes", "is", null);
  if (!data || data.length === 0) return 0;
  return data.reduce((s, r) => s + (r.response_time_minutes as number), 0) / data.length;
}

async function getReviewSentiment(venueId: string, from: string, to: string): Promise<number> {
  const { data } = await supabase
    .from("reviews")
    .select("rating")
    .eq("venue_id", venueId)
    .gte("review_date", from)
    .lte("review_date", to)
    .not("rating", "is", null);
  if (!data || data.length === 0) return 0;
  return data.reduce((s, r) => s + Number(r.rating), 0) / data.length;
}

async function getTourConversion(venueId: string, from: string, to: string): Promise<number> {
  const { data: tours } = await supabase
    .from("tours")
    .select("completed, outcome")
    .eq("venue_id", venueId)
    .gte("scheduled_at", from)
    .lte("scheduled_at", to)
    .eq("completed", true);
  if (!tours || tours.length === 0) return 0;
  const booked = tours.filter((t) => t.outcome === "booked").length;
  return tours.length > 0 ? (booked / tours.length) * 100 : 0;
}

async function getBookingCount(venueId: string, from: string, to: string): Promise<number> {
  const { count } = await supabase
    .from("clients")
    .select("id", { count: "exact", head: true })
    .eq("venue_id", venueId)
    .gte("contracted_at", from)
    .lte("contracted_at", to);
  return count ?? 0;
}

async function getLostDealCount(venueId: string, from: string, to: string): Promise<number> {
  const { count } = await supabase
    .from("lost_deals")
    .select("id", { count: "exact", head: true })
    .eq("venue_id", venueId)
    .gte("created_at", from)
    .lte("created_at", to);
  return count ?? 0;
}

// ── Core detection loop ──────────────────────────────────────────────────

interface MetricDef {
  name: string;
  getter: (venueId: string, from: string, to: string) => Promise<number>;
  threshold: number;
  frequency: "daily" | "weekly" | "monthly";
  minBaseline: number; // Don't flag if baseline is below this (avoids noise on tiny numbers)
}

const METRICS: MetricDef[] = [
  { name: "inquiry_volume", getter: getInquiryVolume, threshold: 25, frequency: "daily", minBaseline: 3 },
  { name: "response_time", getter: getAvgResponseTime, threshold: 100, frequency: "daily", minBaseline: 1 },
  { name: "tour_conversion", getter: getTourConversion, threshold: 20, frequency: "weekly", minBaseline: 2 },
  { name: "booking_rate", getter: getBookingCount, threshold: 25, frequency: "weekly", minBaseline: 1 },
  { name: "review_sentiment", getter: getReviewSentiment, threshold: 15, frequency: "weekly", minBaseline: 1 },
  { name: "lost_deal_rate", getter: getLostDealCount, threshold: 30, frequency: "monthly", minBaseline: 1 },
];

export async function runAnomalyDetection(venueId: string) {
  const now = new Date();

  for (const metric of METRICS) {
    try {
      // Current period: last 7 days for daily, last 14 for weekly, last 30 for monthly
      const currentDays = metric.frequency === "daily" ? 7 : metric.frequency === "weekly" ? 14 : 30;
      const currentFrom = format(subDays(now, currentDays), "yyyy-MM-dd");
      const currentTo = format(now, "yyyy-MM-dd");

      // Baseline period: same duration, shifted back by that duration
      const baselineFrom = format(subDays(now, currentDays * 2), "yyyy-MM-dd");
      const baselineTo = currentFrom;

      const current = await metric.getter(venueId, currentFrom, currentTo);
      const baseline = await metric.getter(venueId, baselineFrom, baselineTo);

      // Skip if baseline is too small to be meaningful
      if (baseline < metric.minBaseline && current < metric.minBaseline) continue;

      // Calculate change percentage (handle zero baseline)
      let changePct: number;
      if (baseline === 0 && current === 0) continue;
      if (baseline === 0) changePct = 100; // From nothing to something
      else changePct = ((current - baseline) / baseline) * 100;

      if (Math.abs(changePct) < metric.threshold) continue;

      // Check for existing detection in same period (avoid duplicates)
      const { data: existing } = await supabase
        .from("anomaly_detections")
        .select("id")
        .eq("venue_id", venueId)
        .eq("metric", metric.name)
        .eq("period_current", `${currentFrom} to ${currentTo}`)
        .limit(1);

      if (existing && existing.length > 0) continue;

      const severity = getSeverity(changePct);

      // Get AI analysis for warning and critical anomalies
      let aiAnalysis: { causes: string[]; recommendation: string; confidence: number } | null = null;
      if (severity !== "info") {
        aiAnalysis = await getAIAnalysis(venueId, metric.name, changePct, current, baseline);
      }

      const record: AnomalyRecord = {
        venue_id: venueId,
        metric: metric.name,
        direction: changePct > 0 ? "up" : "down",
        magnitude_pct: Math.round(changePct * 100) / 100,
        period_current: `${currentFrom} to ${currentTo}`,
        period_baseline: `${baselineFrom} to ${baselineTo}`,
        baseline_type: "prior_period",
        current_value: Math.round(current * 100) / 100,
        baseline_value: Math.round(baseline * 100) / 100,
        severity,
        ai_possible_causes: aiAnalysis?.causes ?? null,
        ai_recommendation: aiAnalysis?.recommendation ?? null,
        ai_confidence: aiAnalysis?.confidence ?? null,
      };

      await supabase.from("anomaly_detections").insert(record);

      // Also create an annotation for backward compatibility with the annotations UI
      if (severity !== "info") {
        await supabase.from("annotations").insert({
          venue_id: venueId,
          period_start: currentFrom,
          period_end: currentTo,
          annotation_type: "anomaly_response",
          source: "system_detected",
          detected_signal: metric.name,
          detected_value: current,
          detected_threshold: baseline,
          notes: aiAnalysis?.recommendation ??
            `${metric.name.replace(/_/g, " ")} changed by ${changePct > 0 ? "+" : ""}${Math.round(changePct)}%`,
          created_by: "system",
        });
      }
    } catch (err) {
      console.error(`[anomaly-detect] Error checking ${metric.name} for venue ${venueId}:`, err);
    }
  }

  // ── Stalled clients check ─────────────────────────────────────────────
  try {
    const stalledStatuses = ["tour_booked", "toured", "held"];
    for (const status of stalledStatuses) {
      const threshold = status === "held" ? 14 : 21; // Held clients stall faster
      const cutoff = format(subDays(now, threshold), "yyyy-MM-dd'T'00:00:00");

      const dateCol =
        status === "tour_booked" ? "tour_booked_at" :
        status === "toured" ? "toured_at" :
        "held_at";

      const { data: stalled } = await supabase
        .from("clients")
        .select("id, name_primary")
        .eq("venue_id", venueId)
        .eq("status", status)
        .lt(dateCol, cutoff)
        .limit(10);

      if (stalled && stalled.length >= 2) {
        const { data: existing } = await supabase
          .from("anomaly_detections")
          .select("id")
          .eq("venue_id", venueId)
          .eq("metric", `stalled_${status}`)
          .eq("status", "new")
          .limit(1);

        if (!existing || existing.length === 0) {
          await supabase.from("anomaly_detections").insert({
            venue_id: venueId,
            metric: `stalled_${status}`,
            direction: "down",
            magnitude_pct: 0,
            period_current: `${format(subDays(now, threshold), "yyyy-MM-dd")} to ${format(now, "yyyy-MM-dd")}`,
            period_baseline: `${threshold}+ days in ${status.replace("_", " ")} status`,
            baseline_type: "rolling_average",
            current_value: stalled.length,
            baseline_value: 0,
            severity: stalled.length >= 4 ? "warning" : "info",
            ai_recommendation: `${stalled.length} clients have been in "${status.replace("_", " ")}" for ${threshold}+ days. Consider follow-up: ${stalled.slice(0, 3).map(s => s.name_primary).join(", ")}${stalled.length > 3 ? "..." : ""}.`,
          });
        }
      }
    }
  } catch (err) {
    console.error(`[anomaly-detect] Error checking stalled clients for venue ${venueId}:`, err);
  }
}

// ── Response alert generation ──────────────────────────────────────────
// Creates alerts for inquiries that haven't been responded to within threshold
async function generateResponseAlerts(venueId: string) {
  const defaultThreshold = 30; // minutes

  // Find inquiries received in the last 48 hours with no response
  const cutoff = format(subDays(new Date(), 2), "yyyy-MM-dd'T'HH:mm:ss");
  const { data: unanswered } = await supabase
    .from("inquiries")
    .select("id, received_at, response_time_minutes")
    .eq("venue_id", venueId)
    .gte("received_at", cutoff)
    .is("response_sent_at", null);

  for (const inq of unanswered ?? []) {
    const receivedAt = new Date(inq.received_at as string);
    const minutesSince = Math.round((Date.now() - receivedAt.getTime()) / 60000);

    if (minutesSince < defaultThreshold) continue;

    // Check if alert already exists for this inquiry
    const { data: existing } = await supabase
      .from("response_alerts")
      .select("id")
      .eq("inquiry_id", inq.id)
      .limit(1);

    if (existing && existing.length > 0) continue;

    const alertType = minutesSince > 1440 ? "no_response" :
                      minutesSince > 240 ? "after_hours_gap" :
                      "slow_response";

    await supabase.from("response_alerts").insert({
      venue_id: venueId,
      inquiry_id: inq.id,
      alert_type: alertType,
      threshold_minutes: defaultThreshold,
      actual_minutes: minutesSince,
    });
  }
}

// ── Pattern benchmark calculation ──────────────────────────────────────
// Calculates venue-level benchmarks from client data
async function calculateBenchmarks(venueId: string) {
  const { data: clients } = await supabase
    .from("clients")
    .select("status, revenue_cents, response_time_minutes, inquired_at, contracted_at, event_date")
    .eq("venue_id", venueId);

  if (!clients || clients.length < 5) return;

  const booked = clients.filter(c => ["contracted", "event_complete"].includes(c.status));
  const withRevenue = booked.filter(c => c.revenue_cents && (c.revenue_cents as number) > 0);
  const withRT = clients.filter(c => c.response_time_minutes != null);

  const metrics: Array<{ metric: string; value: any }> = [];

  // Conversion rate
  metrics.push({
    metric: "inquiry_to_booking_rate",
    value: { rate: clients.length > 0 ? booked.length / clients.length : 0, sample: clients.length },
  });

  // Average revenue
  if (withRevenue.length >= 3) {
    const revs = withRevenue.map(c => c.revenue_cents as number).sort((a, b) => a - b);
    metrics.push({
      metric: "revenue_per_event",
      value: {
        p25: revs[Math.floor(revs.length * 0.25)],
        p50: revs[Math.floor(revs.length * 0.5)],
        p75: revs[Math.floor(revs.length * 0.75)],
        mean: Math.round(revs.reduce((a, b) => a + b, 0) / revs.length),
        sample: revs.length,
      },
    });
  }

  // Response time
  if (withRT.length >= 3) {
    const rts = withRT.map(c => c.response_time_minutes as number).sort((a, b) => a - b);
    metrics.push({
      metric: "response_time_minutes",
      value: {
        p25: rts[Math.floor(rts.length * 0.25)],
        p50: rts[Math.floor(rts.length * 0.5)],
        p75: rts[Math.floor(rts.length * 0.75)],
        mean: Math.round(rts.reduce((a, b) => a + b, 0) / rts.length),
        sample: rts.length,
      },
    });
  }

  // Booking horizon (days from inquiry to event)
  const horizons = clients
    .filter(c => c.inquired_at && c.event_date)
    .map(c => Math.round((new Date(c.event_date as string).getTime() - new Date(c.inquired_at as string).getTime()) / 86400000))
    .filter(d => d > 0 && d < 1095)
    .sort((a, b) => a - b);

  if (horizons.length >= 3) {
    metrics.push({
      metric: "booking_horizon_days",
      value: {
        p25: horizons[Math.floor(horizons.length * 0.25)],
        p50: horizons[Math.floor(horizons.length * 0.5)],
        p75: horizons[Math.floor(horizons.length * 0.75)],
        mean: Math.round(horizons.reduce((a, b) => a + b, 0) / horizons.length),
        sample: horizons.length,
      },
    });
  }

  const period = format(new Date(), "yyyy-MM");

  for (const m of metrics) {
    // Upsert — one benchmark per venue per metric per period
    const { data: existing } = await supabase
      .from("pattern_benchmarks")
      .select("id")
      .eq("venue_id", venueId)
      .eq("metric", m.metric)
      .eq("period", period)
      .limit(1);

    if (existing && existing.length > 0) {
      await supabase.from("pattern_benchmarks").update({
        value: m.value,
        calculated_at: new Date().toISOString(),
        sample_size: m.value.sample ?? null,
      }).eq("id", existing[0].id);
    } else {
      await supabase.from("pattern_benchmarks").insert({
        venue_id: venueId,
        metric: m.metric,
        period,
        value: m.value,
        sample_size: m.value.sample ?? null,
      });
    }
  }
}

export async function runAnomalyDetectionAllVenues() {
  const { data: venues } = await supabase
    .from("venues")
    .select("id")
    .eq("onboarding_complete", true);

  for (const venue of venues ?? []) {
    try {
      await runAnomalyDetection(venue.id);
      await generateResponseAlerts(venue.id);
      await calculateBenchmarks(venue.id);
    } catch (err) {
      console.error(`Anomaly detection failed for venue ${venue.id}:`, err);
    }
  }
}
