import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://vitylftwsflnzbjometm.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const VENUE_ID = "b0000000-0000-0000-0000-000000000001";
const ORG_ID = "a0000000-0000-0000-0000-000000000001";

if (!SERVICE_KEY) {
  console.error("ERROR: SUPABASE_SERVICE_ROLE_KEY environment variable is not set.");
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

// Return a random date between two Date objects
function randomBetween(start: Date, end: Date): Date {
  const ms = start.getTime() + Math.random() * (end.getTime() - start.getTime());
  return new Date(ms);
}

// Return the next Saturday on or after a given date
function nextSaturday(date: Date): Date {
  const d = new Date(date);
  const dow = d.getDay(); // 0=Sun
  const diff = dow <= 6 ? 6 - dow : 0;
  d.setDate(d.getDate() + diff);
  return d;
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
  "Layla", "Nora", "Zoey", "Lillian", "Eleanor", "Victoria",
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
];

const EMAIL_DOMAINS = [
  "gmail.com", "gmail.com", "gmail.com", "gmail.com",
  "yahoo.com", "yahoo.com",
  "outlook.com", "outlook.com",
  "icloud.com",
  "hotmail.com",
  "me.com",
  "protonmail.com",
];

const SOURCES = [
  "The Knot", "WeddingWire", "Google", "Instagram", "Referral", "Friend", "Drove by",
];

const INQUIRY_CHANNELS = [
  "email", "the_knot", "wedding_wire", "phone", "instagram",
];

const PACKAGES = [
  "Full Weekend", "Full Weekend", "Full Weekend",
  "Saturday Only", "Saturday Only",
  "Friday + Saturday",
  "Elopement",
];

const COORDINATORS = ["Sarah M.", "Jamie R.", "Alex T."];

const STATUSES = [
  "event_complete", "contracted", "held", "toured",
  "tour_booked", "inquiry", "lost",
];
const STATUS_WEIGHTS = [40, 15, 10, 10, 10, 8, 7];

// ---------------------------------------------------------------------------
// Generate a full name pair
// ---------------------------------------------------------------------------

function generateCouple(): { primary: string; partner: string | null; emailPrimary: string } {
  const fn1 = pick(FIRST_NAMES);
  const ln = pick(LAST_NAMES);
  const hasPartner = Math.random() < 0.7;
  const fn2 = hasPartner ? pick(FIRST_NAMES) : null;
  const domain = pick(EMAIL_DOMAINS);
  const emailPrimary = `${fn1.toLowerCase()}.${ln.toLowerCase()}@${domain}`;
  return {
    primary: `${fn1} ${ln}`,
    partner: fn2 ? `${fn2} ${ln}` : null,
    emailPrimary,
  };
}

// ---------------------------------------------------------------------------
// Wedding dates — weekends Apr–Nov 2024–2026
// ---------------------------------------------------------------------------

function generateWeddingDates(count: number): Date[] {
  const dates: Date[] = [];
  // Pool: every Saturday Apr–Nov across 2024, 2025, 2026
  for (const year of [2024, 2025, 2026]) {
    for (let month = 3; month <= 10; month++) {
      // find all Saturdays
      const d = new Date(year, month, 1);
      while (d.getMonth() === month) {
        if (d.getDay() === 6) dates.push(new Date(d));
        d.setDate(d.getDate() + 1);
      }
    }
  }
  // Shuffle and take `count`
  for (let i = dates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [dates[i], dates[j]] = [dates[j], dates[i]];
  }
  return dates.slice(0, count);
}

// ---------------------------------------------------------------------------
// 1. CLIENTS
// ---------------------------------------------------------------------------

async function seedClients(): Promise<string[]> {
  console.log("Seeding clients (200 records)...");

  const weddingDates = generateWeddingDates(200);
  const now = new Date("2026-03-25T00:00:00Z");
  const clientRows: Record<string, unknown>[] = [];

  for (let i = 0; i < 200; i++) {
    const couple = generateCouple();
    const status = weightedPick(STATUSES, STATUS_WEIGHTS);
    const eventDate = weddingDates[i % weddingDates.length];

    // inquired_at: 1–18 months before event date, but never in the future relative to "now"
    const maxInquiryOffset = Math.min(18 * 30, Math.floor((eventDate.getTime() - now.getTime()) / 86400000) + 365);
    const inquiryDaysBeforeEvent = rand(30, Math.max(31, maxInquiryOffset));
    const inquiredAt = addDays(eventDate, -inquiryDaysBeforeEvent);

    const source = pick(SOURCES);
    const resolvedSource = Math.random() < 0.6 ? source : null;
    const inquiryChannel = pick(INQUIRY_CHANNELS);
    const pkg = pick(PACKAGES);
    const isElopement = pkg === "Elopement";
    const guestCount = isElopement ? rand(20, 40) : rand(80, 220);

    let revenueCents: number | null = null;
    if (status === "event_complete" || status === "contracted") {
      revenueCents = rand(800000, 1800000);
    }

    let reviewStarRating: number | null = null;
    let reviewSubmitted = false;
    if (status === "event_complete") {
      const r = Math.random();
      if (r < 0.85) {
        reviewStarRating = 5.0;
        reviewSubmitted = true;
      } else if (r < 0.95) {
        reviewStarRating = 4.0;
        reviewSubmitted = true;
      }
      // else null
    }

    // Stage timestamps — fill in a plausible chain
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
      review_star_rating: reviewStarRating,
      review_submitted: reviewSubmitted,
      assigned_coordinator: pick(COORDINATORS),
      tour_booked_at: tourBookedAt,
      toured_at: touredAt,
      held_at: heldAt,
      contracted_at: contractedAt,
      event_completed_at: eventCompletedAt,
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
      data?.forEach((r) => insertedIds.push(r.id));
      console.log(`  Inserted clients ${i + 1}–${Math.min(i + 50, clientRows.length)}`);
    }
  }

  console.log(`  Done — ${insertedIds.length} clients inserted.`);
  return insertedIds;
}

