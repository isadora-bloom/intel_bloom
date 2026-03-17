/**
 * Seed script: Rixey Manor
 * Creates user, venue, and seeds real historical data.
 *
 * Run: node scripts/seed-rixey.mjs
 */

const SUPABASE_URL = "https://awawmtvynhwrahrekiso.supabase.co";
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3YXdtdHZ5bmh3cmFocmVraXNvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzY4OTIzNywiZXhwIjoyMDg5MjY1MjM3fQ.-LfGQ-K4gM0uU79M-Hl2lNGp2bT9NSzpGU0N5RSnL20";

const headers = {
  "Content-Type": "application/json",
  "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
  "apikey": SERVICE_ROLE_KEY,
};

async function rest(method, path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: { ...headers, "Prefer": "return=representation" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${method} ${path} → ${res.status}: ${err}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function adminPost(path, body) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Admin ${path}: ${JSON.stringify(data)}`);
  return data;
}

// ── 1. Create user ──────────────────────────────────────────────────────────
console.log("Creating user isadora@rixeymanor.com...");
let userId;
try {
  const user = await adminPost("/users", {
    email: "isadora@rixeymanor.com",
    password: "rixeymanor",
    email_confirm: true,
  });
  userId = user.id;
  console.log(`  ✓ User created: ${userId}`);
} catch (e) {
  if (e.message.includes("already been registered")) {
    console.log("  User already exists, fetching...");
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?email=isadora@rixeymanor.com`, { headers });
    const data = await res.json();
    userId = data.users?.[0]?.id;
    console.log(`  ✓ Existing user: ${userId}`);
  } else throw e;
}

// ── 2. Create venue ──────────────────────────────────────────────────────────
console.log("\nCreating Rixey Manor venue...");
let venueId;
try {
  const [venue] = await rest("POST", "/venues", {
    name: "Rixey Manor",
    slug: "rixey-manor",
    address_line1: "11419 Rixeyville Rd",
    city: "Rixeyville",
    state: "VA",
    zip: "22737",
    lat: 38.5873,
    lng: -77.9919,
    noaa_station_id: "KCJR",
    noaa_station_name: "Culpeper Regional Airport",
    fed_district: 5,
    google_trends_metro: "US-DC",
    competitor_radius_miles: 35,
    plan: "founder",
    monthly_price_cents: 0,
    timezone: "America/New_York",
    onboarding_complete: true,
    contributes_to_benchmark: true,
  });
  venueId = venue.id;
  console.log(`  ✓ Venue created: ${venueId}`);
} catch (e) {
  if (e.message.includes("23505")) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/venues?slug=eq.rixey-manor&select=id`, { headers });
    const [venue] = await res.json();
    venueId = venue.id;
    console.log(`  Venue already exists: ${venueId}`);
  } else throw e;
}

// ── 3. Link user to venue ───────────────────────────────────────────────────
console.log("\nLinking user to venue...");
try {
  await rest("POST", "/venue_users", { venue_id: venueId, user_id: userId, role: "owner" });
  console.log("  ✓ venue_users linked");
} catch (e) {
  if (e.message.includes("23505")) console.log("  venue_users already linked");
  else throw e;
}

// ── 4. Seed vendors ─────────────────────────────────────────────────────────
console.log("\nSeeding vendors...");
const vendors = [
  { name: "Sweetgrass Social", category: "photography", appearances_count: 18 },
  { name: "Compass Floral", category: "florals", appearances_count: 24 },
  { name: "Hunter & Company", category: "photography", appearances_count: 12 },
  { name: "Feast & Fettle", category: "catering", appearances_count: 31 },
  { name: "Wild Folk Studio", category: "photography", appearances_count: 9 },
  { name: "Capital Disc Jockey", category: "dj", appearances_count: 15 },
  { name: "Harmony Road Band", category: "live_music", appearances_count: 8 },
  { name: "Bloom Cakes", category: "cake", appearances_count: 22 },
  { name: "Elysian Events", category: "coordination", appearances_count: 7 },
  { name: "Ridgeline Rentals", category: "rentals", appearances_count: 19 },
];
let insertedVendors;
try {
  insertedVendors = await rest("POST", "/vendors", vendors.map(v => ({ ...v, venue_id: venueId })));
  console.log(`  ✓ ${insertedVendors.length} vendors created`);
} catch (e) {
  if (e.message.includes("23505")) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/vendors?venue_id=eq.${venueId}&select=id,name`, { headers });
    insertedVendors = await res.json();
    console.log(`  Vendors already exist: ${insertedVendors.length}`);
  } else throw e;
}
const vendorMap = {};
insertedVendors.forEach(v => { vendorMap[v.name] = v.id; });

