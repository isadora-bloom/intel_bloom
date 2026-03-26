import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { venueId, awarenessChannels, briefingEmail } = await request.json();
  if (!venueId) {
    return NextResponse.json({ error: "venueId required" }, { status: 400 });
  }

  // Use service role to bypass RLS — user owns this venue (verified below)
  const supabase = createServiceClient();

  // Verify user owns this venue
  const { data: venueUser } = await supabase
    .from("venue_users")
    .select("role")
    .eq("venue_id", venueId)
    .eq("user_id", user.id)
    .single();

  if (!venueUser) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await supabase
    .from("venues")
    .update({ onboarding_complete: true })
    .eq("id", venueId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
