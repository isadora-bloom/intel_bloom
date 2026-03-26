import { createServiceClient } from "@/lib/supabase/server";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * GET /api/export — One-click full venue data export as JSON
 * Brief: "Data export: one-click full export of all venue data as CSV/JSON. Always available."
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createServiceClient();

  // Get venue_id for user
  const { data: vu } = await db
    .from("venue_users")
    .select("venue_id")
    .eq("user_id", session.user.id)
    .limit(1)
    .single();

  if (!vu?.venue_id) {
    return NextResponse.json({ error: "No venue found" }, { status: 404 });
  }

  const venueId = vu.venue_id;

  const tables = [
    "clients", "inquiries", "tours", "uploads", "planning_events",
    "reviews", "review_language", "referrals", "vendors", "client_vendors",
    "channel_spend", "social_posts", "annotations", "lost_deals",
    "campaigns", "pre_inquiry_signals", "leads", "client_source_touchpoints",
    "anomaly_detections", "venue_capacity", "venue_health",
  ];

  const result: Record<string, any[]> = {};

  for (const table of tables) {
    const { data } = await db
      .from(table)
      .select("*")
      .eq("venue_id", venueId)
      .limit(10000);
    result[table] = data ?? [];
  }

  // Venue config (excluding sensitive API keys)
  const { data: venue } = await db
    .from("venues")
    .select("id, name, slug, city, state, zip, lat, lng, region, timezone, sage_tone, sage_voice_description, packages, primary_color, secondary_color, created_at")
    .eq("id", venueId)
    .single();

  result.venue = venue ? [venue] : [];

  const filename = `bloom-export-${venue?.slug ?? venueId}-${new Date().toISOString().split("T")[0]}.json`;

  return new NextResponse(JSON.stringify(result, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
