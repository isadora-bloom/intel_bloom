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

export const calendlyRouter = router({
  // Sync tours from Calendly into the tours table
  syncTours: venueProcedure.mutation(async ({ ctx }) => {
    // 1. Fetch API key for this venue
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

    // 2. Get user URI + organization URI
    const meData = await calendlyFetch("/users/me", apiKey);
    const userUri = meData.resource?.uri as string;
    if (!userUri) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not retrieve Calendly user URI." });

    // 3. Paginate all active scheduled events
    const allEvents: any[] = [];
    let nextPageToken: string | null = null;

    do {
      const params = new URLSearchParams({
        user: userUri,
        status: "active",
        count: "100",
      });
      if (nextPageToken) params.set("page_token", nextPageToken);

      const eventsData = await calendlyFetch(`/scheduled_events?${params.toString()}`, apiKey);
      const events = eventsData.collection ?? [];
      allEvents.push(...events);
      nextPageToken = eventsData.pagination?.next_page_token ?? null;
    } while (nextPageToken);

    // 4. Fetch existing tours for this venue to detect already-synced URIs
    const { data: existingTours } = await ctx.supabase
      .from("tours")
      .select("id, notes_raw")
      .eq("venue_id", ctx.venueId);

    const syncedUris = new Set<string>();
    for (const tour of existingTours ?? []) {
      const notes = tour.notes_raw;
      if (typeof notes === "string") {
        try {
          const parsed = JSON.parse(notes);
          if (parsed?.calendly_uri) syncedUris.add(parsed.calendly_uri);
        } catch {
          // not JSON, skip
        }
      } else if (notes && typeof notes === "object") {
        const parsed = notes as Record<string, any>;
        if (parsed.calendly_uri) syncedUris.add(parsed.calendly_uri as string);
      }
    }

    let synced = 0;
    let alreadyExisted = 0;
    const errors: string[] = [];

    // 5. Process each event
    for (const event of allEvents) {
      const eventUri = event.uri as string;
      if (!eventUri) continue;

      // Skip if already synced
      if (syncedUris.has(eventUri)) {
        alreadyExisted++;
        continue;
      }

      try {
        // Fetch invitees for this event
        const uuidMatch = eventUri.match(/scheduled_events\/([^/]+)/);
        const eventUuid = uuidMatch?.[1];
        if (!eventUuid) {
          errors.push(`Could not extract UUID from URI: ${eventUri}`);
          continue;
        }

        const inviteesData = await calendlyFetch(`/scheduled_events/${eventUuid}/invitees?count=100`, apiKey);
        const invitees = inviteesData.collection ?? [];
        const firstInvitee = invitees[0];

        const scheduledAt = event.start_time as string | null;
        if (!scheduledAt) {
          errors.push(`Event ${eventUuid} has no start_time, skipping.`);
          continue;
        }

        // Extract tour_type from event_type name
        const tourType = (event.name as string) ?? "tour";

        // Build notes_raw as JSON with calendly_uri
        const notesRaw = JSON.stringify({ calendly_uri: eventUri });

        // Insert into tours table
        const { error: insertError } = await ctx.supabase.from("tours").insert({
          venue_id: ctx.venueId,
          scheduled_at: scheduledAt,
          tour_type: tourType,
          notes_raw: notesRaw,
          completed: false,
          cancelled: false,
          // client_id is nullable — we don't auto-match here
        });

        if (insertError) {
          errors.push(`Failed to insert tour for event ${eventUuid}: ${insertError.message}`);
        } else {
          synced++;
          syncedUris.add(eventUri);
        }
      } catch (err: any) {
        errors.push(`Error processing event ${eventUri}: ${err.message}`);
      }
    }

    return { synced, alreadyExisted, errors };
  }),

  // Upcoming tours for this venue
  getUpcomingTours: venueProcedure.query(async ({ ctx }) => {
    const now = new Date().toISOString();

    const { data, error } = await ctx.supabase
      .from("tours")
      .select("*, clients(id, name, email)")
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
      notesRaw: tour.notes_raw,
      clientId: tour.client_id,
      clientName: tour.clients?.name ?? null,
      clientEmail: tour.clients?.email ?? null,
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
    const totalTours = tours.length;
    const completedTours = tours.filter((t: any) => t.completed).length;
    const cancelledTours = tours.filter((t: any) => t.cancelled).length;

    const conversionRate = completedTours > 0 ? completedTours / totalTours : 0;

    const bookingDays = tours
      .filter((t: any) => t.booking_conversion_days != null)
      .map((t: any) => t.booking_conversion_days as number);
    const avgBookingDays =
      bookingDays.length > 0
        ? Math.round(bookingDays.reduce((a: number, b: number) => a + b, 0) / bookingDays.length)
        : null;

    return {
      totalTours,
      completedTours,
      cancelledTours,
      conversionRate,
      avgBookingDays,
    };
  }),
});
