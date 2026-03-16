/**
 * Identity Resolution Engine
 * Matches inquiries to client records using weighted signal scoring.
 *
 * CRITICAL: Auto-match threshold is 90. Never lower this.
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface MatchSignal {
  name: string;
  weight: number;
  matched: boolean;
  detail?: string;
}

interface MatchResult {
  recordAId: string;
  recordBId: string;
  score: number;
  signals: MatchSignal[];
  tier: "auto" | "review" | "suggest" | "no_match";
}

const SIGNAL_WEIGHTS = {
  exact_email: 95,
  exact_phone: 90,
  full_name_exact_date: 85,
  full_name_month_year: 65,
  first_name_exact_date: 60,
  multi_platform_90_days: 20,
  budget_range: 15,
  package_match: 15,
  geographic_origin: 10,
  communication_style: 5,
};

// CRITICAL: Never lower this threshold
const AUTO_MATCH_THRESHOLD = 90;

function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9]/g, "").slice(-10);
}

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

function fuzzyNameMatch(nameA: string | null, nameB: string | null): number {
  if (!nameA || !nameB) return 0;
  const a = nameA.toLowerCase().trim();
  const b = nameB.toLowerCase().trim();

  if (a === b) return 1.0;

  // Check if first names match
  const firstA = a.split(" ")[0];
  const firstB = b.split(" ")[0];
  if (firstA === firstB) return 0.75;

  // Simple Levenshtein-based similarity
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1.0;

  const editDistance = levenshtein(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function isSameDate(a: string | Date, b: string | Date): boolean {
  return new Date(a).toISOString().split("T")[0] === new Date(b).toISOString().split("T")[0];
}

function isSameMonthYear(a: string | Date, b: string | Date): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth();
}

export async function scoreMatch(
  recordA: any,
  recordB: any
): Promise<MatchResult> {
  const signals: MatchSignal[] = [];
  let totalScore = 0;

  // Email match
  const emailA = recordA.email_primary ?? recordA.email_extracted;
  const emailB = recordB.email_primary ?? recordB.email_extracted;
  if (emailA && emailB) {
    const matched = normalizeEmail(emailA) === normalizeEmail(emailB);
    signals.push({ name: "exact_email", weight: SIGNAL_WEIGHTS.exact_email, matched });
    if (matched) totalScore += SIGNAL_WEIGHTS.exact_email;
  }

  // Phone match
  const phoneA = recordA.phone_primary ?? recordA.phone_extracted;
  const phoneB = recordB.phone_primary ?? recordB.phone_extracted;
  if (phoneA && phoneB) {
    const matched = normalizePhone(phoneA) === normalizePhone(phoneB);
    signals.push({ name: "exact_phone", weight: SIGNAL_WEIGHTS.exact_phone, matched });
    if (matched) totalScore += SIGNAL_WEIGHTS.exact_phone;
  }

  // Name + date matching
  const nameA = recordA.name_primary ?? recordA.name_extracted;
  const nameB = recordB.name_primary ?? recordB.name_extracted;
  const nameScore = fuzzyNameMatch(nameA, nameB);

  const dateA = recordA.event_date ?? recordA.event_date_extracted;
  const dateB = recordB.event_date ?? recordB.event_date_extracted;

  if (nameScore > 0.9 && dateA && dateB) {
    if (isSameDate(dateA, dateB)) {
      signals.push({ name: "full_name_exact_date", weight: 85, matched: true });
      totalScore += 85;
    } else if (isSameMonthYear(dateA, dateB)) {
      signals.push({ name: "full_name_month_year", weight: 65, matched: true });
      totalScore += 65;
    }
  } else if (nameScore > 0.7 && dateA && dateB && isSameDate(dateA, dateB)) {
    signals.push({ name: "first_name_exact_date", weight: 60, matched: true });
    totalScore += 60;
  }

  // Multi-platform timing (both arrived within 90 days)
  const timeA = recordA.received_at ?? recordA.created_at;
  const timeB = recordB.received_at ?? recordB.created_at;
  if (timeA && timeB) {
    const diffDays =
      Math.abs(new Date(timeA).getTime() - new Date(timeB).getTime()) /
      (1000 * 60 * 60 * 24);
    if (diffDays <= 90) {
      signals.push({ name: "multi_platform_90_days", weight: 20, matched: true });
      totalScore += 20;
    }
  }

  const score = Math.min(totalScore, 100);
  const tier =
    score >= AUTO_MATCH_THRESHOLD
      ? "auto"
      : score >= 60
      ? "review"
      : score >= 40
      ? "suggest"
      : "no_match";

  return {
    recordAId: recordA.id,
    recordBId: recordB.id,
    score,
    signals,
    tier,
  };
}

export async function runMatchingPass(venueId: string) {
  const { data: unmatched } = await supabase
    .from("inquiries")
    .select("*")
    .eq("venue_id", venueId)
    .eq("match_status", "unmatched");

  const { data: clients } = await supabase
    .from("clients")
    .select("*")
    .eq("venue_id", venueId);

  let autoMatched = 0;
  let queued = 0;

  for (const inquiry of unmatched ?? []) {
    let bestMatch: MatchResult | null = null;

    for (const client of clients ?? []) {
      const result = await scoreMatch(inquiry, client);

      if (result.tier === "auto") {
        // Auto-link immediately
        await supabase
          .from("inquiries")
          .update({
            matched_client_id: client.id,
            match_confidence: result.score,
            match_status: "auto_matched",
          })
          .eq("id", inquiry.id);

        autoMatched++;
        bestMatch = null; // Don't queue this one
        break;
      } else if (
        (result.tier === "review" || result.tier === "suggest") &&
        (!bestMatch || result.score > bestMatch.score)
      ) {
        bestMatch = result;
      }
    }

    if (bestMatch) {
      // Queue for human review
      await supabase.from("matching_queue").upsert(
        {
          venue_id: venueId,
          record_a_type: "inquiry",
          record_a_id: inquiry.id,
          record_b_type: "client",
          record_b_id: bestMatch.recordBId,
          match_score: bestMatch.score,
          signals_matched: bestMatch.signals.filter((s) => s.matched),
          signals_unmatched: bestMatch.signals.filter((s) => !s.matched),
          status: "pending",
        },
        { onConflict: "record_a_id,record_b_id" }
      );
      queued++;
    }
  }

  console.log(`Matching pass complete: ${autoMatched} auto-matched, ${queued} queued for review`);
  return { autoMatched, queued };
}
