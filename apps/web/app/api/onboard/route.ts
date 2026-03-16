import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { venueId } = await request.json();
  if (!venueId) {
    return NextResponse.json({ error: "venueId required" }, { status: 400 });
  }

  // Verify user owns this venue
  const { data: venueUser } = await supabase
    .from("venue_users")
    .select("role")
    .eq("venue_id", venueId)
    .eq("user_id", user.id)
    .single();

  if (!venueUser || venueUser.role !== "owner") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Geocode the address to get lat/lng
  const { data: venue } = await supabase
    .from("venues")
    .select("address_line1, city, state, zip")
    .eq("id", venueId)
    .single();

  if (venue) {
    const address = encodeURIComponent(
      `${venue.address_line1}, ${venue.city}, ${venue.state} ${venue.zip}`
    );

    if (process.env.GOOGLE_PLACES_API_KEY) {
      const geocodeUrl =
        `https://maps.googleapis.com/maps/api/geocode/json` +
        `?address=${address}&key=${process.env.GOOGLE_PLACES_API_KEY}`;

      const geocodeResp = await fetch(geocodeUrl);
      if (geocodeResp.ok) {
        const geocodeData = await geocodeResp.json();
        const location = geocodeData.results?.[0]?.geometry?.location;

        if (location) {
          await supabase
            .from("venues")
            .update({ lat: location.lat, lng: location.lng })
            .eq("id", venueId);
        }
      }
    }
  }

  // Trigger onboarding asynchronously
  // In production this would go to a Bull queue
  // For now, respond immediately and run in background
  onboardVenueAsync(venueId);

  return NextResponse.json({ success: true, message: "Onboarding started" });
}

async function onboardVenueAsync(venueId: string) {
  try {
    // Dynamic import to avoid bundling heavy packages into edge
    const { onboardVenue } = await import("@bloom/ingestion/onboard-venue");
    await onboardVenue(venueId);
  } catch (err) {
    console.error("Onboarding failed for venue", venueId, err);

    // Mark onboarding complete anyway so user isn't stuck
    const { createServiceClient } = await import("@/lib/supabase/server");
    const serviceSupabase = createServiceClient();
    await serviceSupabase
      .from("venues")
      .update({ onboarding_complete: true })
      .eq("id", venueId);
  }
}
