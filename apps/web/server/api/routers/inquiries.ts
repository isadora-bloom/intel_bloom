import { z } from "zod";
import { router, venueProcedure } from "@/lib/trpc/server";
import { TRPCError } from "@trpc/server";

export const inquiriesRouter = router({
  list: venueProcedure
    .input(
      z.object({
        platform: z.string().optional(),
        matchStatus: z.enum(["unmatched", "auto_matched", "human_confirmed", "human_rejected"]).optional(),
        intentFilter: z.string().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        limit: z.number().int().default(50),
        offset: z.number().int().default(0),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      // Select only columns that exist on the inquiries table per schema 001_schema.sql
      let query = ctx.db
        .from("inquiries")
        .select(
          `id,
           name_extracted,
           email_extracted,
           phone_extracted,
           event_date_extracted,
           received_at,
           platform,
           day_of_week,
           hour_of_day,
           inquiry_intent,
           touchpoint_classification,
           first_contact_channel,
           days_from_signal_to_inquiry,
           prior_signal_id,
           prior_signal_confidence,
           response_time_minutes,
           match_status,
           matched_client_id,
           matched_client:clients(id, name_primary, event_date, status)`,
          { count: "exact" }
        )
        .eq("venue_id", ctx.venueId)
        .order("received_at", { ascending: false })
        .range(input?.offset ?? 0, (input?.offset ?? 0) + (input?.limit ?? 50) - 1);

      if (input?.platform) query = query.eq("platform", input.platform);
      if (input?.matchStatus) query = query.eq("match_status", input.matchStatus);
      if (input?.intentFilter) query = query.eq("inquiry_intent", input.intentFilter);
      if (input?.dateFrom) query = query.gte("received_at", input.dateFrom);
      if (input?.dateTo) query = query.lte("received_at", input.dateTo);

      const { data, error, count } = await query;
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

      return { inquiries: data ?? [], total: count ?? 0 };
    }),

  getById: venueProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.db
        .from("inquiries")
        .select("*")
        .eq("id", input.id)
        .eq("venue_id", ctx.venueId)
        .single();

      if (error) throw new TRPCError({ code: "NOT_FOUND" });
      return data;
    }),

  // Match inquiry to existing client and propagate session data
  matchToClient: venueProcedure
    .input(
      z.object({
        inquiryId: z.string().uuid(),
        clientId: z.string().uuid(),
        confidence: z.number().int().min(0).max(100).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Fetch inquiry first so we can propagate session_data to the client
      const { data: inquiry } = await ctx.db
        .from("inquiries")
        .select("session_data")
        .eq("id", input.inquiryId)
        .eq("venue_id", ctx.venueId)
        .single();

      const { error } = await ctx.db
        .from("inquiries")
        .update({
          matched_client_id: input.clientId,
          match_confidence: input.confidence ?? 100,
          match_status: "human_confirmed",
        })
        .eq("id", input.inquiryId)
        .eq("venue_id", ctx.venueId);

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

      // Propagate session_data to client record only if client has none yet
      if (inquiry?.session_data) {
        const { data: client } = await ctx.db
          .from("clients")
          .select("session_data")
          .eq("id", input.clientId)
          .single();

        if (!client?.session_data) {
          await ctx.db
            .from("clients")
            .update({ session_data: inquiry.session_data })
            .eq("id", input.clientId)
            .eq("venue_id", ctx.venueId);
        }
      }

      return { success: true };
    }),

  // Create new client from an inquiry record
  createClientFromInquiry: venueProcedure
    .input(z.object({ inquiryId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { data: inquiry, error: fetchError } = await ctx.db
        .from("inquiries")
        .select("*")
        .eq("id", input.inquiryId)
        .eq("venue_id", ctx.venueId)
        .single();

      if (fetchError) throw new TRPCError({ code: "NOT_FOUND" });

      // Build client from inquiry fields — only use columns that exist on clients
      const { data: client, error: createError } = await ctx.db
        .from("clients")
        .insert({
          venue_id: ctx.venueId,
          name_primary: inquiry.name_extracted ?? "Unknown",
          email_primary: inquiry.email_extracted,
          phone_primary: inquiry.phone_extracted,
          event_date: inquiry.event_date_extracted,
          guest_count_initial: inquiry.guest_count_extracted,
          first_touch_platform: inquiry.platform,
          first_touch_date: inquiry.received_at,
          inquiry_intent: inquiry.inquiry_intent,
          inquiry_channel: inquiry.first_contact_channel,
          days_from_signal_to_inquiry: inquiry.days_from_signal_to_inquiry,
          // Propagate session_data if present on inquiry
          session_data: inquiry.session_data ?? null,
          status: "inquiry",
          inquired_at: inquiry.received_at ?? new Date().toISOString(),
        })
        .select()
        .single();

      if (createError) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: createError.message });

      // Link inquiry to new client
      await ctx.db
        .from("inquiries")
        .update({
          matched_client_id: client.id,
          match_confidence: 100,
          match_status: "human_confirmed",
        })
        .eq("id", input.inquiryId);

      return client;
    }),

  // Record response time for an inquiry
  markResponded: venueProcedure
    .input(z.object({ inquiryId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { data: inquiry } = await ctx.db
        .from("inquiries")
        .select("received_at")
        .eq("id", input.inquiryId)
        .eq("venue_id", ctx.venueId)
        .single();

      const responseTime = inquiry?.received_at
        ? Math.round((Date.now() - new Date(inquiry.received_at).getTime()) / 60000)
        : null;

      const { error } = await ctx.db
        .from("inquiries")
        .update({
          response_sent_at: new Date().toISOString(),
          response_time_minutes: responseTime,
        })
        .eq("id", input.inquiryId)
        .eq("venue_id", ctx.venueId);

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { success: true };
    }),

  // Unresolved response alerts for this venue
  getAlerts: venueProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.db
      .from("response_alerts")
      .select("*, inquiry:inquiries(name_extracted, email_extracted, received_at)")
      .eq("venue_id", ctx.venueId)
      .eq("resolved", false)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    return data ?? [];
  }),

  resolveAlert: venueProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.db
        .from("response_alerts")
        .update({ resolved: true, resolved_at: new Date().toISOString() })
        .eq("id", input.id)
        .eq("venue_id", ctx.venueId);
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { success: true };
    }),
});
