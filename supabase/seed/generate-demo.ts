/**
 * Bloom Intelligence — Demo Seed Data Generator
 * Creates the Crestwood Hospitality Group sandbox demo environment.
 *
 * Usage:
 *   npx tsx supabase/seed/generate-demo.ts           # seed all demo data
 *   npx tsx supabase/seed/generate-demo.ts --clean    # remove demo data only
 *
 * Requires apps/web/.env.local with:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// ═══════════════════════════════════════════════════════════════════════════
// ENV
// ═══════════════════════════════════════════════════════════════════════════

const envPath = path.resolve(__dirname, "../../apps/web/.env.local");
if (!fs.existsSync(envPath)) {
  console.error(`Missing .env.local at ${envPath}`);
  process.exit(1);
}
for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  if (!process.env[t.slice(0, eq)]) process.env[t.slice(0, eq)] = t.slice(eq + 1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const CLEAN_ONLY = process.argv.includes("--clean");

// ═══════════════════════════════════════════════════════════════════════════
// DETERMINISTIC IDs
// ═══════════════════════════════════════════════════════════════════════════

const ORG_ID = "de000000-0000-0000-0000-000000000001";

const VENUE = {
  stonehill:   "de000000-0000-0000-0000-000000000010",
  lakeview:    "de000000-0000-0000-0000-000000000020",
  marchetti:   "de000000-0000-0000-0000-000000000030",
  cooperfield: "de000000-0000-0000-0000-000000000040",
} as const;

const USER = {
  owner:  "de000000-0000-0000-0000-a00000000001", // Jamie Westbrook
  dana:   "de000000-0000-0000-0000-a00000000002",
  marcus: "de000000-0000-0000-0000-a00000000003",
  priya:  "de000000-0000-0000-0000-a00000000004",
  jordan: "de000000-0000-0000-0000-a00000000005",
} as const;

const ALL_VENUE_IDS = Object.values(VENUE);
const NOW = new Date("2026-03-27T12:00:00Z");

// ═══════════════════════════════════════════════════════════════════════════
// VENUE CONFIGURATIONS
// ═══════════════════════════════════════════════════════════════════════════

interface VenueConfig {
  id: string;
  key: string;
  name: string;
  slug: string;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lng: number;
  capacity: number;
  basePriceCents: number;
  avgBookingCents: number;
  bookingStddev: number;
  peakMonths: number[];
  dataStart: Date;
  sources: [string, number][];          // [source, weight]
  consultants: [string, number][];      // [userId, weight]
  avgResponseMin: number;
  responseStddev: number;
  counts: Record<string, number>;       // status → count
  unmatchedCount: number;
  monthlySpend: [string, number][];     // [channel, cents]
  reviewDist: [string, number][];       // [platform, count]
  reviewAvg: number;
  openedYear: number;
}

const VENUES: VenueConfig[] = [
  {
    id: VENUE.stonehill, key: "stonehill",
    name: "The Arbor at Stonehill", slug: "demo-stonehill",
    city: "Stone Hill", state: "VA", zip: "22701",
    lat: 38.42, lng: -78.52,
    capacity: 200, basePriceCents: 850000, avgBookingCents: 1240000, bookingStddev: 280000,
    peakMonths: [3, 4, 5, 6, 7, 8, 9],
    dataStart: new Date("2024-04-01"),
    sources: [["Google", 35], ["Referral", 28], ["Instagram", 18], ["The Knot", 12], ["Other", 7]],
    consultants: [[USER.dana, 100]],
    avgResponseMin: 108, responseStddev: 50,
    counts: { event_complete: 72, contracted: 35, held: 10, toured: 8, tour_booked: 6, inquiry: 12, lost: 98 },
    unmatchedCount: 400,
    monthlySpend: [["Google Ads", 80000], ["The Knot", 25000], ["Instagram Ads", 40000]],
    reviewDist: [["google", 35], ["the_knot", 18], ["wedding_wire", 9]],
    reviewAvg: 4.9, openedYear: 2019,
  },
  {
    id: VENUE.lakeview, key: "lakeview",
    name: "Lakeview Hall", slug: "demo-lakeview",
    city: "Lake Haven", state: "VA", zip: "22702",
    lat: 38.35, lng: -78.38,
    capacity: 250, basePriceCents: 720000, avgBookingCents: 1080000, bookingStddev: 250000,
    peakMonths: [4, 5, 6, 7, 8],
    dataStart: new Date("2024-04-01"),
    sources: [["The Knot", 38], ["WeddingWire", 22], ["Google", 20], ["Referral", 12], ["Other", 8]],
    consultants: [[USER.marcus, 80], [USER.jordan, 20]],
    avgResponseMin: 372, responseStddev: 180,
    counts: { event_complete: 58, contracted: 30, held: 8, toured: 12, tour_booked: 8, inquiry: 18, lost: 227 },
    unmatchedCount: 450,
    monthlySpend: [["Google Ads", 60000], ["The Knot", 50000], ["Instagram Ads", 20000], ["WeddingWire", 35000]],
    reviewDist: [["google", 20], ["the_knot", 12], ["wedding_wire", 6]],
    reviewAvg: 4.4, openedYear: 2020,
  },
  {
    id: VENUE.marchetti, key: "marchetti",
    name: "Marchetti Estate", slug: "demo-marchetti",
    city: "Marchetti", state: "VA", zip: "22703",
    lat: 38.48, lng: -78.45,
    capacity: 150, basePriceCents: 980000, avgBookingCents: 1420000, bookingStddev: 320000,
    peakMonths: [3, 4, 5, 6, 7, 8, 9, 10],
    dataStart: new Date("2024-04-01"),
    sources: [["Referral", 45], ["Google", 25], ["Instagram", 20], ["The Knot", 6], ["Other", 4]],
    consultants: [[USER.priya, 100]],
    avgResponseMin: 144, responseStddev: 60,
    counts: { event_complete: 50, contracted: 25, held: 6, toured: 5, tour_booked: 4, inquiry: 8, lost: 48 },
    unmatchedCount: 250,
    monthlySpend: [["Google Ads", 15000], ["The Knot", 12500]],
    reviewDist: [["google", 28], ["the_knot", 12], ["wedding_wire", 8]],
    reviewAvg: 4.95, openedYear: 2018,
  },
  {
    id: VENUE.cooperfield, key: "cooperfield",
    name: "The Cooperfield", slug: "demo-cooperfield",
    city: "Cooper Mill", state: "VA", zip: "22704",
    lat: 38.28, lng: -78.55,
    capacity: 175, basePriceCents: 650000, avgBookingCents: 920000, bookingStddev: 200000,
    peakMonths: [4, 5, 6, 7, 8, 9],
    dataStart: new Date("2025-02-01"),
    sources: [["Instagram", 32], ["Google", 28], ["The Knot", 22], ["Referral", 10], ["Other", 8]],
    consultants: [[USER.jordan, 70], [USER.dana, 30]],
    avgResponseMin: 186, responseStddev: 80,
    counts: { event_complete: 24, contracted: 16, held: 5, toured: 6, tour_booked: 4, inquiry: 10, lost: 65 },
    unmatchedCount: 230,
    monthlySpend: [["Google Ads", 50000], ["The Knot", 25000], ["Instagram Ads", 35000]],
    reviewDist: [["google", 8], ["the_knot", 4], ["wedding_wire", 2]],
    reviewAvg: 4.7, openedYear: 2025,
  },
];

// Consultant response profiles (for inquiry response_time_minutes)
const CONSULTANT_PROFILES: Record<string, { avgMin: number; stddev: number; name: string }> = {
  [USER.dana]:   { avgMin: 84,  stddev: 40,  name: "Dana Okafor" },
  [USER.marcus]: { avgMin: 468, stddev: 200, name: "Marcus Trent" },
  [USER.priya]:  { avgMin: 126, stddev: 55,  name: "Priya Desai" },
  [USER.jordan]: { avgMin: 216, stddev: 90,  name: "Jordan Pace" },
};

// ═══════════════════════════════════════════════════════════════════════════
// SEASONALITY CURVES
// ═══════════════════════════════════════════════════════════════════════════

// Monthly index (100 = average month) — 0-indexed [Jan..Dec]
const INQUIRY_SEASON = [130, 145, 120, 140, 115, 95, 80, 75, 85, 90, 55, 70];
const BOOKING_SEASON = [15, 20, 40, 80, 140, 160, 130, 120, 140, 155, 70, 30];

// ═══════════════════════════════════════════════════════════════════════════
// NAME POOLS
// ═══════════════════════════════════════════════════════════════════════════

const FIRST = [
  "Emma","Olivia","Ava","Isabella","Sophia","Charlotte","Mia","Amelia","Harper","Evelyn",
  "Abigail","Emily","Ella","Elizabeth","Camila","Luna","Sofia","Avery","Mila","Aria",
  "Liam","Noah","Oliver","Elijah","William","James","Benjamin","Lucas","Henry","Alexander",
  "Mason","Ethan","Daniel","Jacob","Logan","Jackson","Sebastian","Jack","Aiden","Owen",
  "Samuel","Ryan","Nathan","Caleb","Christian","Zoe","Natalie","Hannah","Lily","Grace",
  "Chloe","Penelope","Riley","Layla","Nora","Zoey","Lillian","Eleanor","Victoria","Scarlett",
  "Hazel","Violet","Aurora","Savannah","Audrey","Brooklyn","Bella","Claire","Skylar","Lucy",
  "Paisley","Anna","Caroline","Genesis","Kennedy","Samantha","Maya","Willow","Kinsley","Naomi",
];
const LAST = [
  "Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis","Rodriguez","Martinez",
  "Wilson","Anderson","Thomas","Taylor","Moore","Jackson","Martin","Lee","Perez","Thompson",
  "White","Harris","Clark","Lewis","Robinson","Walker","Young","Allen","King","Wright",
  "Scott","Torres","Nguyen","Hill","Flores","Green","Adams","Nelson","Baker","Hall",
  "Rivera","Campbell","Mitchell","Carter","Roberts","Turner","Phillips","Evans","Parker","Edwards",
  "Collins","Stewart","Morris","Murphy","Cook","Rogers","Morgan","Peterson","Cooper","Reed",
  "Bailey","Bell","Howard","Ward","Bennett","Brooks","Gray","Price","Sanders","Sullivan",
];
const DOMAINS = ["gmail.com","gmail.com","gmail.com","yahoo.com","outlook.com","icloud.com","hotmail.com","protonmail.com"];
const PACKAGES = ["Full Weekend","Full Weekend","Full Weekend","Saturday Only","Saturday Only","Friday + Saturday","Elopement"];
const COMPETITORS = ["The Evergreen","River Bend Estate","Highland Farm","Oakwood Manor","Blue Ridge Hall","The Ashford","Meadow Creek","Willow Brook"];

const LOST_REASONS: [string, number][] = [
  ["went_with_another_venue", 35],
  ["budget_mismatch", 20],
  ["date_unavailable", 18],
  ["no_response", 15],
  ["changed_plans", 8],
  ["other", 4],
];

const INQUIRY_MESSAGES = [
  "Hi! We just got engaged and love the look of your venue. Could you send pricing and availability info?",
  "We found you on The Knot and would love to learn more about hosting our wedding. Looking at fall dates.",
  "A friend who got married at your venue recommended we reach out. Would love to schedule a tour!",
  "We're planning a wedding for about 120 guests and interested in your full weekend package. Any summer dates?",
  "Saw your venue on Instagram — it looks stunning! Considering a spring wedding, could you share availability?",
  "Looking for a venue for our October wedding. Can you tell us more about what's included?",
  "Recently engaged and looking at venues in the area. Would love to come see the property!",
  "We've been looking at outdoor wedding venues and yours keeps coming up. Thinking 80-100 guests for September.",
  "We drove past your property and it's beautiful! We'd love to learn more. Our date is flexible.",
  "Found your venue through Google — very interested. Planning a smaller wedding, around 60 guests.",
];

// ═══════════════════════════════════════════════════════════════════════════
// REVIEW TEXT POOLS (per venue — keywords embedded for review intelligence)
// ═══════════════════════════════════════════════════════════════════════════

const REVIEWS: Record<string, { stars: number; texts: string[] }[]> = {
  stonehill: [
    { stars: 5, texts: [
      "We had our wedding at the barn last fall and it was absolutely magical. The sunset ceremony overlooking the hills was breathtaking. Our coordinator made everything seamless from start to finish.",
      "The barn venue exceeded every expectation. The food was incredible — our guests are still talking about it months later. The views from the ceremony site are simply unmatched in the region.",
      "From the moment we walked into the barn for our tour, we knew this was our venue. The sunset photos we got were stunning and the food quality was outstanding. Highly recommend.",
      "Our coordinator at Stonehill was amazing — she thought of everything we didn't. The barn was decorated beautifully and the views of the rolling hills made the whole weekend feel magical.",
      "Best decision we ever made. The barn was rustic but elegant, the food was farm-to-table perfection, and the sunset ceremony was a dream come true. Our guests raved about the views.",
      "The views from Stonehill are incredible — there's nowhere else like it. We had our ceremony at sunset and there wasn't a dry eye. The coordinator guided us through every detail.",
      "The barn is even more beautiful in person than the photos. Our guests loved the food, especially the late-night snacks. The sunset golden hour was picture perfect for our photographer.",
    ]},
    { stars: 4, texts: [
      "Beautiful barn venue with stunning views. The food was delicious. Our only minor note was the gravel parking was tricky after rain but the coordinator handled everything else perfectly.",
      "Gorgeous property — the sunset was everything we hoped for. The coordinator was helpful though communication slowed a bit in the final weeks before the wedding. Food made up for it.",
    ]},
    { stars: 3, texts: [
      "The barn and views are stunning, no question. The food was good but coordination could have been tighter. A few details were missed in the final week leading up to the event.",
    ]},
  ],
  lakeview: [
    { stars: 5, texts: [
      "The lake at sunset was absolutely stunning. The modern event hall was sleek and exactly what we wanted for our aesthetic. Everything about our wedding was perfect.",
      "We chose Lakeview for its modern design and the lake views did not disappoint. The cocktail hour by the water was the highlight of the entire evening for our guests.",
      "Beautiful modern venue right on the lake. The industrial touches inside balanced perfectly with the natural beauty outside. Our photos turned out incredible.",
    ]},
    { stars: 4, texts: [
      "Beautiful venue on the lake. The modern design is gorgeous. The parking situation was a bit tricky for some guests but staff helped direct everyone. Overall a great experience.",
      "Loved the modern look and the lake views. Food was great. Parking was limited but they arranged overflow. Communication could have been faster during the planning process.",
      "The lake is stunning, the modern hall is perfect for photos. Minor communication delays during planning but the day-of was smooth and beautiful.",
    ]},
    { stars: 3, texts: [
      "The lake and modern hall are beautiful but the experience was uneven. Response times during planning were slow — we waited days sometimes. Parking was a real challenge for elderly guests.",
      "Beautiful setting with a modern feel. However, communication could be much better. We followed up multiple times on details that should have been handled. Parking logistics need work.",
    ]},
    { stars: 2, texts: [
      "Beautiful venue on the lake, modern design great for photos. Unfortunately planning was frustrating — slow responses, missed details, and the parking situation was chaotic on the day. The venue is beautiful but the service didn't match the price point.",
    ]},
  ],
  marchetti: [
    { stars: 5, texts: [
      "The garden ceremony was intimate and perfect. We felt like we were at a villa in Tuscany. Priya was incredible — she made our day completely stress-free and beautiful beyond words.",
      "Marchetti Estate is pure magic. The garden was in full bloom for our June wedding. We had wine and cheese during sunset and it felt like a dream. Priya handled everything flawlessly.",
      "An intimate and elegant experience. The garden setting with fireflies at night was something out of a fairy tale. The wine selection during dinner was absolutely superb.",
      "Priya knew exactly what we wanted before we even said it. The intimate garden setting was perfect for our 100-person wedding. The wine pairings with dinner were exceptional — our guests still talk about it.",
      "The garden at Marchetti is breathtaking. We had fireflies during our first dance — you can't plan that kind of magic. Priya made every single detail seamless and personal.",
      "Everything about Marchetti felt intimate and personal. The garden ceremony, the wine hour, the fireflies at night. Priya was the best coordinator we could have asked for — she feels like family now.",
    ]},
    { stars: 4, texts: [
      "Beautiful intimate garden venue with a true Italian villa feel. The wine selection was wonderful. Slightly limited parking but the garden atmosphere more than made up for it.",
      "The garden and intimate setting were perfect for us. We loved the wine hour concept. Priya was great though we wished for a few more check-in meetings before the big day.",
    ]},
    { stars: 3, texts: [
      "The garden is stunning and the intimate atmosphere is real. However, the venue felt a bit cramped with our 140 guests. Beautiful for smaller weddings though.",
    ]},
  ],
  cooperfield: [
    { stars: 5, texts: [
      "The Cooperfield is such a unique space. The industrial beams and exposed brick gave our wedding an urban edge that was exactly the vibe we were going for. Loved every minute.",
      "If you want something different, this is your venue. The unique industrial setting had everyone talking. Urban cool meets wedding elegance — our photos are incredible.",
      "The vibe at Cooperfield is unmatched. The industrial architecture is stunning and totally unique. Our photos with the exposed brick were our favorites from the entire day.",
    ]},
    { stars: 4, texts: [
      "Really unique venue with great industrial character and an urban feel. The vibe was exactly what we wanted. Still building out a few amenities but the team worked around everything gracefully.",
      "Love the unique industrial aesthetic. The urban location was convenient for our out-of-town guests. Great vibe for a non-traditional wedding — wouldn't change a thing.",
    ]},
    { stars: 3, texts: [
      "Cool unique space with industrial character. The urban location is convenient. Being newer there were a few logistical kinks but the team was responsive and worked hard to fix things.",
    ]},
  ],
};

// Review language keywords per venue
const REVIEW_KEYWORDS: Record<string, { phrase: string; theme: string; frequency: number; avgRating: number }[]> = {
  stonehill: [
    { phrase: "barn", theme: "venue_style", frequency: 24, avgRating: 4.8 },
    { phrase: "sunset", theme: "ambiance", frequency: 18, avgRating: 4.9 },
    { phrase: "coordinator", theme: "service", frequency: 15, avgRating: 4.7 },
    { phrase: "food", theme: "catering", frequency: 14, avgRating: 4.8 },
    { phrase: "views", theme: "scenery", frequency: 12, avgRating: 4.9 },
    { phrase: "rustic", theme: "venue_style", frequency: 8, avgRating: 4.8 },
    { phrase: "rolling hills", theme: "scenery", frequency: 6, avgRating: 5.0 },
  ],
  lakeview: [
    { phrase: "lake", theme: "scenery", frequency: 20, avgRating: 4.6 },
    { phrase: "modern", theme: "venue_style", frequency: 12, avgRating: 4.5 },
    { phrase: "parking", theme: "logistics", frequency: 8, avgRating: 3.2 },
    { phrase: "beautiful but", theme: "mixed_sentiment", frequency: 6, avgRating: 3.8 },
    { phrase: "communication", theme: "service", frequency: 7, avgRating: 3.5 },
    { phrase: "industrial", theme: "venue_style", frequency: 5, avgRating: 4.4 },
  ],
  marchetti: [
    { phrase: "intimate", theme: "ambiance", frequency: 22, avgRating: 4.9 },
    { phrase: "garden", theme: "scenery", frequency: 19, avgRating: 4.9 },
    { phrase: "Priya", theme: "staff_named", frequency: 11, avgRating: 5.0 },
    { phrase: "wine", theme: "catering", frequency: 9, avgRating: 4.9 },
    { phrase: "fireflies", theme: "ambiance", frequency: 8, avgRating: 5.0 },
    { phrase: "villa", theme: "venue_style", frequency: 6, avgRating: 4.8 },
  ],
  cooperfield: [
    { phrase: "unique", theme: "venue_style", frequency: 8, avgRating: 4.6 },
    { phrase: "industrial", theme: "venue_style", frequency: 6, avgRating: 4.7 },
    { phrase: "urban", theme: "location", frequency: 5, avgRating: 4.5 },
    { phrase: "vibe", theme: "ambiance", frequency: 4, avgRating: 4.8 },
    { phrase: "exposed brick", theme: "venue_style", frequency: 3, avgRating: 4.9 },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function pickN<T>(arr: T[], min: number, max: number): T[] {
  const n = rand(min, max);
  return [...arr].sort(() => Math.random() - 0.5).slice(0, n);
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
function normalRandom(mean: number, stddev: number): number {
  // Box-Muller transform
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.round(mean + z * stddev);
}
function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}
function fmtDate(d: Date): string {
  return d.toISOString().split("T")[0];
}
function fmtTs(d: Date): string {
  return d.toISOString();
}
function randomBetween(a: Date, b: Date): Date {
  return new Date(a.getTime() + Math.random() * (b.getTime() - a.getTime()));
}
function vary(base: number, pct = 0.2): number {
  return Math.round(base * (1 - pct + Math.random() * pct * 2));
}

function generateSeasonalDates(count: number, weights: number[], start: Date, end: Date): Date[] {
  const dates: Date[] = [];
  const startY = start.getFullYear(), startM = start.getMonth();
  const endY = end.getFullYear(), endM = end.getMonth();

  // Build month list with weights
  const months: { y: number; m: number; w: number }[] = [];
  let y = startY, m = startM;
  while (y < endY || (y === endY && m <= endM)) {
    months.push({ y, m, w: weights[m] });
    m++;
    if (m > 11) { m = 0; y++; }
  }
  const totalW = months.reduce((a, b) => a + b.w, 0);

  // Distribute counts proportionally with some variance
  const slots: { y: number; m: number; n: number }[] = months.map((mo) => ({
    y: mo.y, m: mo.m,
    n: Math.max(0, Math.round((mo.w / totalW) * count * (0.85 + Math.random() * 0.3))),
  }));

  // Adjust to hit target count
  let total = slots.reduce((a, b) => a + b.n, 0);
  while (total < count) { slots[rand(0, slots.length - 1)].n++; total++; }
  while (total > count) {
    const i = rand(0, slots.length - 1);
    if (slots[i].n > 0) { slots[i].n--; total--; }
  }

  // Generate dates within each month
  for (const slot of slots) {
    for (let i = 0; i < slot.n; i++) {
      const day = rand(1, 28);
      dates.push(new Date(slot.y, slot.m, day));
    }
  }
  return dates;
}

function pickSaturday(year: number, month: number): Date {
  const saturdays: Date[] = [];
  const d = new Date(year, month, 1);
  while (d.getMonth() === month) {
    if (d.getDay() === 6) saturdays.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return pick(saturdays);
}

function generateCouple() {
  const fn1 = pick(FIRST), ln1 = pick(LAST);
  const fn2 = Math.random() < 0.85 ? pick(FIRST) : null;
  const ln2 = fn2 ? pick(LAST) : null;
  const domain = pick(DOMAINS);
  return {
    primary: `${fn1} ${ln1}`,
    partner: fn2 && ln2 ? `${fn2} ${ln2}` : null,
    email: `${fn1.toLowerCase()}.${ln1.toLowerCase()}${rand(1, 999)}@${domain}`,
    phone: `(${rand(200, 999)}) ${rand(200, 999)}-${rand(1000, 9999)}`,
  };
}

function mapSourceToPlatform(source: string): string {
  const m: Record<string, string> = {
    "Google": "google", "The Knot": "the_knot", "WeddingWire": "wedding_wire",
    "Instagram": "instagram", "Referral": "referral", "Other": "website",
  };
  return m[source] || "website";
}

// Batch insert with chunking — returns inserted IDs in order
async function batchInsert(table: string, rows: Record<string, unknown>[], size = 100): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < rows.length; i += size) {
    const batch = rows.slice(i, i + size);
    const { data, error } = await db.from(table).insert(batch).select("id");
    if (error) {
      console.error(`  ERROR ${table} batch ${Math.floor(i / size) + 1}: ${error.message}`);
      // Try to continue
    } else {
      data?.forEach((r: { id: string }) => ids.push(r.id));
    }
  }
  return ids;
}

// ═══════════════════════════════════════════════════════════════════════════
// CLEAR ALL DEMO DATA
// ═══════════════════════════════════════════════════════════════════════════

async function clearDemoData() {
  console.log("Clearing all demo data...");

  // Delete in FK-safe order (children first)
  const venueScoped = [
    "lost_deals", "response_alerts", "tours", "reviews", "review_language",
    "anomaly_detections", "weekly_insights", "venue_health", "venue_capacity",
    "revenue_forecasts", "channel_spend", "campaigns", "referrals",
    "client_source_touchpoints", "content_touchpoints", "email_messages",
    "email_threads", "website_sessions", "social_posts", "social_api_connections",
    "website_traffic", "leads", "pre_inquiry_signals", "matching_queue",
    "pattern_benchmarks", "market_pulse", "vendor_availability", "client_vendors",
    "vendors", "planning_events", "uploads", "customer_health", "ai_usage_log",
    "data_access_log", "weather_forecasts", "annotations",
  ];

  for (const table of venueScoped) {
    const { error } = await db.from(table).delete().in("venue_id", ALL_VENUE_IDS);
    if (error && !error.message.includes("does not exist")) {
      console.error(`  WARN clearing ${table}: ${error.message}`);
    }
  }

  // Inquiries and clients (inquiries reference clients, delete inquiries first)
  await db.from("inquiries").delete().in("venue_id", ALL_VENUE_IDS);
  await db.from("clients").delete().in("venue_id", ALL_VENUE_IDS);

  // Org-scoped
  await db.from("user_invitations").delete().in("venue_id", ALL_VENUE_IDS);
  await db.from("user_sessions").delete().in("venue_id", ALL_VENUE_IDS);
  await db.from("venue_users").delete().in("venue_id", ALL_VENUE_IDS);
  await db.from("venues").delete().in("id", ALL_VENUE_IDS);
  await db.from("organisations").delete().eq("id", ORG_ID);

  console.log("  Done — all demo data cleared.");
}

// ═══════════════════════════════════════════════════════════════════════════
// SEED: Organisation
// ═══════════════════════════════════════════════════════════════════════════

async function seedOrg() {
  console.log("Creating organisation: Crestwood Hospitality Group");
  const { error } = await db.from("organisations").insert({
    id: ORG_ID,
    name: "Crestwood Hospitality Group",
    slug: "demo-crestwood",
    plan: "enterprise",
    created_at: "2024-03-01T00:00:00Z",
  });
  if (error) console.error("  ERROR:", error.message);
}

// ═══════════════════════════════════════════════════════════════════════════
// SEED: Venues
// ═══════════════════════════════════════════════════════════════════════════

async function seedVenues() {
  console.log("Creating 4 venues...");
  for (const v of VENUES) {
    const { error } = await db.from("venues").insert({
      id: v.id,
      name: v.name,
      slug: v.slug,
      city: v.city,
      state: v.state,
      zip: v.zip,
      lat: v.lat,
      lng: v.lng,
      organisation_id: ORG_ID,
      region: "Mid-Atlantic",
      plan: "founder",
      onboarding_complete: true,
      timezone: "America/New_York",
      noaa_station_id: "USW00013740",
      fed_district: 5,
      google_trends_metro: "US-VA-584",
      created_at: v.dataStart.toISOString(),
      primary_color: "#1A6B6B",
    });
    if (error) console.error(`  ERROR ${v.name}:`, error.message);
    else console.log(`  Created: ${v.name}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SEED: Venue Users (consultants + owner)
// ═══════════════════════════════════════════════════════════════════════════

async function seedVenueUsers() {
  console.log("Creating venue users...");
  const rows: Record<string, unknown>[] = [];

  // Owner — enterprise_owner on all venues
  for (const vid of ALL_VENUE_IDS) {
    rows.push({
      venue_id: vid, user_id: USER.owner, role: "enterprise_owner",
      organisation_id: ORG_ID, is_active: true,
    });
  }

  // Consultant assignments
  const assignments: [string, string, string][] = [
    [USER.dana,   VENUE.stonehill,   "coordinator"],
    [USER.dana,   VENUE.cooperfield, "coordinator"],
    [USER.marcus, VENUE.lakeview,    "coordinator"],
    [USER.priya,  VENUE.marchetti,   "coordinator"],
    [USER.jordan, VENUE.cooperfield, "coordinator"],
    [USER.jordan, VENUE.lakeview,    "coordinator"],
  ];
  for (const [uid, vid, role] of assignments) {
    rows.push({
      venue_id: vid, user_id: uid, role,
      organisation_id: ORG_ID, is_active: true,
    });
  }

  const { error } = await db.from("venue_users").insert(rows);
  if (error) console.error("  ERROR:", error.message);
  else console.log(`  Created ${rows.length} venue_user records`);
}

// ═══════════════════════════════════════════════════════════════════════════
// SEED: Clients + Inquiries + Tours + Lost Deals (per venue)
// ═══════════════════════════════════════════════════════════════════════════

interface ClientMeta {
  status: string;
  inquiryDate: Date;
  eventDate: Date;
  tourDate: Date | null;
  toured: boolean;
  consultant: string;
  responseMin: number;
  source: string;
  revenueCents: number | null;
  lostReason: string | null;
  couple: { primary: string; partner: string | null; email: string; phone: string };
}

function generateClientMetas(vc: VenueConfig): ClientMeta[] {
  const metas: ClientMeta[] = [];

  // Helper to pick consultant for this venue
  function pickConsultant(): string {
    return weightedPick(vc.consultants.map(c => c[0]), vc.consultants.map(c => c[1]));
  }

  // Helper to calc response time for a consultant
  function responseTime(consultantId: string): number {
    const p = CONSULTANT_PROFILES[consultantId];
    return clamp(normalRandom(p.avgMin, p.stddev), 5, 2880);
  }

  // ── Booked clients (event_complete + contracted) ──
  const bookedCount = vc.counts.event_complete + vc.counts.contracted;
  // Generate event dates using booking seasonality
  const eventDates = generateSeasonalDates(bookedCount, BOOKING_SEASON, vc.dataStart, new Date("2027-06-01"))
    .sort((a, b) => a.getTime() - b.getTime());

  let idx = 0;

  // event_complete — wedding already happened
  for (let i = 0; i < vc.counts.event_complete; i++) {
    let eventDate = eventDates[idx++] || pickSaturday(2025, rand(4, 9));
    // Ensure it's in the past
    if (eventDate >= NOW) {
      eventDate = pickSaturday(2025, rand(3, 10));
      if (eventDate >= NOW) eventDate = pickSaturday(2024, rand(5, 9));
    }
    const leadDays = clamp(normalRandom(340, 60), 90, 540);
    const inquiryDate = addDays(eventDate, -leadDays);
    const con = pickConsultant();
    const tourDate = addDays(inquiryDate, rand(3, 21));

    metas.push({
      status: "event_complete",
      inquiryDate: inquiryDate < vc.dataStart ? vc.dataStart : inquiryDate,
      eventDate,
      tourDate,
      toured: true,
      consultant: con,
      responseMin: responseTime(con),
      source: weightedPick(vc.sources.map(s => s[0]), vc.sources.map(s => s[1])),
      revenueCents: clamp(normalRandom(vc.avgBookingCents, vc.bookingStddev), vc.basePriceCents, vc.avgBookingCents * 2),
      lostReason: null,
      couple: generateCouple(),
    });
  }

  // contracted — wedding in the future
  for (let i = 0; i < vc.counts.contracted; i++) {
    let eventDate = eventDates[idx++] || pickSaturday(2026, rand(5, 10));
    if (eventDate < NOW) eventDate = pickSaturday(2026, rand(4, 11));
    if (eventDate < NOW) eventDate = pickSaturday(2027, rand(1, 6));
    const leadDays = clamp(normalRandom(340, 60), 90, 540);
    const inquiryDate = addDays(eventDate, -leadDays);
    const con = pickConsultant();
    const tourDate = addDays(inquiryDate, rand(3, 21));

    metas.push({
      status: "contracted",
      inquiryDate: inquiryDate < vc.dataStart ? vc.dataStart : inquiryDate,
      eventDate,
      tourDate,
      toured: true,
      consultant: con,
      responseMin: responseTime(con),
      source: weightedPick(vc.sources.map(s => s[0]), vc.sources.map(s => s[1])),
      revenueCents: clamp(normalRandom(vc.avgBookingCents, vc.bookingStddev), vc.basePriceCents, vc.avgBookingCents * 2),
      lostReason: null,
      couple: generateCouple(),
    });
  }

  // ── Active clients (held, toured, tour_booked, inquiry) — recent dates ──
  const activeStatuses = ["held", "toured", "tour_booked", "inquiry"] as const;
  for (const status of activeStatuses) {
    for (let i = 0; i < (vc.counts[status] || 0); i++) {
      const inquiryDate = randomBetween(addDays(NOW, -120), addDays(NOW, -5));
      const eventDate = addDays(inquiryDate, clamp(normalRandom(340, 60), 90, 540));
      const con = pickConsultant();
      const toured = ["held", "toured"].includes(status);
      const tourDate = toured || status === "tour_booked"
        ? addDays(inquiryDate, rand(3, 21))
        : null;

      metas.push({
        status,
        inquiryDate,
        eventDate,
        tourDate: status === "tour_booked" ? addDays(NOW, rand(1, 21)) : tourDate,
        toured,
        consultant: con,
        responseMin: responseTime(con),
        source: weightedPick(vc.sources.map(s => s[0]), vc.sources.map(s => s[1])),
        revenueCents: null,
        lostReason: null,
        couple: generateCouple(),
      });
    }
  }

  // ── Lost clients ──
  const lostDates = generateSeasonalDates(vc.counts.lost, INQUIRY_SEASON, vc.dataStart, addDays(NOW, -14));
  for (let i = 0; i < vc.counts.lost; i++) {
    const inquiryDate = lostDates[i] || randomBetween(vc.dataStart, addDays(NOW, -14));
    const eventDate = addDays(inquiryDate, clamp(normalRandom(340, 60), 90, 540));
    const con = pickConsultant();
    const reason = weightedPick(LOST_REASONS.map(r => r[0]), LOST_REASONS.map(r => r[1]));

    // "no_response" leads have much longer response times (or never responded)
    let respMin = responseTime(con);
    if (reason === "no_response") {
      respMin = rand(1440, 4320); // 1-3 days
    }

    // ~55% of lost leads toured first (unless reason is no_response)
    const toured = reason !== "no_response" && Math.random() < 0.55;
    const tourDate = toured ? addDays(inquiryDate, rand(5, 28)) : null;

    metas.push({
      status: "lost",
      inquiryDate,
      eventDate,
      tourDate,
      toured,
      consultant: con,
      responseMin: respMin,
      source: weightedPick(vc.sources.map(s => s[0]), vc.sources.map(s => s[1])),
      revenueCents: null,
      lostReason: reason,
      couple: generateCouple(),
    });
  }

  return metas;
}

async function seedVenueData(vc: VenueConfig) {
  console.log(`\n${"═".repeat(50)}`);
  console.log(`Seeding: ${vc.name}`);
  console.log(`${"═".repeat(50)}`);

  const metas = generateClientMetas(vc);
  const totalClients = metas.length;
  console.log(`  Generated ${totalClients} client journeys`);

  // ── 1. Insert clients ──
  const clientRows = metas.map((m) => ({
    venue_id: vc.id,
    name_primary: m.couple.primary,
    name_partner: m.couple.partner,
    email_primary: m.couple.email,
    phone_primary: m.couple.phone,
    event_date: fmtDate(m.eventDate),
    event_date_confirmed: ["contracted", "event_complete"].includes(m.status),
    status: m.status,
    revenue_cents: m.revenueCents,
    self_reported_source: m.source,
    resolved_source: Math.random() < 0.7 ? m.source : null,
    first_touch_platform: mapSourceToPlatform(m.source),
    first_touch_date: fmtTs(m.inquiryDate),
    package: pick(PACKAGES),
    guest_count_initial: rand(50, vc.capacity),
    guest_count_final: m.status === "event_complete" ? rand(50, vc.capacity) : null,
    inquired_at: fmtDate(m.inquiryDate),
    toured_at: m.toured && m.tourDate ? fmtDate(m.tourDate) : null,
    held_at: ["held", "contracted", "event_complete"].includes(m.status) && m.tourDate
      ? fmtDate(addDays(m.tourDate, rand(1, 14))) : null,
    contracted_at: ["contracted", "event_complete"].includes(m.status) && m.tourDate
      ? fmtDate(addDays(m.tourDate, rand(14, 45))) : null,
    lost_reason: m.lostReason,
    competing_venues: Math.random() < 0.35 ? pickN(COMPETITORS, 1, 2) : [],
    assigned_to: m.consultant,
    created_at: fmtTs(m.inquiryDate),
    confidence_score: 100,
  }));

  console.log(`  Inserting ${clientRows.length} clients...`);
  const clientIds = await batchInsert("clients", clientRows);
  console.log(`  ✓ ${clientIds.length} clients inserted`);

  // ── 2. Insert matched inquiries (one per client) ──
  const inquiryRows = metas.map((m, i) => {
    const received = new Date(m.inquiryDate);
    received.setHours(rand(7, 22), rand(0, 59), 0, 0);
    const responseSentAt = new Date(received.getTime() + m.responseMin * 60000);

    return {
      venue_id: vc.id,
      platform: mapSourceToPlatform(m.source),
      raw_message: pick(INQUIRY_MESSAGES),
      name_extracted: m.couple.primary,
      email_extracted: m.couple.email,
      phone_extracted: m.couple.phone,
      event_date_extracted: fmtDate(m.eventDate),
      guest_count_extracted: rand(50, vc.capacity),
      received_at: fmtTs(received),
      day_of_week: received.getDay(),
      hour_of_day: received.getHours(),
      matched_client_id: clientIds[i] || null,
      match_confidence: rand(85, 100),
      match_status: "confirmed",
      response_sent_at: fmtTs(responseSentAt),
      response_time_minutes: m.responseMin,
      inquiry_intent: weightedPick(
        ["pricing", "availability", "tour_request", "general_info"],
        [30, 25, 30, 15]
      ),
      first_contact_channel: mapSourceToPlatform(m.source),
      self_reported_source: m.source,
      resolved_source: m.source,
      assigned_to: m.consultant,
      created_at: fmtTs(received),
    };
  });

  console.log(`  Inserting ${inquiryRows.length} matched inquiries...`);
  const inquiryIds = await batchInsert("inquiries", inquiryRows);
  console.log(`  ✓ ${inquiryIds.length} matched inquiries inserted`);

  // ── 3. Insert unmatched inquiries ──
  const unmatchedDates = generateSeasonalDates(vc.unmatchedCount, INQUIRY_SEASON, vc.dataStart, addDays(NOW, -3));
  const unmatchedRows = unmatchedDates.map((d) => {
    d.setHours(rand(7, 22), rand(0, 59), 0, 0);
    const source = weightedPick(vc.sources.map(s => s[0]), vc.sources.map(s => s[1]));
    return {
      venue_id: vc.id,
      platform: mapSourceToPlatform(source),
      raw_message: pick(INQUIRY_MESSAGES),
      name_extracted: `${pick(FIRST)} ${pick(LAST)}`,
      email_extracted: `${pick(FIRST).toLowerCase()}.${pick(LAST).toLowerCase()}${rand(1, 999)}@${pick(DOMAINS)}`,
      event_date_extracted: fmtDate(addDays(d, rand(120, 540))),
      guest_count_extracted: rand(40, vc.capacity),
      received_at: fmtTs(d),
      day_of_week: d.getDay(),
      hour_of_day: d.getHours(),
      match_status: "unmatched",
      inquiry_intent: weightedPick(["pricing", "availability", "general_info"], [40, 30, 30]),
      first_contact_channel: mapSourceToPlatform(source),
      self_reported_source: source,
      created_at: fmtTs(d),
    };
  });

  console.log(`  Inserting ${unmatchedRows.length} unmatched inquiries...`);
  await batchInsert("inquiries", unmatchedRows);
  console.log(`  ✓ unmatched inquiries inserted`);

  // ── 4. Insert tours ──
  const tourRows: Record<string, unknown>[] = [];
  metas.forEach((m, i) => {
    if (!m.toured || !m.tourDate || !clientIds[i]) return;
    const scheduled = new Date(m.tourDate);
    scheduled.setHours(rand(10, 16), 0, 0, 0);
    const dayOfWeek = scheduled.getDay();
    const completed = ["event_complete", "contracted", "held", "toured", "lost"].includes(m.status);

    tourRows.push({
      venue_id: vc.id,
      client_id: clientIds[i],
      scheduled_at: fmtTs(scheduled),
      tour_type: dayOfWeek === 6 ? "saturday_tour" : dayOfWeek === 0 ? "sunday_tour" : "weekday_tour",
      completed,
      cancelled: false,
      self_reported_source: m.source,
      competing_venues: Math.random() < 0.3 ? pickN(COMPETITORS, 1, 2) : [],
      booking_date: ["contracted", "event_complete"].includes(m.status)
        ? fmtDate(addDays(m.tourDate!, rand(3, 30))) : null,
      booking_conversion_days: ["contracted", "event_complete"].includes(m.status)
        ? rand(3, 30) : null,
      assigned_to: m.consultant,
    });
  });

  console.log(`  Inserting ${tourRows.length} tours...`);
  await batchInsert("tours", tourRows);
  console.log(`  ✓ tours inserted`);

  // ── 5. Insert lost deals ──
  const lostRows: Record<string, unknown>[] = [];
  metas.forEach((m, i) => {
    if (m.status !== "lost" || !clientIds[i]) return;
    const stage = m.toured ? pick(["toured", "held"]) : pick(["inquiry", "tour_booked"]);
    const competitorName = m.lostReason === "went_with_another_venue" ? pick(COMPETITORS) : null;

    lostRows.push({
      venue_id: vc.id,
      client_id: clientIds[i],
      inquiry_id: inquiryIds[i] || null,
      lost_at_stage: stage,
      reason_category: m.lostReason,
      reason_detail: m.lostReason === "went_with_another_venue"
        ? `Couple chose ${competitorName} instead`
        : m.lostReason === "budget_mismatch"
        ? "Pricing exceeded their budget range"
        : m.lostReason === "no_response"
        ? "No response after initial inquiry — went cold"
        : m.lostReason === "date_unavailable"
        ? "Requested date was already booked"
        : m.lostReason === "changed_plans"
        ? "Couple postponed or changed wedding plans"
        : "Did not proceed — no specific reason given",
      competitor_name: competitorName,
      coordinator: CONSULTANT_PROFILES[m.consultant]?.name || null,
      days_in_stage: rand(3, 60),
      created_at: fmtTs(addDays(m.inquiryDate, rand(7, 90))),
    });
  });

  console.log(`  Inserting ${lostRows.length} lost deals...`);
  await batchInsert("lost_deals", lostRows);
  console.log(`  ✓ lost deals inserted`);

  return { clientIds, inquiryIds, metas };
}

// ═══════════════════════════════════════════════════════════════════════════
// SEED: Channel Spend
// ═══════════════════════════════════════════════════════════════════════════

async function seedChannelSpend() {
  console.log("\nSeeding channel spend...");
  const rows: Record<string, unknown>[] = [];

  for (const vc of VENUES) {
    // Build month list for this venue's data window
    let y = vc.dataStart.getFullYear(), m = vc.dataStart.getMonth();
    const endY = NOW.getFullYear(), endM = NOW.getMonth();

    while (y < endY || (y === endY && m <= endM)) {
      const monthStr = `${y}-${String(m + 1).padStart(2, "0")}-01`;

      for (const [channel, baseCents] of vc.monthlySpend) {
        rows.push({
          venue_id: vc.id,
          channel,
          month: monthStr,
          amount_cents: vary(baseCents, 0.15),
        });
      }
      m++;
      if (m > 11) { m = 0; y++; }
    }
  }

  console.log(`  Inserting ${rows.length} channel_spend records...`);
  await batchInsert("channel_spend", rows);
  console.log(`  ✓ channel spend inserted`);
}

// ═══════════════════════════════════════════════════════════════════════════
// SEED: Reviews
// ═══════════════════════════════════════════════════════════════════════════

async function seedReviews(allClientIds: Map<string, string[]>) {
  console.log("\nSeeding reviews...");
  const rows: Record<string, unknown>[] = [];

  for (const vc of VENUES) {
    const venueReviews = REVIEWS[vc.key];
    if (!venueReviews) continue;

    const clientIds = allClientIds.get(vc.id) || [];
    let reviewIdx = 0;

    for (const [platform, targetCount] of vc.reviewDist) {
      // Distribute star ratings: ~65% 5-star, ~22% 4-star, ~10% 3-star, ~3% 2-star
      const ratingWeights = [65, 22, 10, 3];
      const ratings = [5, 4, 3, 2];

      for (let i = 0; i < targetCount; i++) {
        const rating = weightedPick(ratings, ratingWeights);
        // Adjust to hit venue avg — if venue avg is high, bias toward 5-star
        const adjustedRating = vc.reviewAvg >= 4.8 && rating < 4 && Math.random() < 0.5
          ? rating + 1 : rating;

        // Find matching text pool
        const pool = venueReviews.find(r => r.stars === adjustedRating)
          || venueReviews.find(r => r.stars === 5)!;
        const text = pool.texts[reviewIdx % pool.texts.length];

        const reviewDate = randomBetween(addDays(vc.dataStart, 30), addDays(NOW, -7));

        // Sentiment correlates with rating
        const sentimentBase = adjustedRating >= 5 ? 0.92 : adjustedRating >= 4 ? 0.78
          : adjustedRating >= 3 ? 0.55 : 0.35;

        rows.push({
          venue_id: vc.id,
          platform,
          platform_review_id: `demo-${vc.key}-${platform}-${i}`,
          reviewer_name: `${pick(FIRST)} & ${pick(FIRST)} ${pick(LAST)[0]}.`,
          rating: adjustedRating,
          review_text: text,
          review_date: fmtDate(reviewDate),
          sentiment_score: parseFloat((sentimentBase + Math.random() * 0.06).toFixed(2)),
          themes: pickN(["staff", "atmosphere", "food", "views", "coordination", "scenery", "value", "service"], 2, 3),
          standout_phrases: text.split(". ").slice(0, 2),
          concerns_mentioned: adjustedRating < 4 ? pickN(["communication", "parking", "logistics", "timing"], 1, 2) : [],
          match_status: Math.random() < 0.6 ? "matched" : "unmatched",
          matched_client_id: Math.random() < 0.4 && clientIds.length > 0 ? pick(clientIds) : null,
          import_source: "demo_seed",
        });

        reviewIdx++;
      }
    }
  }

  console.log(`  Inserting ${rows.length} reviews...`);
  await batchInsert("reviews", rows);
  console.log(`  ✓ reviews inserted`);
}

// ═══════════════════════════════════════════════════════════════════════════
// SEED: Review Language
// ═══════════════════════════════════════════════════════════════════════════

async function seedReviewLanguage() {
  console.log("\nSeeding review language keywords...");
  const rows: Record<string, unknown>[] = [];

  for (const vc of VENUES) {
    const keywords = REVIEW_KEYWORDS[vc.key] || [];
    for (const kw of keywords) {
      rows.push({
        venue_id: vc.id,
        phrase: kw.phrase,
        theme: kw.theme,
        frequency: kw.frequency,
        avg_rating: kw.avgRating,
        approved_for_sage: kw.avgRating >= 4.5,
        approved_for_marketing: kw.avgRating >= 4.0 && kw.theme !== "logistics",
      });
    }
  }

  const { error } = await db.from("review_language").insert(rows);
  if (error) console.error("  ERROR:", error.message);
  else console.log(`  ✓ ${rows.length} review language entries inserted`);
}

// ═══════════════════════════════════════════════════════════════════════════
// SEED: Anomaly Detections
// ═══════════════════════════════════════════════════════════════════════════

async function seedAnomalyDetections() {
  console.log("\nSeeding anomaly alerts...");
  const rows = [
    {
      venue_id: VENUE.lakeview,
      organisation_id: ORG_ID,
      detected_at: fmtTs(addDays(NOW, -5)),
      metric: "cost_per_booking",
      direction: "up",
      magnitude_pct: 34,
      period_current: "last_90_days",
      period_baseline: "prior_90_days",
      current_value: 2800,
      baseline_value: 2100,
      ai_possible_causes: JSON.stringify(["The Knot listing tier unchanged but fewer conversions", "Increased competition in listing placement"]),
      ai_confidence: 78,
      ai_recommendation: "The Knot cost-per-booking has increased 34% over 90 days (from $2,100 to $2,800). Consider reducing listing tier or reallocating budget to Google Ads which converts at lower cost.",
      status: "new",
      severity: "warning",
    },
    {
      venue_id: VENUE.cooperfield,
      organisation_id: ORG_ID,
      detected_at: fmtTs(addDays(NOW, -12)),
      metric: "source_conversion_rate",
      direction: "up",
      magnitude_pct: 50,
      period_current: "february_2026",
      period_baseline: "january_2026",
      current_value: 42,
      baseline_value: 28,
      ai_possible_causes: JSON.stringify(["Instagram Reel from Feb 8 went semi-viral", "New photographer content driving higher-intent traffic"]),
      ai_confidence: 65,
      ai_recommendation: "Instagram conversion rate jumped from 28% to 42% in February. Investigate what content drove the change — likely the Feb 8 Reel. Consider boosting similar content.",
      status: "new",
      severity: "positive",
    },
    {
      venue_id: VENUE.stonehill,
      organisation_id: ORG_ID,
      detected_at: fmtTs(addDays(NOW, -3)),
      metric: "tour_capacity",
      direction: "up",
      magnitude_pct: 100,
      period_current: "next_3_weeks",
      period_baseline: "typical",
      current_value: 14,
      baseline_value: 7,
      ai_possible_causes: JSON.stringify(["Seasonal inquiry surge", "Google Ads performing above average"]),
      ai_confidence: 90,
      ai_recommendation: "Saturday tour slots are fully booked 3 weeks out. Consider adding Sunday tour availability to capture overflow demand.",
      status: "new",
      severity: "info",
    },
    {
      venue_id: VENUE.marchetti,
      organisation_id: ORG_ID,
      detected_at: fmtTs(addDays(NOW, -8)),
      metric: "source_inquiry_count",
      direction: "down",
      magnitude_pct: 100,
      period_current: "last_14_days",
      period_baseline: "prior_14_days",
      current_value: 0,
      baseline_value: 3,
      ai_possible_causes: JSON.stringify(["Google Ads account may be paused or out of budget", "Ad creative expiration"]),
      ai_confidence: 72,
      ai_recommendation: "Zero inquiries from Google Ads in the last 14 days. Check if ad account is active and budget is available.",
      status: "new",
      severity: "warning",
    },
    {
      venue_id: VENUE.lakeview,
      organisation_id: ORG_ID,
      detected_at: fmtTs(addDays(NOW, -2)),
      metric: "conversion_rate",
      direction: "down",
      magnitude_pct: 8,
      period_current: "this_month",
      period_baseline: "last_month",
      current_value: 20,
      baseline_value: 28,
      ai_possible_causes: JSON.stringify(["Response time increased to 9.1hr avg this month", "4 inquiries went cold with no response within 24 hours"]),
      ai_confidence: 85,
      ai_recommendation: "Group-wide conversion rate dropped 4 points month-over-month. Primary driver is Lakeview's 8-point decline. Address response time — currently averaging 9.1 hours.",
      status: "new",
      severity: "critical",
    },
  ];

  const { error } = await db.from("anomaly_detections").insert(rows);
  if (error) console.error("  ERROR:", error.message);
  else console.log(`  ✓ ${rows.length} anomaly alerts inserted`);
}

// ═══════════════════════════════════════════════════════════════════════════
// SEED: Weekly Insights (AI Briefings)
// ═══════════════════════════════════════════════════════════════════════════

function makeBriefing(insights: Array<{
  type: string; timeframe: string; headline: string; body: string;
  action?: string; supporting: { label: string; value: string }[];
  sentiment: string;
}>) {
  return insights.map((ins, i) => ({
    id: `demo-${i}`,
    ...ins,
    dataAvailable: true,
  }));
}

async function seedWeeklyInsights() {
  console.log("\nSeeding weekly insights (AI briefings)...");
  const rows: Record<string, unknown>[] = [];

  // Stonehill — current week
  rows.push({
    venue_id: VENUE.stonehill,
    generated_at: fmtTs(addDays(NOW, -1)),
    created_at: fmtTs(addDays(NOW, -1)),
    generated_by: "demo_seed",
    insights: makeBriefing([
      {
        type: "platform_activity", timeframe: "past",
        headline: "Strong week — 6 new inquiries",
        body: "4 tours completed, 2 bookings confirmed. Dana's response time averaged 1.2 hours, best in 30 days. Google Ads drove 4 of 6 inquiries.",
        supporting: [{ label: "New Inquiries", value: "6" }, { label: "Tours", value: "4" }, { label: "Bookings", value: "2" }, { label: "Avg Response", value: "1.2 hrs" }],
        sentiment: "positive",
      },
      {
        type: "source_performance", timeframe: "present",
        headline: "Google Ads driving 67% of this week's inquiries",
        body: "At $640 cost-per-booking, Google remains your most efficient paid channel. Current $800/month budget is well-allocated.",
        supporting: [{ label: "Google Bookings", value: "15/yr" }, { label: "Cost per Booking", value: "$640" }],
        sentiment: "positive",
      },
      {
        type: "recommendation", timeframe: "recommendation",
        headline: "Test a Google Ads budget increase",
        body: "Current budget is efficiently allocated. Consider testing a $200/month increase to capture additional high-intent searches during the spring inquiry surge.",
        action: "Increase Google Ads budget by $200/month for 60-day test",
        supporting: [{ label: "Current Budget", value: "$800/mo" }, { label: "Projected Additional Bookings", value: "2-3/yr" }],
        sentiment: "positive",
      },
    ]),
  });

  // Stonehill — 2 weeks ago
  rows.push({
    venue_id: VENUE.stonehill,
    generated_at: fmtTs(addDays(NOW, -14)),
    created_at: fmtTs(addDays(NOW, -14)),
    generated_by: "demo_seed",
    insights: makeBriefing([
      {
        type: "platform_activity", timeframe: "past",
        headline: "Steady week — 5 inquiries, 3 tours",
        body: "1 booking confirmed ($13,200 — above average). All inquiries received first response within 2 hours. Referral channel produced 2 of 5 inquiries.",
        supporting: [{ label: "Inquiries", value: "5" }, { label: "Booking Value", value: "$13,200" }],
        sentiment: "positive",
      },
      {
        type: "leading_indicator", timeframe: "future",
        headline: "Spring inquiry surge starting early",
        body: "February inquiries are running 18% above last year. Valentine's Day engagement bump is translating into tour requests earlier than typical.",
        supporting: [{ label: "Feb vs Last Year", value: "+18%" }, { label: "Tours Scheduled", value: "8 next 2 weeks" }],
        sentiment: "positive",
      },
    ]),
  });

  // Lakeview — current week
  rows.push({
    venue_id: VENUE.lakeview,
    generated_at: fmtTs(addDays(NOW, -1)),
    created_at: fmtTs(addDays(NOW, -1)),
    generated_by: "demo_seed",
    insights: makeBriefing([
      {
        type: "platform_activity", timeframe: "past",
        headline: "12 inquiries but only 3 tours booked",
        body: "25% inquiry-to-tour rate, below your 90-day average of 32%. Marcus's average first response was 9.1 hours this week, up from 7.2 last week. 4 inquiries went cold with no response within 24 hours.",
        supporting: [{ label: "Inquiries", value: "12" }, { label: "Tours Booked", value: "3" }, { label: "Avg Response", value: "9.1 hrs" }, { label: "Cold Inquiries", value: "4" }],
        sentiment: "negative",
      },
      {
        type: "source_performance", timeframe: "present",
        headline: "The Knot cost-per-booking climbing",
        body: "The Knot cost-per-booking has risen to $2,800 — 34% higher than 90 days ago. Meanwhile, Google converts at $900 per booking with less spend.",
        supporting: [{ label: "Knot CPB", value: "$2,800" }, { label: "Google CPB", value: "$900" }, { label: "Knot Spend", value: "$500/mo" }],
        sentiment: "caution",
      },
      {
        type: "recommendation", timeframe: "recommendation",
        headline: "Implement a 2-hour response SLA",
        body: "Response time is the primary driver of Lakeview's low conversion. When Marcus responds within 2 hours, tour-booking rate jumps to 58% vs 24% when slower. Consider automated first-touch emails for after-hours inquiries.",
        action: "Set up automated first-touch email response for inquiries received outside business hours",
        supporting: [{ label: "Fast Response Conversion", value: "58%" }, { label: "Slow Response Conversion", value: "24%" }],
        sentiment: "caution",
      },
    ]),
  });

  // Lakeview — 2 weeks ago
  rows.push({
    venue_id: VENUE.lakeview,
    generated_at: fmtTs(addDays(NOW, -14)),
    created_at: fmtTs(addDays(NOW, -14)),
    generated_by: "demo_seed",
    insights: makeBriefing([
      {
        type: "platform_activity", timeframe: "past",
        headline: "High volume, low conversion continues",
        body: "14 inquiries, 4 tours, 1 booking. Response time averaged 7.2 hours. WeddingWire produced 4 inquiries but 0 tours — worst performing source.",
        supporting: [{ label: "Inquiries", value: "14" }, { label: "Bookings", value: "1" }, { label: "WeddingWire Tours", value: "0" }],
        sentiment: "negative",
      },
    ]),
  });

  // Marchetti — current week
  rows.push({
    venue_id: VENUE.marchetti,
    generated_at: fmtTs(addDays(NOW, -1)),
    created_at: fmtTs(addDays(NOW, -1)),
    generated_by: "demo_seed",
    insights: makeBriefing([
      {
        type: "platform_activity", timeframe: "past",
        headline: "Quiet week — 3 inquiries, all referrals",
        body: "2 tours completed, 1 booking confirmed at $15,800 — above your $14,200 average. Priya mentioned by name in a new 5-star Google review this week.",
        supporting: [{ label: "Inquiries", value: "3" }, { label: "Booking Value", value: "$15,800" }, { label: "New Review", value: "5 stars" }],
        sentiment: "positive",
      },
      {
        type: "source_performance", timeframe: "present",
        headline: "Referral pipeline at $0 acquisition cost",
        body: "Your referral pipeline continues to be your strongest channel — 45% of all inquiries, 74% conversion, zero acquisition cost. This is your competitive moat.",
        supporting: [{ label: "Referral Share", value: "45%" }, { label: "Referral Conversion", value: "74%" }, { label: "Acquisition Cost", value: "$0" }],
        sentiment: "positive",
      },
      {
        type: "recommendation", timeframe: "recommendation",
        headline: "Amplify referrals with a simple card program",
        body: "A simple 'refer a friend' card given to recent couples could amplify this organically. Even a 10% increase in referrals would add 3-4 bookings per year at zero cost.",
        action: "Create referral cards to give couples after their wedding",
        supporting: [{ label: "Potential Additional Bookings", value: "3-4/yr" }, { label: "Cost", value: "$0" }],
        sentiment: "positive",
      },
    ]),
  });

  // Cooperfield — current week
  rows.push({
    venue_id: VENUE.cooperfield,
    generated_at: fmtTs(addDays(NOW, -1)),
    created_at: fmtTs(addDays(NOW, -1)),
    generated_by: "demo_seed",
    insights: makeBriefing([
      {
        type: "platform_activity", timeframe: "past",
        headline: "4 inquiries, trending up month-over-month",
        body: "Inquiry volume is up 22% vs. last month. Instagram drove 2 of 4 inquiries. Jordan's response time improved to 2.8 hours — best month yet.",
        supporting: [{ label: "Inquiries", value: "4" }, { label: "MoM Change", value: "+22%" }, { label: "Jordan Avg Response", value: "2.8 hrs" }],
        sentiment: "positive",
      },
      {
        type: "leading_indicator", timeframe: "future",
        headline: "Building momentum as a new venue",
        body: "Conversion rate has improved from 31% to 38% over the last quarter. Review count is still low (14) — getting to 25+ reviews will unlock credibility on listing sites.",
        supporting: [{ label: "Conversion Trend", value: "31% → 38%" }, { label: "Reviews", value: "14 (target: 25+)" }],
        sentiment: "neutral",
      },
    ]),
  });

  console.log(`  Inserting ${rows.length} weekly insight briefings...`);
  const { error } = await db.from("weekly_insights").insert(rows);
  if (error) console.error("  ERROR:", error.message);
  else console.log(`  ✓ ${rows.length} briefings inserted`);
}

// ═══════════════════════════════════════════════════════════════════════════
// SEED: Venue Health Scores
// ═══════════════════════════════════════════════════════════════════════════

async function seedVenueHealth() {
  console.log("\nSeeding venue health scores...");
  const rows = [
    {
      venue_id: VENUE.stonehill,
      calculated_at: fmtTs(addDays(NOW, -1)),
      health_score: 88,
      status: "green",
      booking_pace_score: 92,
      conversion_score: 85,
      response_time_score: 95,
      review_trend_score: 90,
      inquiry_trend_score: 82,
      lost_deal_score: 78,
      alerts: ["Saturday tours fully booked 3 weeks out"],
      recommendations: ["Add Sunday tour slots"],
    },
    {
      venue_id: VENUE.lakeview,
      calculated_at: fmtTs(addDays(NOW, -1)),
      health_score: 42,
      status: "red",
      booking_pace_score: 45,
      conversion_score: 28,
      response_time_score: 15,
      review_trend_score: 55,
      inquiry_trend_score: 72,
      lost_deal_score: 35,
      alerts: [
        "Response time 6.2hrs — 3x above benchmark",
        "The Knot CPB up 34% in 90 days",
      ],
      recommendations: [
        "Implement 2-hour response SLA",
        "Reduce The Knot spend, increase Google Ads",
      ],
    },
    {
      venue_id: VENUE.marchetti,
      calculated_at: fmtTs(addDays(NOW, -1)),
      health_score: 94,
      status: "green",
      booking_pace_score: 88,
      conversion_score: 96,
      response_time_score: 88,
      review_trend_score: 98,
      inquiry_trend_score: 75,
      lost_deal_score: 92,
      alerts: ["Zero Google Ads inquiries in 14 days — check account"],
      recommendations: ["Test modest Google Ads spend ($300/mo)"],
    },
    {
      venue_id: VENUE.cooperfield,
      calculated_at: fmtTs(addDays(NOW, -1)),
      health_score: 65,
      status: "amber",
      booking_pace_score: 58,
      conversion_score: 62,
      response_time_score: 70,
      review_trend_score: 55,
      inquiry_trend_score: 78,
      lost_deal_score: 60,
      alerts: ["Only 14 reviews — below credibility threshold"],
      recommendations: ["Prioritize review collection to reach 25+"],
    },
  ];

  const { error } = await db.from("venue_health").insert(rows);
  if (error) console.error("  ERROR:", error.message);
  else console.log(`  ✓ ${rows.length} venue health records inserted`);
}

// ═══════════════════════════════════════════════════════════════════════════
// SEED: Revenue Forecasts
// ═══════════════════════════════════════════════════════════════════════════

async function seedRevenueForecasts() {
  console.log("\nSeeding revenue forecasts...");
  const rows: Record<string, unknown>[] = [];

  const quarters = [
    { start: "2026-04-01", end: "2026-06-30", label: "Q2 2026" },
    { start: "2026-07-01", end: "2026-09-30", label: "Q3 2026" },
    { start: "2026-10-01", end: "2026-12-31", label: "Q4 2026" },
    { start: "2027-01-01", end: "2027-03-31", label: "Q1 2027" },
  ];

  const venueForecasts: Record<string, { contracted: number; held: number; pipeline: number }[]> = {
    [VENUE.stonehill]:   [{ contracted: 450000, held: 180000, pipeline: 120000 }, { contracted: 520000, held: 200000, pipeline: 150000 }, { contracted: 280000, held: 100000, pipeline: 80000 }, { contracted: 120000, held: 60000, pipeline: 40000 }],
    [VENUE.lakeview]:    [{ contracted: 320000, held: 120000, pipeline: 100000 }, { contracted: 380000, held: 150000, pipeline: 120000 }, { contracted: 150000, held: 60000, pipeline: 50000 }, { contracted: 50000, held: 30000, pipeline: 20000 }],
    [VENUE.marchetti]:   [{ contracted: 380000, held: 140000, pipeline: 90000 }, { contracted: 420000, held: 160000, pipeline: 110000 }, { contracted: 250000, held: 90000, pipeline: 60000 }, { contracted: 100000, held: 50000, pipeline: 30000 }],
    [VENUE.cooperfield]: [{ contracted: 160000, held: 80000, pipeline: 60000 }, { contracted: 200000, held: 100000, pipeline: 80000 }, { contracted: 100000, held: 50000, pipeline: 40000 }, { contracted: 40000, held: 20000, pipeline: 15000 }],
  };

  for (const vid of ALL_VENUE_IDS) {
    const forecasts = venueForecasts[vid] || [];
    quarters.forEach((q, i) => {
      const f = forecasts[i];
      if (!f) return;
      const total = f.contracted + f.held + f.pipeline;
      rows.push({
        venue_id: vid,
        forecast_date: fmtDate(NOW),
        period_start: q.start,
        period_end: q.end,
        contracted_revenue_cents: vary(f.contracted * 100),
        held_revenue_cents: vary(f.held * 100),
        pipeline_revenue_cents: vary(f.pipeline * 100),
        total_forecast_cents: vary(total * 100),
        confidence_level: i === 0 ? "high" : i === 1 ? "medium" : "low",
      });
    });
  }

  const { error } = await db.from("revenue_forecasts").insert(rows);
  if (error) console.error("  ERROR:", error.message);
  else console.log(`  ✓ ${rows.length} revenue forecast records inserted`);
}

// ═══════════════════════════════════════════════════════════════════════════
// SEED: Venue Capacity
// ═══════════════════════════════════════════════════════════════════════════

async function seedVenueCapacity() {
  console.log("\nSeeding venue capacity...");
  const rows: Record<string, unknown>[] = [];

  for (const vc of VENUES) {
    // Generate monthly capacity for the next 12 months
    for (let offset = 0; offset < 12; offset++) {
      const d = new Date(NOW.getFullYear(), NOW.getMonth() + offset, 1);
      const month = d.getMonth();
      const year = d.getFullYear();
      const isPeak = vc.peakMonths.includes(month);

      const totalDates = isPeak ? rand(8, 12) : rand(4, 8);
      const booked = isPeak ? rand(4, totalDates - 1) : rand(1, Math.max(1, totalDates - 3));
      const held = rand(0, Math.min(3, totalDates - booked));
      const occupancy = ((booked + held) / totalDates * 100);

      rows.push({
        venue_id: vc.id,
        month: `${year}-${String(month + 1).padStart(2, "0")}-01`,
        year,
        total_available_dates: totalDates,
        booked_dates: booked,
        held_dates: held,
        occupancy_pct: Math.round(occupancy * 100) / 100,
        avg_revenue_per_event_cents: vc.avgBookingCents,
        is_peak: isPeak,
      });
    }
  }

  const { error } = await db.from("venue_capacity").insert(rows);
  if (error) console.error("  ERROR:", error.message);
  else console.log(`  ✓ ${rows.length} capacity records inserted`);
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log("═".repeat(60));
  console.log("  Bloom Intelligence — Demo Seed Data Generator");
  console.log("  Organisation: Crestwood Hospitality Group");
  console.log("  Venues: 4 | Consultants: 4 | Data Window: 24 months");
  console.log("═".repeat(60));
  console.log();

  // Always clear first
  await clearDemoData();

  if (CLEAN_ONLY) {
    console.log("\n--clean flag: done. No new data inserted.");
    return;
  }

  // Structure
  await seedOrg();
  await seedVenues();
  await seedVenueUsers();

  // Core data per venue
  const allClientIds = new Map<string, string[]>();
  for (const vc of VENUES) {
    const { clientIds } = await seedVenueData(vc);
    allClientIds.set(vc.id, clientIds);
  }

  // Supporting data
  await seedChannelSpend();
  await seedReviews(allClientIds);
  await seedReviewLanguage();
  await seedAnomalyDetections();
  await seedWeeklyInsights();
  await seedVenueHealth();
  await seedRevenueForecasts();
  await seedVenueCapacity();

  // Summary
  console.log("\n" + "═".repeat(60));
  console.log("  SEED COMPLETE — Summary");
  console.log("═".repeat(60));

  let totalClients = 0, totalInquiries = 0;
  for (const vc of VENUES) {
    const c = Object.values(vc.counts).reduce((a, b) => a + b, 0);
    const i = c + vc.unmatchedCount;
    totalClients += c;
    totalInquiries += i;
    console.log(`  ${vc.name}: ${c} clients, ${i} inquiries`);
  }

  console.log(`\n  Total clients:    ${totalClients}`);
  console.log(`  Total inquiries:  ${totalInquiries}`);
  console.log(`  Total bookings:   ${VENUES.reduce((a, v) => a + v.counts.event_complete + v.counts.contracted, 0)}`);
  console.log(`  Total lost:       ${VENUES.reduce((a, v) => a + v.counts.lost, 0)}`);
  console.log(`  Reviews:          ${VENUES.reduce((a, v) => a + v.reviewDist.reduce((x, r) => x + r[1], 0), 0)}`);
  console.log(`  Anomaly alerts:   5`);
  console.log(`  AI Briefings:     ${VENUES.length * 2}`);
  console.log("═".repeat(60));
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
