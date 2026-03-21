import { z } from "zod";
import { router, venueProcedure } from "@/lib/trpc/server";
import { TRPCError } from "@trpc/server";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── GMAIL HELPERS ──────────────────────────────────────────────────────────────

async function getValidToken(
  supabase: any,
  venueId: string
): Promise<{ token: string; emailAddress: string; connectionId: string }> {
  const { data: conn } = await supabase
    .from("email_connections")
    .select("*")
    .eq("venue_id", venueId)
    .eq("provider", "google")
    .single();

  if (!conn) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Gmail not connected" });
  }

  // Refresh if expiring within 2 minutes
  const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at) : null;
  const needsRefresh = !expiresAt || expiresAt < new Date(Date.now() + 120_000);

  if (!needsRefresh) {
    return { token: conn.access_token, emailAddress: conn.email_address, connectionId: conn.id };
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: conn.refresh_token,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to refresh Gmail token" });
  }

  const tokens = await res.json();

  await supabase
    .from("email_connections")
    .update({
      access_token: tokens.access_token,
      token_expires_at: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : null,
    })
    .eq("id", conn.id);

  return { token: tokens.access_token, emailAddress: conn.email_address, connectionId: conn.id };
}

async function gmailGet(token: string, path: string) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Gmail API error: ${res.status} ${await res.text()}`);
  return res.json();
}

// Decode base64url email part
function decodeBase64(encoded: string): string {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return Buffer.from(base64, "base64").toString("utf-8");
  } catch {
    return "";
  }
}

function extractEmailText(payload: any): string {
  if (!payload) return "";

  // Direct text/plain part
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64(payload.body.data).slice(0, 2000);
  }

  // Recurse into parts
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return decodeBase64(part.body.data).slice(0, 2000);
      }
    }
    // Fallback: first HTML part stripped
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        const html = decodeBase64(part.body.data);
        return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 2000);
      }
    }
  }

  return "";
}

function getHeader(headers: any[], name: string): string {
  return headers?.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

// ── EXTRACTION TYPES ───────────────────────────────────────────────────────────

interface EmailExtraction {
  isWeddingRelated: boolean;
  name: string | null;
  eventDate: string | null;       // ISO date or null
  source: string | null;          // the_knot | instagram | google | friend_referral | direct | other
  sourceQuote: string | null;     // the verbatim sentence they said
  guestCount: number | null;
  summary: string;
}

async function extractFromEmails(
  emails: Array<{ messageId: string; from: string; subject: string; body: string; date: string }>
): Promise<EmailExtraction[]> {
  if (emails.length === 0) return [];

  const prompt = `You are extracting intelligence from wedding venue inquiry emails. For each email, extract:
- is_wedding_related: is this an actual inquiry or tour request from a couple? (not spam, not vendor pitches)
- name: the couple's name (first name or full name, not their email handle)
- event_date: their wedding date if mentioned (ISO YYYY-MM-DD, or null)
- source: where they found the venue — map to one of: the_knot | wedding_wire | instagram | facebook | google | friend_referral | direct | other | null
- source_quote: the exact sentence where they mention how they found the venue (verbatim from the email), or null
- guest_count: number of guests if mentioned, or null
- summary: one plain sentence describing this email (max 15 words)

Emails:
${emails.map((e, i) => `
[${i}]
From: ${e.from}
Date: ${e.date}
Subject: ${e.subject}
Body: ${e.body}
`).join("\n---\n")}

