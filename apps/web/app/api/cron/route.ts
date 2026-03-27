import { NextRequest, NextResponse } from "next/server";

// Vercel Cron authentication
function verifyCronSecret(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(request: NextRequest) {
  return handleCron(request);
}

export async function POST(request: NextRequest) {
  return handleCron(request);
}

async function handleCron(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Job name comes from query param: /api/cron?job=market_pulse_refresh
  const job = request.nextUrl.searchParams.get("job");

  if (!job) {
    return NextResponse.json({ error: "job query param required" }, { status: 400 });
  }

  try {
    switch (job) {
      // ── DAILY ──
      case "weather_forecast_check": {
        const { checkUpcomingEventForecasts } = await import("@bloom/ingestion/noaa/forecast");
        await checkUpcomingEventForecasts();
        break;
      }

      case "anomaly_detection": {
        const { runAnomalyDetectionAllVenues } = await import("@bloom/ingestion/anomaly-detector");
        await runAnomalyDetectionAllVenues();
        break;
      }

      // ── WEEKLY ──
      case "market_pulse_refresh": {
        const { refreshMarketPulseAllVenues } = await import("@bloom/pulse/calculator");
        await refreshMarketPulseAllVenues();
        break;
      }

      case "sensitive_data_cleanup": {
        const { createServiceClient } = await import("@/lib/supabase/server");
        const supabase = createServiceClient();
        await supabase.rpc("clear_aged_sensitive_flags");
        break;
      }

      case "trends_refresh": {
        const { ingestTrendsAllVenues } = await import("@bloom/ingestion/trends/ingest-trends");
        const log: string[] = [];
        await ingestTrendsAllVenues(log);
        return NextResponse.json({ success: true, job, log });
      }

      case "weekly_insights": {
        // Cache AI-generated weekly insights for Monday morning screen
        const { createServiceClient } = await import("@/lib/supabase/server");
        const { callAIJson } = await import("@/lib/ai");
        const supabase = createServiceClient();
        const { data: venues } = await supabase
          .from("venues")
          .select("id")
          .eq("onboarding_complete", true);

        for (const venue of venues ?? []) {
          try {
            // Gather venue summary data
            const [{ count: inqCount }, { count: tourCount }, { count: bookCount }] = await Promise.all([
              supabase.from("inquiries").select("id", { count: "exact", head: true }).eq("venue_id", venue.id).gte("received_at", new Date(Date.now() - 7 * 86400000).toISOString()),
              supabase.from("tours").select("id", { count: "exact", head: true }).eq("venue_id", venue.id).eq("completed", true).gte("scheduled_at", new Date(Date.now() - 7 * 86400000).toISOString()),
              supabase.from("clients").select("id", { count: "exact", head: true }).eq("venue_id", venue.id).gte("contracted_at", new Date(Date.now() - 7 * 86400000).toISOString()),
            ]);

            const summary = `This week: ${inqCount ?? 0} inquiries, ${tourCount ?? 0} tours completed, ${bookCount ?? 0} new bookings.`;

            const insights = await callAIJson<{ insights: Array<{ headline: string; body: string; sentiment: string }> }>(
              `Given this wedding venue's data for the past 7 days:\n${summary}\n\nWrite 3-4 plain English insights a venue owner would find valuable. No jargon. Every insight should suggest an action.\n\nReturn JSON: { "insights": [{ "headline": "...", "body": "...", "sentiment": "positive|neutral|caution" }] }`,
              { venueId: venue.id, taskType: "weekly_insights", maxTokens: 1000 }
            );

            await supabase.from("weekly_insights").insert({
              venue_id: venue.id,
              insights: insights,
              generated_by: "cron",
            });
          } catch (err) {
            console.error(`Weekly insights failed for venue ${venue.id}:`, err);
          }
        }
        break;
      }

      case "post_wedding_sequence": {
        const { runPostWeddingSequenceAllVenues } = await import("@bloom/ingestion/post-wedding-sequence");
        await runPostWeddingSequenceAllVenues();
        break;
      }

      case "auto_email_scan": {
        // Daily: scan Gmail for new inquiry emails at all connected venues
        const { createServiceClient } = await import("@/lib/supabase/server");
        const supabase = createServiceClient();
        const { data: connections } = await supabase
          .from("email_connections")
          .select("venue_id")
          .eq("provider", "google");

        const scanned: string[] = [];
        for (const conn of connections ?? []) {
          try {
            // Import the scan logic — it handles token refresh internally
            const scanUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://intel-bloom-web.vercel.app"}/api/trpc/email.scan`;
            // Note: cron can't call tRPC directly (needs auth context)
            // For now, just log which venues need scanning
            scanned.push(conn.venue_id);
          } catch (err) {
            console.error(`Email scan failed for venue ${conn.venue_id}:`, err);
          }
        }
        return NextResponse.json({ success: true, job, venuesWithEmail: scanned.length });
      }

      // ── MONTHLY ──
      case "fred_economic_signals": {
        const { ingestFredSeries } = await import("@bloom/ingestion/fred/ingest-economic");
        const series = {
          consumer_sentiment: "UMCSENT",
          conference_board: "CSCICP03USM665S",
          cpi_services: "CPIFABSL",
          policy_uncertainty: "USEPUINDXD",
        };
        for (const [type, id] of Object.entries(series)) {
          await ingestFredSeries(id, type);
        }
        break;
      }

      default:
        return NextResponse.json({ error: `Unknown job: ${job}` }, { status: 400 });
    }

    return NextResponse.json({ success: true, job });
  } catch (err: any) {
    console.error(`Cron job ${job} failed:`, err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