// ── 5. Seed clients ──────────────────────────────────────────────────────────
console.log("\nSeeding clients...");
const clients = [
  // 2023 — completed events
  {
    name_primary: "Sophie Harrington", name_partner: "James Aldridge",
    email_primary: "sophie.harrington@gmail.com", phone_primary: "540-291-4412",
    event_date: "2023-05-13", event_date_confirmed: true,
    package: "Full Weekend", guest_count_initial: 140, guest_count_final: 138,
    revenue_cents: 4830000, status: "event_complete",
    first_touch_platform: "the_knot", resolved_source: "the_knot", resolved_source_confidence: 85,
    self_reported_source: "The Knot", competing_venues: ["Pippin Hill Farm", "King Family Vineyards"],
    complexity_score: 62, staffing_hours_actual: 24, day_of_complexity: 3,
    review_left: true, review_platform: "google", review_star_rating: 5.0,
    review_date: "2023-05-29",
    review_text: "Rixey Manor was the most magical place we could have imagined for our wedding. Isadora and her team thought of everything.",
    review_sentiment: "positive", referrals_generated: 2,
  },
  {
    name_primary: "Claire Donovan", name_partner: "Marcus Webb",
    email_primary: "claire.donovan@outlook.com", phone_primary: "703-882-1930",
    event_date: "2023-06-03", event_date_confirmed: true,
    package: "Full Weekend", guest_count_initial: 95, guest_count_final: 92,
    revenue_cents: 3220000, status: "event_complete",
    first_touch_platform: "instagram", resolved_source: "instagram", resolved_source_confidence: 90,
    self_reported_source: "Instagram", competing_venues: ["Morais Vineyards"],
    complexity_score: 48, staffing_hours_actual: 20, day_of_complexity: 2,
    review_left: true, review_platform: "the_knot", review_star_rating: 5.0,
    review_date: "2023-06-18",
    review_text: "Intimate, beautiful, and run by people who genuinely care. We felt like family.",
    review_sentiment: "positive", referrals_generated: 1,
  },
  {
    name_primary: "Amelia Chen", name_partner: "Tobias Park",
    email_primary: "ameliapark2023@gmail.com", phone_primary: "571-440-2291",
    event_date: "2023-09-16", event_date_confirmed: true,
    package: "Full Weekend", guest_count_initial: 180, guest_count_final: 176,
    revenue_cents: 6160000, status: "event_complete",
    first_touch_platform: "referral", resolved_source: "referral",
    referrer_name: "Sophie Harrington", resolved_source_confidence: 95,
    self_reported_source: "Friend (Sophie Harrington)", competing_venues: [],
    complexity_score: 78, staffing_hours_actual: 28, day_of_complexity: 4,
    review_left: true, review_platform: "google", review_star_rating: 5.0,
    review_date: "2023-10-01",
    review_text: "Every detail was perfect. The property is stunning and the team is exceptional.",
    review_sentiment: "positive", referrals_generated: 3,
  },
  {
    name_primary: "Rachel Ostrowski", name_partner: "Ben Ostrowski",
    email_primary: "rostrowski@gmail.com", phone_primary: "202-553-0881",
    event_date: "2023-10-07", event_date_confirmed: true,
    package: "Full Weekend", guest_count_initial: 120, guest_count_final: 118,
    revenue_cents: 4130000, status: "event_complete",
    first_touch_platform: "the_knot", resolved_source: "the_knot", resolved_source_confidence: 80,
    self_reported_source: "The Knot", competing_venues: ["Goodstone Inn"],
    complexity_score: 55, staffing_hours_actual: 22, day_of_complexity: 2,
    review_left: true, review_platform: "google", review_star_rating: 4.0,
    review_date: "2023-10-22",
    review_text: "Beautiful venue. Some minor coordination hiccups but overall a wonderful experience.",
    review_sentiment: "mostly_positive", referrals_generated: 0,
  },
  // 2024
  {
    name_primary: "Natalie Flores", name_partner: "Diego Reyes",
    email_primary: "natalie.flores@gmail.com", phone_primary: "571-923-4402",
    event_date: "2024-04-27", event_date_confirmed: true,
    package: "Full Weekend", guest_count_initial: 160, guest_count_final: 158,
    revenue_cents: 5530000, status: "event_complete",
    first_touch_platform: "wedding_wire", resolved_source: "wedding_wire", resolved_source_confidence: 88,
    self_reported_source: "WeddingWire", competing_venues: ["Inn at Vaucluse Spring", "Keswick Hall"],
    complexity_score: 71, staffing_hours_actual: 26, day_of_complexity: 3,
    review_left: true, review_platform: "google", review_star_rating: 5.0,
    review_date: "2024-05-09",
    review_text: "Simply breathtaking. Worth every penny and then some.",
    review_sentiment: "positive", referrals_generated: 2,
  },
  {
    name_primary: "Grace Kimball", name_partner: "Ethan Kimball",
    email_primary: "gracekimball22@icloud.com", phone_primary: "703-210-5540",
    event_date: "2024-06-15", event_date_confirmed: true,
    package: "Full Weekend", guest_count_initial: 110, guest_count_final: 108,
    revenue_cents: 3780000, status: "event_complete",
    first_touch_platform: "referral", resolved_source: "referral",
    referrer_name: "Amelia Chen", resolved_source_confidence: 95,
    self_reported_source: "Friend (Amelia Chen)", competing_venues: [],
    complexity_score: 52, staffing_hours_actual: 21, day_of_complexity: 2,
    review_left: true, review_platform: "google", review_star_rating: 5.0,
    review_date: "2024-06-28",
    review_text: "Our day was flawless. The grounds are magical in June.",
    review_sentiment: "positive", referrals_generated: 1,
  },
  {
    name_primary: "Maya Johnson", name_partner: "Caleb Washington",
    email_primary: "maya.johnson.dc@gmail.com", phone_primary: "202-881-0023",
    event_date: "2024-09-28", event_date_confirmed: true,
    package: "Full Weekend", guest_count_initial: 200, guest_count_final: 194,
    revenue_cents: 6790000, status: "event_complete",
    first_touch_platform: "the_knot", resolved_source: "the_knot", resolved_source_confidence: 82,
    self_reported_source: "The Knot", competing_venues: ["Salamander Resort", "Childress Vineyards"],
    complexity_score: 84, staffing_hours_actual: 30, day_of_complexity: 5,
    review_left: true, review_platform: "google", review_star_rating: 5.0,
    review_date: "2024-10-15",
    review_text: "Two hundred guests, flawless execution. Rixey Manor handled everything with grace.",
    review_sentiment: "positive", referrals_generated: 4,
  },
  {
    name_primary: "Leah Steinberg", name_partner: "Noah Steinberg",
    email_primary: "leah.steinberg@gmail.com", phone_primary: "301-440-2200",
    event_date: "2024-10-19", event_date_confirmed: true,
    package: "Full Weekend", guest_count_initial: 85, guest_count_final: 82,
    revenue_cents: 2870000, status: "event_complete",
    first_touch_platform: "instagram", resolved_source: "instagram", resolved_source_confidence: 91,
    self_reported_source: "Instagram", competing_venues: ["Shenandoah Woods"],
    complexity_score: 44, staffing_hours_actual: 19, day_of_complexity: 2,
    review_left: true, review_platform: "google", review_star_rating: 5.0,
    review_date: "2024-11-01",
    review_text: "Fall foliage, perfect temperature, incredible team. We are so grateful.",
    review_sentiment: "positive", referrals_generated: 1,
  },
  // 2025 — completed
  {
    name_primary: "Priya Sharma", name_partner: "Aidan Murphy",
    email_primary: "priya.sharma.wedding@gmail.com", phone_primary: "703-920-4412",
    event_date: "2025-05-10", event_date_confirmed: true,
    package: "Full Weekend", guest_count_initial: 150, guest_count_final: 147,
    revenue_cents: 5145000, status: "event_complete",
    first_touch_platform: "referral", resolved_source: "referral",
    referrer_name: "Grace Kimball", resolved_source_confidence: 95,
    competing_venues: [], complexity_score: 68, staffing_hours_actual: 25, day_of_complexity: 3,
    review_left: true, review_platform: "google", review_star_rating: 5.0,
    review_date: "2025-05-24",
    review_text: "The most beautiful day of my life and Rixey made it happen.",
    review_sentiment: "positive", referrals_generated: 2,
  },
  {
    name_primary: "Olivia Hartmann", name_partner: "Felix Hartmann",
    email_primary: "olivia.hartmann@gmail.com", phone_primary: "540-882-3311",
    event_date: "2025-09-20", event_date_confirmed: true,
    package: "Full Weekend", guest_count_initial: 130, guest_count_final: 128,
    revenue_cents: 4480000, status: "event_complete",
    first_touch_platform: "the_knot", resolved_source: "the_knot", resolved_source_confidence: 79,
    competing_venues: ["Clifton Inn"], complexity_score: 60, staffing_hours_actual: 23, day_of_complexity: 3,
    review_left: false, referrals_generated: 0,
  },
  // 2026 — upcoming / in planning
  {
    name_primary: "Zoe Whitfield", name_partner: "Liam Whitfield",
    email_primary: "zoe.whitfield26@gmail.com", phone_primary: "571-234-9910",
    event_date: "2026-05-23", event_date_confirmed: true,
    package: "Full Weekend", guest_count_initial: 125,
    revenue_cents: null, status: "planning",
    first_touch_platform: "the_knot", resolved_source: "the_knot", resolved_source_confidence: 83,
    competing_venues: [], complexity_score: 58,
  },
  {
    name_primary: "Hannah Petrov", name_partner: "Mikhail Petrov",
    email_primary: "hannah.petrov@gmail.com", phone_primary: "202-774-3320",
    event_date: "2026-06-06", event_date_confirmed: true,
    package: "Full Weekend", guest_count_initial: 170,
    revenue_cents: null, status: "planning",
    first_touch_platform: "referral", resolved_source: "referral",
    referrer_name: "Maya Johnson", resolved_source_confidence: 95,
    competing_venues: [], complexity_score: 72,
  },
  {
    name_primary: "Isabelle Laurent", name_partner: "Thomas Laurent",
    email_primary: "isabelle.laurent.dc@gmail.com", phone_primary: "703-551-8820",
    event_date: "2026-09-12", event_date_confirmed: true,
    package: "Full Weekend", guest_count_initial: 145,
    revenue_cents: null, status: "booked",
    first_touch_platform: "instagram", resolved_source: "instagram", resolved_source_confidence: 88,
    competing_venues: ["Pippin Hill Farm"],
  },
  {
    name_primary: "Sara Mitchell", name_partner: "Chris Mitchell",
    email_primary: "sara.mitchell.wedding@icloud.com", phone_primary: "571-882-0044",
    event_date: "2026-10-03", event_date_confirmed: false,
    package: "Full Weekend", guest_count_initial: 100,
    revenue_cents: null, status: "tour_booked",
    first_touch_platform: "the_knot", resolved_source: "the_knot", resolved_source_confidence: 75,
    competing_venues: ["The Inn at Willow Grove", "Fleetwood Farm Winery"],
  },
  // Active inquiries
  {
    name_primary: "Emma Reynolds",
    email_primary: "emma.reynolds2026@gmail.com",
    event_date: "2026-11-07", event_date_confirmed: false,
    guest_count_initial: 80, status: "inquiry",
    first_touch_platform: "the_knot",
  },
  {
    name_primary: "Aisha Nkosi",
    email_primary: "aisha.nkosi@gmail.com",
    event_date: "2027-05-15", event_date_confirmed: false,
    guest_count_initial: 200, status: "inquiry",
    first_touch_platform: "instagram",
  },
];