Return a JSON array of exactly ${emails.length} objects in this order, one per email:
[{ "is_wedding_related": bool, "name": str|null, "event_date": str|null, "source": str|null, "source_quote": str|null, "guest_count": int|null, "summary": str }, ...]`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "[]";

  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const parsed = JSON.parse(jsonMatch?.[0] ?? "[]");
    return parsed.map((r: any) => ({
      isWeddingRelated: !!r.is_wedding_related,
      name: r.name ?? null,
      eventDate: r.event_date ?? null,
      source: r.source ?? null,
      sourceQuote: r.source_quote ?? null,
      guestCount: r.guest_count ?? null,
      summary: r.summary ?? "",
    }));
  } catch {
    return emails.map(() => ({
      isWeddingRelated: false,
      name: null,
      eventDate: null,
      source: null,
      sourceQuote: null,
      guestCount: null,
      summary: "Parse error",
    }));
  }
}

// ── MATCHING HELPERS ─────────────────────────────────────────────────────────

// Score how likely two names refer to the same person.
// Handles: exact match, nicknames ("Maddy" / "Madeline"), initials ("Maddy D." / "Madeline Deep")
export function nameMatchScore(nameA: string, nameB: string): number {
  const clean = (s: string) => s.trim().toLowerCase().replace(/\.$/, "");
  const a = clean(nameA);
  const b = clean(nameB);
  if (a === b) return 100;

  const aParts = a.split(/\s+/);
  const bParts = b.split(/\s+/);
  const aFirst = aParts[0];
  const bFirst = bParts[0];
  const aLast = aParts.length > 1 ? clean(aParts[aParts.length - 1]) : null;
  const bLast = bParts.length > 1 ? clean(bParts[bParts.length - 1]) : null;

  let score = 0;

  // First name scoring
  if (aFirst === bFirst) {
    score += 60;
  } else if (aFirst.length >= 3 && bFirst.length >= 3) {
    // Count shared prefix length
    let shared = 0;
    while (shared < aFirst.length && shared < bFirst.length && aFirst[shared] === bFirst[shared]) {
      shared++;
    }
    // "Maddy" / "Madeline" share 3 chars ("mad") — moderate match
    // "Maggi" / "Margaret" share 3 chars ("mag") — moderate
    if (shared >= 5) score += 50;
    else if (shared >= 4) score += 38;
    else if (shared >= 3) score += 22;
  }

  // Last name / initial scoring (only matters if first name already partially matched)
  if (score > 0 && aLast && bLast) {
    if (aLast === bLast) {
      score += 40; // full last name match
    } else if (aLast.length === 1 && bLast.startsWith(aLast)) {
      score += 28; // "D" initial matches "Deep"
    } else if (bLast.length === 1 && aLast.startsWith(bLast)) {
      score += 28; // "Deep" matched against "D" initial
    }
  }

  return Math.min(score, 100);
}

// Days between two date strings (ISO or parseable). Returns null if either is missing.
export function daysBetween(dateA: string | null, dateB: string | null): number | null {
  if (!dateA || !dateB) return null;
  try {
    const diff = Math.abs(new Date(dateA).getTime() - new Date(dateB).getTime());
    return diff / (1000 * 60 * 60 * 24);
  } catch {
    return null;
  }
}

// Hard cutoff: over this many days apart = different planning cycle, don't link.
const MAX_LINK_DAYS = 365;

// Bonus/penalty based on how close in time two touches are.
// Positive = same person likely. Negative = probably different inquiry cycle.
export function timeProximityBonus(days: number): number {
  if (days <= 3)   return 35;  // 48-hour window — very strong
  if (days <= 14)  return 22;  // within two weeks
  if (days <= 30)  return 12;  // within a month
  if (days <= 90)  return 4;   // within a quarter — mild
  if (days <= 180) return -10; // getting stale
  return -25;                  // 6-12 months apart — probably different cycle
}

// ── MATCH RESULT ──────────────────────────────────────────────────────────────

interface MatchResult {
  matchedLeadId: string | null;
  matchedInquiryId: string | null;
  matchedClientId: string | null;
  matchScore: number;
  matchSignals: string[];
  matchStatus: "auto_linked" | "pending_review" | "unmatched";
}

async function matchExtraction(
  supabase: any,
  venueId: string,
  extraction: EmailExtraction,
  fromEmail: string,
  emailReceivedAt: string | null
): Promise<MatchResult> {
  let score = 0;
  const signals: string[] = [];
  let matchedLeadId: string | null = null;
  let matchedInquiryId: string | null = null;
  let matchedClientId: string | null = null;

  const cleanEmail = fromEmail.toLowerCase().trim();

  // Fetch candidates in parallel — cast a wide net by first 3 chars of first name
  const firstName = extraction.name
    ? extraction.name.trim().split(/\s+/)[0].toLowerCase()
    : null;
  const namePrefix = firstName ? firstName.slice(0, 3) : null;

  const [inquiriesRes, clientsRes, leadsRes] = await Promise.all([
    cleanEmail
      ? supabase
          .from("inquiries")
          .select("id, name_extracted, platform, received_at, email_extracted")
          .eq("venue_id", venueId)
          .ilike("email_extracted", cleanEmail)
          .limit(3)
      : { data: [] },

    cleanEmail
      ? supabase
          .from("clients")
          .select("id, name_primary, first_touch_platform, event_date, email_primary")
          .eq("venue_id", venueId)
          .ilike("email_primary", cleanEmail)
          .limit(3)
      : { data: [] },

    // Wide name search — we score properly below
    namePrefix
      ? supabase
          .from("leads")
          .select("id, name, platform, touch_type, source_date")
          .eq("venue_id", venueId)
          .ilike("name", `${namePrefix}%`)
          .limit(20)
      : { data: [] },
  ]);

  // ── Email address match (order-independent, strongest signal) ──────────────

  if (clientsRes.data?.length > 0) {
    matchedClientId = clientsRes.data[0].id;
    score += 90;
    signals.push("email address matches client record");
  }

  if (inquiriesRes.data?.length > 0) {
    const inq = inquiriesRes.data[0];
    matchedInquiryId = inq.id;
    score += 90;
    signals.push("email address matches inquiry record");
    // Time proximity bonus on the inquiry itself
    const days = daysBetween(emailReceivedAt, inq.received_at);
    if (days !== null && days <= MAX_LINK_DAYS) {
      const bonus = timeProximityBonus(days);
      if (bonus !== 0) {
        score += bonus;
        signals.push(`inquiry ${Math.round(days)}d apart`);
      }
    }
  }

  // ── Name-based lead matching (fuzzy + time window) ─────────────────────────

  if (extraction.name && leadsRes.data?.length > 0) {
    // Find the best-scoring lead candidate
    let bestLead: any = null;
    let bestLeadScore = 0;

    for (const lead of leadsRes.data ?? []) {
      if (!lead.name) continue;

      const nScore = nameMatchScore(extraction.name, lead.name);
      if (nScore < 40) continue; // not plausibly the same person

      // Time proximity — works regardless of which came first
      const days = daysBetween(emailReceivedAt, lead.source_date);

      // Hard block: over a year apart = different planning cycle
      if (days !== null && days > MAX_LINK_DAYS) continue;

      let candidateScore = nScore;

      // Time proximity bonus/penalty
      if (days !== null) {
        candidateScore += timeProximityBonus(days);
      }

      // Platform corroboration: email mentions same source as lead platform
      if (
        extraction.source &&
        lead.platform &&
        extraction.source.toLowerCase().replace(/\s+/g, "_") === lead.platform
      ) {
        candidateScore += 20;
      }

      if (candidateScore > bestLeadScore) {
        bestLeadScore = candidateScore;
        bestLead = lead;
      }
    }

    if (bestLead && bestLeadScore >= 40) {
      matchedLeadId = bestLead.id;
      score += bestLeadScore;

      const days = daysBetween(emailReceivedAt, bestLead.source_date);
      const daysStr = days !== null ? ` (${Math.round(days)}d apart)` : "";
      signals.push(
        `name match: "${bestLead.name}" via ${bestLead.platform} ${bestLead.touch_type}${daysStr}`
      );
    }
  }

  // ── Event date corroboration ───────────────────────────────────────────────

  if (extraction.eventDate && firstName) {
    const { data: clientDateMatch } = await supabase
      .from("clients")
      .select("id, name_primary")
      .eq("venue_id", venueId)
      .eq("event_date", extraction.eventDate)
      .ilike("name_primary", `${firstName.slice(0, 3)}%`)
      .limit(3);

    for (const c of clientDateMatch ?? []) {
      const nScore = nameMatchScore(extraction.name ?? firstName, c.name_primary ?? "");
      if (nScore >= 30) {
        if (!matchedClientId) {
          matchedClientId = c.id;
          score += 55;
          signals.push("first name + event date matches client");
        } else {
          score += 15;
          signals.push("event date corroborated");
        }
        break;
      }
    }
  }

  // Source quote adds confidence when we have a lead match
  if (extraction.sourceQuote && matchedLeadId) {
    score += 12;
    signals.push(`source mentioned: "${extraction.sourceQuote.slice(0, 60)}"`);
  }

  const matchStatus: MatchResult["matchStatus"] =
    score >= 85 ? "auto_linked"
    : score >= 50 ? "pending_review"
    : "unmatched";

  return {
    matchedLeadId,
    matchedInquiryId,
    matchedClientId,
    matchScore: Math.min(score, 100),
    matchSignals: signals,
    matchStatus,
  };
}

// ── ROUTER ────────────────────────────────────────────────────────────────────

export const emailRouter = router({
  // Check if Gmail is connected
  getConnection: venueProcedure.query(async ({ ctx }) => {
    const { data } = await ctx.supabase
      .from("email_connections")
      .select("id, email_address, last_synced_at, created_at")
      .eq("venue_id", ctx.venueId)
      .eq("provider", "google")
      .single();

    return data ?? null;
  }),

  // Disconnect Gmail
  disconnect: venueProcedure.mutation(async ({ ctx }) => {
    await ctx.supabase
      .from("email_connections")
      .delete()
      .eq("venue_id", ctx.venueId)
      .eq("provider", "google");
    return { ok: true };
  }),

  // Scan inbox — search, extract, match, store
  scan: venueProcedure
    .input(z.object({
      maxEmails: z.number().min(10).max(500).default(200),
      daysBack: z.number().min(30).max(1825).default(730),
    }))
    .mutation(async ({ ctx, input }) => {
      const { token, connectionId } = await getValidToken(ctx.supabase, ctx.venueId);

      // Already-scanned message IDs so we don't re-extract
      const { data: existingExtractions } = await ctx.supabase
        .from("email_extractions")
        .select("gmail_message_id")
        .eq("venue_id", ctx.venueId);

      const alreadyScanned = new Set<string>(
        (existingExtractions ?? []).map((e: any) => e.gmail_message_id)
      );

      // Search Gmail — all mail, no keyword filter (venue inbox is mostly wedding-related)
      // Use pagination to collect up to maxEmails results
      const query = encodeURIComponent(`newer_than:${input.daysBack}d -from:me`);

      const messageIds: string[] = [];
      let pageToken: string | undefined;
      do {
        const url = `messages?q=${query}&maxResults=500${pageToken ? `&pageToken=${pageToken}` : ""}`;
        const listData = await gmailGet(token, url);
        for (const m of listData.messages ?? []) messageIds.push(m.id);
        pageToken = listData.nextPageToken;
      } while (pageToken && messageIds.length < input.maxEmails);
      const newIds = messageIds.filter((id) => !alreadyScanned.has(id));

      if (newIds.length === 0) {
        return {
          scanned: 0,
          newWeddingEmails: 0,
          sourceAttribFound: 0,
          matchesFound: 0,
          autoLinked: 0,
          pendingReview: 0,
          extractions: [],
        };
      }

      // Fetch message details in parallel — cap at maxEmails, batched to avoid rate limits
      const toFetch = newIds.slice(0, input.maxEmails);
      const messageDetails = await Promise.all(
        toFetch.map((id) =>
          gmailGet(token, `messages/${id}?format=full`).catch(() => null)
        )
      );

      // Build email objects for Claude
      const emailBatch = messageDetails
        .filter(Boolean)
        .map((msg: any) => {
          const headers = msg.payload?.headers ?? [];
          return {
            messageId: msg.id as string,
            threadId: msg.threadId as string,
            from: getHeader(headers, "from"),
            subject: getHeader(headers, "subject"),
            date: getHeader(headers, "date"),
            internalDate: msg.internalDate,
            body: extractEmailText(msg.payload),
          };
        })
        .filter((e) => e.body.length > 20); // skip empty/unreadable messages

      // Extract in batches of 10 (Claude handles ~10 emails per call well)
      const BATCH = 10;
      const allExtractions: Array<EmailExtraction & {
        messageId: string;
        threadId: string;
        from: string;
        subject: string;
        internalDate: string;
      }> = [];

      for (let i = 0; i < emailBatch.length; i += BATCH) {
        const batch = emailBatch.slice(i, i + BATCH);
        const extracted = await extractFromEmails(batch);
        for (let j = 0; j < batch.length; j++) {
          allExtractions.push({
            ...extracted[j],
            messageId: batch[j].messageId,
            threadId: batch[j].threadId,
            from: batch[j].from,
            subject: batch[j].subject,
            internalDate: batch[j].internalDate,
          });
        }
      }

      // Process wedding-related extractions: match + store
      const weddingEmails = allExtractions.filter((e) => e.isWeddingRelated);
      const toInsert: any[] = [];
      const results: any[] = [];

      for (const extraction of weddingEmails) {
        // Parse from address: "Claire Thompson <claire@gmail.com>" → email
        const fromEmailMatch = extraction.from.match(/<([^>]+)>/);
        const fromEmail = fromEmailMatch ? fromEmailMatch[1] : extraction.from;
        const fromName = extraction.from.replace(/<[^>]+>/, "").trim().replace(/^"(.*)"$/, "$1");

        const receivedAt = extraction.internalDate
          ? new Date(parseInt(extraction.internalDate)).toISOString()
          : null;

        const match = await matchExtraction(
          ctx.supabase,
          ctx.venueId,
          extraction,
          fromEmail,
          receivedAt
        );

        const row = {
          venue_id: ctx.venueId,
          gmail_message_id: extraction.messageId,
          thread_id: extraction.threadId,
          received_at: receivedAt,
          from_email: fromEmail,
          from_name: fromName || extraction.name || null,
          subject: extraction.subject,
          extracted_name: extraction.name,
          extracted_event_date: extraction.eventDate,
          extracted_source: extraction.source,
          extracted_source_quote: extraction.sourceQuote,
          extracted_guest_count: extraction.guestCount,
          extraction_summary: extraction.summary,
          match_status: match.matchStatus,
          matched_lead_id: match.matchedLeadId,
          matched_inquiry_id: match.matchedInquiryId,
          matched_client_id: match.matchedClientId,
          match_score: match.matchScore,
          match_signals: match.matchSignals,
        };

        toInsert.push(row);
        results.push({ ...row, matchSignals: match.matchSignals });
      }

      // Bulk insert (ignore duplicates)
      if (toInsert.length > 0) {
        await ctx.supabase
          .from("email_extractions")
          .upsert(toInsert, { onConflict: "venue_id,gmail_message_id", ignoreDuplicates: true });
      }

      // If any auto-linked leads, update their linked_inquiry_id
      for (const r of results) {
        if (r.match_status === "auto_linked" && r.matched_lead_id && r.matched_inquiry_id) {
          await ctx.supabase
            .from("leads")
            .update({ linked_inquiry_id: r.matched_inquiry_id })
            .eq("id", r.matched_lead_id)
            .is("linked_inquiry_id", null); // only if not already linked
        }
        if (r.match_status === "auto_linked" && r.matched_lead_id && r.matched_client_id) {
          await ctx.supabase
            .from("leads")
            .update({ linked_client_id: r.matched_client_id })
            .eq("id", r.matched_lead_id)
            .is("linked_client_id", null);
        }
        // Also back-fill source on inquiry/client if we extracted a source and they don't have one
        if (r.extracted_source && r.matched_inquiry_id) {
          await ctx.supabase
            .from("inquiries")
            .update({ self_reported_source: r.extracted_source })
            .eq("id", r.matched_inquiry_id)
            .is("self_reported_source", null);
        }
        if (r.extracted_source && r.matched_client_id) {
          await ctx.supabase
            .from("clients")
            .update({ self_reported_source: r.extracted_source })
            .eq("id", r.matched_client_id)
            .is("self_reported_source", null);
        }
      }

      // Update last_synced_at on connection
      await ctx.supabase
        .from("email_connections")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("id", connectionId);

      const autoLinked = results.filter((r) => r.match_status === "auto_linked").length;
      const pendingReview = results.filter((r) => r.match_status === "pending_review").length;
      const sourceFound = results.filter((r) => r.extracted_source).length;

      return {
        scanned: emailBatch.length,
        newWeddingEmails: weddingEmails.length,
        sourceAttribFound: sourceFound,
        matchesFound: autoLinked + pendingReview,
        autoLinked,
        pendingReview,
        extractions: results.slice(0, 30).map((r) => ({
          id: r.gmail_message_id,
          fromName: r.from_name,
          fromEmail: r.from_email,
          subject: r.subject,
          receivedAt: r.received_at,
          extractedName: r.extracted_name,
          extractedSource: r.extracted_source,
          sourceQuote: r.extracted_source_quote,
          eventDate: r.extracted_event_date,
          summary: r.extraction_summary,
          matchStatus: r.match_status,
          matchScore: r.match_score,
          matchSignals: r.match_signals,
        })),
      };
    }),

  // Get previously scanned extractions with pending review
  getPendingMatches: venueProcedure.query(async ({ ctx }) => {
    const { data } = await ctx.supabase
      .from("email_extractions")
      .select("*")
      .eq("venue_id", ctx.venueId)
      .eq("match_status", "pending_review")
      .order("created_at", { ascending: false })
      .limit(50);

    return data ?? [];
  }),

  // Approve or reject a pending match
  resolveMatch: venueProcedure
    .input(z.object({
      extractionId: z.string().uuid(),
      action: z.enum(["approve", "reject"]),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.action === "reject") {
        await ctx.supabase
          .from("email_extractions")
          .update({ match_status: "rejected" })
          .eq("id", input.extractionId)
          .eq("venue_id", ctx.venueId);
        return { ok: true };
      }

      // Approve: promote to auto_linked and push source back-fill
      const { data: extraction } = await ctx.supabase
        .from("email_extractions")
        .select("*")
        .eq("id", input.extractionId)
        .eq("venue_id", ctx.venueId)
        .single();

      if (!extraction) return { ok: false };

      await ctx.supabase
        .from("email_extractions")
        .update({ match_status: "auto_linked" })
        .eq("id", input.extractionId);

      if (extraction.matched_lead_id && extraction.matched_inquiry_id) {
        await ctx.supabase
          .from("leads")
          .update({ linked_inquiry_id: extraction.matched_inquiry_id })
          .eq("id", extraction.matched_lead_id)
          .is("linked_inquiry_id", null);
      }
      if (extraction.matched_lead_id && extraction.matched_client_id) {
        await ctx.supabase
          .from("leads")
          .update({ linked_client_id: extraction.matched_client_id })
          .eq("id", extraction.matched_lead_id)
          .is("linked_client_id", null);
      }
      if (extraction.extracted_source && extraction.matched_inquiry_id) {
        await ctx.supabase
          .from("inquiries")
          .update({ self_reported_source: extraction.extracted_source })
          .eq("id", extraction.matched_inquiry_id)
          .is("self_reported_source", null);
      }
      if (extraction.extracted_source && extraction.matched_client_id) {
        await ctx.supabase
          .from("clients")
          .update({ self_reported_source: extraction.extracted_source })
          .eq("id", extraction.matched_client_id)
          .is("self_reported_source", null);
      }

      return { ok: true };
    }),
});
