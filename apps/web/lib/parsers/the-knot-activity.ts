/**
 * Parser for The Knot Storefront Activity export.
 *
 * The export is a loosely structured text file (saved as .csv) where each
 * day's activity is grouped under a date header. Rows alternate between
 * a single initial letter and the full activity line.
 *
 * Example structure:
 *   "Mar 16, 2026"
 *   C
 *   Chelsey R. visited your Storefront on The Knot.
 *   A
 *   A couple saved your Storefront on The Knot.
 *   8 other couples visited your Storefront on The Knot and WeddingWire.
 */

export interface KnotActivityRecord {
  date: string;                 // ISO date string, e.g. "2026-03-16"
  firstName: string | null;     // null for anonymous entries
  lastInitial: string | null;   // null for anonymous entries
  signalType: KnotSignalType;
  platform: "the_knot" | "wedding_wire" | "both";
  isAnonymous: boolean;         // "A couple" entries
  anonymousCount: number;       // 1 for named/single anon, N for "8 other couples"
  rawLine: string;
}

export type KnotSignalType =
  | "profile_view"
  | "profile_save"
  | "website_clickthrough"   // "visited your website or social media profiles from your Storefront"
  | "inquiry"                // "sent an inquiry to your Storefront" — already in your inbox
  | "unknown";

const DATE_HEADER_RE = /^"?([A-Z][a-z]+ \d{1,2},\s*\d{4})"?$/;
const NAMED_ACTIVITY_RE = /^([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\s([A-Z])\.\s(.+)$/;
const BULK_ANONYMOUS_RE = /^(\d+)\s+other couple[s]?\s+(.+)$/i;
const SINGLE_ANONYMOUS_RE = /^A couple\s+(.+)$/i;

function parseSignalType(activityText: string): {
  signalType: KnotSignalType;
  platform: "the_knot" | "wedding_wire" | "both";
} {
  const text = activityText.toLowerCase();

  const platform: "the_knot" | "wedding_wire" | "both" =
    text.includes("weddingwire") && text.includes("the knot") ? "both"
    : text.includes("weddingwire") ? "wedding_wire"
    : "the_knot";

  let signalType: KnotSignalType = "unknown";

  if (text.includes("sent an inquiry")) {
    signalType = "inquiry";
  } else if (text.includes("saved your storefront")) {
    signalType = "profile_save";
  } else if (
    text.includes("visited your website") ||
    text.includes("visited your social media") ||
    text.includes("from your storefront")
  ) {
    signalType = "website_clickthrough";
  } else if (text.includes("visited your storefront") || text.includes("visited your")) {
    signalType = "profile_view";
  }

  return { signalType, platform };
}

function parseDate(raw: string): string {
  // "Mar 16, 2026" → "2026-03-16"
  const d = new Date(raw.replace(/"/g, "").trim());
  if (isNaN(d.getTime())) return raw;
  return d.toISOString().split("T")[0];
}

export function parseKnotActivityCsv(csvText: string): KnotActivityRecord[] {
  const lines = csvText.split("\n").map(l => l.trim()).filter(Boolean);
  const records: KnotActivityRecord[] = [];

  let currentDate = "";
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Date header
    if (DATE_HEADER_RE.test(line)) {
      currentDate = parseDate(line);
      i++;
      continue;
    }

    // Bulk anonymous: "8 other couples visited..."
    const bulkMatch = line.match(BULK_ANONYMOUS_RE);
    if (bulkMatch) {
      const count = parseInt(bulkMatch[1], 10);
      const activity = bulkMatch[2];
      const { signalType, platform } = parseSignalType(activity);
      records.push({
        date: currentDate,
        firstName: null,
        lastInitial: null,
        signalType,
        platform,
        isAnonymous: true,
        anonymousCount: count,
        rawLine: line,
      });
      i++;
      continue;
    }

    // Single anonymous: "A couple visited..."
    const singleAnonMatch = line.match(SINGLE_ANONYMOUS_RE);
    if (singleAnonMatch) {
      const { signalType, platform } = parseSignalType(singleAnonMatch[1]);
      records.push({
        date: currentDate,
        firstName: null,
        lastInitial: null,
        signalType,
        platform,
        isAnonymous: true,
        anonymousCount: 1,
        rawLine: line,
      });
      i++;
      continue;
    }

    // Single initial letter on its own line — peek at next line for the full activity
    if (/^[A-Z]$/.test(line) && i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      const namedMatch = nextLine.match(NAMED_ACTIVITY_RE);
      if (namedMatch) {
        const firstName = namedMatch[1];
        const lastInitial = namedMatch[2];
        const activity = namedMatch[3];
        const { signalType, platform } = parseSignalType(activity);
        records.push({
          date: currentDate,
          firstName,
          lastInitial,
          signalType,
          platform,
          isAnonymous: false,
          anonymousCount: 1,
          rawLine: nextLine,
        });
        i += 2; // consume both the initial and the activity line
        continue;
      }
    }

    // Named activity line without preceding initial (fallback)
    const namedMatch = line.match(NAMED_ACTIVITY_RE);
    if (namedMatch) {
      const firstName = namedMatch[1];
      const lastInitial = namedMatch[2];
      const activity = namedMatch[3];
      const { signalType, platform } = parseSignalType(activity);
      records.push({
        date: currentDate,
        firstName,
        lastInitial,
        signalType,
        platform,
        isAnonymous: false,
        anonymousCount: 1,
        rawLine: line,
      });
      i++;
      continue;
    }

    i++;
  }

  return records;
}

/**
 * Summarise a parsed activity export into aggregate metrics.
 * Used for cost-per-outcome calculations.
 */
export function summariseKnotActivity(records: KnotActivityRecord[]) {
  const namedRecords = records.filter(r => !r.isAnonymous);
  const totalAnonymous = records
    .filter(r => r.isAnonymous)
    .reduce((sum, r) => sum + r.anonymousCount, 0);

  return {
    totalProfileViews: records
      .filter(r => r.signalType === "profile_view")
      .reduce((sum, r) => sum + r.anonymousCount, 0),
    totalProfileSaves: records
      .filter(r => r.signalType === "profile_save")
      .reduce((sum, r) => sum + r.anonymousCount, 0),
    totalWebsiteClickthroughs: records
      .filter(r => r.signalType === "website_clickthrough")
      .reduce((sum, r) => sum + r.anonymousCount, 0),
    totalInquiries: records
      .filter(r => r.signalType === "inquiry")
      .reduce((sum, r) => sum + r.anonymousCount, 0),
    namedProfileViews: namedRecords.filter(r => r.signalType === "profile_view").length,
    namedProfileSaves: namedRecords.filter(r => r.signalType === "profile_save").length,
    namedWebsiteClickthroughs: namedRecords.filter(r => r.signalType === "website_clickthrough").length,
    namedInquiries: namedRecords.filter(r => r.signalType === "inquiry").length,
    totalAnonymous,
    matchableRecords: namedRecords.length,  // Records we can attempt to match to inquiries
  };
}
