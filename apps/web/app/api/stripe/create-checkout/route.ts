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

  // Get the user's venue
  const { data: venueUser, error: vuError } = await supabase
    .from("venue_users")
    .select("venue_id, venues(id, name, stripe_customer_id)")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (vuError || !venueUser) {
    return NextResponse.json({ error: "No venue found for this user" }, { status: 404 });
  }

  const venue = venueUser.venues as any;
  let stripeCustomerId: string = venue.stripe_customer_id;

  // Create Stripe customer if not yet linked
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      name: venue.name ?? undefined,
      email: user.email ?? undefined,
      metadata: { venue_id: venue.id },
    });
    stripeCustomerId = customer.id;

    const { error: updateError } = await supabase
      .from("venues")
      .update({ stripe_customer_id: stripeCustomerId })
      .eq("id", venue.id);

    if (updateError) {
      console.error("[create-checkout] failed to save stripe_customer_id:", updateError.message);
    }
  }

  // Create Checkout Session
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: stripeCustomerId,
    line_items: [
      {
        price: process.env.STRIPE_PRICE_ID!,
        quantity: 1,
      },
    ],
    subscription_data: {
      trial_period_days: 14,
    },
    success_url: `${appUrl}/dashboard?upgraded=1`,
    cancel_url: `${appUrl}/upgrade`,
  });

  return NextResponse.json({ url: session.url });
}