// ---------------------------------------------------------------------------
// 2. CHANNEL SPEND
// ---------------------------------------------------------------------------

async function seedChannelSpend(): Promise<void> {
  console.log("Seeding channel_spend (120 rows: 24 months × 5 channels)...");

  const channels = [
    { name: "The Knot", minCents: 50000, maxCents: 80000 },
    { name: "WeddingWire", minCents: 30000, maxCents: 50000 },
    { name: "Google Ads", minCents: 20000, maxCents: 60000 },
    { name: "Instagram", minCents: 10000, maxCents: 30000 },
    { name: "Facebook", minCents: 5000, maxCents: 20000 },
  ];

  const rows: Record<string, unknown>[] = [];

  for (let year = 2024; year <= 2025; year++) {
    for (let month = 1; month <= 12; month++) {
      const monthStr = `${year}-${String(month).padStart(2, "0")}-01`;
      for (const ch of channels) {
        rows.push({
          venue_id: VENUE_ID,
          month: monthStr,
          channel: ch.name,
          spend_cents: rand(ch.minCents, ch.maxCents),
        });
      }
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
// 3. REVIEWS
// ---------------------------------------------------------------------------

const REVIEW_TEMPLATES = [
  "We got married at Rixey Manor last fall and it was absolutely perfect. The grounds are breathtaking, and the team made everything feel effortless. Our guests are still talking about it months later. We cannot recommend this venue enough.",
  "From our first tour to the last dance of the reception, Rixey Manor exceeded every expectation. The historic manor house created the most romantic backdrop for our ceremony. Sarah and her team thought of every detail we hadn't.",
  "If you're looking for a venue that combines natural beauty with exceptional service, Rixey Manor is it. The rolling hills of Rapidan provided a stunning setting, and the flexibility the team offered us was invaluable. A truly magical day.",
  "We had a small, intimate wedding at Rixey Manor and it was exactly what we dreamed of. The team treated us like family throughout the entire planning process. The food was incredible and the scenery was unmatched.",
  "Rixey Manor is a hidden gem in the Virginia countryside. The coordinator Jamie was responsive, professional, and genuinely passionate about making our day special. The venue itself is stunning in every season.",
  "Our guests traveled from across the country for our wedding and every single one of them said it was the most beautiful venue they'd ever seen. Rixey Manor's combination of rustic charm and elegant details is unparalleled.",
  "We toured four venues before falling in love with Rixey Manor on the spot. The team was transparent about pricing, flexible with our vision, and incredibly warm throughout. Our wedding day ran seamlessly.",
  "Five stars isn't enough for Rixey Manor. The grounds, the manor house, the staff, the food — every single element was extraordinary. Alex T. was our coordinator and she was a dream to work with.",
  "Planning a wedding can be stressful but the team at Rixey Manor made it feel joyful. They went above and beyond at every turn. The outdoor ceremony space with the mountain backdrop took our breath away.",
  "We celebrated our wedding at Rixey Manor in June and it was the best decision we made. The full-weekend package allowed our guests to truly settle in and celebrate with us. Worth every penny and then some.",
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
];

async function seedReviews(): Promise<void> {
  console.log("Seeding reviews (30 records)...");

  const platforms = ["google", "google", "google", "the_knot", "the_knot", "wedding_wire"];
  const reviewerNames = [
    "Emma & James W.", "Sophia & Noah G.", "Charlotte & Oliver H.",
    "Ava & William B.", "Mia & Lucas D.", "Isabella & Ethan T.",
    "Amelia & Mason K.", "Harper & Henry P.", "Evelyn & Alexander S.",
    "Lily & Benjamin F.", "Grace & Caleb M.", "Chloe & Daniel R.",
    "Natalie & Logan A.", "Zoey & Jackson N.", "Hannah & Samuel C.",
    "Riley & Ryan E.", "Penelope & Nathan V.", "Victoria & Christian Y.",
    "Nora & Owen J.", "Eleanor & Sebastian L.", "Zoe & Aiden X.",
    "Luna & Jack O.", "Layla & Michael Q.", "Aria & Tyler Z.",
    "Camila & Connor U.", "Lillian & Dylan I.", "Abigail & Kyle W.",
    "Emily & Brandon P.", "Elizabeth & Justin A.", "Avery & Trevor N.",
  ];

  const start = new Date("2024-01-01");
  const end = new Date("2025-12-31");

  const rows: Record<string, unknown>[] = [];

  for (let i = 0; i < 30; i++) {
    const rating = Math.random() < 0.85 ? 5.0 : 4.0;
    const reviewDate = randomBetween(start, end);

    rows.push({
      venue_id: VENUE_ID,
      platform: pick(platforms),
      reviewer_name: reviewerNames[i % reviewerNames.length],
      rating,
      review_text: REVIEW_TEMPLATES[i % REVIEW_TEMPLATES.length],
      review_date: formatTimestamp(reviewDate),
      sentiment_score: parseFloat((0.85 + Math.random() * 0.14).toFixed(2)),
      themes: REVIEW_THEMES_POOL[i % REVIEW_THEMES_POOL.length],
      match_status: "unmatched",
    });
  }

  const { error } = await supabase.from("reviews").insert(rows);
  if (error) {
    console.error("  ERROR inserting reviews:", error.message);
  } else {
    console.log(`  Done — ${rows.length} reviews inserted.`);
  }
}

// ---------------------------------------------------------------------------
// 4. TOURS
// ---------------------------------------------------------------------------

async function seedTours(): Promise<void> {
  console.log("Seeding tours (50 records)...");

  const now = new Date("2026-03-25T00:00:00Z");
  const start = new Date("2024-01-01");
  const end = new Date("2025-12-31");
  const rows: Record<string, unknown>[] = [];

  for (let i = 0; i < 50; i++) {
    // Tours happen on weekends — find a random Saturday or Sunday
    const baseDate = randomBetween(start, end);
    const dow = baseDate.getDay();
    const daysToWeekend = dow === 6 ? 0 : dow === 0 ? 0 : 6 - dow;
    const tourDate = addDays(baseDate, daysToWeekend);
    tourDate.setHours(rand(10, 16), 0, 0, 0);

    const isPast = tourDate < now;
    const tourType = Math.random() < 0.8 ? "In-Person" : "Virtual";
    const cancelled = isPast && Math.random() < 0.1;
    const completed = isPast && !cancelled && Math.random() < 0.8;
    const bookedOutcome = completed && Math.random() < 0.45;

    rows.push({
      venue_id: VENUE_ID,
      scheduled_at: formatTimestamp(tourDate),
      tour_type: tourType,
      completed,
      cancelled,
      self_reported_source: pick(SOURCES),
      conducted_by: pick(COORDINATORS),
      outcome: completed ? (bookedOutcome ? "Booked" : "Not booked") : null,
      booking_conversion_days: bookedOutcome ? rand(3, 45) : null,
    });
  }

  const { error } = await supabase.from("tours").insert(rows);
  if (error) {
    console.error("  ERROR inserting tours:", error.message);
  } else {
    console.log(`  Done — ${rows.length} tours inserted.`);
  }
}

// ---------------------------------------------------------------------------
// 5. LOST DEALS
// ---------------------------------------------------------------------------

async function seedLostDeals(): Promise<void> {
  console.log("Seeding lost_deals (30 records)...");

  const REASON_CATEGORIES = [
    "too_expensive", "date_taken", "chose_competitor",
    "no_response", "not_right_fit", "budget_cut", "unknown",
  ];

  const REASON_DETAILS: Record<string, string[]> = {
    too_expensive: [
      "Budget was closer to $8k all-in and couldn't stretch further.",
      "Couple appreciated the venue but found an all-inclusive option at lower price point.",
      "Price point was above what they had allocated for the venue.",
    ],
    date_taken: [
      "Their preferred September date was already booked.",
      "Wanted October 12th specifically — date was unavailable.",
      "Date conflict with another booking — venue was not flexible on the Saturday.",
    ],
    chose_competitor: [
      "Went with a venue that had indoor ceremony space.",
      "Decided on a vineyard venue in Charlottesville.",
      "Chose a venue closer to family in Northern Virginia.",
    ],
    no_response: [
      "Couple stopped responding after the tour.",
      "Follow-up emails went unanswered after two weeks.",
      "Lost contact after initial inquiry — never booked a tour.",
    ],
    not_right_fit: [
      "Couple was looking for a ballroom-style indoor venue.",
      "Needed accessible facilities for elderly guests that we couldn't provide.",
      "Looking for a venue with on-site catering only.",
    ],
    budget_cut: [
      "Family situation changed — scaled back to a micro-wedding.",
      "Changed plans after an unexpected financial change.",
      "Reduced guest count and moved to a smaller venue.",
    ],
    unknown: [],
  };

  const LOST_STAGES = [
    "inquiry", "tour_booked", "toured", "held",
  ];

  const rows: Record<string, unknown>[] = [];

  for (let i = 0; i < 30; i++) {
    const reasonCategory = pick(REASON_CATEGORIES);
    const detailOptions = REASON_DETAILS[reasonCategory];
    const reasonDetail =
      detailOptions.length > 0 && Math.random() < 0.7
        ? pick(detailOptions)
        : null;

    rows.push({
      venue_id: VENUE_ID,
      lost_at_stage: pick(LOST_STAGES),
      reason_category: reasonCategory,
      reason_detail: reasonDetail,
    });
  }

  const { error } = await supabase.from("lost_deals").insert(rows);
  if (error) {
    console.error("  ERROR inserting lost_deals:", error.message);
  } else {
    console.log(`  Done — ${rows.length} lost_deals inserted.`);
  }
}

// ---------------------------------------------------------------------------
// Delete existing seed data (FK-safe order)
// ---------------------------------------------------------------------------

async function clearSeedData(): Promise<void> {
  console.log("Clearing existing seed data for venue...");

  const tables = [
    "lost_deals",
    "tours",
    "reviews",
    "channel_spend",
  ] as const;

  for (const table of tables) {
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

  // Clients: delete by is_seed_data flag to avoid accidental data loss
  const { error: clientErr } = await supabase
    .from("clients")
    .delete()
    .eq("venue_id", VENUE_ID)
    .eq("is_seed_data", true);
  if (clientErr) {
    console.error("  ERROR deleting from clients:", clientErr.message);
  } else {
    console.log("  Cleared clients (seed data only)");
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("Bloom Intelligence Layer — Seed Script");
  console.log(`Venue:  ${VENUE_ID}`);
  console.log(`Org:    ${ORG_ID}`);
  console.log(`Target: ${SUPABASE_URL}`);
  console.log("=".repeat(60));

  try {
    await clearSeedData();
    console.log();

    await seedClients();
    console.log();

    await seedChannelSpend();
    console.log();

    await seedReviews();
    console.log();

    await seedTours();
    console.log();

    await seedLostDeals();
    console.log();

    console.log("=".repeat(60));
    console.log("Seed complete.");
    console.log("=".repeat(60));
  } catch (err) {
    console.error("FATAL ERROR during seed:", err);
    process.exit(1);
  }
}

main();
