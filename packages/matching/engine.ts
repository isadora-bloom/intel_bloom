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

// ─────────────────────────────────────────────────────────────────────────────
// PRE-INQUIRY SIGNAL MATCHING
//
// When an inquiry arrives, search pre_inquiry_signals for prior touchpoints
// from this person. The Knot only gives first_name + last_initial pre-inquiry
// so this is a probabilistic match — scored and surfaced for human review.
//
// Scoring rationale:
//   Base 60 pts  — first name + last initial match (necessary but not sufficient)
//   +15 pts      — signal is a SAVE not just a view (higher intent signal)
//   +10 pts      — multiple signals exist (view THEN save = clear progression)
//   +10 pts      — timing is realistic (2 weeks to 6 months before inquiry)
//   +15 pts      — wedding date in inquiry aligns with any date hint in signal
//   -15 pts      — signal is older than 12 months
//   -10 pts      — signal is < 3 days before inquiry (too fast, likely coincidence)
//
// Thresholds:
//   ≥ 85 → auto-link (still shown to venue, they can dismiss)
//   55–84 → surface as "probable prior touchpoint" → human confirms
//   < 55 → don't surface (noise)
// ─────────────────────────────────────────────────────────────────────────────

interface PriorSignalCandidate {
  signal: any;
  score: number;
  scoreBreakdown: Record<string, number>;
}

function extractFirstNameAndInitial(fullName: string | null): { firstName: string; lastInitial: string } | null {
  if (!fullName?.trim()) return null;
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const firstName = parts[0].toLowerCase();
  const lastInitial = parts[parts.length - 1][0].toLowerCase();
  return { firstName, lastInitial };
}

function scoreSignalAgainstInquiry(
  signal: any,
  inquiry: any
): { score: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {};
  let score = 0;

  // Base: first name + last initial — already guaranteed by the DB query
  // (we only fetch signals that match, so this is always true here)
  breakdown.name_match = 60;
  score += 60;

  // Boost: save > view
  if (signal.signal_type === "profile_save") {
    breakdown.is_save = 15;
    score += 15;
  }

  // Boost: timing window (2 weeks to 6 months before inquiry)
  const inquiryDate = new Date(inquiry.received_at ?? inquiry.created_at);
  const signalDate = new Date(signal.occurred_at);
  const daysDiff = (inquiryDate.getTime() - signalDate.getTime()) / (1000 * 60 * 60 * 24);

  // NOTE: Same-session (0–1 day) is valid and common — couples frequently
  // view a Knot profile and inquire in the same session. No penalty.
  if (daysDiff >= 0 && daysDiff <= 1) {
    breakdown.timing_same_session = 5;  // Small boost — visit confirms they saw the profile
    score += 5;
  } else if (daysDiff > 1 && daysDiff <= 180) {
    breakdown.timing_considered = 10;   // Deliberate consideration window
    score += 10;
  } else if (daysDiff > 180 && daysDiff <= 365) {
    // Still plausible — long consideration cycles are real
    breakdown.timing_late = 0;
  } else if (daysDiff > 365) {
    breakdown.timing_too_old = -15;
    score -= 15;
  }

  return { score: Math.max(0, Math.min(100, score)), breakdown };
}

/**
 * For a given inquiry, search pre_inquiry_signals for prior touchpoints
 * from the same person (matched on first_name + last_initial).
 *
 * Returns candidates sorted by score descending.
 * Updates the inquiry record with the best match found.
 */
