/**
 * Calendly Q&A Parser
 *
 * Parses the raw invitee_qa JSONB from Calendly tour/call bookings.
 * Extracts structured fields and uses them to:
 *   1. Enrich the client/inquiry record
 *   2. Correct source attribution (Calendly answer > inquiry channel)
 *   3. Confirm wedding date and guest count
 *
 * Calendly Q&A format:
 *   [{ question: "...", answer: "..." }, ...]
 */

import { TOUCHPOINT_VALUES } from "@/lib/touchpoints";

export interface CalendlyQAParsed {
  weddingDate: string | null;         // ISO date string
  guestCount: number | null;
  partnerOneName: string | null;
  partnerTwoName: string | null;
  selfReportedSource: string | null;  // Raw answer to "where did you hear about us"
  resolvedSource: string | null;      // Matched to a TOUCHPOINTS value
  sourceConfidence: "high" | "medium" | "low";
  rawAnswers: Record<string, string>; // All Q&A pairs keyed by normalised question
}

// Keywords that map to touchpoint values
// Order matters — more specific patterns first
const SOURCE_PATTERNS: Array<{ pattern: RegExp; value: string }> = [
  { pattern: /here comes the guide/i,       value: "here_comes_the_guide" },
  { pattern: /wedding wire|weddingwire/i,   value: "wedding_wire" },
  { pattern: /the knot|theknot/i,           value: "the_knot" },
  { pattern: /\bzola\b/i,                   value: "zola" },
  { pattern: /eventective/i,                value: "eventective" },
  { pattern: /wedding spot/i,               value: "wedding_spot" },
  { pattern: /venue report/i,               value: "the_venue_report" },
  { pattern: /google maps/i,                value: "google_maps" },
  { pattern: /\bgoogle\b/i,                 value: "google_search" },
  { pattern: /\bbing\b/i,                   value: "bing_search" },
  { pattern: /\byelp\b/i,                   value: "yelp" },
  { pattern: /instagram|ig\b/i,             value: "instagram" },
  { pattern: /\bpinterest\b/i,              value: "pinterest" },
  { pattern: /\btiktok\b/i,                 value: "tiktok" },
  { pattern: /\byoutube\b/i,                value: "youtube" },
  { pattern: /\bfacebook\b/i,               value: "facebook" },
  { pattern: /\breddit\b/i,                 value: "reddit" },
  // Referral patterns — these are the most valuable to capture
  { pattern: /photographer|photo/i,         value: "photographer_referral" },
  { pattern: /planner|coordinator/i,        value: "planner_referral" },
  { pattern: /florist|caterer|vendor|dj\b/i,value: "vendor_referral" },
  // Word of mouth — check AFTER specific referral types
  { pattern: /friend|family|sister|brother|parents?|mom|dad|cousin|aunt|uncle/i, value: "friend_family_referral" },
  { pattern: /wedding.*attended|attended.*wedding|was.*guest|went.*wedding/i,    value: "past_couple_referral" },
  { pattern: /previous couple|past couple|client|they (got|were) married/i,      value: "past_couple_referral" },
  { pattern: /word of mouth|recommended|recommendation/i, value: "past_couple_referral" },
  // Editorial
  { pattern: /styled shoot|blog|feature|article|magazine/i, value: "wedding_blogs" },
  { pattern: /\bai\b|chatgpt|perplexity/i,  value: "ai_tools" },
  { pattern: /bridal (show|expo|fair)/i,    value: "bridal_expo" },
  { pattern: /open house/i,                 value: "venue_open_house" },
];

function normaliseQuestion(question: string): string {
  return question.toLowerCase().trim().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, "_");
}

function isWeddingDateQuestion(q: string): boolean {
  return /date|when|wedding date/i.test(q);
}

function isGuestCountQuestion(q: string): boolean {
  return /guest|count|number|how many|size/i.test(q);
}

function isNamesQuestion(q: string): boolean {
  return /name|partner|couple|who/i.test(q);
}

function isSourceQuestion(q: string): boolean {
  return /hear|find|discover|refer|source|how.*know|learn/i.test(q);
}

