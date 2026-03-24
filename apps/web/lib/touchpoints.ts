/**
 * Canonical list of initial touchpoints — ways couples first discover a venue.
 * Also defines first-contact channels and inquiry intent levels.
 * Used in onboarding, setup checklist, attribution analysis, and reporting.
 * Single source of truth — do not duplicate elsewhere.
 */

export interface Touchpoint {
  value: string;
  label: string;
  category: TouchpointCategory;
}

export type TouchpointCategory =
  | "Directories"
  | "Search & Maps"
  | "Social — Organic"
  | "Social — Paid"
  | "Referrals"
  | "Press & Editorial"
  | "Events"
  | "AI Tools";

export const TOUCHPOINTS: Touchpoint[] = [
  // Directories
  { value: "the_knot",            label: "The Knot",               category: "Directories" },
  { value: "wedding_wire",        label: "WeddingWire",            category: "Directories" },
  { value: "zola",                label: "Zola",                   category: "Directories" },
  { value: "here_comes_the_guide",label: "Here Comes The Guide",   category: "Directories" },
  { value: "eventective",         label: "Eventective",            category: "Directories" },
  { value: "wedding_spot",        label: "Wedding Spot",           category: "Directories" },
  { value: "the_venue_report",    label: "The Venue Report",       category: "Directories" },
  { value: "wezoree",             label: "Wezoree",                category: "Directories" },
  { value: "off_beat_wed",        label: "Offbeat Wed",            category: "Directories" },

  // Search & Maps
  { value: "google_search",       label: "Google Search",          category: "Search & Maps" },
  { value: "google_maps",         label: "Google Maps",            category: "Search & Maps" },
  { value: "bing_search",         label: "Bing Search",            category: "Search & Maps" },
  { value: "bing_maps",           label: "Bing Maps",              category: "Search & Maps" },
  { value: "yelp",                label: "Yelp",                   category: "Search & Maps" },

  // Social — Organic
  { value: "instagram",           label: "Instagram",              category: "Social — Organic" },
  { value: "pinterest",           label: "Pinterest",              category: "Social — Organic" },
  { value: "tiktok",              label: "TikTok",                 category: "Social — Organic" },
  { value: "youtube",             label: "YouTube",                category: "Social — Organic" },
  { value: "facebook",            label: "Facebook",               category: "Social — Organic" },
  { value: "reddit",              label: "Reddit",                 category: "Social — Organic" },

  // Social — Paid
  { value: "instagram_ads",       label: "Instagram Ads",          category: "Social — Paid" },
  { value: "pinterest_ads",       label: "Pinterest Ads",          category: "Social — Paid" },
  { value: "tiktok_ads",          label: "TikTok Ads",             category: "Social — Paid" },
  { value: "google_ads",          label: "Google Ads",             category: "Social — Paid" },

  // Referrals
  { value: "past_couple_referral",label: "Past couple",            category: "Referrals" },
  { value: "planner_referral",    label: "Wedding planner",        category: "Referrals" },
  { value: "photographer_referral",label: "Photographer",          category: "Referrals" },
  { value: "vendor_referral",     label: "Other vendor (caterer, florist, DJ…)", category: "Referrals" },
  { value: "friend_family_referral",label: "Friend or family",     category: "Referrals" },

  // Press & Editorial
  { value: "styled_shoots",       label: "Styled shoots",          category: "Press & Editorial" },
  { value: "wedding_blogs",       label: "Wedding blogs",          category: "Press & Editorial" },
  { value: "wedding_magazines",   label: "Wedding magazines",      category: "Press & Editorial" },
  { value: "press_features",      label: "Press / features",       category: "Press & Editorial" },
  { value: "real_weddings_features",label: "Real weddings features",category: "Press & Editorial" },
  { value: "influencer_features", label: "Influencer features",    category: "Press & Editorial" },

  // Events
  { value: "bridal_expo",         label: "Bridal expo / show",     category: "Events" },
  { value: "venue_open_house",    label: "Open house",             category: "Events" },

  // AI Tools
  { value: "ai_tools",            label: "AI tools (ChatGPT, Perplexity, etc.)", category: "AI Tools" },
];

/** Flat array of values — useful for validation */
export const TOUCHPOINT_VALUES = TOUCHPOINTS.map(t => t.value);

/** Categories that venues pay for — used in the channel spend UI */
const PAID_CATEGORIES: TouchpointCategory[] = ["Directories", "Search & Maps", "Social — Paid"];

/** Channels with advertising spend — returns objects with id/label/category for UI selects */
export function getPaidChannels(): Array<{ id: string; label: string; category: string }> {
  return TOUCHPOINTS
    .filter(t => PAID_CATEGORIES.includes(t.category))
    .map(t => ({ id: t.value, label: t.label, category: t.category }));
}

/** Grouped by category — useful for rendering segmented selectors */
export const TOUCHPOINTS_BY_CATEGORY = TOUCHPOINTS.reduce<
  Record<TouchpointCategory, Touchpoint[]>
>((acc, t) => {
  if (!acc[t.category]) acc[t.category] = [];
  acc[t.category].push(t);
  return acc;
}, {} as Record<TouchpointCategory, Touchpoint[]>);

