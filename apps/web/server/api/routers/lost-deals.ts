import { z } from "zod";
import { router, venueProcedure } from "@/lib/trpc/server";
import { TRPCError } from "@trpc/server";

const REASON_CATEGORIES = [
  "no_response",
  "pricing",
  "competitor",
  "date_unavailable",
  "ghosted",
  "changed_plans",
  "venue_mismatch",
  "budget_change",
  "other",
] as const;

const LOST_STAGES = ["inquiry", "tour", "hold", "contract"] as const;

export const lostDealsRouter = router({
  // ── Stats overview ───────────────────────────────────────────────────────
  getStats: venueProcedure.query(async ({ ctx }) => {
    // All lost deals for this venue
    const { data: deals, error: dealsError } = await ctx.db
      .from("lost_deals")
      .select("*")
      .eq("venue_id", ctx.venueId);

    if (dealsError) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: dealsError.message });

    const allDeals = deals ?? [];

    // Lost by stage
    const byStage: Record<string, number> = { inquiry: 0, tour: 0, hold: 0, contract: 0 };
    for (const d of allDeals) {
      const stage = d.lost_at_stage as string;
      byStage[stage] = (byStage[stage] ?? 0) + 1;
    }

    // Top 5 reason categories
    const reasonCounts: Record<string, number> = {};
    for (const d of allDeals) {
      if (d.reason_category) {
        reasonCounts[d.reason_category] = (reasonCounts[d.reason_category] ?? 0) + 1;
      }
    }
    const topReasons = Object.entries(reasonCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category, count]) => ({ category, count }));

    // Top 5 competitors with counts and implied win rate
    const competitorCounts: Record<string, number> = {};
    for (const d of allDeals) {
      if (d.competitor_name) {
        competitorCounts[d.competitor_name] = (competitorCounts[d.competitor_name] ?? 0) + 1;
      }
    }

    // contracted + event_complete clients = "wins"
    const { count: wonCount } = await ctx.db
      .from("clients")
      .select("*", { count: "exact", head: true })
      .eq("venue_id", ctx.venueId)
      .in("status", ["contracted", "event_complete"]);

    const totalWon = wonCount ?? 0;
    const totalLost = allDeals.length;
    const totalSeen = totalWon + totalLost;

    const topCompetitors = Object.entries(competitorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, lostCount]) => ({
        name,
        lostCount,
        // Win rate = wins / (wins + losses where this competitor appeared)
        winRate: totalSeen > 0 ? Math.round((totalWon / (totalWon + lostCount)) * 100) : null,
      }));

    // Month-by-month lost count for last 12 months
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
    twelveMonthsAgo.setDate(1);
    twelveMonthsAgo.setHours(0, 0, 0, 0);

    const recentDeals = allDeals.filter(
      (d) => d.created_at && new Date(d.created_at) >= twelveMonthsAgo
    );

    const monthlyMap: Record<string, number> = {};
    for (const d of recentDeals) {
      if (!d.created_at) continue;
      const dt = new Date(d.created_at);
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
      monthlyMap[key] = (monthlyMap[key] ?? 0) + 1;
    }

    // Build full 12-month array (fill gaps with 0)
    const monthlyTrend: { month: string; count: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleString("default", { month: "short", year: "2-digit" });
      monthlyTrend.push({ month: label, count: monthlyMap[key] ?? 0 });
    }

    // Overall lost rate
    const lostRate = totalSeen > 0 ? Math.round((totalLost / totalSeen) * 100) : null;

    // Recovery rate
    const recoveryAttempted = allDeals.filter((d) => d.recovery_attempted).length;
    const recoverySucceeded = allDeals.filter(
      (d) => d.recovery_attempted && d.recovery_outcome && d.recovery_outcome !== "failed"
    ).length;
    const recoveryRate =
      recoveryAttempted > 0 ? Math.round((recoverySucceeded / recoveryAttempted) * 100) : null;

    return {
      total: totalLost,
      byStage,
      topReasons,
      topCompetitors,
      monthlyTrend,
      lostRate,
      recoveryRate,
      recoveryAttempted,
    };
  }),

  // ── List with filters ─────────────────────────────────────────────────────
  list: venueProcedure
    .input(
      z.object({
        stage: z.string().optional(),
        reason: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(50),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      let query = ctx.db
        .from("lost_deals")
        .select(
          `*, client:clients(id, name_primary, name_partner, status, resolved_source)`
        )
        .eq("venue_id", ctx.venueId)
        .order("created_at", { ascending: false })
        .limit(input?.limit ?? 50);

      if (input?.stage) {
        query = query.eq("lost_at_stage", input.stage);
      }
      if (input?.reason) {
        query = query.eq("reason_category", input.reason);
      }

      const { data, error } = await query;
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

      return data ?? [];
    }),

  // ── Record a new lost deal ────────────────────────────────────────────────
  record: venueProcedure
    .input(
      z.object({
        clientId: z.string().uuid(),
        lostAtStage: z.enum(LOST_STAGES),
        reasonCategory: z.enum(REASON_CATEGORIES).optional(),
        reasonDetail: z.string().optional(),
        competitorName: z.string().optional(),
        coordinator: z.string().optional(),
        daysInStage: z.number().int().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Insert the lost_deals record
      const { data, error } = await ctx.db
        .from("lost_deals")
        .insert({
          venue_id: ctx.venueId,
          client_id: input.clientId,
          lost_at_stage: input.lostAtStage,
          reason_category: input.reasonCategory ?? null,
          reason_detail: input.reasonDetail ?? null,
          competitor_name: input.competitorName ?? null,
          coordinator: input.coordinator ?? null,
          days_in_stage: input.daysInStage ?? null,
        })
        .select()
        .single();

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

      // Update client status to "lost"
      await ctx.db
        .from("clients")
        .update({ status: "lost" })
        .eq("id", input.clientId)
        .eq("venue_id", ctx.venueId);

      return data;
    }),

  // ── Mark recovery attempt ─────────────────────────────────────────────────
  markRecoveryAttempt: venueProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        outcome: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.db
        .from("lost_deals")
        .update({
          recovery_attempted: true,
          recovery_outcome: input.outcome,
        })
        .eq("id", input.id)
        .eq("venue_id", ctx.venueId)
        .select()
        .single();

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return data;
    }),

  // ── Auto-detect unlogged lost clients ─────────────────────────────────────
  autoDetect: venueProcedure.query(async ({ ctx }) => {
    // Clients with status=lost or archived
    const { data: lostClients, error: clientError } = await ctx.db
      .from("clients")
      .select("id, name_primary, name_partner, status, inquired_at, resolved_source")
      .eq("venue_id", ctx.venueId)
      .in("status", ["lost", "archived"])
      .order("inquired_at", { ascending: false });

    if (clientError) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: clientError.message });
    if (!lostClients || lostClients.length === 0) return [];

    // Get all client_ids already logged in lost_deals
    const { data: logged } = await ctx.db
      .from("lost_deals")
      .select("client_id")
      .eq("venue_id", ctx.venueId)
      .in(
        "client_id",
        lostClients.map((c) => c.id)
      );

    const loggedIds = new Set((logged ?? []).map((l) => l.client_id).filter(Boolean));

    return lostClients.filter((c) => !loggedIds.has(c.id));
  }),
});
