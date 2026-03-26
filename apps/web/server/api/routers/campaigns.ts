import { z } from "zod";
import { router, venueProcedure } from "@/lib/trpc/server";
import { TRPCError } from "@trpc/server";

export const campaignsRouter = router({
  list: venueProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.db
      .from("campaigns")
      .select("*")
      .eq("venue_id", ctx.venueId)
      .order("start_date", { ascending: false });

    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    return data ?? [];
  }),

  upsert: venueProcedure
    .input(
      z.object({
        id: z.string().uuid().optional(),
        name: z.string().min(1),
        campaignType: z.string().optional(),
        channel: z.string().optional(),
        startDate: z.string().optional(), // ISO date string "YYYY-MM-DD"
        endDate: z.string().optional(),
        spendCents: z.number().int().min(0).optional(),
        inquiriesAttributed: z.number().int().min(0).optional(),
        toursAttributed: z.number().int().min(0).optional(),
        bookingsAttributed: z.number().int().min(0).optional(),
        revenueAttributedCents: z.number().int().min(0).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const spend = input.spendCents ?? 0;
      const inquiries = input.inquiriesAttributed ?? 0;
      const bookings = input.bookingsAttributed ?? 0;
      const revenue = input.revenueAttributedCents ?? 0;

      const costPerInquiry = spend > 0 && inquiries > 0
        ? Math.round(spend / inquiries)
        : null;

      const costPerBooking = spend > 0 && bookings > 0
        ? Math.round(spend / bookings)
        : null;

      const roiRatio = spend > 0 && revenue > 0
        ? parseFloat((revenue / spend).toFixed(2))
        : null;

      const payload = {
        name: input.name,
        campaign_type: input.campaignType ?? null,
        channel: input.channel ?? null,
        start_date: input.startDate ?? null,
        end_date: input.endDate ?? null,
        spend_cents: spend,
        inquiries_attributed: inquiries,
        tours_attributed: input.toursAttributed ?? 0,
        bookings_attributed: bookings,
        revenue_attributed_cents: revenue,
        cost_per_inquiry_cents: costPerInquiry,
        cost_per_booking_cents: costPerBooking,
        roi_ratio: roiRatio,
      };

      if (input.id) {
        const { data, error } = await ctx.db
          .from("campaigns")
          .update(payload)
          .eq("id", input.id)
          .eq("venue_id", ctx.venueId)
          .select()
          .single();
        if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
        return data;
      } else {
        const { data, error } = await ctx.db
          .from("campaigns")
          .insert({ ...payload, venue_id: ctx.venueId })
          .select()
          .single();
        if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
        return data;
      }
    }),

  delete: venueProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.db
        .from("campaigns")
        .delete()
        .eq("id", input.id)
        .eq("venue_id", ctx.venueId);
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { success: true };
    }),
});
