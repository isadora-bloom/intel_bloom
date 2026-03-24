import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  // Verify the user is authenticated via their session cookie
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { name, slug, addressLine1, city, state, zip } = await request.json();

  if (!name?.trim() || !city?.trim()) {
    return NextResponse.json({ error: "name and city are required" }, { status: 400 });
  }

  // Use service role to bypass RLS for venue creation (user has no venue_users row yet)
  const supabase = createServiceClient();

  const { data: venue, error: venueError } = await supabase
    .from("venues")
    .insert({ name, slug, address_line1: addressLine1, city, state, zip, onboarding_step: 1 })
    .select()
    .single();

  if (venueError) {
    return NextResponse.json({ error: venueError.message }, { status: 500 });
  }

  const { error: vuError } = await supabase
    .from("venue_users")
    .insert({ venue_id: venue.id, user_id: user.id, role: "owner" });

  if (vuError) {
    return NextResponse.json({ error: vuError.message }, { status: 500 });
  }

  return NextResponse.json({ venue });
}