export async function findPriorSignalsForInquiry(
  venueId: string,
  inquiryId: string
): Promise<{ classification: string; bestCandidate: PriorSignalCandidate | null }> {
  // 1. Load the inquiry
  const { data: inquiry } = await supabase
    .from("inquiries")
    .select("*")
    .eq("id", inquiryId)
    .single();

  if (!inquiry) return { classification: "unknown", bestCandidate: null };

  // 2. Check if this couple has inquired before (returning inquiry)
  const inquiryName = inquiry.name_extracted?.toLowerCase().trim();
  const inquiryEmail = inquiry.email_extracted?.toLowerCase().trim();

  if (inquiryEmail) {
    const { data: priorInquiries } = await supabase
      .from("inquiries")
      .select("id, received_at, first_contact_channel")
      .eq("venue_id", venueId)
      .ilike("email_extracted", inquiryEmail)
      .neq("id", inquiryId)
      .order("received_at", { ascending: false })
      .limit(1);

    if (priorInquiries && priorInquiries.length > 0) {
      await supabase
        .from("inquiries")
        .update({
          touchpoint_classification: "returning_inquiry",
          prior_signal_status: "searched_no_match", // prior inquiry ≠ pre-inquiry signal
        })
        .eq("id", inquiryId);
      return { classification: "returning_inquiry", bestCandidate: null };
    }
  }

  // 3. Extract name components for pre-inquiry signal lookup
  const parsed = extractFirstNameAndInitial(inquiry.name_extracted);
  if (!parsed) {
    await supabase
      .from("inquiries")
      .update({ touchpoint_classification: "unknown", prior_signal_status: "searched_no_match" })
      .eq("id", inquiryId);
    return { classification: "unknown", bestCandidate: null };
  }

  // 4. Search pre_inquiry_signals — only signals that PRECEDE this inquiry
  const { data: candidates } = await supabase
    .from("pre_inquiry_signals")
    .select("*")
    .eq("venue_id", venueId)
    .ilike("first_name", parsed.firstName)
    .ilike("last_initial", parsed.lastInitial)
    .eq("match_status", "unmatched")
    .lt("occurred_at", inquiry.received_at ?? inquiry.created_at)
    .order("occurred_at", { ascending: false });

  if (!candidates || candidates.length === 0) {
    await supabase
      .from("inquiries")
      .update({ touchpoint_classification: "inquiry_is_first_touch", prior_signal_status: "searched_no_match" })
      .eq("id", inquiryId);
    return { classification: "inquiry_is_first_touch", bestCandidate: null };
  }

  // 5. Score each candidate
  // Boost if multiple signals exist for this name (view then save progression)
  const hasMultipleSignals = candidates.length > 1;

  const scored: PriorSignalCandidate[] = candidates.map(signal => {
    const { score, breakdown } = scoreSignalAgainstInquiry(signal, inquiry);
    const finalScore = hasMultipleSignals ? Math.min(100, score + 10) : score;
    if (hasMultipleSignals) breakdown.multiple_signals = 10;
    return { signal, score: finalScore, scoreBreakdown: breakdown };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  // 6. Classify and update
  const AUTO_LINK_THRESHOLD = 85;
  const SURFACE_THRESHOLD = 55;

  let priorSignalStatus: string;
  let classification: string;

  if (best.score >= AUTO_LINK_THRESHOLD) {
    priorSignalStatus = "confirmed";
    classification = "inquiry_preceded_by_awareness";
  } else if (best.score >= SURFACE_THRESHOLD) {
    priorSignalStatus = "pending_review";
    classification = "inquiry_preceded_by_awareness";
  } else {
    priorSignalStatus = "searched_no_match";
    classification = "inquiry_is_first_touch";
  }

  // 7. Calculate days between earliest signal and this inquiry
  const earliestSignal = candidates[candidates.length - 1];
  const daysFromSignal = Math.round(
    (new Date(inquiry.received_at ?? inquiry.created_at).getTime() -
      new Date(earliestSignal.occurred_at).getTime()) /
      (1000 * 60 * 60 * 24)
  );

  await supabase
    .from("inquiries")
    .update({
      touchpoint_classification: classification,
      prior_signal_id: best.score >= SURFACE_THRESHOLD ? best.signal.id : null,
      prior_signal_confidence: best.score >= SURFACE_THRESHOLD ? best.score : null,
      prior_signal_status: priorSignalStatus,
      days_from_signal_to_inquiry: best.score >= SURFACE_THRESHOLD ? daysFromSignal : null,
    })
    .eq("id", inquiryId);

  // 8. If auto-linked, also mark the signal as matched
  if (best.score >= AUTO_LINK_THRESHOLD) {
    await supabase
      .from("pre_inquiry_signals")
      .update({ matched_inquiry_id: inquiryId, match_confidence: best.score, match_status: "matched" })
      .eq("id", best.signal.id);
  }

  return {
    classification,
    bestCandidate: best.score >= SURFACE_THRESHOLD ? best : null,
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
