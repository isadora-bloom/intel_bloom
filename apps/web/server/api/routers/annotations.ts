import { z } from "zod";
import { router, venueProcedure } from "@/lib/trpc/server";
import { TRPCError } from "@trpc/server";

const ANNOTATION_TYPES = [
  "closed",
  "property_event",
  "platform_technical",
  "staffing_change",
  "business_decision",
  "external_event",
  "seasonal_pause",
  "unknown",
  "no_reason",
] as const;

export const annotationsRouter = router({
  // List annotations + system-detected flags awaiting response
  list: venueProcedure
    .input(z.object({
      source: z.enum(["human_proactive", "system_detected", "human_reactive", "all"]).default("all"),
    }).optional())
    .query(async ({ ctx, input }) => {
      let query = ctx.supabase
        .from("annotations")
        .select("*")
        .eq("venue_id", ctx.venueId)
        .order("created_at", { ascending: false });

      if (input?.source && input.source !== "all") {
        query = query.eq("source", input.source);
      }

      const { data, error } = await query;
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return data ?? [];
    }),

  // Respond to a system-detected flag
  respond: venueProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        annotationType: z.enum(ANNOTATION_TYPES),
        categoryDetail: z.string().optional(),
        notes: z.string().optional(),
        excludeFromPatterns: z.boolean().default(false),
        excludeReason: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase
        .from("annotations")
        .update({
          annotation_type: input.annotationType,
          category_detail: input.categoryDetail,
          notes: input.notes,
          exclude_from_patterns: input.excludeFromPatterns,
          exclude_reason: input.excludeReason,
          source: "human_reactive",
        })
        .eq("id", input.id)
        .eq("venue_id", ctx.venueId);

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { success: true };
    }),

  // Create proactive annotation
  create: venueProcedure
    .input(
      z.object({
        periodStart: z.string(),
        periodEnd: z.string(),
        annotationType: z.enum(ANNOTATION_TYPES),
        categoryDetail: z.string().optional(),
        notes: z.string().optional(),
        excludeFromPatterns: z.boolean().default(false),
        excludeReason: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("annotations")
        .insert({
          venue_id: ctx.venueId,
          created_by: ctx.user.id,
          period_start: input.periodStart,
          period_end: input.periodEnd,
          annotation_type: input.annotationType,
          category_detail: input.categoryDetail,
          notes: input.notes,
          exclude_from_patterns: input.excludeFromPatterns,
          exclude_reason: input.excludeReason,
          source: "human_proactive",
        })
        .select()
        .single();

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return data;
    }),

  // Delete annotation
  delete: venueProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase
        .from("annotations")
        .delete()
        .eq("id", input.id)
        .eq("venue_id", ctx.venueId);

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { success: true };
    }),
});