export const TOUCHPOINT_CATEGORY_ORDER: TouchpointCategory[] = [
  "Directories",
  "Search & Maps",
  "Social — Organic",
  "Social — Paid",
  "Referrals",
  "Press & Editorial",
  "Events",
  "AI Tools",
];

// ─────────────────────────────────────────────────────────────────────────────
// FIRST-CONTACT CHANNELS
// How a couple makes initial contact — distinct from how they discovered the venue.
// ─────────────────────────────────────────────────────────────────────────────

export interface FirstContactChannel {
  value: string;
  label: string;
  category: FirstContactCategory;
}

export type FirstContactCategory =
  | "Directory"
  | "Website"
  | "Direct";

export const FIRST_CONTACT_CHANNELS: FirstContactChannel[] = [
  // Directory — came through a listing site's inquiry system
  { value: "the_knot_inquiry",        label: "The Knot — direct inquiry",   category: "Directory" },
  { value: "the_knot_also_contacted", label: "The Knot — also contacted",   category: "Directory" },
  { value: "wedding_wire_inquiry",    label: "WeddingWire inquiry",         category: "Directory" },
  { value: "zola_inquiry",            label: "Zola inquiry",                category: "Directory" },
  { value: "here_comes_the_guide_inquiry", label: "Here Comes The Guide inquiry", category: "Directory" },
  { value: "eventective_inquiry",     label: "Eventective inquiry",         category: "Directory" },
  { value: "other_directory_inquiry", label: "Other directory inquiry",     category: "Directory" },

  // Website — came through the venue's own website
  { value: "website_contact_form",    label: "Website contact form",        category: "Website" },
  { value: "website_quiz",            label: "Website quiz",                category: "Website" },
  { value: "website_quote_calculator",label: "Website pricing calculator",  category: "Website" },

  // Direct — reached out without going through a platform
  { value: "direct_email",            label: "Direct email",                category: "Direct" },
  { value: "direct_text",             label: "Text / SMS",                  category: "Direct" },
  { value: "phone_call",              label: "Phone call",                  category: "Direct" },
];

export const FIRST_CONTACT_CATEGORY_ORDER: FirstContactCategory[] = [
  "Directory",
  "Website",
  "Direct",
];

// ─────────────────────────────────────────────────────────────────────────────
// INQUIRY INTENT LEVEL
// Captures how intentional the inquiry was — critical for conversion rate analysis.
// A couple who chose you specifically is fundamentally different from one
// who was auto-blasted to you by The Knot after inquiring with a competitor.
// ─────────────────────────────────────────────────────────────────────────────

export type InquiryIntent =
  | "chosen"        // Couple deliberately chose this venue — came directly to the profile/site
  | "also_contacted"// Couple was prompted by a platform after inquiring with a competitor ("also contact these 5 venues")
  | "unknown";      // Intent cannot be determined

export const INQUIRY_INTENT_LABELS: Record<InquiryIntent, string> = {
  chosen:          "Chose us directly",
  also_contacted:  "Also contacted (platform blast)",
  unknown:         "Unknown",
};

export const INQUIRY_INTENT_DESCRIPTIONS: Record<InquiryIntent, string> = {
  chosen:
    "Couple deliberately found and contacted this venue. May have viewed the profile, saved it, or come through search/social.",
  also_contacted:
    "Couple inquired with another venue and was prompted by the platform to also contact us. " +
    "May never have seen a single photo. Typically converts at a much lower rate — track separately.",
  unknown:
    "Source of intent could not be determined from available data.",
};

// ─────────────────────────────────────────────────────────────────────────────
// DIRECTORY ENGAGEMENT STAGES (The Knot / WeddingWire / Zola model)
// Pre-inquiry signals from directory platforms — show funnel depth before contact.
// ─────────────────────────────────────────────────────────────────────────────

export type DirectoryEngagementStage =
  | "impression"        // Appeared in search results — may not have clicked
  | "profile_view"      // Clicked through and viewed the profile
  | "profile_saved"     // Saved / hearted / favourited the venue
  | "website_clickthrough" // Clicked from directory profile to venue's own website — high intent
  | "inquired";         // Sent an inquiry message

export const DIRECTORY_ENGAGEMENT_LABELS: Record<DirectoryEngagementStage, string> = {
  impression:           "Appeared in search",
  profile_view:         "Viewed profile",
  profile_saved:        "Saved profile",
  website_clickthrough: "Clicked to venue website",
  inquired:             "Sent inquiry",
};

// Intent ranking — higher = more deliberate
export const DIRECTORY_ENGAGEMENT_INTENT_RANK: Record<DirectoryEngagementStage, number> = {
  impression:           1,
  profile_view:         2,
  profile_saved:        3,
  website_clickthrough: 4,  // Clicked out to venue site — very high intent
  inquired:             5,
};

