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

  // Count of pending items (for sidebar badge)
  pendingCount: venueProcedure.query(async ({ ctx }) => {
    const { count } = await ctx.supabase
      .from("matching_queue")
      .select("id", { count: "exact", head: true })
      .eq("venue_id", ctx.venueId)
      .eq("status", "pending");
    return { count: count ?? 0 };
  }),

  // Run a full matching pass for this venue: auto-match at 90+, queue 60-89 for review
  runPass: venueProcedure.mutation(async ({ ctx }) => {
    const { autoMatched, queued } = await runMatchingPass(ctx.venueId);
    return { autoMatched, queued };
  }),

  // Scan the whole venue's data for likely duplicates and queue them
  scanDuplicates: venueProcedure.mutation(async ({ ctx }) => {
    const [{ data: clients }, { data: platformMetrics }] = await Promise.all([
      ctx.supabase
        .from("clients")
        .select("id, name_primary, email_primary, event_date, status")
        .eq("venue_id", ctx.venueId),
      ctx.supabase
        .from("platform_metrics")
        .select("id, platform, metric_name, period_start, period_end, metric_value, captured_at")
        .eq("venue_id", ctx.venueId)
        .order("captured_at", { ascending: false }),
    ]);

    // Fetch already-queued pairs so we don't re-queue
    const { data: existing } = await ctx.supabase
      .from("matching_queue")
      .select("record_a_id, record_b_id")
      .eq("venue_id", ctx.venueId)
      .neq("status", "rejected");

    const alreadyQueued = new Set<string>(
      (existing ?? []).map((e) => [e.record_a_id, e.record_b_id].sort().join(":"))
    );

    const toInsert: any[] = [];

    // ── CLIENT DEDUPLICATION ────────────────────────────────────────────────
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
            match_score: score,
            signals_matched: signals,
            status: "pending",
          });
          alreadyQueued.add(pairKey);
        }
      }
    }

    // ── PLATFORM METRIC DEDUPLICATION ──────────────────────────────────────
    // Group by platform + metric_name and flag if multiple rows have overlapping periods
    const metricGroups = new Map<string, typeof platformMetrics extends (infer T)[] | null ? T[] : never[]>();
    for (const m of platformMetrics ?? []) {
      const key = `${m.platform}:${m.metric_name}`;
      if (!metricGroups.has(key)) metricGroups.set(key, []);
      metricGroups.get(key)!.push(m as any);
    }

    for (const [, rows] of metricGroups) {
      if (rows.length < 2) continue;
      // Compare each pair for overlapping periods
      for (let i = 0; i < rows.length; i++) {
        for (let j = i + 1; j < rows.length; j++) {
          const a = rows[i] as any;
          const b = rows[j] as any;
          const pairKey = [a.id, b.id].sort().join(":");
          if (alreadyQueued.has(pairKey)) continue;

          // Overlapping date ranges
          const aStart = a.period_start ? new Date(a.period_start) : null;
          const aEnd = a.period_end ? new Date(a.period_end) : null;
          const bStart = b.period_start ? new Date(b.period_start) : null;
          const bEnd = b.period_end ? new Date(b.period_end) : null;

          const overlaps =
            aStart && aEnd && bStart && bEnd &&
            aStart <= bEnd && bStart <= aEnd;

          if (overlaps) {
            const valueDiff = Math.abs((a.metric_value ?? 0) - (b.metric_value ?? 0));
            const score = valueDiff < 5 ? 90 : 60; // same value = almost certainly duplicate
            toInsert.push({
              venue_id: ctx.venueId,
              record_a_type: "platform_metric",
              record_a_id: a.id,
              record_b_type: "platform_metric",
              record_b_id: b.id,
              match_score: score,
              signals_matched: [`duplicate ${a.platform} ${a.metric_name} for overlapping period`],
              status: "pending",
            });
            alreadyQueued.add(pairKey);
          }
        }
      }
    }

    if (toInsert.length > 0) {
      await ctx.supabase.from("matching_queue").insert(toInsert);
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