// Normalize all client rows to have identical keys (PostgREST requirement)
const clientDefaults = {
  venue_id: null, name_primary: null, name_partner: null,
  email_primary: null, phone_primary: null,
  event_date: null, event_date_confirmed: false,
  package: null, guest_count_initial: null, guest_count_final: null,
  revenue_cents: null, status: "inquiry",
  first_touch_platform: null, resolved_source: null, resolved_source_confidence: null,
  self_reported_source: null, referrer_name: null,
  competing_venues: [], complexity_score: null,
  staffing_hours_actual: null, day_of_complexity: null,
  review_left: false, review_platform: null, review_star_rating: null,
  review_date: null, review_text: null, review_sentiment: null,
  referrals_generated: 0,
};
let insertedClients;
try {
  insertedClients = await rest("POST", "/clients", clients.map(c => ({
    ...clientDefaults,
    venue_id: venueId,
    ...c,
  })));
  console.log(`  ✓ ${insertedClients.length} clients created`);
} catch (e) {
  if (e.message.includes("23505")) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/clients?venue_id=eq.${venueId}&select=id,name_primary`, { headers });
    insertedClients = await res.json();
    console.log(`  Clients already exist: ${insertedClients.length}`);
  } else throw e;
}

// ── 6. Seed client_vendors ───────────────────────────────────────────────────
console.log("\nLinking vendors to clients...");
const vendorLinks = [
  // Sophie & James
  { clientName: "Sophie Harrington", vendors: ["Sweetgrass Social", "Compass Floral", "Feast & Fettle", "Capital Disc Jockey", "Bloom Cakes"] },
  // Claire & Marcus
  { clientName: "Claire Donovan", vendors: ["Hunter & Company", "Compass Floral", "Feast & Fettle", "Bloom Cakes"] },
  // Amelia & Tobias
  { clientName: "Amelia Chen", vendors: ["Sweetgrass Social", "Compass Floral", "Feast & Fettle", "Harmony Road Band", "Bloom Cakes", "Ridgeline Rentals"] },
  // Rachel & Ben
  { clientName: "Rachel Ostrowski", vendors: ["Hunter & Company", "Feast & Fettle", "Capital Disc Jockey"] },
  // Natalie & Diego
  { clientName: "Natalie Flores", vendors: ["Sweetgrass Social", "Compass Floral", "Feast & Fettle", "Harmony Road Band", "Ridgeline Rentals"] },
  // Grace & Ethan
  { clientName: "Grace Kimball", vendors: ["Wild Folk Studio", "Compass Floral", "Feast & Fettle", "Bloom Cakes"] },
  // Maya & Caleb
  { clientName: "Maya Johnson", vendors: ["Sweetgrass Social", "Compass Floral", "Feast & Fettle", "Harmony Road Band", "Bloom Cakes", "Ridgeline Rentals", "Elysian Events"] },
  // Leah & Noah
  { clientName: "Leah Steinberg", vendors: ["Wild Folk Studio", "Compass Floral", "Feast & Fettle", "Capital Disc Jockey", "Bloom Cakes"] },
  // Priya & Aidan
  { clientName: "Priya Sharma", vendors: ["Sweetgrass Social", "Compass Floral", "Feast & Fettle", "Harmony Road Band"] },
];

const clientMap = {};
insertedClients.forEach(c => { clientMap[c.name_primary] = c.id; });

const cvLinks = [];
for (const link of vendorLinks) {
  const cId = clientMap[link.clientName];
  if (!cId) continue;
  for (const vName of link.vendors) {
    const vId = vendorMap[vName];
    if (!vId) continue;
    cvLinks.push({ venue_id: venueId, client_id: cId, vendor_id: vId });
  }
}
try {
  await rest("POST", "/client_vendors", cvLinks);
  console.log(`  ✓ ${cvLinks.length} client-vendor links created`);
} catch (e) {
  if (e.message.includes("23505")) console.log(`  client_vendor links already exist`);
  else throw e;
}

// ── 7. Seed inquiries ────────────────────────────────────────────────────────
console.log("\nSeeding recent inquiries...");
const inquiries = [
  {
    platform: "the_knot", received_at: "2026-03-10T14:22:00Z",
    name_extracted: "Emma Reynolds", email_extracted: "emma.reynolds2026@gmail.com",
    event_date_extracted: "2026-11-07", guest_count_extracted: 80,
    raw_message: "Hi! I came across Rixey Manor on The Knot and fell in love with it. We're planning a November 2026 wedding with around 80 guests. Could we schedule a tour?",
    self_reported_source: "The Knot", match_status: "matched",
    matched_client_id: clientMap["Emma Reynolds"],
    day_of_week: 1, hour_of_day: 14, response_sent_at: "2026-03-10T16:45:00Z", response_time_minutes: 143,
  },
  {
    platform: "instagram", received_at: "2026-03-12T09:15:00Z",
    name_extracted: "Aisha Nkosi", email_extracted: "aisha.nkosi@gmail.com",
    event_date_extracted: "2027-05-15", guest_count_extracted: 200,
    raw_message: "I've been following your page for months and we are absolutely in love with Rixey Manor. We have a large guest list (~200) and are looking at May 2027. Is that date available?",
    self_reported_source: "Instagram", match_status: "matched",
    matched_client_id: clientMap["Aisha Nkosi"],
    day_of_week: 3, hour_of_day: 9, response_sent_at: "2026-03-12T11:30:00Z", response_time_minutes: 135,
  },
  {
    platform: "the_knot", received_at: "2026-03-14T19:03:00Z",
    name_extracted: "Laura Beckett", email_extracted: "laura.beckett@gmail.com",
    event_date_extracted: "2027-06-12", guest_count_extracted: 150,
    raw_message: "Hi there, I'm reaching out about availability for summer 2027. We're looking at June for around 150 guests.",
    self_reported_source: "The Knot", match_status: "unmatched",
    day_of_week: 6, hour_of_day: 19, response_sent_at: "2026-03-15T09:00:00Z", response_time_minutes: 837,
  },
  {
    platform: "the_knot", received_at: "2026-03-15T11:40:00Z",
    name_extracted: "Jordan Patel", email_extracted: "jordan.patel.wedding@gmail.com",
    event_date_extracted: "2026-08-08", guest_count_extracted: 120,
    raw_message: "We toured a few venues this past weekend and Rixey Manor is at the top of our list. August 2026 - is the weekend of the 8th available?",
    self_reported_source: "The Knot", match_status: "unmatched",
    day_of_week: 0, hour_of_day: 11,
  },
];

const inquiryDefaults = {
  venue_id: null, platform: null, received_at: null,
  name_extracted: null, email_extracted: null,
  event_date_extracted: null, guest_count_extracted: null,
  raw_message: null, self_reported_source: null,
  match_status: "unmatched", matched_client_id: null,
  day_of_week: null, hour_of_day: null,
  response_sent_at: null, response_time_minutes: null,
};
try {
  await rest("POST", "/inquiries", inquiries.map(i => ({ ...inquiryDefaults, venue_id: venueId, ...i })));
  console.log(`  ✓ ${inquiries.length} inquiries created`);
} catch (e) {
  if (e.message.includes("23505")) console.log(`  Inquiries already exist`);
  else throw e;
}

// ── 8. Seed competitors ──────────────────────────────────────────────────────
console.log("\nSeeding competitor landscape...");
const competitors = [
  { competitor_name: "Pippin Hill Farm & Vineyards", distance_miles: 28.4, google_rating: 4.9, review_count: 312, competitor_place_id: "ChIJ_pippin_hill" },
  { competitor_name: "King Family Vineyards", distance_miles: 31.2, google_rating: 4.7, review_count: 198, competitor_place_id: "ChIJ_king_family" },
  { competitor_name: "Goodstone Inn & Estate", distance_miles: 22.8, google_rating: 4.8, review_count: 156, competitor_place_id: "ChIJ_goodstone" },
  { competitor_name: "The Inn at Willow Grove", distance_miles: 18.3, google_rating: 4.6, review_count: 203, competitor_place_id: "ChIJ_willow_grove" },
  { competitor_name: "Morais Vineyards & Winery", distance_miles: 12.1, google_rating: 4.5, review_count: 287, competitor_place_id: "ChIJ_morais" },
  { competitor_name: "Fleetwood Farm Winery", distance_miles: 14.7, google_rating: 4.7, review_count: 134, competitor_place_id: "ChIJ_fleetwood" },
  { competitor_name: "Shenandoah Woods", distance_miles: 33.5, google_rating: 4.4, review_count: 89, competitor_place_id: "ChIJ_shenandoah" },
  { competitor_name: "Keswick Hall", distance_miles: 35.2, google_rating: 4.8, review_count: 421, competitor_place_id: "ChIJ_keswick" },
  { competitor_name: "Inn at Vaucluse Spring", distance_miles: 24.6, google_rating: 4.7, review_count: 167, competitor_place_id: "ChIJ_vaucluse" },
  { competitor_name: "Clifton Inn", distance_miles: 29.8, google_rating: 4.6, review_count: 244, competitor_place_id: "ChIJ_clifton" },
];

try {
  await rest("POST", "/macro_competitor_landscape", competitors.map(c => ({
    venue_id: venueId,
    scanned_at: new Date().toISOString(),
    ...c,
  })));
  console.log(`  ✓ ${competitors.length} competitors seeded`);
} catch (e) {
  if (e.message.includes("23505")) console.log(`  Competitors already seeded`);
  else throw e;
}

// ── 9. Seed market pulse ─────────────────────────────────────────────────────
console.log("\nSeeding initial market pulse...");
try {
  await rest("POST", "/market_pulse", {
    venue_id: venueId,
    calculated_at: new Date().toISOString(),
    valid_until: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    demand_outlook: "positive",
    demand_score: 63,
    consumer_confidence_latest: 67.8,
    consumer_confidence_trend: "stable",
    search_volume_vs_seasonal: 12,
    engagement_seasonality_signal: "spring_peak",
    marriage_rate_trend: "stable",
    regional_economy_summary: "Richmond Fed district shows continued services growth. Hospitality sector robust heading into spring wedding season.",
    weather_caution_months: ["Jul", "Aug"],
    competitor_change_alert: null,
    full_summary: {
      note: "Initial seed — run NOAA ingestion to populate historical weather data"
    }
  });
  console.log("  ✓ Market pulse seeded");
} catch (e) {
  if (e.message.includes("23505")) console.log(`  Market pulse already exists`);
  else throw e;
}

// ── Done ─────────────────────────────────────────────────────────────────────
console.log(`
╔════════════════════════════════════════════╗
║  Rixey Manor seeded successfully           ║
║                                            ║
║  Venue ID: ${venueId.slice(0, 8)}...
║  16 clients · 10 vendors · 4 inquiries     ║
║  10 competitors · market pulse active      ║
║                                            ║
║  Login: isadora@rixeymanor.com             ║
║  Password: rixeymanor                      ║
╚════════════════════════════════════════════╝
`);
