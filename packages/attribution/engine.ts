/**
 * Source Attribution Engine
 * Resolves vague self-reported sources ("Google") into specific channels.
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface AttributionSignal {
  type: string;
  platform?: string;
  confidence: number;
  detail?: any;
}

interface AttributionResult {
  platform: string;
  confidence: number;
  signals: AttributionSignal[];
}

function classifySourceUrl(url: string): string {
  if (url.includes("theknot.com")) return "knot";
  if (url.includes("google.com/ads") || url.includes("googleads")) return "google_ads";
  if (url.includes("instagram.com")) return "instagram";
  if (url.includes("facebook.com") || url.includes("fb.com")) return "facebook";
  if (url.includes("weddingwire.com")) return "wedding_wire";
  if (url.includes("pinterest.com")) return "pinterest";
  if (url.includes("google.com")) return "google_organic";
  return "direct";
}

function resolveSignals(
  signals: AttributionSignal[],
  selfReported: string | null
): AttributionResult {
  // Sort by confidence, highest first
  const sorted = [...signals].sort((a, b) => b.confidence - a.confidence);

  // If URL source exists with high confidence, use it
  const urlSignal = sorted.find((s) => s.type === "url_source" && s.confidence >= 80);
  if (urlSignal) {
    return {
      platform: urlSignal.platform!,
      confidence: urlSignal.confidence,
      signals,
    };
  }

  // Normalize self-reported source
  if (selfReported) {
    const normalized = selfReported.toLowerCase();
    if (normalized.includes("knot")) return { platform: "knot", confidence: 75, signals };
    if (normalized.includes("instagram") || normalized.includes("ig"))
      return { platform: "instagram", confidence: 70, signals };
    if (normalized.includes("facebook") || normalized.includes("fb"))
      return { platform: "facebook", confidence: 70, signals };
    if (normalized.includes("google") || normalized.includes("search"))
      return { platform: "google_organic", confidence: 55, signals }; // "Google" is vague
    if (normalized.includes("friend") || normalized.includes("referral") || normalized.includes("word"))
      return { platform: "referral", confidence: 80, signals };
    if (normalized.includes("wedding wire"))
      return { platform: "wedding_wire", confidence: 75, signals };
    if (normalized.includes("pinterest"))
      return { platform: "pinterest", confidence: 75, signals };
  }

  // Fall back to highest confidence signal
  if (sorted.length > 0 && sorted[0].platform) {
    return {
      platform: sorted[0].platform,
      confidence: sorted[0].confidence,
      signals,
    };
  }

  return { platform: "unknown", confidence: 10, signals };
}

export async function resolveAttribution(
  inquiryId: string
): Promise<AttributionResult | null> {
  const { data: inquiry, error } = await supabase
    .from("inquiries")
    .select("*, venues(google_trends_metro)")
    .eq("id", inquiryId)
    .single();

  if (error || !inquiry) return null;

  const signals: AttributionSignal[] = [];

  // Signal 1: URL source
  if (inquiry.session_source_url) {
    const platform = classifySourceUrl(inquiry.session_source_url);
    signals.push({ type: "url_source", platform, confidence: 90 });
  }

  // Signal 2: Platform the inquiry came through
  if (inquiry.platform && inquiry.platform !== "email") {
    const platformMap: Record<string, string> = {
      knot: "knot",
      instagram: "instagram",
      website: "google_organic",
    };
    const mapped = platformMap[inquiry.platform];
    if (mapped) {
      signals.push({ type: "platform_source", platform: mapped, confidence: 60 });
    }
  }

  const resolved = resolveSignals(signals, inquiry.self_reported_source);

  // Write back to inquiry
  await supabase
    .from("inquiries")
    .update({
      resolved_source: resolved.platform,
      resolved_source_confidence: resolved.confidence,
    })
    .eq("id", inquiryId);

  return resolved;
}

export async function resolveAllUnattributed(venueId: string) {
  const { data: inquiries } = await supabase
    .from("inquiries")
    .select("id")
    .eq("venue_id", venueId)
    .is("resolved_source", null);

  let resolved = 0;
  for (const inq of inquiries ?? []) {
    await resolveAttribution(inq.id);
    resolved++;
  }

  console.log(`Attribution: resolved ${resolved} inquiries for venue ${venueId}`);
}
