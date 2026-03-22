import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

function serviceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// GET — look up invite by token (used by the invite page on load)
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const supabase = serviceClient();

  const { data: invite, error } = await supabase
    .from("venue_invites")
    .select("id, email, role, expires_at, accepted_at, venue_id, venues(name)")
    .eq("token", token)
    .single();

  if (error || !invite) {
    return NextResponse.json({ error: "Not found", reason: "not_found" }, { status: 404 });
  }

  if (invite.accepted_at) {
    return NextResponse.json({ error: "Already used", reason: "used" }, { status: 410 });
  }

  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return NextResponse.json({ error: "Expired", reason: "expired" }, { status: 410 });
  }

  const venueName = (invite.venues as any)?.name ?? "your venue";

  return NextResponse.json({
    invite: {
      email: invite.email,
      role: invite.role,
      venue_name: venueName,
    },
  });
}

// POST — accept invite (user must be authenticated at this point)
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { token } = body as { token?: string };

  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  // Get the authenticated user using SSR client (reads cookies)
  let supabaseResponse = NextResponse.next({ request: req });
  const anonClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
          cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request: req });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await anonClient.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const supabase = serviceClient();

  // Look up invite
  const { data: invite, error: lookupError } = await supabase
    .from("venue_invites")
    .select("id, email, role, expires_at, accepted_at, venue_id")
    .eq("token", token)
    .single();

  if (lookupError || !invite) {
    return NextResponse.json({ error: "Invite not found", reason: "not_found" }, { status: 404 });
  }

  if (invite.accepted_at) {
    return NextResponse.json({ error: "Invite already used", reason: "used" }, { status: 410 });
  }

  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return NextResponse.json({ error: "Invite expired", reason: "expired" }, { status: 410 });
  }

  // Add user to venue
  const { error: insertError } = await supabase.from("venue_users").upsert(
    {
      venue_id: invite.venue_id,
      user_id: user.id,
      role: invite.role,
    },
    { onConflict: "venue_id,user_id" }
  );

  if (insertError) {
    console.error("[invite/accept] venue_users insert failed:", insertError.message);
    return NextResponse.json({ error: "Failed to join venue" }, { status: 500 });
  }

  // Mark invite as accepted
  const { error: updateError } = await supabase
    .from("venue_invites")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", invite.id);

  if (updateError) {
    console.error("[invite/accept] invite update failed:", updateError.message);
    // Non-fatal — user is already in venue_users
  }

  return NextResponse.json({ ok: true, venueId: invite.venue_id });
}
