/**
 * Anomaly Detection
 * Runs daily for each venue. Detects unusual patterns and creates annotation flags.
 */

import { createClient } from "@supabase/supabase-js";
import { subDays, format } from "date-fns";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface AnomalyFlag {
  signal: string;
  detected_value: number;
  detected_threshold: number;
  period_start: string;
  period_end: string;
  message: string;
}

async function createAnnotationFlag(venueId: string, flag: AnomalyFlag) {
  // Check if a similar flag already exists for this period (avoid duplicate spam)
  const { data: existing } = await supabase
    .from("annotations")
    .select("id")
    .eq("venue_id", venueId)
    .eq("detected_signal", flag.signal)
    .eq("period_start", flag.period_start)
    .limit(1);

  if (existing && existing.length > 0) return; // Already flagged

  await supabase.from("annotations").insert({
    venue_id: venueId,
    period_start: flag.period_start,
    period_end: flag.period_end,
    annotation_type: "unknown",
    source: "system_detected",
    detected_signal: flag.signal,
    detected_value: flag.detected_value,
    detected_threshold: flag.detected_threshold,
    notes: flag.message,
  });
}

export async function runAnomalyDetection(venueId: string) {
  const now = new Date();
  const last30Days = subDays(now, 30);
  const last7Days = subDays(now, 7);

  const nowStr = format(now, "yyyy-MM-dd");
  const last7Str = format(last7Days, "yyyy-MM-dd");
  const last30Str = format(last30Days, "yyyy-MM-dd");

  // Check 1: Inquiry volume drop
  const { count: last30Count } = await supabase
    .from("inquiries")
    .select("id", { count: "exact", head: true })
    .eq("venue_id", venueId)
    .gte("received_at", last30Str);

  const avgWeeklyInquiries = ((last30Count ?? 0) / 4);

  const { count: thisWeekCount } = await supabase
    .from("inquiries")
    .select("id", { count: "exact", head: true })
    .eq("venue_id", venueId)
    .gte("received_at", last7Str);

  const weekCount = thisWeekCount ?? 0;

  if (avgWeeklyInquiries > 3 && weekCount < avgWeeklyInquiries * 0.4) {
    await createAnnotationFlag(venueId, {
      signal: "inquiry_volume",
      detected_value: weekCount,
      detected_threshold: Math.round(avgWeeklyInquiries * 0.4),
      period_start: last7Str,
      period_end: nowStr,
      message: `Inquiry volume was ${weekCount} this week vs your usual average of ${Math.round(avgWeeklyInquiries)}. Was there a reason (platform outage, you were closed, seasonality)?`,
    });
  }

  // Check 2: Unanswered inquiry cluster
  const { count: unansweredCount } = await supabase
    .from("inquiries")
    .select("id", { count: "exact", head: true })
    .eq("venue_id", venueId)
    .gte("received_at", last7Str)
    .is("response_sent_at", null);

  if ((unansweredCount ?? 0) >= 3) {
    await createAnnotationFlag(venueId, {
      signal: "inquiry_no_response",
      detected_value: unansweredCount ?? 0,
      detected_threshold: 3,
      period_start: last7Str,
      period_end: nowStr,
      message: `${unansweredCount} inquiries arrived in the last 7 days with no response logged. Platform issue or did these get missed?`,
    });
  }

  // Check 3: Review score deviation (new reviews below average)
  const { data: allReviews } = await supabase
    .from("clients")
    .select("review_star_rating, review_date")
    .eq("venue_id", venueId)
    .eq("review_left", true)
    .not("review_star_rating", "is", null);

  if (allReviews && allReviews.length >= 5) {
    const avg =
      allReviews.reduce((sum, r) => sum + Number(r.review_star_rating), 0) /
      allReviews.length;

    // Check reviews in last 30 days
    const recentReviews = allReviews.filter(
      (r) => r.review_date && new Date(r.review_date) >= last30Days
    );

    for (const review of recentReviews) {
      if (Number(review.review_star_rating) < avg - 0.8) {
        const reviewDate = format(new Date(review.review_date!), "yyyy-MM-dd");
        await createAnnotationFlag(venueId, {
          signal: "review_score_deviation",
          detected_value: Number(review.review_star_rating),
          detected_threshold: avg - 0.8,
          period_start: reviewDate,
          period_end: reviewDate,
          message: `A recent review scored ${review.review_star_rating} stars (your average: ${avg.toFixed(1)}). Add context if weather or external factors played a role — your adjusted score can still reflect your actual performance.`,
        });
      }
    }
  }

  // Check 4: Clients in planning with no activity in 21 days
  const { data: inactivePlanning } = await supabase
    .from("clients")
    .select("id, name_primary")
    .eq("venue_id", venueId)
    .eq("status", "planning");

  for (const client of inactivePlanning ?? []) {
    const { count: recentEvents } = await supabase
      .from("planning_events")
      .select("id", { count: "exact", head: true })
      .eq("client_id", client.id)
      .gte("created_at", format(subDays(now, 21), "yyyy-MM-dd"));

    if ((recentEvents ?? 0) === 0) {
      await createAnnotationFlag(venueId, {
        signal: "planning_drought",
        detected_value: 0,
        detected_threshold: 1,
        period_start: format(subDays(now, 21), "yyyy-MM-dd"),
        period_end: nowStr,
        message: `${client.name_primary} has been in planning status for 21+ days with no recorded activity. Worth a check-in?`,
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
    } catch (err) {
      console.error(`Anomaly detection failed for venue ${venue.id}:`, err);
    }
  }
}
