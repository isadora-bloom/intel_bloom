import { z } from "zod";
import { router, venueProcedure } from "@/lib/trpc/server";
import { TRPCError } from "@trpc/server";

const CALENDLY_BASE = "https://api.calendly.com";

async function calendlyFetch(path: string, apiKey: string) {
  const res = await fetch(`${CALENDLY_BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Calendly API error ${res.status}: ${text}`);
  }
  return res.json();
}

/** Extract a Q&A answer where the question contains any of the keywords */
function extractQA(qa: any[], ...keywords: string[]): string | null {
  if (!qa?.length) return null;
  for (const item of qa) {
    const q = (item.question ?? "").toLowerCase();
    if (keywords.some((k) => q.includes(k)) && item.answer) {
      return String(item.answer).trim();
    }
  }
  return null;
}

export const calendlyRouter = router({
  // Sync all Calendly events (active + cancelled, past + future) into the tours table
  syncTours: venueProcedure.mutation(async ({ ctx }) => {
    const { data: venueData, error: venueError } = await ctx.supabase
      .from("venues")
      .select("calendly_api_key")
      .eq("id", ctx.venueId)
      .single();

    if (venueError) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: venueError.message });
    if (!venueData?.calendly_api_key) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No Calendly API key configured for this venue." });
    }

    const apiKey = venueData.calendly_api_key as string;

    // Get user URI
    const meData = await calendlyFetch("/users/me", apiKey);
    const userUri = meData.resource?.uri as string;
    if (!userUri) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not retrieve Calendly user URI." });

    // Fetch existing external_ids to skip already-synced events
    const { data: existingTours } = await ctx.supabase
      .from("tours")
      .select("external_id")
      .eq("venue_id", ctx.venueId)
      .not("external_id", "is", null);

    const syncedUris = new Set<string>(
      (existingTours ?? []).map((t: any) => t.external_id).filter(Boolean)
    );

    // Also collect legacy URIs stored in notes_raw JSON (backwards compat)
    const { data: legacyTours } = await ctx.supabase
      .from("tours")
      .select("notes_raw")
      .eq("venue_id", ctx.venueId)
      .is("external_id", null);

    for (const t of legacyTours ?? []) {
      try {
        const parsed = typeof t.notes_raw === "string" ? JSON.parse(t.notes_raw) : t.notes_raw;
        if (parsed?.calendly_uri) syncedUris.add(parsed.calendly_uri);
      } catch { /* not JSON */ }
    }

    // Paginate ALL events — both active and canceled, no date restriction
    const allEvents: any[] = [];
    for (const status of ["active", "canceled"]) {
      let nextPageToken: string | null = null;
      do {
        const params = new URLSearchParams({ user: userUri, status, count: "100" });
        if (nextPageToken) params.set("page_token", nextPageToken);
        const eventsData = await calendlyFetch(`/scheduled_events?${params.toString()}`, apiKey);
        allEvents.push(...(eventsData.collection ?? []));
        nextPageToken = eventsData.pagination?.next_page_token ?? null;
      } while (nextPageToken);
    }

    const now = new Date();
    let synced = 0;
    let alreadyExisted = 0;
    const errors: string[] = [];

    for (const event of allEvents) {
      const eventUri = event.uri as string;
      if (!eventUri) continue;
      if (syncedUris.has(eventUri)) { alreadyExisted++; continue; }

      try {
        const uuidMatch = eventUri.match(/scheduled_events\/([^/]+)/);
        const eventUuid = uuidMatch?.[1];
        if (!eventUuid) continue;

        // Fetch invitees for this event
        const inviteesData = await calendlyFetch(
          `/scheduled_events/${eventUuid}/invitees?count=100`,
          apiKey
        );
        const invitees: any[] = inviteesData.collection ?? [];
        const firstInvitee = invitees[0];

        const scheduledAt = event.start_time as string | null;
        if (!scheduledAt) { errors.push(`Event ${eventUuid} has no start_time`); continue; }

        const isCancelled = event.status === "canceled";
        const isPast = new Date(scheduledAt) < now;

        // Extract invitee details
        const inviteeName: string | null = firstInvitee?.name ?? null;
        const inviteeEmail: string | null = firstInvitee?.email ?? null;
        const inviteePhone: string | null = firstInvitee?.text_reminder_number ?? null;
        const qa: any[] = firstInvitee?.questions_and_answers ?? [];

        // Mine Q&A for useful signals
        const selfReportedSource = extractQA(qa, "hear about", "find us", "source", "referral", "discover");
        const weddingDateRaw = extractQA(qa, "wedding date", "event date", "date of");
        const guestCountRaw = extractQA(qa, "guest", "how many", "number of guests");

        // Parse wedding date from Q&A (best-effort)
        let extractedEventDate: string | null = null;
        if (weddingDateRaw) {
          const d = new Date(weddingDateRaw);
          if (!isNaN(d.getTime())) extractedEventDate = d.toISOString().split("T")[0];
        }

        // Try to auto-match to an existing client by email
        let clientId: string | null = null;
        if (inviteeEmail) {
          const { data: matchedClient } = await ctx.supabase
            .from("clients")
            .select("id")
            .eq("venue_id", ctx.venueId)
            .or(`email_primary.eq.${inviteeEmail},email_partner.eq.${inviteeEmail}`)
            .limit(1)
            .single();
          clientId = matchedClient?.id ?? null;
        }

        const { error: insertError } = await ctx.supabase.from("tours").insert({
          venue_id: ctx.venueId,
          client_id: clientId,
          scheduled_at: scheduledAt,
          tour_type: (event.name as string) ?? "tour",
          completed: isPast && !isCancelled,
          cancelled: isCancelled,
          self_reported_source: selfReportedSource,
          invitee_name: inviteeName,
          invitee_email: inviteeEmail,
          invitee_phone: inviteePhone,
          invitee_qa: qa.length > 0 ? qa : null,
          external_id: eventUri,
          source: "calendly",
          notes_raw: JSON.stringify({ calendly_uri: eventUri }), // keep for backwards compat
        });

        if (insertError) {
          errors.push(`Failed to insert tour for ${eventUuid}: ${insertError.message}`);
        } else {
          synced++;
          syncedUris.add(eventUri);

          // If we matched a client and have an extracted event date, backfill it
          if (clientId && extractedEventDate) {
            await ctx.supabase
              .from("clients")
              .update({ event_date: extractedEventDate })
              .eq("id", clientId)
              .is("event_date", null); // only if not already set
          }
        }
      } catch (err: any) {
        errors.push(`Error processing ${eventUri}: ${err.message}`);
      }
    }

    return { synced, alreadyExisted, errors };
  }),

  // Upcoming tours for this venue
  getUpcomingTours: venueProcedure.query(async ({ ctx }) => {
    const now = new Date().toISOString();

    const { data, error } = await ctx.supabase
      .from("tours")
      .select("*, clients(id, name_primary, email_primary)")
      .eq("venue_id", ctx.venueId)
      .gte("scheduled_at", now)
      .eq("cancelled", false)
      .order("scheduled_at", { ascending: true })
      .limit(20);

    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

    return (data ?? []).map((tour: any) => ({
      id: tour.id,
      scheduledAt: tour.scheduled_at,
      tourType: tour.tour_type,
      completed: tour.completed,
      cancelled: tour.cancelled,
      selfReportedSource: tour.self_reported_source,
      inviteeName: tour.invitee_name,
      inviteeEmail: tour.invitee_email,
      clientId: tour.client_id,
      clientName: tour.clients?.name_primary ?? tour.invitee_name ?? null,
      clientEmail: tour.clients?.email_primary ?? tour.invitee_email ?? null,
    }));
  }),

  // Aggregate tour stats for this venue
  getStats: venueProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from("tours")
      .select("completed, cancelled, booking_conversion_days")
      .eq("venue_id", ctx.venueId);

    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

    const tours = data ?? [];
    const totalTours = tours.filter((t: any) => !t.cancelled).length;
    const completedTours = tours.filter((t: any) => t.completed).length;
    const cancelledTours = tours.filter((t: any) => t.cancelled).length;

    const conversionRate = totalTours > 0 ? completedTours / totalTours : 0;

    const bookingDays = tours
      .filter((t: any) => t.booking_conversion_days != null)
      .map((t: any) => t.booking_conversion_days as number);
    const avgBookingDays =
      bookingDays.length > 0
        ? Math.round(bookingDays.reduce((a: number, b: number) => a + b, 0) / bookingDays.length)
        : null;

    return { totalTours, completedTours, cancelledTours, conversionRate, avgBookingDays };
  }),
});
