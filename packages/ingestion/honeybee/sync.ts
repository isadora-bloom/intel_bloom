/**
 * HoneyBook Sync
 * Syncs projects, contacts, and payments from HoneyBook API.
 * Deduplicates by honeybook_project_id for stable matching.
 */

import { createClient } from "@supabase/supabase-js";

const HB_BASE = "https://api.honeybook.com/api/v1";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapHbStatus(hbStatus: string): string {
  const map: Record<string, string> = {
    lead: "inquiry",
    inquiry: "inquiry",
    active: "booked",
    planning: "planning",
    completed: "event_complete",
    archived: "archived",
    cancelled: "archived",
  };
  return map[hbStatus?.toLowerCase()] ?? "inquiry";
}

async function hbRequest(path: string, token: string) {
  const response = await fetch(`${HB_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`HoneyBook API error ${response.status}: ${path}`);
  }

  return response.json();
}

async function upsertClientFromHoneyBook(venueId: string, project: any) {
  const projectId = project.id as string | null;

  // Primary contact
  const namePrimary: string = project.contact?.name ?? project.name ?? "Unknown";
  const namePartner: string | null = project.secondary_contact?.name ?? null;

  // Determine self-reported source from HB referral / lead_source fields
  const selfReportedSource: string | null =
    project.lead_source ?? project.referral_source ?? project.referral?.name ?? null;

  const clientData: Record<string, unknown> = {
    venue_id: venueId,
    name_primary: namePrimary,
    name_partner: namePartner,
    email_primary: project.contact?.email ?? null,
    email_partner: project.secondary_contact?.email ?? null,
    phone_primary: project.contact?.phone ?? null,
    event_date: project.event_date ?? null,
    package: project.service?.name ?? null,
    // HB stores total contract value; use amount_due if available, else amount_paid
    revenue_cents: project.amount_due
      ? Math.round(project.amount_due * 100)
      : project.amount_paid
      ? Math.round(project.amount_paid * 100)
      : null,
    guest_count_initial: project.guest_count ?? project.guests ?? null,
    status: mapHbStatus(project.status),
    self_reported_source: selfReportedSource,
    inquiry_date: project.created_at ?? null,
    honeybook_project_id: projectId,
  };

  if (projectId) {
    // Stable dedup by HB project ID
    const { data: existing } = await supabase
      .from("clients")
      .select("id")
      .eq("venue_id", venueId)
      .eq("honeybook_project_id", projectId)
      .limit(1)
      .single();

    if (existing) {
      await supabase.from("clients").update(clientData).eq("id", existing.id);
      return;
    }
  } else {
    // Fallback: dedup by email, then name
    const emailPrimary = project.contact?.email;
    if (emailPrimary) {
      const { data: existing } = await supabase
        .from("clients")
        .select("id")
        .eq("venue_id", venueId)
        .eq("email_primary", emailPrimary)
        .limit(1)
        .single();
      if (existing) {
        await supabase.from("clients").update(clientData).eq("id", existing.id);
        return;
      }
    } else {
      const { data: existing } = await supabase
        .from("clients")
        .select("id")
        .eq("venue_id", venueId)
        .eq("name_primary", namePrimary)
        .limit(1)
        .single();
      if (existing) {
        await supabase.from("clients").update(clientData).eq("id", existing.id);
        return;
      }
    }
  }

  await supabase.from("clients").insert(clientData);
}

export async function syncHoneyBook(venueId: string, apiKey: string) {
  console.log(`Syncing HoneyBook for venue ${venueId}...`);

  let page = 1;
  let synced = 0;

  while (true) {
    const { projects, meta } = await hbRequest(
      `/projects?page=${page}&per_page=50`,
      apiKey
    );

    for (const project of projects ?? []) {
      await upsertClientFromHoneyBook(venueId, project);
      synced++;
    }

    console.log(`  Page ${page}/${meta?.total_pages ?? "?"}: ${synced} projects synced`);

    if (!meta || page >= meta.total_pages) break;
    page++;

    await sleep(500);
  }

  // Backfill weather scores for events that have an event_date
  await backfillEventWeather(venueId);

  console.log(`HoneyBook sync complete: ${synced} projects`);
  return { synced };
}

async function backfillEventWeather(venueId: string) {
  const { data: venue } = await supabase
    .from("venues")
    .select("noaa_station_id")
    .eq("id", venueId)
    .single();

  if (!venue?.noaa_station_id) return;

  const stationId = venue.noaa_station_id.replace(/^GHCND:/i, "");

  const { data: clients } = await supabase
    .from("clients")
    .select("id, event_date, review_star_rating")
    .eq("venue_id", venueId)
    .not("event_date", "is", null);

  let backfilled = 0;

  for (const client of clients ?? []) {
    const eventDate = new Date(client.event_date as string);
    const { data: weather } = await supabase
      .from("weather_monthly")
      .select("weather_score")
      .eq("noaa_station_id", stationId)
      .eq("year", eventDate.getFullYear())
      .eq("month", eventDate.getMonth() + 1)
      .single();

    if (weather) {
      const adjustedScore =
        client.review_star_rating && weather.weather_score
          ? calculateAdjustedScore(Number(client.review_star_rating), weather.weather_score)
          : null;

      await supabase
        .from("clients")
        .update({
          weather_difficulty_score: weather.weather_score,
          review_adjusted_score: adjustedScore,
        })
        .eq("id", client.id);

      backfilled++;
    }
  }

  console.log(`  Backfilled weather for ${backfilled} events`);
}

function calculateAdjustedScore(rawScore: number, difficultyScore: number): number {
  const adjustment = difficultyScore * 0.04;
  return Math.min(5.0, Math.round((rawScore + adjustment) * 10) / 10);
}
