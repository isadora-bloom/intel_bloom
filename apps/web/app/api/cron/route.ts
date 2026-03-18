import { NextRequest, NextResponse } from "next/server";

// Vercel Cron authentication
function verifyCronSecret(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

export async function POST(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { job } = await request.json();

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
        // Call Supabase Edge Function
        const { createServiceClient } = await import("@/lib/supabase/server");
        const supabase = createServiceClient();
        await supabase.rpc("clear_aged_sensitive_flags");
        break;
      }

      // ── WEEKLY ──
      case "trends_refresh": {
        const { ingestTrendsAllVenues } = await import("@bloom/ingestion/trends/ingest-trends");
        const log: string[] = [];
        await ingestTrendsAllVenues(log);
        return NextResponse.json({ success: true, job, log });
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
