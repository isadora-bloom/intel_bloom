import { z } from "zod";
import { router, venueProcedure } from "@/lib/trpc/server";
import { TRPCError } from "@trpc/server";

const CLIENT_STATUS = [
  "inquiry",
  "tour_booked",
  "booked",
  "planning",
  "event_complete",
  "archived",
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
      let query = ctx.supabase
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

  // Get single client (full five-layer record)
  getById: venueProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data: client, error } = await ctx.supabase
        .from("clients")
        .select("*")
        .eq("id", input.id)
        .eq("venue_id", ctx.venueId)
        .single();

      if (error) throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });

      // Layer 2: acquisition — source touchpoints
      const { data: touchpoints } = await ctx.supabase
        .from("client_source_touchpoints")
        .select("*")
        .eq("client_id", input.id)
        .order("touchpoint_date", { ascending: true });

      // Layer 3: planning events timeline
      const { data: planningEvents } = await ctx.supabase
        .from("planning_events")
        .select("*")
        .eq("client_id", input.id)
        .order("event_date", { ascending: true });

      // Layer 4: vendors
      const { data: clientVendors } = await ctx.supabase
        .from("client_vendors")
        .select("*, vendor:vendors(*)")
        .eq("client_id", input.id);

      // Uploads
      const { data: uploads } = await ctx.supabase
        .from("uploads")
        .select("*")
        .eq("client_id", input.id)
        .order("created_at", { ascending: false });

      return {
        client,
        touchpoints: touchpoints ?? [],
        planningEvents: planningEvents ?? [],
        vendors: clientVendors?.map((cv) => cv.vendor) ?? [],
        uploads: uploads ?? [],
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
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
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
        })
        .select()
        .single();

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return data;
    }),

  // Upsert client from import — deduplicates by email, then name
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
        inquiryDate: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Dedup: try email first, then event_date, then name
      let existingId: string | null = null;

      if (input.emailPrimary) {
        const { data: byEmail } = await ctx.supabase
          .from("clients")
          .select("id")
          .eq("venue_id", ctx.venueId)
          .eq("email_primary", input.emailPrimary)
          .limit(1)
          .single();
        existingId = byEmail?.id ?? null;
      }

      if (!existingId && input.eventDate) {
        const { data: byDate } = await ctx.supabase
          .from("clients")
          .select("id")
          .eq("venue_id", ctx.venueId)
          .eq("event_date", input.eventDate)
          .limit(1)
          .single();
        existingId = byDate?.id ?? null;
      }

      if (!existingId) {
        const { data: byName } = await ctx.supabase
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
        inquiry_date: input.inquiryDate ?? null,
      };

      if (existingId) {
        await ctx.supabase.from("clients").update(payload).eq("id", existingId);
        return { action: "updated" as const };
      } else {
        await ctx.supabase.from("clients").insert(payload);
        return { action: "created" as const };
      }
    }),

  // Update client
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
        resolvedSource: z.string().optional(),
        resolvedSourceConfidence: z.number().int().min(0).max(100).optional(),
        complexityScore: z.number().int().min(0).max(100).optional(),
        dayOfComplexity: z.number().int().min(1).max(5).optional(),
        staffingHoursActual: z.number().int().optional(),
        reviewLeft: z.boolean().optional(),
        reviewPlatform: z.string().optional(),
        reviewStarRating: z.number().min(1).max(5).optional(),
        reviewText: z.string().optional(),
        referralsGenerated: z.number().int().optional(),
        holdExpiresAt: z.string().datetime().nullable().optional(),
        lostReason: z.enum([
          "too_expensive", "date_taken", "chose_competitor", "no_response",
          "not_right_fit", "budget_cut", "postponed", "unknown", "other",
        ]).nullable().optional(),
        lostReasonNote: z.string().max(500).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input;
      const updateData: Record<string, unknown> = {};

      // Map camelCase to snake_case
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
        resolvedSource: "resolved_source",
        resolvedSourceConfidence: "resolved_source_confidence",
        complexityScore: "complexity_score",
        dayOfComplexity: "day_of_complexity",
        staffingHoursActual: "staffing_hours_actual",
        reviewLeft: "review_left",
        reviewPlatform: "review_platform",
        reviewStarRating: "review_star_rating",
        reviewText: "review_text",
        referralsGenerated: "referrals_generated",
        holdExpiresAt: "hold_expires_at",
        lostReason: "lost_reason",
        lostReasonNote: "lost_reason_note",
      };

      for (const [key, value] of Object.entries(rest)) {
        if (value !== undefined && fieldMap[key]) {
          updateData[fieldMap[key]] = value;
        }
      }

      const { data, error } = await ctx.supabase
        .from("clients")
        .update(updateData)
        .eq("id", id)
        .eq("venue_id", ctx.venueId)
        .select()
        .single();

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return data;
    }),

  // Update social reach — tracks social following / post reach for a past couple.
  // Useful for identifying "ambassador" clients whose wedding posts drove significant
  // organic awareness. Set manually by the coordinator after checking.
  //
  // social_reach shape (all optional):
  //   { instagram_followers, instagram_post_url, reach_estimate, notes }
  updateSocialReach: venueProcedure
    .input(
      z.object({
        clientId: z.string().uuid(),
        socialReach: z.object({
          instagram_followers: z.number().int().optional(),
          instagram_post_url:  z.string().url().optional(),
          reach_estimate:      z.number().int().optional(),
          notes:               z.string().max(500).optional(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase
        .from("clients")
        .update({ social_reach: input.socialReach })
        .eq("id", input.clientId)
        .eq("venue_id", ctx.venueId);

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { success: true };
    }),
});
