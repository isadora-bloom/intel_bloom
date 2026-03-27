import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { callAIJson } from "@/lib/ai";

/**
 * Daily cron: auto-scan Gmail for new inquiry emails at all connected venues.
 * Runs independently of user sessions — uses service role + stored OAuth tokens.
 */

function verifyCronSecret(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

async function gmailGet(token: string, path: string) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Gmail API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getValidToken(db: any, venueId: string) {
  const { data: conn } = await db
    .from("email_connections")
    .select("*")
    .eq("venue_id", venueId)
    .eq("provider", "google")
    .single();

  if (!conn) return null;

  const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at) : null;
  const needsRefresh = !expiresAt || expiresAt < new Date(Date.now() + 120_000);

  if (!needsRefresh) {
    return conn.access_token;
  }

  // Refresh the token
  if (!conn.refresh_token) return null;

  const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: conn.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!refreshRes.ok) return null;

  const tokens = await refreshRes.json();
  await db
    .from("email_connections")
    .update({
      access_token: tokens.access_token,
      token_expires_at: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString(),
    })
    .eq("id", conn.id);

  return tokens.access_token;
}

function extractEmailText(payload: any): string {
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64").toString("utf-8");
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const text = extractEmailText(part);
      if (text) return text;
    }
  }
  return "";
}

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createServiceClient();

  // Find all venues with Gmail connected
  const { data: connections } = await db
    .from("email_connections")
    .select("venue_id, email_address")
    .eq("provider", "google");

  if (!connections || connections.length === 0) {
    return NextResponse.json({ success: true, scanned: 0, message: "No venues with Gmail connected" });
  }

  const results: Array<{ venueId: string; newEmails: number; error?: string }> = [];

  for (const conn of connections) {
    try {
      const token = await getValidToken(db, conn.venue_id);
      if (!token) {
        results.push({ venueId: conn.venue_id, newEmails: 0, error: "Token refresh failed" });
        continue;
      }

      // Get already-scanned message IDs
      const { data: existing } = await db
        .from("email_extractions")
        .select("gmail_message_id")
        .eq("venue_id", conn.venue_id);
      const alreadyScanned = new Set((existing ?? []).map((e: any) => e.gmail_message_id));

      // Search for emails from the last 3 days (daily scan)
      const query = encodeURIComponent("newer_than:3d -from:me");
      const listData = await gmailGet(token, `messages?q=${query}&maxResults=50`);
      const messageIds = (listData.messages ?? []).map((m: any) => m.id);
      const newIds = messageIds.filter((id: string) => !alreadyScanned.has(id));

      if (newIds.length === 0) {
        results.push({ venueId: conn.venue_id, newEmails: 0 });
        continue;
      }

      // Process up to 20 new emails
      let processed = 0;
      for (const msgId of newIds.slice(0, 20)) {
        try {
          const msg = await gmailGet(token, `messages/${msgId}?format=full`);
          const headers = msg.payload?.headers ?? [];
          const from = headers.find((h: any) => h.name === "From")?.value ?? "";
          const subject = headers.find((h: any) => h.name === "Subject")?.value ?? "";
          const date = headers.find((h: any) => h.name === "Date")?.value ?? "";
          const body = extractEmailText(msg.payload ?? {}).substring(0, 2000);

          // Skip emails from the venue itself
          if (from.includes(conn.email_address)) continue;

          // Use AI to classify — is this a wedding inquiry?
          const classification = await callAIJson<{
            is_inquiry: boolean;
            name: string | null;
            email: string | null;
            event_date: string | null;
            source: string | null;
            guest_count: number | null;
          }>(
            `Is this email a wedding venue inquiry or lead? Classify it.

From: ${from}
Subject: ${subject}
Body preview: ${body.substring(0, 1000)}

Return JSON:
{
  "is_inquiry": true/false,
  "name": "couple name or null",
  "email": "their email or null",
  "event_date": "YYYY-MM-DD or null",
  "source": "the_knot|wedding_wire|zola|instagram|google|direct|referral|other|null",
  "guest_count": number or null
}

Only mark is_inquiry=true if this is clearly a couple or platform inquiring about a wedding/event. Marketing emails, newsletters, vendor pitches = false.`,
            { taskType: "auto_email_classify", venueId: conn.venue_id, maxTokens: 300 }
          );

          // Store the extraction
          await db.from("email_extractions").insert({
            venue_id: conn.venue_id,
            gmail_message_id: msgId,
            from_address: from,
            subject,
            received_at: date ? new Date(date).toISOString() : new Date().toISOString(),
            is_inquiry: classification.is_inquiry,
            extracted_name: classification.name,
            extracted_email: classification.email,
            extracted_event_date: classification.event_date,
            extracted_source: classification.source,
            match_status: "pending",
          });

          // If it's an inquiry, create an inquiry record
          if (classification.is_inquiry) {
            await db.from("inquiries").insert({
              venue_id: conn.venue_id,
              platform: classification.source ?? "email",
              name_extracted: classification.name,
              email_extracted: classification.email,
              event_date_extracted: classification.event_date,
              guest_count_extracted: classification.guest_count,
              received_at: date ? new Date(date).toISOString() : new Date().toISOString(),
              day_of_week: new Date(date || Date.now()).getDay(),
              hour_of_day: new Date(date || Date.now()).getHours(),
              inquiry_intent: "unknown",
              match_status: "unmatched",
            });
            processed++;
          }
        } catch (err: any) {
          console.error(`[email-scan] Error processing message ${msgId}:`, err.message);
        }
      }

      results.push({ venueId: conn.venue_id, newEmails: processed });
    } catch (err: any) {
      results.push({ venueId: conn.venue_id, newEmails: 0, error: err.message });
    }
  }

  return NextResponse.json({
    success: true,
    scanned: connections.length,
    results,
  });
}
