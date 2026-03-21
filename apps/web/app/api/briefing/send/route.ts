/**
 * POST /api/briefing/send
 * Cron endpoint — sends weekly briefing emails to venues with briefing_email set.
 * Authorization: Bearer <CRON_SECRET>
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

function verifyCronAuth(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  // Dev mode: skip check if no secret configured
  if (!cronSecret) return true;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${cronSecret}`;
}

function buildBriefingHtml(params: {
  venueName: string;
  recentInquiries: number;
  demandOutlook: string | null;
  consumerConfidenceTrend: string | null;
  appUrl: string;
}): string {
  const { venueName, recentInquiries, demandOutlook, consumerConfidenceTrend, appUrl } = params;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { font-family: Georgia, serif; background: #fdfaf6; color: #2d2d2d; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 40px auto; padding: 32px; background: #fff; border-radius: 8px; }
    h1 { font-size: 22px; margin-bottom: 4px; color: #1a1a1a; }
    .subtitle { font-size: 13px; color: #888; margin-bottom: 32px; }
    .stat-row { display: flex; align-items: baseline; gap: 12px; margin-bottom: 16px; }
    .stat-label { font-size: 14px; color: #555; min-width: 220px; }
    .stat-value { font-size: 16px; font-weight: 600; color: #1a1a1a; }
    .cta { margin-top: 32px; }
    .cta a { display: inline-block; padding: 12px 24px; background: #2E7D54; color: #fff; text-decoration: none; border-radius: 6px; font-size: 14px; }
    .footer { margin-top: 40px; font-size: 12px; color: #aaa; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Bloom Intelligence</h1>
    <div class="subtitle">Weekly briefing for ${venueName}</div>

    <p>Hi ${venueName} team,</p>
    <p>Here's your weekly snapshot from Bloom Intelligence.</p>

    <div class="stat-row">
      <span class="stat-label">Inquiries last 30 days</span>
      <span class="stat-value">${recentInquiries}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Market demand outlook</span>
      <span class="stat-value">${demandOutlook ?? "—"}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Consumer confidence trend</span>
      <span class="stat-value">${consumerConfidenceTrend ?? "—"}</span>
    </div>

    <div class="cta">
      <a href="${appUrl}/dashboard">See your full briefing →</a>
    </div>

    <div class="footer">
      You're receiving this because your venue has briefing emails enabled in Bloom Intelligence.
    </div>
  </div>
</body>
</html>`;
}

export async function POST(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.BRIEFING_FROM_EMAIL ?? "Bloom Intelligence <briefing@bloomhq.co>";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.bloomhq.co";

  if (!resendApiKey) {
    console.warn("RESEND_API_KEY not configured — skipping briefing email sends.");
  }

  // 1. Fetch all venues with a briefing email set
  const { data: venues, error: venuesError } = await supabase
    .from("venues")
    .select("id, name, briefing_email")
    .not("briefing_email", "is", null);

  if (venuesError) {
    return NextResponse.json({ error: venuesError.message }, { status: 500 });
  }

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  let sent = 0;
  const errors: string[] = [];

  for (const venue of venues ?? []) {
    try {
      // 2. Fetch recent inquiry count and latest market_pulse in parallel
      const [inquiriesRes, pulseRes] = await Promise.all([
        supabase
          .from("inquiries")
          .select("id", { count: "exact", head: true })
          .eq("venue_id", venue.id)
          .gte("received_at", thirtyDaysAgo.toISOString()),
        supabase
          .from("market_pulse")
          .select("demand_outlook, consumer_confidence_trend")
          .eq("venue_id", venue.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const recentInquiries = inquiriesRes.count ?? 0;
      const pulse = pulseRes.data;

      const html = buildBriefingHtml({
        venueName: venue.name as string,
        recentInquiries,
        demandOutlook: (pulse?.demand_outlook as string | null) ?? null,
        consumerConfidenceTrend: (pulse?.consumer_confidence_trend as string | null) ?? null,
        appUrl,
      });

      const subject = `Your Bloom Intelligence briefing — ${venue.name}`;

      // 3. Send via Resend
      if (!resendApiKey) {
        // Log but don't throw — dev mode
        console.log(`[briefing] Would send to ${venue.briefing_email}: "${subject}"`);
        sent++;
        continue;
      }

      const sendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromEmail,
          to: venue.briefing_email as string,
          subject,
          html,
        }),
      });

      if (!sendRes.ok) {
        const text = await sendRes.text();
        errors.push(`Failed to send to ${venue.briefing_email} (venue ${venue.id}): ${sendRes.status} ${text}`);
      } else {
        sent++;
      }
    } catch (err: any) {
      errors.push(`Error processing venue ${venue.id}: ${err.message}`);
    }
  }

  return NextResponse.json({ sent, errors });
}
