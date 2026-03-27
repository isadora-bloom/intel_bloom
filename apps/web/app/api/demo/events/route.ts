import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { DEMO_COOKIE, parseDemoCookie } from "@/lib/demo";

/**
 * POST /api/demo/events
 * Ingests demo tracking events from the client-side tracker.
 * Accepts a batch of events for efficiency.
 */
export async function POST(request: NextRequest) {
  const demoCookie = request.cookies.get(DEMO_COOKIE)?.value;
  const session = parseDemoCookie(demoCookie);

  if (!session) {
    return NextResponse.json({ error: "No demo session" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const events = Array.isArray(body.events) ? body.events : body.event ? [body.event] : [];

  if (events.length === 0) {
    return NextResponse.json({ error: "No events" }, { status: 400 });
  }

  const db = createServiceClient();

  // Insert events
  const rows = events.slice(0, 50).map((evt: any) => ({
    session_id: session.sessionId,
    event_type: String(evt.type || "unknown").slice(0, 50),
    page_path: evt.page ? String(evt.page).slice(0, 200) : null,
    role: session.role,
    venue_slug: evt.venueSlug ? String(evt.venueSlug).slice(0, 50) : null,
    duration_ms: typeof evt.durationMs === "number" ? evt.durationMs : null,
    scroll_depth_pct: typeof evt.scrollPct === "number" ? Math.min(100, evt.scrollPct) : null,
    feature_name: evt.feature ? String(evt.feature).slice(0, 100) : null,
    feature_detail: evt.detail ? String(evt.detail).slice(0, 500) : null,
    element_id: evt.elementId ? String(evt.elementId).slice(0, 100) : null,
    element_text: evt.elementText ? String(evt.elementText).slice(0, 200) : null,
    viewport_width: typeof evt.vw === "number" ? evt.vw : null,
    viewport_height: typeof evt.vh === "number" ? evt.vh : null,
    is_mobile: typeof evt.mobile === "boolean" ? evt.mobile : false,
  }));

  const { error } = await db.from("demo_events").insert(rows);
  if (error) {
    console.error("Demo events insert error:", error.message);
  }

  // Update session aggregate stats
  const pageViews = events.filter((e: any) => e.type === "page_view").length;
  const totalDuration = events.reduce((sum: number, e: any) =>
    sum + (typeof e.durationMs === "number" ? Math.round(e.durationMs / 1000) : 0), 0);

  if (pageViews > 0 || totalDuration > 0) {
    // Use RPC or raw update to increment counters
    await Promise.resolve(db.rpc("increment_demo_session_stats", {
      p_session_id: session.sessionId,
      p_page_views: pageViews,
      p_duration_secs: totalDuration,
    })).catch(() => {
      // Fallback: direct update (less atomic but works without the function)
      db.from("demo_sessions")
        .update({
          total_page_views: pageViews, // This won't increment, just set — but it's a fallback
          last_active_at: new Date().toISOString(),
        })
        .eq("id", session.sessionId)
        .then(() => {});
    });
  }

  return NextResponse.json({ ok: true, count: rows.length });
}
