import { z } from "zod";
import { router, venueProcedure } from "@/lib/trpc/server";
import { TRPCError } from "@trpc/server";

export const anomaliesRouter = router({
  // Recent anomaly detections for the dashboard
  getRecent: venueProcedure
    .input(z.object({ limit: z.number().int().default(10) }).optional())
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 10;

      const { data, error } = await ctx.db
        .from("anomaly_detections")
        .select("*")
        .eq("venue_id", ctx.venueId)
        .in("status", ["new", "acknowledged"])
        .order("detected_at", { ascending: false })
        .limit(limit);

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return data ?? [];
    }),

  // Count of unacknowledged anomalies (for badge)
  unacknowledgedCount: venueProcedure.query(async ({ ctx }) => {
    const { count, error } = await ctx.db
      .from("anomaly_detections")
      .select("id", { count: "exact", head: true })
      .eq("venue_id", ctx.venueId)
      .eq("status", "new");

    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    return count ?? 0;
  }),

  // Acknowledge an anomaly (marks it as seen)
  acknowledge: venueProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.db
        .from("anomaly_detections")
        .update({
          status: "acknowledged",
          acknowledged_by: ctx.user.id,
          acknowledged_at: new Date().toISOString(),
        })
        .eq("id", input.id)
        .eq("venue_id", ctx.venueId);

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { success: true };
    }),

  // Dismiss an anomaly
  dismiss: venueProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.db
        .from("anomaly_detections")
        .update({ status: "dismissed" })
        .eq("id", input.id)
        .eq("venue_id", ctx.venueId);

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { success: true };
    }),

  // Annotate — user explains why the anomaly happened, creates an annotation linked to it
  annotate: venueProcedure
    .input(z.object({
      anomalyId: z.string().uuid(),
      note: z.string().min(1),
      category: z.string().optional(),
      periodStart: z.string().optional(),
      periodEnd: z.string().optional(),
      excludeFromPatterns: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      // Get the anomaly to link
      const { data: anomaly, error: fetchErr } = await ctx.db
        .from("anomaly_detections")
        .select("metric, period_current")
        .eq("id", input.anomalyId)
        .eq("venue_id", ctx.venueId)
        .single();

      if (fetchErr || !anomaly) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Anomaly not found" });
      }

      // Parse period from anomaly
      const [pStart, pEnd] = (anomaly.period_current ?? "").split(" to ");

      // Create the annotation
      const { data: annotation, error: insertErr } = await ctx.db
        .from("annotations")
        .insert({
          venue_id: ctx.venueId,
          annotation_type: "anomaly_response",
          category: input.category ?? "other",
          note: input.note,
          period_start: input.periodStart ?? pStart,
          period_end: input.periodEnd ?? pEnd,
          exclude_from_patterns: input.excludeFromPatterns,
          affects_metrics: [anomaly.metric],
          anomaly_id: input.anomalyId,
          created_by: ctx.user.id,
          created_by_role: "venue_owner", // TODO: pull from venue_users
        })
        .select("id")
        .single();

      if (insertErr) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: insertErr.message });

      // Update anomaly status to annotated
      await ctx.db
        .from("anomaly_detections")
        .update({
          status: "annotated",
          annotation_id: annotation?.id,
          acknowledged_by: ctx.user.id,
          acknowledged_at: new Date().toISOString(),
        })
        .eq("id", input.anomalyId);

      return { success: true, annotationId: annotation?.id };
    }),

  // Full history (for a dedicated anomaly log page)
  list: venueProcedure
    .input(z.object({
      status: z.enum(["new", "acknowledged", "annotated", "dismissed", "resolved"]).optional(),
      severity: z.enum(["info", "warning", "critical"]).optional(),
      limit: z.number().int().default(50),
      offset: z.number().int().default(0),
    }).optional())
    .query(async ({ ctx, input }) => {
      let query = ctx.db
        .from("anomaly_detections")
        .select("*")
        .eq("venue_id", ctx.venueId)
        .order("detected_at", { ascending: false })
        .range(input?.offset ?? 0, (input?.offset ?? 0) + (input?.limit ?? 50) - 1);

      if (input?.status) query = query.eq("status", input.status);
      if (input?.severity) query = query.eq("severity", input.severity);

      const { data, error } = await query;
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return data ?? [];
    }),
});
