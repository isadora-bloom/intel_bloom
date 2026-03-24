/**
 * POST /api/admin/backfill-client-weather
 * Backfills weather_difficulty_score and review_adjusted_score for all clients
 * that have an event_date but no weather score yet.
 * Uses the venue's noaa_station_id and the weather_monthly table.
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function calculateAdjustedScore(rawScore: number, difficultyScore: number): number {
  const adjustment = difficultyScore * 0.04;
  return Math.min(5.0, Math.round((rawScore + adjustment) * 10) / 10);
}

export async function POST() {
  const cookieStore = await cookies();
  const userSupabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );

  const { data: { user } } = await userSupabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: venueUser } = await adminSupabase
    .from("venue_users")
    .select("venue_id")
    .eq("user_id", user.id)
    .single();

  if (!venueUser) {
    return NextResponse.json({ error: "No venue found" }, { status: 404 });
  }

  const venueId = venueUser.venue_id;

  const { data: venue } = await adminSupabase
    .from("venues")
    .select("noaa_station_id")
    .eq("id", venueId)
    .single();

  if (!venue?.noaa_station_id) {
    return NextResponse.json(
      { error: "No NOAA station configured. Set one in Settings → Intelligence Calibration." },
      { status: 400 }
    );
  }

  const stationId = venue.noaa_station_id.replace(/^GHCND:/i, "");

  // Fetch all clients with an event_date (skip those already scored)
  const { data: clients, error: clientsError } = await adminSupabase
    .from("clients")
    .select("id, event_date, review_star_rating, weather_difficulty_score")
    .eq("venue_id", venueId)
    .not("event_date", "is", null);

  if (clientsError) {
    return NextResponse.json({ error: clientsError.message }, { status: 500 });
  }

  let backfilled = 0;
  let skipped = 0;

  for (const client of clients ?? []) {
    const eventDate = new Date(client.event_date as string);
    if (isNaN(eventDate.getTime())) { skipped++; continue; }

    const { data: weather } = await adminSupabase
      .from("weather_monthly")
      .select("weather_score")
      .eq("noaa_station_id", stationId)
      .eq("year", eventDate.getFullYear())
      .eq("month", eventDate.getMonth() + 1)
      .single();

    if (!weather) { skipped++; continue; }

    const adjustedScore =
      client.review_star_rating && weather.weather_score
        ? calculateAdjustedScore(Number(client.review_star_rating), weather.weather_score)
        : null;

    await adminSupabase
      .from("clients")
      .update({
        weather_difficulty_score: weather.weather_score,
        review_adjusted_score: adjustedScore,
      })
      .eq("id", client.id);

    backfilled++;
  }

  return NextResponse.json({ ok: true, backfilled, skipped });
}
