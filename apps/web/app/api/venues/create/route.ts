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

  // Auto-create an organisation for this venue
  const orgSlug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const { data: org, error: orgError } = await supabase
    .from("organisations")
    .insert({ name, slug: orgSlug })
    .select()
    .single();

  if (orgError) {
    return NextResponse.json({ error: orgError.message }, { status: 500 });
  }

  const { data: venue, error: venueError } = await supabase
    .from("venues")
    .insert({ name, slug, address_line1: addressLine1, city, state, zip, organisation_id: org.id, onboarding_complete: true })
    .select()
    .single();

  if (venueError) {
    return NextResponse.json({ error: venueError.message }, { status: 500 });
  }

  const { error: vuError } = await supabase
    .from("venue_users")
    .insert({ venue_id: venue.id, user_id: user.id, role: "venue_owner", organisation_id: org.id });

  if (vuError) {
    return NextResponse.json({ error: vuError.message }, { status: 500 });
  }

  return NextResponse.json({ venue });
}
