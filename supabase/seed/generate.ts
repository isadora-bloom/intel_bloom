/**
 * Bloom Intelligence Layer — Seed Data Generator
 *
 * Generates realistic demo data for a wedding venue.
 *
 * Usage:
 *   npx tsx supabase/seed/generate.ts <venue_id>
 *
 * Env vars loaded from apps/web/.env.local:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Load env from apps/web/.env.local
// ---------------------------------------------------------------------------

const envPath = path.resolve(__dirname, "../../apps/web/.env.local");
if (!fs.existsSync(envPath)) {
  console.error(`ERROR: Could not find .env.local at ${envPath}`);
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, "utf-8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx);
  const value = trimmed.slice(eqIdx + 1);
  if (!process.env[key]) {
    process.env[key] = value;
  }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}

const VENUE_ID = process.argv[2];
if (!VENUE_ID) {
  console.error("Usage: npx tsx supabase/seed/generate.ts <venue_id>");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN<T>(arr: T[], min: number, max: number): T[] {
  const n = rand(min, max);
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function weightedPick<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function formatTimestamp(date: Date): string {
  return date.toISOString();
}

function randomBetween(start: Date, end: Date): Date {
  const ms = start.getTime() + Math.random() * (end.getTime() - start.getTime());
  return new Date(ms);
}

// ---------------------------------------------------------------------------
// Name pools
// ---------------------------------------------------------------------------

const FIRST_NAMES = [
  "Emma", "Olivia", "Ava", "Isabella", "Sophia", "Charlotte", "Mia", "Amelia",
  "Harper", "Evelyn", "Abigail", "Emily", "Ella", "Elizabeth", "Camila",
  "Luna", "Sofia", "Avery", "Mila", "Aria", "Liam", "Noah", "Oliver",
  "Elijah", "William", "James", "Benjamin", "Lucas", "Henry", "Alexander",
  "Mason", "Ethan", "Daniel", "Jacob", "Logan", "Jackson", "Sebastian",
  "Jack", "Aiden", "Owen", "Samuel", "Ryan", "Nathan", "Caleb", "Christian",
  "Zoe", "Natalie", "Hannah", "Lily", "Grace", "Chloe", "Penelope", "Riley",
  "Layla", "Nora", "Zoey", "Lillian", "Eleanor", "Victoria", "Scarlett",
  "Hazel", "Violet", "Aurora", "Savannah", "Audrey", "Brooklyn", "Bella",
  "Claire", "Skylar", "Lucy", "Paisley", "Anna", "Caroline", "Genesis",
  "Kennedy", "Samantha", "Maya", "Willow", "Kinsley", "Naomi", "Aaliyah",
];

const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller",
  "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez",
  "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin",
  "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark",
  "Ramirez", "Lewis", "Robinson", "Walker", "Young", "Allen", "King",
  "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores", "Green",
  "Adams", "Nelson", "Baker", "Hall", "Rivera", "Campbell", "Mitchell",
  "Carter", "Roberts", "Turner", "Phillips", "Evans", "Parker", "Edwards",
  "Collins", "Stewart", "Morris", "Murphy", "Cook", "Rogers", "Morgan",
  "Peterson", "Cooper", "Reed", "Bailey", "Bell", "Howard", "Ward",
];

const EMAIL_DOMAINS = [
  "gmail.com", "gmail.com", "gmail.com", "gmail.com",
  "yahoo.com", "yahoo.com",
  "outlook.com", "outlook.com",
  "icloud.com", "hotmail.com", "me.com", "protonmail.com",
];

const COMPETING_VENUES = [
  "The Inn at Willow Grove",
  "Pippin Hill",
  "Keswick Hall",
  "Montfair Resort",
];

const COORDINATORS = ["Sarah M.", "Jamie R.", "Alex T."];

const PACKAGES = [
  "Full Weekend", "Full Weekend", "Full Weekend",
  "Saturday Only", "Saturday Only",
  "Friday + Saturday",
  "Elopement",
];

// Source distribution: 40% The Knot, 25% Google, 15% Instagram, 10% referral, 10% direct
const SOURCES = ["The Knot", "Google", "Instagram", "Referral", "Direct"];
const SOURCE_WEIGHTS = [40, 25, 15, 10, 10];

// Status distribution per spec
const STATUSES = [
  "inquiry", "tour_booked", "toured", "held",
  "contracted", "event_complete", "lost",
];
const STATUS_WEIGHTS = [15, 10, 8, 12, 35, 15, 5];

// Peak months (May=4 through Oct=9, 0-indexed) get 60% of bookings
// Off-peak months (Nov=10 through Apr=3) get 40%
const PEAK_MONTHS = [4, 5, 6, 7, 8, 9]; // May-Oct (0-indexed)
const OFF_PEAK_MONTHS = [0, 1, 2, 3, 10, 11]; // Jan-Apr, Nov-Dec

// ---------------------------------------------------------------------------
// Generate a couple
// ---------------------------------------------------------------------------

function generateCouple(): { primary: string; partner: string | null; emailPrimary: string } {
  const fn1 = pick(FIRST_NAMES);
  const ln = pick(LAST_NAMES);
  const hasPartner = Math.random() < 0.85;
  const fn2 = hasPartner ? pick(FIRST_NAMES) : null;
  const domain = pick(EMAIL_DOMAINS);
  const suffix = rand(1, 999);
  const emailPrimary = `${fn1.toLowerCase()}.${ln.toLowerCase()}${suffix}@${domain}`;
  return {
    primary: `${fn1} ${ln}`,
    partner: fn2 ? `${fn2} ${pick(LAST_NAMES)}` : null,
    emailPrimary,
  };
}

// ---------------------------------------------------------------------------
// Generate seasonal wedding dates across 24 months
// ---------------------------------------------------------------------------

function generateSeasonalEventDate(): Date {
  // Spread across 24 months: Jan 2025 - Dec 2026
  const isPeak = Math.random() < 0.6;
  const monthPool = isPeak ? PEAK_MONTHS : OFF_PEAK_MONTHS;
  const month = pick(monthPool);
  const year = Math.random() < 0.5 ? 2025 : 2026;

  // Pick a random Saturday in that month
  const firstOfMonth = new Date(year, month, 1);
  const saturdays: Date[] = [];
  const d = new Date(firstOfMonth);
  while (d.getMonth() === month) {
    if (d.getDay() === 6) saturdays.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return pick(saturdays);
}

// ---------------------------------------------------------------------------
// Review text for rural Virginia venue
// ---------------------------------------------------------------------------

const REVIEW_TEXTS_5_STAR = [
  "We got married here last fall and it was absolutely perfect. The rolling hills and the pastoral setting made every photo look like a painting. Our guests could not stop talking about how stunning the property is. The team went above and beyond at every turn.",
  "From the moment we drove down that gravel road for our tour, we knew this was the place. The old farmhouse charm, the mountain views, the fireflies at dusk — it felt like something out of a movie. The coordinators made every detail seamless.",
  "If you are looking for a venue that truly feels like the Virginia countryside at its best, look no further. We had 150 guests for our full weekend and everyone said it was the best wedding they had ever attended. Worth every single penny.",
  "The grounds are absolutely breathtaking — especially in October when the leaves are turning. Our ceremony overlooking the valley was a moment I will never forget. The staff treated us like family from day one through our final dance.",
  "We wanted a venue that felt intimate despite having a big guest list, and this place delivered. The coordinator Sarah was an absolute dream — responsive, creative, and genuinely invested in our day. The sunset ceremony views are unmatched in Virginia.",
  "Our wedding weekend was pure magic. The accommodations on-site meant our closest friends and family could stay, and the Saturday evening under the string lights on the lawn felt like the most beautiful night of our lives. Cannot say enough good things.",
  "Everything about our experience was exceptional. The venue handled a last-minute rain pivot with zero stress — they had a gorgeous backup plan ready to go. The food was farm-to-table and our guests are still raving about the biscuits.",
  "This venue is a hidden gem in the Blue Ridge foothills. We drove two hours from DC and it was the best decision we made. The peace and quiet, the mountain air, the starry sky after the reception — truly unforgettable.",
];

const REVIEW_TEXTS_4_STAR = [
  "Beautiful property and wonderful staff. Our only minor note was that the gravel parking situation was a bit tricky for some of our elderly guests, but the team helped with golf cart shuttles. Everything else was flawless.",
  "We had a gorgeous fall wedding here and loved it. The coordinator was great, though there were a few communication gaps in the final weeks leading up to the event. On the day itself, everything ran perfectly.",
  "Stunning venue with incredible views. The food was delicious and the staff was attentive. We would have appreciated a bit more flexibility on the ceremony start time, but overall a wonderful experience for our 120 guests.",
  "The property is gorgeous and our photos turned out amazing. The team did a great job overall. The only thing that gave us pause was the lack of cell service on-site, which made coordination on the day a bit challenging.",
];

const REVIEW_TEXTS_3_STAR = [
  "The venue itself is beautiful — no question. The views and the grounds are stunning. Our experience with coordination was mixed, though. Some details fell through the cracks and we had to follow up multiple times on things we expected to be handled.",
  "Lovely property but the experience was uneven. The initial planning was great, but as we got closer to the wedding date, response times slowed down considerably. The day-of went well, but the lead-up was more stressful than it needed to be.",
];

const REVIEW_TEXTS_2_STAR = [
  "The property is undeniably beautiful, which is why we booked it. Unfortunately the coordination was lacking. Several details we discussed were forgotten, and we felt like we were managing the logistics ourselves in the final weeks. The day turned out okay, but the planning experience did not match the price point.",
];

// ---------------------------------------------------------------------------
// 1. SEED CLIENTS (200)
// ---------------------------------------------------------------------------

async function seedClients(): Promise<string[]> {
  console.log("Seeding 200 clients with seasonal distribution...");

  const now = new Date("2026-03-26T00:00:00Z");
  const clientRows: Record<string, unknown>[] = [];

  for (let i = 0; i < 200; i++) {
    const couple = generateCouple();
    const status = weightedPick(STATUSES, STATUS_WEIGHTS) as string;
    const eventDate = generateSeasonalEventDate();
    const source = weightedPick(SOURCES, SOURCE_WEIGHTS);

    // inquired_at: 2-18 months before event date, clamped to not exceed "now"
    const maxDaysBefore = Math.min(540, Math.floor((eventDate.getTime() - new Date("2024-01-01").getTime()) / 86400000));
    const inquiryDaysBefore = rand(60, Math.max(61, maxDaysBefore));
    let inquiredAt = addDays(eventDate, -inquiryDaysBefore);
    if (inquiredAt > now) inquiredAt = addDays(now, -rand(1, 30));
    if (inquiredAt < new Date("2024-01-01")) inquiredAt = new Date("2024-01-15");

    const resolvedSource = Math.random() < 0.65 ? source : null;
    const inquiryChannel = weightedPick(
      ["email", "the_knot", "phone", "instagram", "website_form"],
      [35, 25, 15, 15, 10]
    );
    const pkg = pick(PACKAGES);
    const isElopement = pkg === "Elopement";
    const guestCount = isElopement ? rand(20, 45) : rand(50, 200);

    // Revenue: $25,000-$75,000 in cents (only for contracted/event_complete)
    let revenueCents: number | null = null;
    if (status === "contracted" || status === "event_complete") {
      revenueCents = rand(2500000, 7500000);
    }

    // Competing venues: 0-2 per client
    const competing = pickN(COMPETING_VENUES, 0, 2);

    // Review fields (only for event_complete)
    let reviewStarRating: number | null = null;
    let reviewSubmitted = false;
    if (status === "event_complete" && Math.random() < 0.7) {
      reviewStarRating = Math.random() < 0.8 ? 5.0 : 4.0;
      reviewSubmitted = true;
    }

    // Stage transition timestamps — build a plausible chain
    const tourBookedAt =
      ["tour_booked", "toured", "held", "contracted", "event_complete", "lost"].includes(status)
        ? formatTimestamp(addDays(inquiredAt, rand(1, 10)))
        : null;

    const touredAt =
      ["toured", "held", "contracted", "event_complete", "lost"].includes(status)
        ? formatTimestamp(addDays(new Date(tourBookedAt!), rand(3, 21)))
        : null;

    const heldAt =
      ["held", "contracted", "event_complete"].includes(status)
        ? formatTimestamp(addDays(new Date(touredAt!), rand(1, 14)))
        : null;

    const contractedAt =
      ["contracted", "event_complete"].includes(status)
        ? formatTimestamp(addDays(new Date(heldAt!), rand(3, 30)))
        : null;

    const eventCompletedAt =
      status === "event_complete"
        ? formatTimestamp(addDays(eventDate, 1))
        : null;

    clientRows.push({
      venue_id: VENUE_ID,
      name_primary: couple.primary,
      name_partner: couple.partner,
      email_primary: couple.emailPrimary,
      event_date: formatDate(eventDate),
      status,
      revenue_cents: revenueCents,
      self_reported_source: source,
      resolved_source: resolvedSource,
      inquiry_channel: inquiryChannel,
      inquired_at: formatTimestamp(inquiredAt),
      package: pkg,
      guest_count_initial: guestCount,
      guest_count_final: status === "event_complete" ? guestCount + rand(-15, 10) : null,
      review_star_rating: reviewStarRating,
      review_submitted: reviewSubmitted,
      assigned_coordinator: pick(COORDINATORS),
      tour_booked_at: tourBookedAt,
      toured_at: touredAt,
      held_at: heldAt,
      contracted_at: contractedAt,
      event_completed_at: eventCompletedAt,
      competing_venues: competing.length > 0 ? competing : null,
      is_seed_data: true,
    });
  }

  // Insert in batches of 50
  const insertedIds: string[] = [];
  for (let i = 0; i < clientRows.length; i += 50) {
    const batch = clientRows.slice(i, i + 50);
    const { data, error } = await supabase
      .from("clients")
      .insert(batch)
      .select("id");
    if (error) {
      console.error(`  ERROR inserting clients batch ${i / 50 + 1}:`, error.message);
    } else {
      data?.forEach((r: { id: string }) => insertedIds.push(r.id));
      console.log(`  Inserted clients ${i + 1}–${Math.min(i + 50, clientRows.length)}`);
    }
  }

  console.log(`  Done — ${insertedIds.length} clients inserted.`);
  return insertedIds;
}

// ---------------------------------------------------------------------------
// 2. SEED REVIEWS (15)
// ---------------------------------------------------------------------------

async function seedReviews(clientIds: string[]): Promise<void> {
  console.log("Seeding 15 reviews...");

  // 8 five-star, 4 four-star, 2 three-star, 1 two-star
  const ratingDistribution: { rating: number; texts: string[] }[] = [
    { rating: 5.0, texts: REVIEW_TEXTS_5_STAR },
    { rating: 4.0, texts: REVIEW_TEXTS_4_STAR },
    { rating: 3.0, texts: REVIEW_TEXTS_3_STAR },
    { rating: 2.0, texts: REVIEW_TEXTS_2_STAR },
  ];
  const counts = [8, 4, 2, 1]; // 8x5star, 4x4star, 2x3star, 1x2star

  const platforms = ["google", "google", "google", "the_knot", "the_knot", "wedding_wire"];
  const reviewerNames = [
    "Emma & James W.", "Sophia & Noah G.", "Charlotte & Oliver H.",
    "Ava & William B.", "Mia & Lucas D.", "Isabella & Ethan T.",
    "Amelia & Mason K.", "Harper & Henry P.", "Evelyn & Alexander S.",
    "Lily & Benjamin F.", "Grace & Caleb M.", "Chloe & Daniel R.",
    "Natalie & Logan A.", "Zoey & Jackson N.", "Hannah & Samuel C.",
  ];

  const REVIEW_THEMES_POOL = [
    ["staff", "atmosphere"],
    ["food", "views"],
    ["coordination", "flexibility"],
    ["scenery", "ceremony"],
    ["staff", "value"],
    ["grounds", "service"],
    ["atmosphere", "coordination"],
    ["food", "staff"],
    ["views", "flexibility"],
    ["service", "grounds"],
    ["scenery", "staff"],
    ["food", "atmosphere"],
    ["grounds", "views"],
    ["ceremony", "service"],
    ["coordination", "scenery"],
  ];

  const rows: Record<string, unknown>[] = [];
  let reviewIdx = 0;

  // Pick random client IDs to match reviews to
  const shuffledClientIds = [...clientIds].sort(() => Math.random() - 0.5);

  for (let g = 0; g < ratingDistribution.length; g++) {
    const { rating, texts } = ratingDistribution[g];
    for (let c = 0; c < counts[g]; c++) {
      const reviewDate = randomBetween(new Date("2024-06-01"), new Date("2026-03-01"));

      // Sentiment score correlates with rating
      let sentimentBase: number;
      if (rating >= 5) sentimentBase = 0.90;
      else if (rating >= 4) sentimentBase = 0.78;
      else if (rating >= 3) sentimentBase = 0.55;
      else sentimentBase = 0.35;

      rows.push({
        venue_id: VENUE_ID,
        client_id: shuffledClientIds[reviewIdx % shuffledClientIds.length] || null,
        platform: pick(platforms),
        reviewer_name: reviewerNames[reviewIdx % reviewerNames.length],
        rating,
        review_text: texts[c % texts.length],
        review_date: formatTimestamp(reviewDate),
        sentiment_score: parseFloat((sentimentBase + Math.random() * 0.08).toFixed(2)),
        themes: REVIEW_THEMES_POOL[reviewIdx % REVIEW_THEMES_POOL.length],
        match_status: "matched",
      });

      reviewIdx++;
    }
  }

  const { error } = await supabase.from("reviews").insert(rows);
  if (error) {
    console.error("  ERROR inserting reviews:", error.message);
  } else {
    console.log(`  Done — ${rows.length} reviews inserted.`);
  }
}

// ---------------------------------------------------------------------------
// 3. SEED CHANNEL SPEND (24 months)
// ---------------------------------------------------------------------------

async function seedChannelSpend(): Promise<void> {
  console.log("Seeding channel_spend (24 months x 3 channels = 72 rows)...");

  const rows: Record<string, unknown>[] = [];

  // 24 months: Jan 2024 - Dec 2025
  for (let year = 2024; year <= 2025; year++) {
    for (let month = 1; month <= 12; month++) {
      const monthStr = `${year}-${String(month).padStart(2, "0")}-01`;

      // The Knot: $350/month (fixed)
      rows.push({
        venue_id: VENUE_ID,
        month: monthStr,
        channel: "The Knot",
        amount_cents: 35000,
      });

      // Google Ads: $200-500/month (varying)
      rows.push({
        venue_id: VENUE_ID,
        month: monthStr,
        channel: "Google Ads",
        amount_cents: rand(20000, 50000),
      });

      // Instagram: $0-150/month (varying)
      rows.push({
        venue_id: VENUE_ID,
        month: monthStr,
        channel: "Instagram",
        amount_cents: rand(0, 15000),
      });
    }
  }

  const { error } = await supabase.from("channel_spend").insert(rows);
  if (error) {
    console.error("  ERROR inserting channel_spend:", error.message);
  } else {
    console.log(`  Done — ${rows.length} channel_spend rows inserted.`);
  }
}

// ---------------------------------------------------------------------------
// 4. SEED INQUIRIES (30, linked to clients)
// ---------------------------------------------------------------------------

async function seedInquiries(clientIds: string[]): Promise<void> {
  console.log("Seeding 30 inquiries linked to clients...");

  const INQUIRY_PLATFORMS = ["email", "the_knot", "wedding_wire", "instagram", "phone"];
  const PLATFORM_WEIGHTS = [35, 25, 15, 15, 10];

  const INQUIRY_MESSAGES = [
    "Hi! We are getting married next year and just love the look of your venue. Could you send us some info on pricing and availability?",
    "Hello, we found you on The Knot and would love to learn more about hosting our wedding at your property. We are looking at fall dates.",
    "We recently got engaged and are starting our venue search. A friend who got married at your venue recommended we reach out. Would love to schedule a tour!",
    "Good morning! We are planning a wedding for about 120 guests and are interested in your full weekend package. Do you have any summer dates available?",
    "Hi there, we saw your venue on Instagram and it looks absolutely stunning. We are considering a spring wedding — could you share availability and pricing?",
    "We are looking for a rural Virginia venue for our October wedding. Could you tell us more about what is included in your packages?",
    "Hello! We are recently engaged and looking at venues in the Rapidan area. We would love to come see the property. What dates do you have available for tours?",
    "Hi, we have been looking at outdoor wedding venues and your property keeps coming up. We are thinking 80-100 guests for a September date. Can you send details?",
    "We drove past your property last weekend and it is beautiful! We would love to learn more about hosting our wedding there. Our date is flexible.",
    "Good afternoon, we found your venue through Google and are very interested. We are planning a smaller wedding, around 60 guests. Do you offer elopement packages?",
  ];

  const rows: Record<string, unknown>[] = [];
  const shuffledClientIds = [...clientIds].sort(() => Math.random() - 0.5);

  for (let i = 0; i < 30; i++) {
    const platform = weightedPick(INQUIRY_PLATFORMS, PLATFORM_WEIGHTS);
    const receivedAt = randomBetween(new Date("2024-03-01"), new Date("2026-03-15"));
    const dow = receivedAt.getDay();
    const hour = rand(7, 22);
    receivedAt.setHours(hour, rand(0, 59), 0, 0);

    const guestCount = rand(50, 200);
    const extractedDate = addDays(receivedAt, rand(120, 540));

    // Response time: 70% within 2 hours, 20% within 24h, 10% longer
    let responseMinutes: number | null = null;
    const responseRoll = Math.random();
    if (responseRoll < 0.7) responseMinutes = rand(10, 120);
    else if (responseRoll < 0.9) responseMinutes = rand(121, 1440);
    else responseMinutes = rand(1441, 4320);

    const responseSentAt = responseMinutes
      ? new Date(receivedAt.getTime() + responseMinutes * 60000)
      : null;

    rows.push({
      venue_id: VENUE_ID,
      platform,
      raw_message: INQUIRY_MESSAGES[i % INQUIRY_MESSAGES.length],
      name_extracted: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
      email_extracted: `${pick(FIRST_NAMES).toLowerCase()}.${pick(LAST_NAMES).toLowerCase()}${rand(1, 99)}@${pick(EMAIL_DOMAINS)}`,
      event_date_extracted: formatDate(extractedDate),
      guest_count_extracted: guestCount,
      inquiry_intent: weightedPick(
        ["pricing", "availability", "tour_request", "general_info"],
        [30, 25, 30, 15]
      ),
      first_contact_channel: platform,
      received_at: formatTimestamp(receivedAt),
      day_of_week: dow,
      hour_of_day: hour,
      matched_client_id: shuffledClientIds[i % shuffledClientIds.length] || null,
      match_confidence: rand(85, 100),
      match_status: "confirmed",
      response_sent_at: responseSentAt ? formatTimestamp(responseSentAt) : null,
      response_time_minutes: responseMinutes,
      responded_by: pick(COORDINATORS),
    });
  }

  const { error } = await supabase.from("inquiries").insert(rows);
  if (error) {
    console.error("  ERROR inserting inquiries:", error.message);
  } else {
    console.log(`  Done — ${rows.length} inquiries inserted.`);
  }
}

// ---------------------------------------------------------------------------
// Clear existing seed data
// ---------------------------------------------------------------------------

async function clearSeedData(): Promise<void> {
  console.log("Clearing existing seed data for venue...");

  // Delete dependent tables first (FK-safe order)
  const tablesToClear = [
    "lost_deals",
    "tours",
    "reviews",
    "inquiries",
    "channel_spend",
  ] as const;

  for (const table of tablesToClear) {
    const { error } = await supabase
      .from(table)
      .delete()
      .eq("venue_id", VENUE_ID);
    if (error) {
      console.error(`  ERROR deleting from ${table}:`, error.message);
    } else {
      console.log(`  Cleared ${table}`);
    }
  }

  // Clients: only delete seed data to avoid accidental data loss
  const { error: clientErr, count } = await supabase
    .from("clients")
    .delete({ count: "exact" })
    .eq("venue_id", VENUE_ID)
    .eq("is_seed_data", true);
  if (clientErr) {
    console.error("  ERROR deleting seed clients:", clientErr.message);
  } else {
    console.log(`  Cleared ${count ?? 0} seed clients`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("Bloom Intelligence Layer — Seed Data Generator");
  console.log(`Venue ID: ${VENUE_ID}`);
  console.log(`Supabase: ${SUPABASE_URL}`);
  console.log("=".repeat(60));
  console.log();

  // Verify venue exists
  const { data: venue, error: venueErr } = await supabase
    .from("venues")
    .select("id, name")
    .eq("id", VENUE_ID)
    .single();

  if (venueErr || !venue) {
    console.error(`ERROR: Venue ${VENUE_ID} not found.`);
    process.exit(1);
  }
  console.log(`Venue found: ${venue.name}`);
  console.log();

  try {
    // 1. Clear old seed data
    await clearSeedData();
    console.log();

    // 2. Seed clients (200)
    const clientIds = await seedClients();
    console.log();

    // 3. Seed reviews (15) — linked to random clients
    await seedReviews(clientIds);
    console.log();

    // 4. Seed channel spend (24 months)
    await seedChannelSpend();
    console.log();

    // 5. Seed inquiries (30) — linked to clients
    await seedInquiries(clientIds);
    console.log();

    // Summary
    console.log("=".repeat(60));
    console.log("SEED COMPLETE — Summary");
    console.log("=".repeat(60));
    console.log(`  Clients:       200 (is_seed_data = true)`);
    console.log(`  Reviews:        15 (8x5star, 4x4star, 2x3star, 1x2star)`);
    console.log(`  Channel spend:  72 (24 months x 3 channels)`);
    console.log(`  Inquiries:      30 (linked to clients)`);
    console.log();
    console.log("Source distribution: 40% The Knot, 25% Google, 15% Instagram, 10% Referral, 10% Direct");
    console.log("Season distribution: 60% peak (May-Oct), 40% off-peak (Nov-Apr)");
    console.log("Revenue range: $25,000-$75,000 per event");
    console.log("=".repeat(60));
  } catch (err) {
    console.error("FATAL ERROR during seed:", err);
    process.exit(1);
  }
}

main();
