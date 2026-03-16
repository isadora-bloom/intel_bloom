import { z } from "zod";
import { router, venueProcedure } from "@/lib/trpc/server";
import { TRPCError } from "@trpc/server";

export const matchingRouter = router({
  // List pending matching queue items
  listQueue: venueProcedure
    .input(z.object({
      status: z.enum(["pending", "confirmed", "rejected", "unsure", "all"]).default("pending"),
      limit: z.number().int().default(20),
      offset: z.number().int().default(0),
    }).optional())
    .query(async ({ ctx, input }) => {
      let query = ctx.supabase
        .from("matching_queue")
        .select("*", { count: "exact" })
        .eq("venue_id", ctx.venueId)
        .order("match_score", { ascending: false })
        .range(input?.offset ?? 0, (input?.offset ?? 0) + (input?.limit ?? 20) - 1);

      const status = input?.status ?? "pending";
      if (status !== "all") {
        query = query.eq("status", status);
      }

      const { data, error, count } = await query;
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

      // Fetch both records for each queue item
      const enriched = await Promise.all(
        (data ?? []).map(async (item) => {
          const [recordA, recordB] = await Promise.all([
            fetchRecord(ctx.supabase, item.record_a_type, item.record_a_id, ctx.venueId),
            fetchRecord(ctx.supabase, item.record_b_type, item.record_b_id, ctx.venueId),
          ]);
          return { ...item, recordA, recordB };
        })
      );

      return { items: enriched, total: count ?? 0 };
    }),

  // Confirm a match
  confirm: venueProcedure
    .input(z.object({ queueItemId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { data: item, error: fetchErr } = await ctx.supabase
        .from("matching_queue")
        .select("*")
        .eq("id", input.queueItemId)
        .eq("venue_id", ctx.venueId)
        .single();

      if (fetchErr) throw new TRPCError({ code: "NOT_FOUND" });

      // Apply the match
      if (item.record_a_type === "inquiry" && item.record_b_type === "client") {
        await ctx.supabase
          .from("inquiries")
          .update({
            matched_client_id: item.record_b_id,
            match_confidence: item.match_score,
            match_status: "human_confirmed",
          })
          .eq("id", item.record_a_id)
          .eq("venue_id", ctx.venueId);
      }

      // Update queue status
      const { error } = await ctx.supabase
        .from("matching_queue")
        .update({
          status: "confirmed",
          reviewed_by: ctx.user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", input.queueItemId);

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { success: true };
    }),

  // Reject a match
  reject: venueProcedure
    .input(z.object({ queueItemId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase
        .from("matching_queue")
        .update({
          status: "rejected",
          reviewed_by: ctx.user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", input.queueItemId)
        .eq("venue_id", ctx.venueId);

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { success: true };
    }),

  // Mark as unsure
  flagUnsure: venueProcedure
    .input(z.object({ queueItemId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase
        .from("matching_queue")
        .update({
          status: "unsure",
          reviewed_by: ctx.user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", input.queueItemId)
        .eq("venue_id", ctx.venueId);

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { success: true };
    }),
});

async function fetchRecord(
  supabase: any,
  type: string,
  id: string,
  venueId: string
) {
  const table = type === "inquiry" ? "inquiries" : "clients";
  const { data } = await (supabase as any)
    .from(table)
    .select("*")
    .eq("id", id)
    .eq("venue_id", venueId)
    .single();
  return data;
}
