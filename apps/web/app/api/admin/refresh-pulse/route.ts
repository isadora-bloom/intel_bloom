/**
 * POST /api/admin/refresh-pulse
 * Recalculates market pulse for the current venue.
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

  try {
    const { calculateMarketPulse } = await import("@bloom/pulse/calculator");
    await calculateMarketPulse(venueUser.venue_id);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("Market pulse refresh error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
