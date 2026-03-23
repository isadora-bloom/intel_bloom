/**
 * POST /api/sync/honeybook
 * Triggers a HoneyBook project sync for the current user's venue.
 * Requires the venue to have honeybook_api_key set.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const userSupabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );

  const { data: { user } } = await userSupabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: venueUser } = await adminSupabase
    .from("venue_users")
    .select("venue_id")
    .eq("user_id", user.id)
    .single();

  if (!venueUser) {
    return NextResponse.json({ error: "No venue found" }, { status: 404 });
  }

  const { data: venue } = await adminSupabase
    .from("venues")
    .select("honeybook_api_key")
    .eq("id", venueUser.venue_id)
    .single();

  if (!venue?.honeybook_api_key) {
    return NextResponse.json(
      { error: "No HoneyBook API key configured. Add it in Settings → Integrations." },
      { status: 400 }
    );
  }

  try {
    const { syncHoneyBook } = await import("@bloom/ingestion/honeybee/sync");
    const result = await syncHoneyBook(venueUser.venue_id, venue.honeybook_api_key);
    return NextResponse.json({ ok: true, synced: result.synced });
  } catch (err: any) {
    console.error("HoneyBook sync error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
