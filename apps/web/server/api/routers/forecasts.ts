import { z } from "zod";
import { router, venueProcedure } from "@/lib/trpc/server";
import { TRPCError } from "@trpc/server";

/**
 * Revenue forecasts — pipeline-weighted projections.
 * Brief: "Based on current pipeline, project future revenue."
 */
export const forecastsRouter = router({
  // Generate or fetch latest revenue forecast
  getRevenueForecast: venueProcedure
    .input(z.object({
      quarters: z.number().int().min(1).max(8).default(4),
    }).optional())
    .query(async ({ ctx, input }) => {
      const quarters = input?.quarters ?? 4;
      const now = new Date();

      // Fetch current pipeline clients with event_date in the future
      const { data: pipeline } = await ctx.db
        .from("clients")
        .select("event_date, status, revenue_cents, guest_count_initial, package")
        .eq("venue_id", ctx.venueId)
        .gte("event_date", now.toISOString().split("T")[0])
        .not("event_date", "is", null);

      // Historical conversion rates for weighting
      const { data: historical } = await ctx.db
        .from("clients")
        .select("status")
        .eq("venue_id", ctx.venueId);

      const allClients = historical ?? [];
      const totalPastInquiry = allClients.length || 1;
      const totalBooked = allClients.filter(c =>
        ["contracted", "event_complete"].includes(c.status)
      ).length;
      const totalHeld = allClients.filter(c => c.status === "held").length;
      const totalToured = allClients.filter(c =>
        ["toured", "held", "contracted", "event_complete"].includes(c.status)
      ).length;

      // Historical conversion rates
      const holdToContractRate = totalHeld > 0
        ? totalBooked / (totalBooked + totalHeld)
        : 0.7; // Default 70% if no data
      const tourToBookRate = totalToured > 0
        ? totalBooked / totalToured
        : 0.55; // Default 55%

      // Weight pipeline revenue by stage
      const stageWeights: Record<string, number> = {
        contracted: 1.0,
        event_complete: 1.0,
        held: holdToContractRate,
        toured: tourToBookRate * holdToContractRate,
        tour_booked: tourToBookRate * holdToContractRate * 0.8,
        inquiry: tourToBookRate * holdToContractRate * 0.3,
      };

      // Avg revenue for clients without revenue_cents
      const withRevenue = (pipeline ?? []).filter(c => c.revenue_cents && c.revenue_cents > 0);
      const avgRevenue = withRevenue.length > 0
        ? withRevenue.reduce((s, c) => s + (c.revenue_cents as number), 0) / withRevenue.length
        : 0;

      // Build quarterly forecast
      const quarterResults: Array<{
        quarter: string;
        periodStart: string;
        periodEnd: string;
        contractedCents: number;
        heldCents: number;
        pipelineCents: number;
        totalForecastCents: number;
        eventCount: number;
        confidenceLevel: string;
      }> = [];

      for (let q = 0; q < quarters; q++) {
        const qStart = new Date(now.getFullYear(), now.getMonth() + q * 3, 1);
        const qEnd = new Date(now.getFullYear(), now.getMonth() + (q + 1) * 3, 0);
        const qStartStr = qStart.toISOString().split("T")[0];
        const qEndStr = qEnd.toISOString().split("T")[0];

        const qClients = (pipeline ?? []).filter(c => {
          const d = c.event_date as string;
          return d >= qStartStr && d <= qEndStr;
        });

        let contractedCents = 0;
        let heldCents = 0;
        let pipelineCents = 0;
        let eventCount = 0;

        for (const c of qClients) {
          const rev = (c.revenue_cents as number) || avgRevenue;
          const weight = stageWeights[c.status] ?? 0.1;
          const weighted = Math.round(rev * weight);
          eventCount++;

          if (c.status === "contracted" || c.status === "event_complete") {
            contractedCents += rev;
          } else if (c.status === "held") {
            heldCents += weighted;
          } else {
            pipelineCents += weighted;
          }
        }

        const totalForecast = contractedCents + heldCents + pipelineCents;
        const contractedPct = totalForecast > 0 ? contractedCents / totalForecast : 0;

        quarterResults.push({
          quarter: `Q${Math.floor(qStart.getMonth() / 3) + 1} ${qStart.getFullYear()}`,
          periodStart: qStartStr,
          periodEnd: qEndStr,
          contractedCents,
          heldCents,
          pipelineCents,
          totalForecastCents: totalForecast,
          eventCount,
          confidenceLevel: contractedPct >= 0.7 ? "high" : contractedPct >= 0.4 ? "medium" : "low",
        });
      }

      // Same period prior year for comparison
      const priorYearStart = new Date(now.getFullYear() - 1, now.getMonth(), 1);
      const priorYearEnd = new Date(now.getFullYear() - 1, now.getMonth() + quarters * 3, 0);
      const { data: priorYear } = await ctx.db
        .from("clients")
        .select("revenue_cents")
        .eq("venue_id", ctx.venueId)
        .in("status", ["contracted", "event_complete"])
        .gte("event_date", priorYearStart.toISOString().split("T")[0])
        .lte("event_date", priorYearEnd.toISOString().split("T")[0]);

      const priorYearRevenue = (priorYear ?? []).reduce((s, c) => s + ((c.revenue_cents as number) ?? 0), 0);
      const totalForecast = quarterResults.reduce((s, q) => s + q.totalForecastCents, 0);
      const yoyPct = priorYearRevenue > 0
        ? Math.round(((totalForecast - priorYearRevenue) / priorYearRevenue) * 100)
        : null;

      return {
        quarters: quarterResults,
        totalForecastCents: totalForecast,
        priorYearCents: priorYearRevenue,
        yoyPct,
        conversionRates: {
          holdToContract: Math.round(holdToContractRate * 100),
          tourToBook: Math.round(tourToBookRate * 100),
        },
      };
    }),
});
