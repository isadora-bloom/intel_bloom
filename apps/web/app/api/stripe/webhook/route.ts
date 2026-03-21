import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2024-04-10" });

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function mapSubscriptionStatus(stripeStatus: string): string {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
      return "past_due";
    case "canceled":
    case "cancelled":
      return "cancelled";
    default:
      return stripeStatus;
  }
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err: any) {
    console.error("[stripe-webhook] signature verification failed:", err.message);
    return NextResponse.json({ error: `Webhook error: ${err.message}` }, { status: 400 });
  }

  const supabase = serviceClient();

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const customerId = session.customer as string;
      const subscriptionId = session.subscription as string;

      if (customerId && subscriptionId) {
        const { error } = await supabase
          .from("venues")
          .update({
            plan_status: "active",
            stripe_subscription_id: subscriptionId,
          })
          .eq("stripe_customer_id", customerId);

        if (error) {
          console.error("[stripe-webhook] checkout.session.completed update failed:", error.message);
        }
      }
      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;
      const planStatus = mapSubscriptionStatus(subscription.status);

      const { error } = await supabase
        .from("venues")
        .update({ plan_status: planStatus })
        .eq("stripe_customer_id", customerId);

      if (error) {
        console.error("[stripe-webhook] customer.subscription.updated failed:", error.message);
      }
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;

      const { error } = await supabase
        .from("venues")
        .update({ plan_status: "cancelled" })
        .eq("stripe_customer_id", customerId);

      if (error) {
        console.error("[stripe-webhook] customer.subscription.deleted failed:", error.message);
      }
      break;
    }

    default:
      // Unhandled event type — no-op
      break;
  }

  return NextResponse.json({ received: true });
}
