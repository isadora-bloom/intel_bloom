/**
 * Venue Onboarding Calibration
 * Runs once after a venue is created. Assigns NOAA station, Fed district,
 * Google Trends metro, runs competitor scan, and calculates initial Market Pulse.
 */

import { createClient } from "@supabase/supabase-js";
import stationList from "./noaa/station-list.json";
import { calculateMarketPulse } from "../pulse/calculator";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface Station {
  id: string;
  ghcnd_id: string;
  name: string;
  metro: string;
  state: string;
  lat?: number;
  lng?: number;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Station coordinates (approx) for nearest-station calculation
const STATION_COORDS: Record<string, { lat: number; lng: number }> = {
  KCJR: { lat: 38.72, lng: -77.86 },
  KIAD: { lat: 38.94, lng: -77.46 },
  KDCA: { lat: 38.85, lng: -77.04 },
  KATL: { lat: 33.64, lng: -84.43 },
  KLAX: { lat: 33.94, lng: -118.41 },
  KORD: { lat: 41.98, lng: -87.91 },
  KJFK: { lat: 40.64, lng: -73.78 },
  KDFW: { lat: 32.90, lng: -97.04 },
  KIAH: { lat: 29.99, lng: -95.34 },
  KPHX: { lat: 33.44, lng: -112.01 },
  KDEN: { lat: 39.86, lng: -104.67 },
  KSEA: { lat: 47.45, lng: -122.31 },
  KMCO: { lat: 28.43, lng: -81.31 },
  KBOS: { lat: 42.36, lng: -71.01 },
  KMIA: { lat: 25.80, lng: -80.29 },
  KRIC: { lat: 37.51, lng: -77.32 },
  KBNA: { lat: 36.12, lng: -86.68 },
  KBWI: { lat: 39.17, lng: -76.67 },
  KPHL: { lat: 39.87, lng: -75.24 },
  KJAX: { lat: 30.49, lng: -81.69 },
  KTPA: { lat: 27.97, lng: -82.53 },
  KCLT: { lat: 35.21, lng: -80.95 },
  KRDU: { lat: 35.88, lng: -78.79 },
  KSFO: { lat: 37.62, lng: -122.38 },
  KSLC: { lat: 40.79, lng: -111.98 },
};

// State → default ICAO station when no lat/lng available
const STATE_DEFAULT_STATION: Record<string, string> = {
  VA: "KIAD", MD: "KBWI", DC: "KDCA", WV: "KIAD",
  NC: "KRDU", SC: "KCLT", GA: "KATL", FL: "KMCO",
  TN: "KBNA", KY: "KCVG", OH: "KCMH", IN: "KIND",
  IL: "KORD", WI: "KMKE", MI: "KDTW", MN: "KMSP",
  PA: "KPHL", NJ: "KJFK", NY: "KJFK", CT: "KBOS",
  MA: "KBOS", RI: "KBOS", NH: "KBOS", VT: "KBOS", ME: "KBOS",
  DE: "KPHL", MO: "KSTL", AR: "KMSY", LA: "KMSY",
  MS: "KJAN", AL: "KBHM", TX: "KDFW", OK: "KOKC",
  KS: "KOKC", NE: "KOMA", IA: "KMSP", SD: "KMSP",
  ND: "KMSP", MT: "KSEA", WY: "KDEN", CO: "KDEN",
  NM: "KABQ", AZ: "KPHX", UT: "KSLC", NV: "KLAS",
  CA: "KLAX", OR: "KPDX", WA: "KSEA", ID: "KSEA",
  AK: "KSEA", HI: "KLAX",
};

export function findNearestNoaaStation(lat: number, lng: number): Station & { lat: number; lng: number } {
  let nearest = stationList[0] as any;
  let minDist = Infinity;

  for (const station of stationList) {
    const coords = STATION_COORDS[station.id];
    if (!coords) continue;

    const dist = haversineKm(lat, lng, coords.lat, coords.lng);
    if (dist < minDist) {
      minDist = dist;
      nearest = { ...station, lat: coords.lat, lng: coords.lng };
    }
  }

  return nearest;
}

export function findStationByState(state: string): Station {
  const icaoId = STATE_DEFAULT_STATION[state] ?? "KIAD";
  const station = stationList.find((s) => s.id === icaoId) ?? stationList[1]; // fallback to KIAD
  return station as Station;
}

export function getFedDistrict(state: string): number {
  const districtMap: Record<string, number> = {
    // 1st - Boston
    ME: 1, NH: 1, VT: 1, MA: 1, CT: 1, RI: 1,
    // 2nd - New York
    NY: 2, NJ: 2,
    // 3rd - Philadelphia
    PA: 3, DE: 3, MD: 3,
    // 4th - Cleveland
    OH: 4, KY: 4, WV: 4,
    // 5th - Richmond
    VA: 5, NC: 5, SC: 5, DC: 5,
    // 6th - Atlanta
    GA: 6, FL: 6, AL: 6, TN: 6, MS: 6, LA: 6,
    // 7th - Chicago
    IL: 7, IN: 7, MI: 7, WI: 7, IA: 7,
    // 8th - St. Louis
    MO: 8, AR: 8,
    // 9th - Minneapolis
    MN: 9, MT: 9, ND: 9, SD: 9,
    // 10th - Kansas City
    KS: 10, NE: 10, OK: 10, CO: 10, WY: 10, NM: 10,
    // 11th - Dallas
    TX: 11,
    // 12th - San Francisco
    CA: 12, AZ: 12, NV: 12, OR: 12, WA: 12, AK: 12, HI: 12, ID: 12, UT: 12,
  };
  return districtMap[state] ?? 5;
}

export function getGoogleTrendsMetro(lat: number, lng: number): string {
  if (lat > 37 && lat < 40 && lng > -79 && lng < -76) return "US-DC";
  if (lat > 40.5 && lat < 41.5 && lng > -74.5 && lng < -73) return "US-NY";
  if (lat > 33 && lat < 34.5 && lng > -85 && lng < -83) return "US-GA-524";
  if (lat > 33.5 && lat < 34.5 && lng > -119 && lng < -117) return "US-CA-803";
  if (lat > 41.5 && lat < 42.5 && lng > -88.5 && lng < -87) return "US-IL-602";
  if (lat > 29 && lat < 30.5 && lng > -96 && lng < -94) return "US-TX-618";
  if (lat > 32.5 && lat < 33.5 && lng > -97.5 && lng < -96) return "US-TX-623";
  if (lat > 36 && lat < 37 && lng > -87.5 && lng < -86) return "US-TN-659";
  if (lat > 35 && lat < 36 && lng > -79 && lng < -78) return "US-NC-560";
  return "US";
}

// State → rough Google Trends metro fallback
const STATE_TRENDS_METRO: Record<string, string> = {
  VA: "US-DC", MD: "US-DC", DC: "US-DC", WV: "US-DC",
  NY: "US-NY", NJ: "US-NY", CT: "US-NY",
  GA: "US-GA-524", FL: "US-FL",
  CA: "US-CA-803", TX: "US-TX-623",
  IL: "US-IL-602", TN: "US-TN-659",
  NC: "US-NC-560", SC: "US-NC-560",
  PA: "US-PA", OH: "US-OH", MA: "US-MA",
};

async function scanCompetitorLandscape(venueId: string) {
  const { data: venue } = await supabase
    .from("venues")
    .select("lat, lng, competitor_radius_miles, google_place_id")
    .eq("id", venueId)
    .single();

  if (!venue?.lat || !venue?.lng || !process.env.GOOGLE_PLACES_API_KEY) {
    console.log(`  Skipping competitor scan (no coordinates or Places API key)`);
    return;
  }

  const radiusMeters = (venue.competitor_radius_miles ?? 30) * 1609;
  const url =
    `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
    `?location=${venue.lat},${venue.lng}` +
    `&radius=${radiusMeters}` +
    `&keyword=wedding+venue` +
    `&key=${process.env.GOOGLE_PLACES_API_KEY}`;

  const response = await fetch(url);
  if (!response.ok) return;

  const { results } = await response.json();

  for (const place of results ?? []) {
    if (place.place_id === venue.google_place_id) continue;

    const distanceMiles = haversineKm(
      Number(venue.lat),
      Number(venue.lng),
      place.geometry.location.lat,
      place.geometry.location.lng
    ) * 0.621;

    await supabase.from("macro_competitor_landscape").insert({
      venue_id: venueId,
      scanned_at: new Date().toISOString(),
      competitor_name: place.name,
      competitor_place_id: place.place_id,
      distance_miles: Math.round(distanceMiles * 10) / 10,
      google_rating: place.rating ?? null,
      review_count: place.user_ratings_total ?? null,
      raw_data: { vicinity: place.vicinity, types: place.types },
    });
  }

  console.log(`  Competitor scan: found ${results?.length ?? 0} nearby venues`);
}

export async function onboardVenue(venueId: string) {
  console.log(`\nOnboarding venue ${venueId}...`);

  const { data: venue } = await supabase
    .from("venues")
    .select("lat, lng, state")
    .eq("id", venueId)
    .single();

  const lat = venue?.lat ? Number(venue.lat) : null;
  const lng = venue?.lng ? Number(venue.lng) : null;
  const state = venue?.state ?? "";

  // 1. Find nearest NOAA station — use lat/lng if available, else state fallback
  let station: Station;
  if (lat !== null && lng !== null) {
    station = findNearestNoaaStation(lat, lng);
    console.log(`  NOAA station (by coords): ${station.id} → ${station.ghcnd_id} (${station.name})`);
  } else {
    station = findStationByState(state);
    console.log(`  NOAA station (state fallback for ${state}): ${station.id} → ${station.ghcnd_id} (${station.name})`);
  }
  // Store the GHCND ID — this is what the ingestion and queries use
  await supabase
    .from("venues")
    .update({ noaa_station_id: station.ghcnd_id, noaa_station_name: station.name })
    .eq("id", venueId);

  // 2. Assign Fed district (only needs state — always works)
  const district = getFedDistrict(state);
  console.log(`  Fed district: ${district}`);
  await supabase.from("venues").update({ fed_district: district }).eq("id", venueId);

  // 3. Assign Google Trends metro
  let metro: string;
  if (lat !== null && lng !== null) {
    metro = getGoogleTrendsMetro(lat, lng);
  } else {
    metro = STATE_TRENDS_METRO[state] ?? "US";
  }
  console.log(`  Google Trends metro: ${metro}`);
  await supabase.from("venues").update({ google_trends_metro: metro }).eq("id", venueId);

  // 4. Competitor scan (needs lat/lng + Google Places key — skips gracefully if missing)
  await scanCompetitorLandscape(venueId);

  // 5. Initial Market Pulse
  await calculateMarketPulse(venueId);

  // 6. Mark onboarding complete
  await supabase
    .from("venues")
    .update({ onboarding_complete: true })
    .eq("id", venueId);

  console.log(`Onboarding complete for venue ${venueId}`);
}
