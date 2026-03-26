import { z } from "zod";
import { router, venueProcedure } from "@/lib/trpc/server";
import { TRPCError } from "@trpc/server";

// Matches the `status` column CHECK / trigger logic in 003_functions.sql
const CLIENT_STATUS = [
  "inquiry",
  "tour_booked",
  "toured",
  "held",
  "contracted",
  "event_complete",
  "archived",
  "lost",
] as const;

export const clientsRouter = router({
  // List clients with filters
  list: venueProcedure
    .input(
      z.object({
        status: z.enum(CLIENT_STATUS).optional(),
        search: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
        orderBy: z.enum(["created_at", "event_date", "name_primary"]).default("created_at"),
        orderDir: z.enum(["asc", "desc"]).default("desc"),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      let query = ctx.db
        .from("clients")
        .select("*", { count: "exact" })
        .eq("venue_id", ctx.venueId)
        .order(input?.orderBy ?? "created_at", { ascending: (input?.orderDir ?? "desc") === "asc" })
        .range(input?.offset ?? 0, (input?.offset ?? 0) + (input?.limit ?? 50) - 1);

      if (input?.status) {
        query = query.eq("status", input.status);
      }

      if (input?.search) {
        query = query.or(
          `name_primary.ilike.%${input.search}%,email_primary.ilike.%${input.search}%,name_partner.ilike.%${input.search}%`
        );
      }

      const { data, error, count } = await query;
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

      return { clients: data ?? [], total: count ?? 0 };
    }),

  // Get single client with all related records (five-layer profile)
  getById: venueProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data: client, error } = await ctx.db
        .from("clients")
        .select("*")
        .eq("id", input.id)
        .eq("venue_id", ctx.venueId)
        .single();

      if (error) throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });

      // Audit log — fire-and-forget
      ctx.logAccess("client", input.id, "view");

      // Layer 2: acquisition — source touchpoints
      const { data: touchpoints } = await ctx.db
        .from("client_source_touchpoints")
        .select("*")
        .eq("client_id", input.id)
        .order("touchpoint_date", { ascending: true });

      // Layer 3: planning events timeline
      const { data: planningEvents } = await ctx.db
        .from("planning_events")
        .select("*")
        .eq("client_id", input.id)
        .order("event_date", { ascending: true });

      // Layer 4: vendors
      const { data: clientVendors } = await ctx.db
        .from("client_vendors")
        .select("*, vendor:vendors(*)")
        .eq("client_id", input.id);

      // Uploads
      const { data: uploads } = await ctx.db
        .from("uploads")
        .select("*")
        .eq("client_id", input.id)
        .order("created_at", { ascending: false });

      // Referrals (given and received)
      const [{ data: referralsGiven }, { data: referralsReceived }] = await Promise.all([
        ctx.db
          .from("referrals")
          .select("id, referred_client_id, source, converted, referral_noted_at, notes")
          .eq("referring_client_id", input.id),
        ctx.db
          .from("referrals")
          .select("id, referring_client_id, source, converted, referral_noted_at, notes")
          .eq("referred_client_id", input.id),
      ]);

      // Weather forecast for event date (if upcoming)
      let weatherForecast = null;
      if (client.event_date) {
        const { data: forecast } = await ctx.db
          .from("weather_forecasts")
          .select("forecast_date, forecast_data, fetched_at")
          .eq("venue_id", ctx.venueId)
          .eq("forecast_date", client.event_date)
          .order("fetched_at", { ascending: false })
          .limit(1)
          .single();
        weatherForecast = forecast;
      }

      return {
        client,
        touchpoints: touchpoints ?? [],
        planningEvents: planningEvents ?? [],
        vendors: clientVendors?.map((cv) => cv.vendor) ?? [],
        uploads: uploads ?? [],
        referralsGiven: referralsGiven ?? [],
        referralsReceived: referralsReceived ?? [],
        weatherForecast,
      };
    }),

  // Create client
  create: venueProcedure
    .input(
      z.object({
        namePrimary: z.string().min(1),
        namePartner: z.string().optional(),
        emailPrimary: z.string().email().optional(),
        emailPartner: z.string().email().optional(),
        phonePrimary: z.string().optional(),
        phonePartner: z.string().optional(),
        eventDate: z.string().optional(),
        package: z.string().optional(),
        guestCountInitial: z.number().int().optional(),
        revenueCents: z.number().int().optional(),
        status: z.enum(CLIENT_STATUS).default("inquiry"),
        selfReportedSource: z.string().optional(),
        firstTouchPlatform: z.string().optional(),
        inquiryChannel: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.db
        .from("clients")
        .insert({
          venue_id: ctx.venueId,
          name_primary: input.namePrimary,
          name_partner: input.namePartner,
          email_primary: input.emailPrimary,
          email_partner: input.emailPartner,
          phone_primary: input.phonePrimary,
          phone_partner: input.phonePartner,
          event_date: input.eventDate,
          package: input.package,
          guest_count_initial: input.guestCountInitial,
          revenue_cents: input.revenueCents,
          status: input.status,
          self_reported_source: input.selfReportedSource,
          first_touch_platform: input.firstTouchPlatform,
          first_touch_date: new Date().toISOString(),
          inquiry_channel: input.inquiryChannel,
          inquired_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return data;
    }),

  // Upsert client from CSV import — deduplicates by email, then event_date, then name
  upsertFromImport: venueProcedure
    .input(
      z.object({
        namePrimary: z.string().min(1),
        namePartner: z.string().optional(),
        emailPrimary: z.string().optional(),
        emailPartner: z.string().optional(),
        phonePrimary: z.string().optional(),
        eventDate: z.string().optional(),
        package: z.string().optional(),
        guestCountInitial: z.number().int().optional(),
        revenueCents: z.number().int().optional(),
        status: z.enum(CLIENT_STATUS).default("inquiry"),
        selfReportedSource: z.string().optional(),
        // inquired_at is the correct column name for the inquiry timestamp
        inquiredAt: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Dedup: try email first, then event_date, then name
      let existingId: string | null = null;

      if (input.emailPrimary) {
        const { data: byEmail } = await ctx.db
          .from("clients")
          .select("id")
          .eq("venue_id", ctx.venueId)
          .eq("email_primary", input.emailPrimary)
          .limit(1)
          .single();
        existingId = byEmail?.id ?? null;
      }

      if (!existingId && input.eventDate) {
        const { data: byDate } = await ctx.db
          .from("clients")
          .select("id")
          .eq("venue_id", ctx.venueId)
          .eq("event_date", input.eventDate)
          .limit(1)
          .single();
        existingId = byDate?.id ?? null;
      }

      if (!existingId) {
        const { data: byName } = await ctx.db
          .from("clients")
          .select("id")
          .eq("venue_id", ctx.venueId)
          .eq("name_primary", input.namePrimary)
          .limit(1)
          .single();
        existingId = byName?.id ?? null;
      }

      const payload = {
        venue_id: ctx.venueId,
        name_primary: input.namePrimary,
        name_partner: input.namePartner,
        email_primary: input.emailPrimary,
        email_partner: input.emailPartner,
        phone_primary: input.phonePrimary,
        event_date: input.eventDate,
        package: input.package,
        guest_count_initial: input.guestCountInitial,
        revenue_cents: input.revenueCents,
        status: input.status,
        self_reported_source: input.selfReportedSource,
        inquired_at: input.inquiredAt ?? null,
      };

      if (existingId) {
        await ctx.db.from("clients").update(payload).eq("id", existingId);
        return { action: "updated" as const };
      } else {
        await ctx.db.from("clients").insert(payload);
        return { action: "created" as const };
      }
    }),

  // Update client — only maps fields that actually exist in the schema
  update: venueProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        namePrimary: z.string().optional(),
        namePartner: z.string().optional(),
        emailPrimary: z.string().email().optional(),
        emailPartner: z.string().email().optional(),
        phonePrimary: z.string().optional(),
        phonePartner: z.string().optional(),
        eventDate: z.string().optional(),
        eventDateConfirmed: z.boolean().optional(),
        package: z.string().optional(),
        guestCountInitial: z.number().int().optional(),
        guestCountFinal: z.number().int().optional(),
        revenueCents: z.number().int().optional(),
        status: z.enum(CLIENT_STATUS).optional(),
        inquiryChannel: z.string().optional(),
        inquiryIntent: z.string().optional(),
        selfReportedSource: z.string().optional(),
        resolvedSource: z.string().optional(),
        resolvedSourceConfidence: z.number().int().min(0).max(100).optional(),
        acquisitionCostCents: z.number().int().optional(),
        competingVenues: z.array(z.string()).optional(),
        complexityScore: z.number().int().min(0).max(100).optional(),
        dayOfComplexity: z.number().int().min(1).max(5).optional(),
        staffingHoursActual: z.number().int().optional(),
        assignedCoordinator: z.string().optional(),
        // review_submitted (boolean) is the correct column — not review_left
        reviewSubmitted: z.boolean().optional(),
        reviewPlatform: z.string().optional(),
        reviewStarRating: z.number().min(1).max(5).optional(),
        reviewText: z.string().optional(),
        referralsGenerated: z.number().int().optional(),
        stressFlags: z.record(z.unknown()).nullable().optional(),
        familyDynamicsFlags: z.record(z.unknown()).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input;
      const updateData: Record<string, unknown> = {};

      // Map camelCase to snake_case — only columns that exist in the schema
      const fieldMap: Record<string, string> = {
        namePrimary: "name_primary",
        namePartner: "name_partner",
        emailPrimary: "email_primary",
        emailPartner: "email_partner",
        phonePrimary: "phone_primary",
        phonePartner: "phone_partner",
        eventDate: "event_date",
        eventDateConfirmed: "event_date_confirmed",
        package: "package",
        guestCountInitial: "guest_count_initial",
        guestCountFinal: "guest_count_final",
        revenueCents: "revenue_cents",
        status: "status",
        inquiryChannel: "inquiry_channel",
        inquiryIntent: "inquiry_intent",
        selfReportedSource: "self_reported_source",
        resolvedSource: "resolved_source",
        resolvedSourceConfidence: "resolved_source_confidence",
        acquisitionCostCents: "acquisition_cost_cents",
        competingVenues: "competing_venues",
        complexityScore: "complexity_score",
        dayOfComplexity: "day_of_complexity",
        staffingHoursActual: "staffing_hours_actual",
        assignedCoordinator: "assigned_coordinator",
        reviewSubmitted: "review_submitted",
        reviewPlatform: "review_platform",
        reviewStarRating: "review_star_rating",
        reviewText: "review_text",
        referralsGenerated: "referrals_generated",
        stressFlags: "stress_flags",
        familyDynamicsFlags: "family_dynamics_flags",
      };

      for (const [key, value] of Object.entries(rest)) {
        if (value !== undefined && fieldMap[key]) {
          updateData[fieldMap[key]] = value;
        }
      }

      const { data, error } = await ctx.db
        .from("clients")
        .update(updateData)
        .eq("id", id)
        .eq("venue_id", ctx.venueId)
        .select()
        .single();

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return data;
    }),

  // Back-fill resolved_source on clients that have no attribution yet,
  // by matching their email address against email_messages already in the DB.
  // Run this after a CSV import or manually from Settings.
  backfillSourceAttribution: venueProcedure
    .mutation(async ({ ctx }) => {
      const { data: clients } = await ctx.db
        .from("clients")
        .select("id, email_primary, email_partner, self_reported_source")
        .eq("venue_id", ctx.venueId)
        .is("resolved_source", null)
        .not("email_primary", "is", null);

      if (!clients || clients.length === 0) return { updated: 0, total: 0 };

      let updated = 0;

      for (const client of clients) {
        const emails = [client.email_primary, client.email_partner].filter(Boolean) as string[];
        if (emails.length === 0) continue;

        // Look up email_threads that can be tied to this client by from_address
        const emailFilter = emails.map((e) => `from_address.ilike.${e}`).join(",");

        const { data: messages } = await ctx.db
          .from("email_messages")
          .select("id, extracted_signals, thread_id")
          .eq("venue_id", ctx.venueId)
          .or(emailFilter)
          .not("extracted_signals", "is", null)
          .limit(5);

        if (!messages || messages.length === 0) continue;

        // Pull the first message that has a self_reported_source signal
        const best = messages.find(
          (m) => (m.extracted_signals as Record<string, unknown>)?.self_reported_source
        );
        if (!best) continue;

        const signals = best.extracted_signals as Record<string, unknown>;
        const extractedSource = signals.self_reported_source as string;

        await ctx.db
          .from("clients")
          .update({
            self_reported_source: client.self_reported_source ?? extractedSource,
            resolved_source: extractedSource,
            resolved_source_confidence: 72,
          })
          .eq("id", client.id);

        updated++;
      }

      return { updated, total: clients.length };
    }),

  // Archive (mark lost) + write reason to lost_deals
  archiveWithReason: venueProcedure
    .input(z.object({
      id:             z.string().uuid(),
      reasonCategory: z.string().nullable(),
      reasonDetail:   z.string().optional(),
      lostAtStage:    z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Get current client status for lost_at_stage fallback
      const { data: client } = await ctx.db
        .from("clients")
        .select("status")
        .eq("id", input.id)
        .eq("venue_id", ctx.venueId)
        .single();

      await Promise.all([
        ctx.db
          .from("clients")
          .update({ status: "lost" })
          .eq("id", input.id)
          .eq("venue_id", ctx.venueId),
        ctx.db
          .from("lost_deals")
          .insert({
            venue_id:          ctx.venueId,
            client_id:         input.id,
            lost_at_stage:     input.lostAtStage ?? (client?.status as string) ?? "unknown",
            reason_category:   input.reasonCategory,
            reason_detail:     input.reasonDetail || null,
          }),
      ]);

      return { success: true };
    }),
});
