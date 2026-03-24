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
      let query = ctx.supabase
        .from("inquiries")
        .select(
          "id, name_extracted, email_extracted, phone_extracted, event_date_extracted, received_at, platform, day_of_week, self_reported_source, session_source_url, resolved_source, resolved_source_confidence, response_time_minutes, match_status, matched_client_id, inquiry_intent, touchpoint_classification, prior_signal_status, days_from_signal_to_inquiry, matched_client:clients(id, name_primary, event_date, status)",
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
      const { data, error } = await ctx.supabase
        .from("inquiries")
        .select("*")
        .eq("id", input.id)
        .eq("venue_id", ctx.venueId)
        .single();

      if (error) throw new TRPCError({ code: "NOT_FOUND" });
      return data;
    }),

  // Match inquiry to existing client
  matchToClient: venueProcedure
    .input(
      z.object({
        inquiryId: z.string().uuid(),
        clientId: z.string().uuid(),
        confidence: z.number().int().min(0).max(100).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Fetch inquiry first so we can propagate session data to the client
      const { data: inquiry } = await ctx.supabase
        .from("inquiries")
        .select("session_data, session_source_url, self_reported_source, resolved_source, resolved_source_confidence")
        .eq("id", input.inquiryId)
        .eq("venue_id", ctx.venueId)
        .single();

      const { error } = await ctx.supabase
        .from("inquiries")
        .update({
          matched_client_id: input.clientId,
          match_confidence: input.confidence ?? 100,
          match_status: "human_confirmed",
        })
        .eq("id", input.inquiryId)
        .eq("venue_id", ctx.venueId);

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

      // Propagate session data to client record (only fill gaps — don't overwrite)
      if (inquiry) {
        const { data: client } = await ctx.supabase
          .from("clients")
          .select("session_data, session_source_url, self_reported_source, resolved_source")
          .eq("id", input.clientId)
          .single();

        const sessionUpdates: Record<string, unknown> = {};
        if (!client?.session_data && inquiry.session_data)
          sessionUpdates.session_data = inquiry.session_data;
        if (!client?.session_source_url && inquiry.session_source_url)
          sessionUpdates.session_source_url = inquiry.session_source_url;
        if (!client?.self_reported_source && inquiry.self_reported_source)
          sessionUpdates.self_reported_source = inquiry.self_reported_source;
        if (!client?.resolved_source && inquiry.resolved_source) {
          sessionUpdates.resolved_source = inquiry.resolved_source;
          sessionUpdates.resolved_source_confidence = inquiry.resolved_source_confidence;
        }

        if (Object.keys(sessionUpdates).length > 0) {
          await ctx.supabase
            .from("clients")
            .update(sessionUpdates)
            .eq("id", input.clientId)
            .eq("venue_id", ctx.venueId);
        }
      }

      return { success: true };
    }),

  // Create new client from inquiry
  createClientFromInquiry: venueProcedure
    .input(z.object({ inquiryId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { data: inquiry, error: fetchError } = await ctx.supabase
        .from("inquiries")
        .select("*")
        .eq("id", input.inquiryId)
        .eq("venue_id", ctx.venueId)
        .single();

      if (fetchError) throw new TRPCError({ code: "NOT_FOUND" });

      // Create client from inquiry data — include session data if present
      const { data: client, error: createError } = await ctx.supabase
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
          status: "inquiry",
          // Propagate session signals from inquiry
          self_reported_source: inquiry.self_reported_source ?? null,
          session_source_url: inquiry.session_source_url ?? null,
          session_data: inquiry.session_data ?? null,
          resolved_source: inquiry.resolved_source ?? null,
          resolved_source_confidence: inquiry.resolved_source_confidence ?? null,
        })
        .select()
        .single();

      if (createError) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: createError.message });

      // Link inquiry to client
      await ctx.supabase
        .from("inquiries")
        .update({
          matched_client_id: client.id,
          match_confidence: 100,
          match_status: "human_confirmed",
        })
        .eq("id", input.inquiryId);

      return client;
    }),

  // Record response time
  markResponded: venueProcedure
    .input(z.object({ inquiryId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { data: inquiry } = await ctx.supabase
        .from("inquiries")
        .select("received_at")
        .eq("id", input.inquiryId)
        .eq("venue_id", ctx.venueId)
        .single();

      const responseTime = inquiry?.received_at
        ? Math.round((Date.now() - new Date(inquiry.received_at).getTime()) / 60000)
        : null;

      const { error } = await ctx.supabase
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
});
