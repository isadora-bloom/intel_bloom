/**
 * Reset Rixey Manor venue data for clean re-onboarding.
 * Run with: node scripts/reset-venue.mjs
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://awawmtvynhwrahrekiso.supabase.co";
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3YXdtdHZ5bmh3cmFocmVraXNvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzY4OTIzNywiZXhwIjoyMDg5MjY1MjM3fQ.-LfGQ-K4gM0uU79M-Hl2lNGp2bT9NSzpGU0N5RSnL20";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function run() {
  // Find venue
  const { data: venue, error: venueErr } = await supabase
    .from("venues")
    .select("id, name, noaa_station_id")
    .ilike("name", "%rixey%")
    .single();

  if (venueErr || !venue) {
    console.error("Could not find Rixey Manor venue:", venueErr?.message);
    process.exit(1);
  }

  const v = venue.id;
  const station = venue.noaa_station_id?.replace(/^ghcnd:/i, "") ?? null;
  console.log(`Found venue: ${venue.name} (${v})`);
  console.log(`Station: ${station ?? "none"}`);

  const tables = [
    "client_source_touchpoints",
    "tours",
    "clients",
    "inquiries",
    "leads",
    "annotations",
    "matching_queue",
    "macro_competitor_landscape",
    "market_pulse",
    "website_traffic",
    "email_extractions",
    "uploads",
  ];

  for (const table of tables) {
    const { error, count } = await supabase
      .from(table)
      .delete({ count: "exact" })
      .eq("venue_id", v);

    if (error) {
      console.warn(`  ${table}: skipped (${error.message})`);
    } else {
      console.log(`  ${table}: deleted ${count ?? "?"} rows`);
    }
  }

  // Wipe weather data for this station
  if (station) {
    const { error, count } = await supabase
      .from("weather_monthly")
      .delete({ count: "exact" })
      .eq("noaa_station_id", station);
    if (error) {
      console.warn(`  weather_monthly: ${error.message}`);
    } else {
      console.log(`  weather_monthly: deleted ${count ?? "?"} rows for station ${station}`);
    }
  }

  // Reset venue calibration fields
  const { error: updateErr } = await supabase
    .from("venues")
    .update({
      noaa_station_id:     null,
      noaa_station_name:   null,
      fed_district:        null,
      google_trends_metro: null,
      google_place_id:     null,
      knot_venue_id:       null,
      lat:                 null,
      lng:                 null,
      onboarding_complete: false,
    })
    .eq("id", v);

  if (updateErr) {
    console.error("Failed to reset venue record:", updateErr.message);
  } else {
    console.log(`\nVenue record reset. Rixey Manor is ready for fresh onboarding.`);
  }
}

run();
