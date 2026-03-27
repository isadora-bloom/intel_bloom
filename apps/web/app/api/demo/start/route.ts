import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  DEMO_COOKIE,
  DEMO_SESSION_DURATION_MS,
  createDemoSessionPayload,
  type DemoRole,
} from "@/lib/demo";

const VALID_ROLES = new Set(["owner", "manager", "coordinator"]);

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const role = body.role as string;

  if (!role || !VALID_ROLES.has(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  // Create demo session in the database for tracking
  const db = createServiceClient();
  const expiresAt = new Date(Date.now() + DEMO_SESSION_DURATION_MS);

  const { data: session, error } = await db
    .from("demo_sessions")
    .insert({
      role,
      expires_at: expiresAt.toISOString(),
      ip_address: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip"),
      user_agent: request.headers.get("user-agent"),
      referrer: request.headers.get("referer"),
      utm_source: body.utm_source || null,
      utm_medium: body.utm_medium || null,
      utm_campaign: body.utm_campaign || null,
    })
    .select("id")
    .single();

  if (error || !session) {
    console.error("Failed to create demo session:", error?.message);
    // Still allow demo even if tracking fails
  }

  const sessionId = session?.id || crypto.randomUUID();
  const payload = createDemoSessionPayload(role as DemoRole, sessionId);

  const response = NextResponse.json({ ok: true, session: payload });

  // Set cookie — httpOnly false so client JS can read role for UI adjustments
  response.cookies.set(DEMO_COOKIE, JSON.stringify(payload), {
    path: "/",
    maxAge: DEMO_SESSION_DURATION_MS / 1000,
    sameSite: "lax",
    httpOnly: false,
  });

  return response;
}
