import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(req: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const code = req.nextUrl.searchParams.get("code");
  const venueId = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");

  if (error || !code || !venueId) {
    return NextResponse.redirect(`${appUrl}/settings?email_error=1`);
  }

  const redirectUri = `${appUrl}/api/auth/google/callback`;

  // Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    return NextResponse.redirect(`${appUrl}/settings?email_error=1`);
  }

  const tokens = await tokenRes.json();

  // Get the user's email address to label the connection
  const userInfoRes = await fetch(
    "https://www.googleapis.com/oauth2/v2/userinfo",
    { headers: { Authorization: `Bearer ${tokens.access_token}` } }
  );
  const userInfo = await userInfoRes.json();

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { error: dbError } = await supabase
    .from("email_connections")
    .upsert(
      {
        venue_id: venueId,
        provider: "google",
        email_address: userInfo.email ?? "unknown",
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expires_at: tokens.expires_in
          ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
          : null,
      },
      { onConflict: "venue_id,email_address" }
    );

  if (dbError) {
    return NextResponse.redirect(`${appUrl}/settings?email_error=1`);
  }

  return NextResponse.redirect(`${appUrl}/settings?email_connected=1`);
}
