/**
 * Post-Wedding Sequence Scheduler
 *
 * Checks all completed clients and determines which sequence emails are due.
 * For each due step, it:
 *   1. Creates a planning_event (type: post_wedding_sequence_due) so the
 *      dashboard can surface it for the coordinator
 *   2. Stamps the timestamp on the client record so it doesn't re-trigger
 *
 * Run this on a daily cron. It is idempotent — already-stamped steps are skipped.
 *
 * Sequence:
 *   Day  2  — Warmth email ("we're still smiling")
 *   Day 14  — First review request
 *   Day 30  — Second review nudge (only if no review submitted yet)
 *   Day 90  — Photo request
 *   Day 365 — Year 1 anniversary message
 *
 * To trigger: call runPostWeddingSequence(venueId) from a Supabase Edge Function
 * or Railway cron job.
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface SequenceStep {
  daysAfterWedding: number;
  field: string;                 // column name on clients table
  eventType: string;             // planning_event type
  label: string;                 // human-readable label
  skipIfReviewSubmitted?: boolean; // day 30 nudge: skip if already reviewed
}

const SEQUENCE_STEPS: SequenceStep[] = [
  {
    daysAfterWedding: 2,
    field: "post_wedding_day2_sent",
    eventType: "post_wedding_warmth",
    label: "Day 2 — Warmth email",
  },
  {
    daysAfterWedding: 14,
    field: "post_wedding_day14_sent",
    eventType: "post_wedding_review_request",
    label: "Day 14 — First review request",
  },
  {
    daysAfterWedding: 30,
    field: "post_wedding_day30_sent",
    eventType: "post_wedding_review_nudge",
    label: "Day 30 — Review nudge",
    skipIfReviewSubmitted: true,
  },
  {
    daysAfterWedding: 90,
    field: "post_wedding_day90_sent",
    eventType: "post_wedding_photo_request",
    label: "Day 90 — Photo request",
  },
  {
    daysAfterWedding: 365,
    field: "post_wedding_anniversary_sent",
    eventType: "post_wedding_anniversary",
    label: "Year 1 — Anniversary message",
  },
];

export async function runPostWeddingSequence(venueId: string): Promise<{
  clientsChecked: number;
  stepsTriggered: number;
}> {
  const now = new Date();

  // Fetch all clients with a confirmed past event date.
  // We look back up to 2 years — anything older is out of scope.
  const twoYearsAgo = new Date(now);
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

  const { data: clients, error } = await supabase
    .from("clients")
    .select(`
      id,
      event_date,
      review_submitted,
      post_wedding_day2_sent,
      post_wedding_day14_sent,
      post_wedding_day30_sent,
      post_wedding_day90_sent,
      post_wedding_anniversary_sent
    `)
    .eq("venue_id", venueId)
    .not("event_date", "is", null)
    .lte("event_date", now.toISOString().split("T")[0])
    .gte("event_date", twoYearsAgo.toISOString().split("T")[0]);

  if (error) {
    console.error(`post-wedding-sequence: failed to fetch clients for ${venueId}:`, error.message);
    return { clientsChecked: 0, stepsTriggered: 0 };
  }

  let stepsTriggered = 0;

  for (const client of clients ?? []) {
    const eventDate = new Date(client.event_date as string);
    const daysSinceWedding = Math.floor(
      (now.getTime() - eventDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    for (const step of SEQUENCE_STEPS) {
      // Not due yet
      if (daysSinceWedding < step.daysAfterWedding) continue;

      // Already sent
      const alreadySent = client[step.field as keyof typeof client];
      if (alreadySent) continue;

      // Skip day-30 nudge if they already reviewed
      if (step.skipIfReviewSubmitted && client.review_submitted) continue;

      // Mark the step as sent
      const { error: updateError } = await supabase
        .from("clients")
        .update({ [step.field]: now.toISOString() })
        .eq("id", client.id)
        .eq("venue_id", venueId);

      if (updateError) {
        console.error(`post-wedding-sequence: failed to stamp ${step.field} on ${client.id}:`, updateError.message);
        continue;
      }

      // Create a planning_event so the dashboard can surface this
      await supabase.from("planning_events").insert({
        venue_id: venueId,
        client_id: client.id,
        event_type: step.eventType,
        event_date: now.toISOString(),
        metadata: {
          label: step.label,
          days_since_wedding: daysSinceWedding,
          scheduled_day: step.daysAfterWedding,
        },
        source: "post_wedding_sequence",
      });

      stepsTriggered++;
    }
  }

  console.log(
    `post-wedding-sequence [${venueId}]: checked ${clients?.length ?? 0} clients, triggered ${stepsTriggered} steps`
  );

  return { clientsChecked: clients?.length ?? 0, stepsTriggered };
}

/**
 * Run for all venues. Call this from a daily cron.
 */
export async function runPostWeddingSequenceAllVenues(): Promise<void> {
  const { data: venues, error } = await supabase
    .from("venues")
    .select("id, name")
    .eq("onboarding_complete", true);

  if (error) {
    console.error("post-wedding-sequence: failed to fetch venues:", error.message);
    return;
  }

  for (const venue of venues ?? []) {
    const result = await runPostWeddingSequence(venue.id);
    if (result.stepsTriggered > 0) {
      console.log(`  ${venue.name}: ${result.stepsTriggered} steps triggered`);
    }
  }
}
