import { z } from "zod";
import { router, venueProcedure } from "@/lib/trpc/server";
import { TRPCError } from "@trpc/server";

export const vendorsRouter = router({
  list: venueProcedure
    .input(z.object({ category: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      let query = ctx.db
        .from("vendors")
        .select("*")
        .eq("venue_id", ctx.venueId)
        .order("appearances_count", { ascending: false });

      if (input?.category) query = query.eq("category", input.category);

      const { data, error } = await query;
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return data ?? [];
    }),

  getScorecard: venueProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data: vendor, error } = await ctx.db
        .from("vendors")
        .select("*")
        .eq("id", input.id)
        .eq("venue_id", ctx.venueId)
        .single();

      if (error) throw new TRPCError({ code: "NOT_FOUND" });

      // Get weddings this vendor worked
      const { data: clientVendors } = await ctx.db
        .from("client_vendors")
        .select("client:clients(id, name_primary, event_date, review_star_rating, revenue_cents, complexity_score, referrer_name)")
        .eq("vendor_id", input.id)
        .eq("venue_id", ctx.venueId);

      return {
        vendor,
        weddings: clientVendors?.map((cv) => cv.client) ?? [],
      };
    }),

  upsert: venueProcedure
    .input(
      z.object({
        id: z.string().uuid().optional(),
        name: z.string().min(1),
        category: z.string().optional(),
        email: z.string().email().optional(),
        website: z.string().url().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.id) {
        const { data, error } = await ctx.db
          .from("vendors")
          .update({
            name: input.name,
            category: input.category,
            email: input.email,
            website: input.website,
          })
          .eq("id", input.id)
          .eq("venue_id", ctx.venueId)
          .select()
          .single();
        if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
        return data;
      } else {
        const { data, error } = await ctx.db
          .from("vendors")
          .insert({
            venue_id: ctx.venueId,
            name: input.name,
            category: input.category,
            email: input.email,
            website: input.website,
          })
          .select()
          .single();
        if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
        return data;
      }
    }),

  // Link vendor to client
  linkToClient: venueProcedure
    .input(z.object({ clientId: z.string().uuid(), vendorId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.db
        .from("client_vendors")
        .upsert({
          venue_id: ctx.venueId,
          client_id: input.clientId,
          vendor_id: input.vendorId,
        });
      if (error && !error.message.includes("duplicate")) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      }
      return { success: true };
    }),
});
