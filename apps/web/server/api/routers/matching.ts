import { z } from "zod";
import { router, venueProcedure } from "@/lib/trpc/server";
import { TRPCError } from "@trpc/server";
import { runMatchingPass } from "@bloom/matching/engine";

export const matchingRouter = router({
  // List pending matching queue items
  listQueue: venueProcedure
    .input(z.object({
      status: z.enum(["pending", "confirmed", "rejected", "unsure", "all"]).default("pending"),
      limit: z.number().int().default(20),
      offset: z.number().int().default(0),
    }).optional())
    .query(async ({ ctx, input }) => {
      // Order by `confidence` — the actual column name in matching_queue schema
      let query = ctx.db
        .from("matching_queue")
        .select("*", { count: "exact" })
        .eq("venue_id", ctx.venueId)
        .order("confidence", { ascending: false })
        .range(input?.offset ?? 0, (input?.offset ?? 0) + (input?.limit ?? 20) - 1);

      const status = input?.status ?? "pending";
      if (status !== "all") {
        query = query.eq("status", status);
      }

      const { data, error, count } = await query;
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

      // Fetch both records for each queue item so the UI can render them
      const enriched = await Promise.all(
        (data ?? []).map(async (item) => {
          const [recordA, recordB] = await Promise.all([
            fetchRecord(ctx.db, item.record_a_type, item.record_a_id, ctx.venueId),
            fetchRecord(ctx.db, item.record_b_type, item.record_b_id, ctx.venueId),
          ]);
          return { ...item, recordA, recordB };
        })
      );

      return { items: enriched, total: count ?? 0 };
    }),

  // Confirm a match — links inquiry→client, marks queue item resolved
  confirm: venueProcedure
    .input(z.object({ queueItemId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { data: item, error: fetchErr } = await ctx.db
        .from("matching_queue")
        .select("*")
        .eq("id", input.queueItemId)
        .eq("venue_id", ctx.venueId)
        .single();

      if (fetchErr) throw new TRPCError({ code: "NOT_FOUND" });

      // Apply the match — support inquiry→client direction
      if (item.record_a_type === "inquiry" && item.record_b_type === "client") {
        await ctx.db
          .from("inquiries")
          .update({
            matched_client_id: item.record_b_id,
            match_confidence: item.confidence,   // correct column: confidence
            match_status: "human_confirmed",
          })
          .eq("id", item.record_a_id)
          .eq("venue_id", ctx.venueId);
      }

      // Mark queue item resolved — use resolved_by / resolved_at (schema columns)
      const { error } = await ctx.db
        .from("matching_queue")
        .update({
          status: "confirmed",
          resolved_by: ctx.user.id,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", input.queueItemId);

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { success: true };
    }),

  // Reject a match
  reject: venueProcedure
    .input(z.object({ queueItemId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.db
        .from("matching_queue")
        .update({
          status: "rejected",
          resolved_by: ctx.user.id,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", input.queueItemId)
        .eq("venue_id", ctx.venueId);

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { success: true };
    }),

  // Mark as unsure (defer for later review)
  flagUnsure: venueProcedure
    .input(z.object({ queueItemId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.db
        .from("matching_queue")
        .update({
          status: "unsure",
          resolved_by: ctx.user.id,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", input.queueItemId)
        .eq("venue_id", ctx.venueId);

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { success: true };
    }),

  // Count of pending items (for sidebar badge)
  pendingCount: venueProcedure.query(async ({ ctx }) => {
    const { count } = await ctx.db
      .from("matching_queue")
      .select("id", { count: "exact", head: true })
      .eq("venue_id", ctx.venueId)
      .eq("status", "pending");
    return { count: count ?? 0 };
  }),

  // Run a full matching pass: auto-match at confidence ≥90, queue 60-89 for review
  runPass: venueProcedure.mutation(async ({ ctx }) => {
    const { autoMatched, queued } = await runMatchingPass(ctx.venueId);
    return { autoMatched, queued };
  }),

  // Scan venue data for likely client duplicates and queue them for review
  scanDuplicates: venueProcedure.mutation(async ({ ctx }) => {
    const { data: clients } = await ctx.db
      .from("clients")
      .select("id, name_primary, email_primary, event_date, status")
      .eq("venue_id", ctx.venueId);

    // Fetch already-queued pairs so we don't re-queue the same pair
    const { data: existing } = await ctx.db
      .from("matching_queue")
      .select("record_a_id, record_b_id")
      .eq("venue_id", ctx.venueId)
      .neq("status", "rejected");

    const alreadyQueued = new Set<string>(
      (existing ?? []).map((e) => [e.record_a_id, e.record_b_id].sort().join(":"))
    );

    const toInsert: {
      venue_id: string;
      record_a_type: string;
      record_a_id: string;
      record_b_type: string;
      record_b_id: string;
      confidence: number;          // schema column is `confidence`, not `match_score`
      signals_matched: string[];   // stored as JSONB
      signals_unmatched: string[];
      status: string;
    }[] = [];

    // CLIENT DEDUPLICATION — compare all pairs
    const clientList = clients ?? [];
    for (let i = 0; i < clientList.length; i++) {
      for (let j = i + 1; j < clientList.length; j++) {
        const a = clientList[i];
        const b = clientList[j];

        const pairKey = [a.id, b.id].sort().join(":");
        if (alreadyQueued.has(pairKey)) continue;

        let score = 0;
        const signals: string[] = [];

        // Exact email match — very strong signal
        if (
          a.email_primary && b.email_primary &&
          a.email_primary.toLowerCase().trim() === b.email_primary.toLowerCase().trim()
        ) {
          score += 85;
          signals.push("same email");
        }

        // Same event date
        if (a.event_date && b.event_date && a.event_date === b.event_date) {
          score += 45;
          signals.push("same event date");
        }

        // Same first name (at least 3 chars)
        if (a.name_primary && b.name_primary) {
          const aFirst = a.name_primary.trim().split(/\s+/)[0].toLowerCase();
          const bFirst = b.name_primary.trim().split(/\s+/)[0].toLowerCase();
          if (aFirst.length >= 3 && aFirst === bFirst) {
            score += 25;
            signals.push("same first name");
          }
        }

        if (score >= 60) {
          toInsert.push({
            venue_id: ctx.venueId,
            record_a_type: "client",
            record_a_id: a.id,
            record_b_type: "client",
            record_b_id: b.id,
            confidence: score,       // correct column name
            signals_matched: signals,
            signals_unmatched: [],
            status: "pending",
          });
          alreadyQueued.add(pairKey);
        }
      }
    }

    if (toInsert.length > 0) {
      await ctx.db.from("matching_queue").insert(toInsert);
    }

    return { found: toInsert.length };
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
