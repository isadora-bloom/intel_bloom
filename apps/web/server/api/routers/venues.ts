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
        googleTrendsMetro: z.string().optional(),
        noaaStationId: z.string().optional(),
        fedDistrict: z.number().int().min(1).max(12).optional(),
        trendsCustomTerms: z.array(z.string().max(80)).max(4).optional(),
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
      if (input.googleTrendsMetro !== undefined) updateData.google_trends_metro = input.googleTrendsMetro;
      if (input.noaaStationId !== undefined) {
        // Always store bare GHCND ID — strip "GHCND:" prefix if user pastes the full form
        updateData.noaa_station_id = input.noaaStationId.replace(/^GHCND:/i, "");
      }
      if (input.fedDistrict !== undefined) updateData.fed_district = input.fedDistrict;
      if (input.trendsCustomTerms !== undefined) updateData.trends_custom_terms = input.trendsCustomTerms;

      const { data, error } = await ctx.supabase
        .from("venues")
        .update(updateData)
        .eq("id", ctx.venueId)
        .select()
        .single();

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return data;
    }),

  // Returns everything the setup checklist needs
  getChecklistStatus: venueProcedure.query(async ({ ctx }) => {
    const [venueRes, emailRes, clientRes, teamRes] = await Promise.all([
      ctx.supabase.from("venues")
        .select("funnel_config, venue_profile, calendly_api_key, briefing_email, city, state, name")
        .eq("id", ctx.venueId).single(),
      ctx.supabase.from("email_connections").select("id").eq("venue_id", ctx.venueId).limit(1),
      ctx.supabase.from("clients").select("id", { count: "exact", head: true }).eq("venue_id", ctx.venueId),
      ctx.supabase.from("venue_users").select("id", { count: "exact", head: true }).eq("venue_id", ctx.venueId),
    ]);
    return {
      funnelConfig: (venueRes.data?.funnel_config ?? {}) as Record<string, any>,
      venueProfile: (venueRes.data?.venue_profile ?? {}) as Record<string, any>,
      calendlyConnected: !!venueRes.data?.calendly_api_key,
      briefingEmail: venueRes.data?.briefing_email ?? null,
      emailConnected: (emailRes.data?.length ?? 0) > 0,
      clientCount: clientRes.count ?? 0,
      teamCount: teamRes.count ?? 1,
      city: venueRes.data?.city ?? null,
      state: venueRes.data?.state ?? null,
      venueName: venueRes.data?.name ?? null,
    };
  }),

  // Returns live data counts for the settings page data-setup checklist
  getSetupStatus: venueProcedure.query(async ({ ctx }) => {
    const { data: venue } = await ctx.supabase
      .from("venues")
      .select("noaa_station_id, fed_district, google_trends_metro")
      .eq("id", ctx.venueId)
      .single();

    const stationId = venue?.noaa_station_id?.replace(/^GHCND:/i, "") ?? null;

    const [weatherResult, clientsWithDateResult, clientsScoredResult, fredResult] =
      await Promise.all([
        stationId
          ? ctx.supabase
              .from("weather_monthly")
              .select("*", { count: "exact", head: true })
              .eq("noaa_station_id", stationId)
          : Promise.resolve({ count: 0 as number | null }),
        ctx.supabase
          .from("clients")
          .select("*", { count: "exact", head: true })
          .eq("venue_id", ctx.venueId)
          .not("event_date", "is", null),
        ctx.supabase
          .from("clients")
          .select("*", { count: "exact", head: true })
          .eq("venue_id", ctx.venueId)
          .not("event_date", "is", null)
          .not("weather_difficulty_score", "is", null),
        ctx.supabase
          .from("macro_economic")
          .select("*", { count: "exact", head: true }),
      ]);

    return {
      hasNoaaStation: !!stationId,
      noaaStationId: stationId,
      weatherMonthCount: weatherResult.count ?? 0,
      clientsWithEventDate: clientsWithDateResult.count ?? 0,
      clientsWithWeatherScore: clientsScoredResult.count ?? 0,
      hasFedDistrict: !!venue?.fed_district,
      fredDataPoints: fredResult.count ?? 0,
      hasTrends: !!venue?.google_trends_metro,
      googleTrendsMetro: venue?.google_trends_metro ?? null,
    };
  }),

  // Merges partial funnel/profile data
  saveOnboardingSection: venueProcedure
    .input(z.object({
      funnelConfig: z.record(z.unknown()).optional(),
      venueProfile: z.record(z.unknown()).optional(),
      calendlyApiKey: z.string().optional(),
      briefingEmail: z.string().email().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { data: existing } = await ctx.supabase
        .from("venues").select("funnel_config, venue_profile").eq("id", ctx.venueId).single();
      const updates: Record<string, unknown> = {};
      if (input.funnelConfig)
        updates.funnel_config = { ...(existing?.funnel_config ?? {}), ...input.funnelConfig };
      if (input.venueProfile)
        updates.venue_profile = { ...(existing?.venue_profile ?? {}), ...input.venueProfile };
      if (input.calendlyApiKey !== undefined) updates.calendly_api_key = input.calendlyApiKey || null;
      if (input.briefingEmail !== undefined) updates.briefing_email = input.briefingEmail;
      const { error } = await ctx.supabase.from("venues").update(updates).eq("id", ctx.venueId);
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { ok: true };
    }),

  // Creates a venue invite
  inviteTeamMember: venueProcedure
    .input(z.object({ email: z.string().email(), role: z.enum(["admin", "member"]).default("member") }))
    .mutation(async ({ ctx, input }) => {
      const { data: { user } } = await ctx.supabase.auth.getUser();

      const { data: upserted, error } = await ctx.supabase.from("venue_invites").upsert(
        { venue_id: ctx.venueId, email: input.email, role: input.role, invited_by: user?.id },
        { onConflict: "venue_id,email", ignoreDuplicates: false }
      ).select("token").single();

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

      // Send invite email via Resend
      const resendApiKey = process.env.RESEND_API_KEY;
      if (!resendApiKey) {
        console.warn("[inviteTeamMember] RESEND_API_KEY not set — skipping invite email");
      } else {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
        const token = upserted?.token;

        if (token) {
          // Fetch venue name for the email
          const { data: venueData } = await ctx.supabase
            .from("venues")
            .select("name")
            .eq("id", ctx.venueId)
            .single();
          const venueName = venueData?.name ?? "your venue";

          const inviteUrl = `${appUrl}/invite/${token}`;
          const fromEmail = process.env.BRIEFING_FROM_EMAIL ?? "invites@bloomhq.co";

          const emailRes = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${resendApiKey}`,
            },
            body: JSON.stringify({
              from: fromEmail,
              to: input.email,
              subject: `You've been invited to join ${venueName} on Bloom Intelligence`,
              html: `
                <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #111827;">
                  <h2 style="font-size: 20px; font-weight: 600; margin-bottom: 8px;">You've been invited</h2>
                  <p style="font-size: 15px; color: #374151; margin-bottom: 24px;">
                    You've been invited to join <strong>${venueName}</strong> on Bloom Intelligence.
                  </p>
                  <a
                    href="${inviteUrl}"
                    style="display: inline-block; background: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-size: 14px; font-weight: 500;"
                  >
                    Accept invitation
                  </a>
                  <p style="font-size: 13px; color: #6b7280; margin-top: 24px;">
                    Or copy this link: <a href="${inviteUrl}" style="color: #2563eb;">${inviteUrl}</a>
                  </p>
                  <p style="font-size: 12px; color: #9ca3af; margin-top: 32px;">
                    This link expires in 7 days. If you weren't expecting this invitation, you can ignore this email.
                  </p>
                </div>
              `,
            }),
          });

          if (!emailRes.ok) {
            const emailErr = await emailRes.text();
            console.error("[inviteTeamMember] Resend failed:", emailErr);
            // Non-fatal — invite was created, email just didn't send
          }
        }
      }

      return { ok: true };
    }),
});