// ─────────────────────────────────────────────────────────────────────────────
// TOUCHPOINT ATTRIBUTION MODEL
//
// When an inquiry arrives, the system attempts to find earlier signals for
// that couple before classifying the inquiry as their first known interaction.
//
// Goal: distinguish "this inquiry IS the first touch" from "this inquiry is
// downstream of an earlier touchpoint we can identify."
//
// This matters because:
//   - It changes how you respond (warm vs cold lead)
//   - It changes attribution — crediting Instagram for a Knot inquiry
//   - It reveals your real awareness-to-inquiry lag (often weeks or months)
//   - It identifies couples who are further along than they appear
// ─────────────────────────────────────────────────────────────────────────────

export type TouchpointAttributionModel =
  | "first_touch"   // Credit goes entirely to the first known touchpoint
  | "last_touch"    // Credit goes entirely to the channel that drove the inquiry
  | "linear"        // Credit split equally across all known touchpoints
  | "time_decay";   // More credit to touchpoints closer to the inquiry

/**
 * A single recorded touchpoint in a couple's journey.
 * The system builds a timeline of these, ordered by occurred_at.
 */
export interface TouchpointRecord {
  id: string;
  type: TouchpointRecordType;
  channel: string;              // value from TOUCHPOINTS or FIRST_CONTACT_CHANNELS
  occurredAt: string;           // ISO timestamp
  source: TouchpointRecordSource;
  confidence: "confirmed" | "inferred" | "possible";
  notes?: string;
}

/**
 * The type of interaction this touchpoint represents.
 */
export type TouchpointRecordType =
  | "discovery"      // First time they encountered the venue (Instagram post, Knot search result, etc.)
  | "profile_view"   // Viewed the venue profile on a directory
  | "profile_save"   // Saved / hearted / favourited the venue on a directory
  | "website_visit"  // Visited the venue's own website
  | "content_engage" // Engaged with content (liked post, watched reel, etc.)
  | "inquiry"        // Sent an inquiry — this is the conversion event
  | "tour_booked"    // Booked a tour
  | "follow_up"      // Re-engaged after going quiet
  | "referral_given";// Referred another couple after their own wedding

/**
 * Where this touchpoint record came from — affects how much to trust it.
 */
export type TouchpointRecordSource =
  | "directory_data"   // Pulled from The Knot / WeddingWire analytics export
  | "gmail_thread"     // Found in Gmail — prior email before the formal inquiry
  | "website_analytics"// Website visit log / form submission log
  | "crm_import"       // Imported from HoneyBook or other CRM
  | "manual"           // Entered manually by the venue team
  | "inferred";        // System inferred from available signals (e.g. inquiry mentions "I've been following you for a while")

/**
 * Classification of a couple's inquiry relative to their known touchpoint history.
 * Determined automatically when an inquiry is processed.
 */
export type InquiryTouchpointClassification =
  | "inquiry_is_first_touch"
    // No prior signal found anywhere. This is their first known interaction.
    // Could mean: cold lead, or they were careful (no account, browsed incognito).
    // Treat as warm-ish but don't assume familiarity.

  | "inquiry_preceded_by_awareness"
    // Prior signal exists — they knew about the venue before they inquired.
    // Sub-cases tracked in priorTouchpoints array.
    // Treat as a warm lead — they chose you after consideration.

  | "returning_inquiry"
    // This couple has inquired before (different date, perhaps different year).
    // Treat carefully — something stopped them last time. Find out what.

  | "unknown";
    // Cannot determine — not enough data.

export const INQUIRY_CLASSIFICATION_LABELS: Record<InquiryTouchpointClassification, string> = {
  inquiry_is_first_touch:         "First touch",
  inquiry_preceded_by_awareness:  "Warm — prior touchpoint found",
  returning_inquiry:              "Returning — inquired before",
  unknown:                        "Unknown",
};

export const INQUIRY_CLASSIFICATION_DESCRIPTIONS: Record<InquiryTouchpointClassification, string> = {
  inquiry_is_first_touch:
    "No prior signal found. This inquiry appears to be their first interaction with the venue. " +
    "May be a cold lead, or they researched without leaving a trace.",
  inquiry_preceded_by_awareness:
    "At least one earlier touchpoint exists before this inquiry — a profile view, save, " +
    "website visit, or social engagement. They chose to reach out after considering the venue.",
  returning_inquiry:
    "This couple or email has inquired before. Something stopped them previously. " +
    "Check the prior inquiry history before responding.",
  unknown:
    "Attribution data is insufficient to classify this inquiry.",
};

/**
 * Sources the system checks automatically when an inquiry arrives,
 * in order of reliability. First match wins for first-touch attribution.
 */
export const PRIOR_TOUCHPOINT_LOOKUP_SOURCES = [
  { source: "directory_data",    label: "Directory analytics",  description: "The Knot / WeddingWire profile views and saves" },
  { source: "gmail_thread",      label: "Gmail history",        description: "Prior email thread before the formal inquiry" },
  { source: "website_analytics", label: "Website visits",       description: "Form submissions, quiz starts, calculator uses" },
  { source: "crm_import",        label: "CRM history",          description: "HoneyBook or prior system records" },
  { source: "manual",            label: "Manual record",        description: "Team-entered note about a prior interaction" },
] as const;