function parseDate(raw: string): string | null {
  if (!raw?.trim()) return null;
  // Try direct parse first
  const d = new Date(raw.trim());
  if (!isNaN(d.getTime()) && d.getFullYear() > 2020) {
    return d.toISOString().split("T")[0];
  }
  // Try common formats: "October 15, 2026", "10/15/2026", "2026-10-15"
  const patterns = [
    /(\w+ \d{1,2},?\s*\d{4})/,
    /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/,
    /(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/,
  ];
  for (const p of patterns) {
    const m = raw.match(p);
    if (m) {
      const d2 = new Date(m[1]);
      if (!isNaN(d2.getTime())) return d2.toISOString().split("T")[0];
    }
  }
  return null;
}

function parseGuestCount(raw: string): number | null {
  if (!raw?.trim()) return null;
  // Handle ranges like "75-100" — take midpoint
  const rangeMatch = raw.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (rangeMatch) {
    return Math.round((parseInt(rangeMatch[1]) + parseInt(rangeMatch[2])) / 2);
  }
  // Handle "about 80", "around 100", "~75"
  const numMatch = raw.match(/\d+/);
  return numMatch ? parseInt(numMatch[0]) : null;
}

function parseNames(raw: string): { partnerOne: string | null; partnerTwo: string | null } {
  if (!raw?.trim()) return { partnerOne: null, partnerTwo: null };
  // "Sarah and Tom", "Sarah & Tom", "Sarah Mitchell and Tom Jones"
  const andMatch = raw.match(/^([^&\n]+?)\s+(?:and|&)\s+(.+)$/i);
  if (andMatch) {
    return {
      partnerOne: andMatch[1].trim(),
      partnerTwo: andMatch[2].trim(),
    };
  }
  // Single name
  return { partnerOne: raw.trim(), partnerTwo: null };
}

function resolveSource(rawAnswer: string): { resolved: string | null; confidence: "high" | "medium" | "low" } {
  if (!rawAnswer?.trim()) return { resolved: null, confidence: "low" };

  // Try each pattern
  for (const { pattern, value } of SOURCE_PATTERNS) {
    if (pattern.test(rawAnswer)) {
      // High confidence if the answer is short and specific
      // Low confidence if the answer is long and the match is incidental
      const confidence = rawAnswer.length < 60 ? "high" : "medium";
      return { resolved: value, confidence };
    }
  }

  // If it mentions a person's name ("My friend Lisa", "Our photographer Jessica")
  // treat it as word of mouth even if we can't classify further
  if (/\b(my|our|a)\b.{0,20}\b(friend|sister|brother|colleague|co-?worker)/i.test(rawAnswer)) {
    return { resolved: "friend_family_referral", confidence: "medium" };
  }

  return { resolved: null, confidence: "low" };
}

/**
 * Parse raw Calendly invitee_qa JSON into structured fields.
 */
export function parseCalendlyQA(rawQA: unknown): CalendlyQAParsed {
  const result: CalendlyQAParsed = {
    weddingDate: null,
    guestCount: null,
    partnerOneName: null,
    partnerTwoName: null,
    selfReportedSource: null,
    resolvedSource: null,
    sourceConfidence: "low",
    rawAnswers: {},
  };

  if (!Array.isArray(rawQA)) return result;

  for (const qa of rawQA) {
    if (!qa?.question || !qa?.answer) continue;
    const q = String(qa.question);
    const a = String(qa.answer).trim();
    if (!a || a === "N/A" || a === "-") continue;

    result.rawAnswers[normaliseQuestion(q)] = a;

    if (isWeddingDateQuestion(q)) {
      result.weddingDate = parseDate(a);
    } else if (isGuestCountQuestion(q)) {
      result.guestCount = parseGuestCount(a);
    } else if (isNamesQuestion(q)) {
      const { partnerOne, partnerTwo } = parseNames(a);
      result.partnerOneName = partnerOne;
      result.partnerTwoName = partnerTwo;
    } else if (isSourceQuestion(q)) {
      result.selfReportedSource = a;
      const { resolved, confidence } = resolveSource(a);
      result.resolvedSource = resolved;
      result.sourceConfidence = confidence;
    }
  }

  return result;
}

/**
 * Determine whether the Calendly source answer should override
 * the inquiry's resolved_source.
 *
 * Calendly answer wins when:
 *   - Inquiry source was unknown or came from an also_contacted blast
 *   - Calendly answer is high confidence
 *   - Calendly answer is a referral (most specific, hardest to infer otherwise)
 */
export function shouldOverrideInquirySource(
  existingSource: string | null,
  existingIntent: string | null,
  newSource: string | null,
  newConfidence: "high" | "medium" | "low",
): boolean {
  if (!newSource) return false;
  if (newConfidence === "low") return false;

  // Never touch booked / signed clients — source attribution is already locked in
  if (existingIntent === "booked" || existingIntent === "signed") return false;

  // Always override if inquiry source is unknown
  if (!existingSource || existingSource === "unknown") return true;

  // Same source — no point updating
  if (existingSource === newSource) return false;

  // Always override if this was an also_contacted blast
  // (the Calendly answer reveals the REAL touchpoint)
  if (existingIntent === "also_contacted") return true;

  // Override with referral info — referrals are specific and valuable
  const referralSources = [
    "past_couple_referral",
    "planner_referral",
    "photographer_referral",
    "vendor_referral",
    "friend_family_referral",
  ];
  if (referralSources.includes(newSource) && newConfidence === "high") return true;

  // Accept any medium/high upgrade
  if (newConfidence === "high" || newConfidence === "medium") return true;

  return false;
}

/** Convert a SourceConfidence string to a numeric score stored in the DB. */
export function confidenceToScore(confidence: "high" | "medium" | "low"): number {
  if (confidence === "high") return 85;
  if (confidence === "medium") return 60;
  return 40;
}
