import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

export const dynamic = "force-dynamic";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2023-10-16" });

function serviceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  // Authenticate the user
  let supabaseResponse = NextResponse.next({ request: req });
  const anonClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
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

  // Get the user's venue stripe_customer_id
  const { data: venueUser, error: vuError } = await supabase
    .from("venue_users")
    .select("venue_id, venues(stripe_customer_id)")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (vuError || !venueUser) {
    return NextResponse.json({ error: "No venue found for this user" }, { status: 404 });
  }

  const venue = venueUser.venues as any;

  if (!venue?.stripe_customer_id) {
    return NextResponse.json({ error: "No billing account found" }, { status: 400 });
  }

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: venue.stripe_customer_id,
    return_url: `${appUrl}/dashboard`,
  });

  return NextResponse.json({ url: portalSession.url });
}
