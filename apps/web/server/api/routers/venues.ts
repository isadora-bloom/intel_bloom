import { z } from "zod";
import { router, venueProcedure, publicProcedure } from "@/lib/trpc/server";
import { TRPCError } from "@trpc/server";

export const venuesRouter = router({
  // Get current venue
  getCurrent: venueProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from("venues")
      .select("*")
      .eq("id", ctx.venueId)
      .single();

    if (error) throw new TRPCError({ code: "NOT_FOUND", message: error.message });
    return data;
  }),

  // Update venue settings
  update: venueProcedure
    .input(
      z.object({
        name: z.string().optional(),
        honeybookApiKey: z.string().optional(),
        knotVenueId: z.string().optional(),
        googlePlaceId: z.string().optional(),
        competitorRadiusMiles: z.number().int().min(5).max(100).optional(),
        contributesToBenchmark: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const updateData: Record<string, unknown> = {};
      if (input.name !== undefined) updateData.name = input.name;
      if (input.honeybookApiKey !== undefined) updateData.honeybook_api_key = input.honeybookApiKey;
      if (input.knotVenueId !== undefined) updateData.knot_venue_id = input.knotVenueId;
      if (input.googlePlaceId !== undefined) updateData.google_place_id = input.googlePlaceId;
      if (input.competitorRadiusMiles !== undefined) updateData.competitor_radius_miles = input.competitorRadiusMiles;
      if (input.contributesToBenchmark !== undefined) updateData.contributes_to_benchmark = input.contributesToBenchmark;

      const { data, error } = await ctx.supabase
        .from("venues")
        .update(updateData)
        .eq("id", ctx.venueId)
        .select()
        .single();

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return data;
    }),
});
