import { z } from "zod";
import { router, venueProcedure, adminProcedure, ownerProcedure, publicProcedure } from "@/lib/trpc/server";
import { TRPCError } from "@trpc/server";
import { DEMO_ORG_ID } from "@/lib/demo";

export const venuesRouter = router({
  // List all venues the current user has access to (for venue switcher)
  listUserVenues: venueProcedure.query(async ({ ctx }) => {
    // Demo mode: return all venues in the demo org
    if ((ctx as any).isDemo) {
      const { data, error } = await ctx.db
        .from("venues")
        .select("id, name, city, state")
        .eq("organisation_id", (ctx as any).demoSession?.orgId || DEMO_ORG_ID);

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

      return (data ?? []).map((v: any) => ({
        id: v.id as string,
        name: v.name as string,
        city: v.city as string | null,
        state: v.state as string | null,
        role: "enterprise_owner",
      }));
    }

    const { data, error } = await ctx.db
      .from("venue_users")
      .select("venue_id, role, venues:venue_id(id, name, city, state)")
      .eq("user_id", ctx.user.id)
      .eq("is_active", true);

    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

    return (data ?? [])
      .filter((row: any) => row.venues)
      .map((row: any) => ({
        id: row.venues.id as string,
        name: row.venues.name as string,
        city: row.venues.city as string | null,
        state: row.venues.state as string | null,
        role: row.role as string,
      }));
  }),

  // Get current venue
  getCurrent: venueProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.db
      .from("venues")
      .select("*")
      .eq("id", ctx.venueId)
      .single();

    if (error) throw new TRPCError({ code: "NOT_FOUND", message: error.message });
    return data;
  }),

  // Update venue settings — requires venue_admin or higher
  update: adminProcedure
    .input(
      z.object({
        name: z.string().optional(),
        // Integration keys present in schema
        honeybookApiKey: z.string().optional(),
        knotVenueId: z.string().optional(),
        googlePlaceId: z.string().optional(),
        ga4PropertyId: z.string().optional(),
        googleAdsCustomerId: z.string().optional(),
        instagramBusinessId: z.string().optional(),
        // Location calibration
        noaaStationId: z.string().optional(),
        fedDistrict: z.number().int().min(1).max(12).optional(),
        googleTrendsMetro: z.string().optional(),
        // Branding
        primaryColor: z.string().optional(),
        secondaryColor: z.string().optional(),
        logoUrl: z.string().optional(),
        // Sage config
        sageTone: z.string().optional(),
        sageGreeting: z.string().optional(),
        sageAutoReply: z.boolean().optional(),
        sageVoiceDescription: z.string().optional(),
        // Extra columns (migrations 006/008)
        calendlyApiKey: z.string().optional(),
        trendsCustomTerms: z.array(z.string()).optional(),
        competitorRadiusMiles: z.number().int().min(5).max(100).optional(),
        maxEventsPerMonth: z.number().int().min(1).max(100).optional(),
        // Misc
        timezone: z.string().optional(),
        contributesToBenchmark: z.boolean().optional(),
        onboardingComplete: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const updateData: Record<string, unknown> = {};

      if (input.name !== undefined) updateData.name = input.name;
      if (input.honeybookApiKey !== undefined) updateData.honeybook_api_key = input.honeybookApiKey;
      if (input.knotVenueId !== undefined) updateData.knot_venue_id = input.knotVenueId;
      if (input.googlePlaceId !== undefined) updateData.google_place_id = input.googlePlaceId;
      if (input.ga4PropertyId !== undefined) updateData.ga4_property_id = input.ga4PropertyId;
      if (input.googleAdsCustomerId !== undefined) updateData.google_ads_customer_id = input.googleAdsCustomerId;
      if (input.instagramBusinessId !== undefined) updateData.instagram_business_id = input.instagramBusinessId;
      if (input.noaaStationId !== undefined) {
        // Always store bare station ID — strip "GHCND:" prefix if user pastes the full form
        updateData.noaa_station_id = input.noaaStationId.replace(/^GHCND:/i, "");
      }
      if (input.fedDistrict !== undefined) updateData.fed_district = input.fedDistrict;
      if (input.googleTrendsMetro !== undefined) updateData.google_trends_metro = input.googleTrendsMetro;
      if (input.primaryColor !== undefined) updateData.primary_color = input.primaryColor;
      if (input.secondaryColor !== undefined) updateData.secondary_color = input.secondaryColor;
      if (input.logoUrl !== undefined) updateData.logo_url = input.logoUrl;
      if (input.sageTone !== undefined) updateData.sage_tone = input.sageTone;
      if (input.sageGreeting !== undefined) updateData.sage_greeting = input.sageGreeting;
      if (input.sageAutoReply !== undefined) updateData.sage_auto_reply = input.sageAutoReply;
      if (input.sageVoiceDescription !== undefined) updateData.sage_voice_description = input.sageVoiceDescription;
      if (input.calendlyApiKey !== undefined) updateData.calendly_api_key = input.calendlyApiKey;
      if (input.trendsCustomTerms !== undefined) updateData.trends_custom_terms = input.trendsCustomTerms.filter(Boolean);
      if (input.competitorRadiusMiles !== undefined) updateData.competitor_radius_miles = input.competitorRadiusMiles;
      if (input.maxEventsPerMonth !== undefined) updateData.max_events_per_month = input.maxEventsPerMonth;
      if (input.timezone !== undefined) updateData.timezone = input.timezone;
      if (input.contributesToBenchmark !== undefined) updateData.contributes_to_benchmark = input.contributesToBenchmark;
      if (input.onboardingComplete !== undefined) updateData.onboarding_complete = input.onboardingComplete;

      const { data, error } = await ctx.db
        .from("venues")
        .update(updateData)
        .eq("id", ctx.venueId)
        .select()
        .single();

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return data;
    }),

  // Returns live data counts for the setup/onboarding checklist
  getChecklistStatus: venueProcedure.query(async ({ ctx }) => {
    const [venueRes, clientRes, teamRes] = await Promise.all([
      ctx.db
        .from("venues")
        .select("noaa_station_id, google_trends_metro, fed_district, sage_tone, onboarding_complete, city, state, name")
        .eq("id", ctx.venueId)
        .single(),
      ctx.db
        .from("clients")
        .select("id", { count: "exact", head: true })
        .eq("venue_id", ctx.venueId),
      ctx.db
        .from("venue_users")
        .select("id", { count: "exact", head: true })
        .eq("venue_id", ctx.venueId),
    ]);

    return {
      hasNoaaStation: !!venueRes.data?.noaa_station_id,
      hasTrends: !!venueRes.data?.google_trends_metro,
      hasFedDistrict: !!venueRes.data?.fed_district,
      sageTone: venueRes.data?.sage_tone ?? null,
      onboardingComplete: venueRes.data?.onboarding_complete ?? false,
      clientCount: clientRes.count ?? 0,
      teamCount: teamRes.count ?? 1,
      city: venueRes.data?.city ?? null,
      state: venueRes.data?.state ?? null,
      venueName: venueRes.data?.name ?? null,
    };
  }),

  // Returns live data counts for the settings page data-setup checklist
  getSetupStatus: venueProcedure.query(async ({ ctx }) => {
    const { data: venue } = await ctx.db
      .from("venues")
      .select("noaa_station_id, fed_district, google_trends_metro")
      .eq("id", ctx.venueId)
      .single();

    // Strip the "GHCND:" prefix if stored with it
    const stationId = venue?.noaa_station_id?.replace(/^GHCND:/i, "") ?? null;

    const [weatherResult, clientsWithDateResult, clientsScoredResult, fredResult] =
      await Promise.all([
        stationId
          ? ctx.db
              .from("weather_monthly")
              .select("*", { count: "exact", head: true })
              // weather_monthly uses `station_id` — NOT `noaa_station_id`
              .eq("station_id", stationId)
          : Promise.resolve({ count: 0 as number | null }),
        ctx.db
          .from("clients")
          .select("*", { count: "exact", head: true })
          .eq("venue_id", ctx.venueId)
          .not("event_date", "is", null),
        ctx.db
          .from("clients")
          .select("*", { count: "exact", head: true })
          .eq("venue_id", ctx.venueId)
          .not("event_date", "is", null)
          .not("weather_difficulty_score", "is", null),
        ctx.db
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

  // Computes intelligence profile values live from clients + channel_spend data
  getComputedProfile: venueProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    const lastMonthStr = `${lastMonthStart.getFullYear()}-${String(lastMonthStart.getMonth() + 1).padStart(2, "0")}-01`;

    const [clientsRes, channelSpendRes, lastMonthSpendRes] = await Promise.all([
      ctx.db
        .from("clients")
        .select("revenue_cents, status, inquiry_channel, resolved_source")
        .eq("venue_id", ctx.venueId)
        .not("status", "is", null),
      ctx.db
        .from("channel_spend")
        .select("amount_cents, channel, month")
        .eq("venue_id", ctx.venueId)
        .order("month", { ascending: false }),
      ctx.db
        .from("channel_spend")
        .select("amount_cents, channel")
        .eq("venue_id", ctx.venueId)
        .eq("month", lastMonthStr),
    ]);

    const clients = clientsRes.data ?? [];
    const spend = channelSpendRes.data ?? [];

    // Average package value from contracted/event_complete clients with revenue
    const bookedClients = clients.filter(
      (c) => ["contracted", "event_complete"].includes(c.status) && c.revenue_cents
    );
    const avgPackageCents =
      bookedClients.length > 0
        ? Math.round(bookedClients.reduce((s, c) => s + (c.revenue_cents ?? 0), 0) / bookedClients.length)
        : null;

    // Tours-per-booking: toured+held+contracted+event_complete / contracted+event_complete
    const touredCount = clients.filter((c) =>
      ["toured", "held", "contracted", "event_complete", "lost"].includes(c.status)
    ).length;
    const contractedCount = clients.filter((c) =>
      ["contracted", "event_complete"].includes(c.status)
    ).length;
    const toursPerBooking = contractedCount > 0 ? Math.round((touredCount / contractedCount) * 10) / 10 : null;

    // Top inquiry channels
    const channelCounts: Record<string, number> = {};
    for (const c of clients) {
      if (c.inquiry_channel) {
        channelCounts[c.inquiry_channel] = (channelCounts[c.inquiry_channel] ?? 0) + 1;
      }
    }
    const topChannels = Object.entries(channelCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k]) => k);

    // Top resolved sources
    const sourceCounts: Record<string, number> = {};
    for (const c of clients) {
      if (c.resolved_source) {
        sourceCounts[c.resolved_source] = (sourceCounts[c.resolved_source] ?? 0) + 1;
      }
    }
    const topSources = Object.entries(sourceCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k]) => k);

    // Last month ad spend total
    const lastMonthSpend = (lastMonthSpendRes.data ?? []).reduce(
      (s: number, r: any) => s + (r.amount_cents ?? 0),
      0
    );

    // Last 12 months total
    const twelveMonthsAgo = new Date(now.getFullYear() - 1, now.getMonth() + 1, 1);
    const twelveMonthsAgoStr = `${twelveMonthsAgo.getFullYear()}-${String(twelveMonthsAgo.getMonth() + 1).padStart(2, "0")}-01`;
    const last12Total = spend
      .filter((s) => (s.month ?? "") >= twelveMonthsAgoStr)
      .reduce((sum, s) => sum + (s.amount_cents ?? 0), 0);

    return {
      avgPackageCents,
      bookedClientCount: bookedClients.length,
      toursPerBooking,
      touredCount,
      contractedCount,
      topInquiryChannels: topChannels,
      topLeadSources: topSources,
      lastMonthSpendCents: lastMonthSpend,
      last12SpendCents: last12Total,
      lastMonthLabel: lastMonthStart.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
      hasData: clients.length > 0 || spend.length > 0,
    };
  }),

  // Delete all seed data for this venue — requires venue_owner
  deleteSeedData: ownerProcedure.mutation(async ({ ctx }) => {
    // Delete in FK-safe order
    await ctx.db.from("lost_deals").delete().eq("venue_id", ctx.venueId);
    await ctx.db.from("tours").delete().eq("venue_id", ctx.venueId);
    await ctx.db.from("reviews").delete().eq("venue_id", ctx.venueId);
    await ctx.db.from("channel_spend").delete().eq("venue_id", ctx.venueId);
    await ctx.db.from("clients").delete().eq("venue_id", ctx.venueId).eq("is_seed_data", true);
    return { success: true };
  }),

  // Creates a venue team invitation — requires venue_admin or higher
  inviteTeamMember: adminProcedure
    .input(z.object({ email: z.string().email(), role: z.enum(["admin", "member"]).default("member") }))
    .mutation(async ({ ctx, input }) => {
      const { data: { user } } = await ctx.db.auth.getUser();

      // Generate a random token for the invite link
      const token = crypto.randomUUID();

      // Table is `user_invitations` — not `venue_invites`
      const { data: upserted, error } = await ctx.db
        .from("user_invitations")
        .upsert(
          {
            venue_id: ctx.venueId,
            email: input.email,
            role: input.role,
            invited_by: user?.id,
            token,
            status: "pending",
          },
          { onConflict: "venue_id,email", ignoreDuplicates: false }
        )
        .select("token")
        .single();

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

      // Send invite email via Resend
      const resendApiKey = process.env.RESEND_API_KEY;
      if (!resendApiKey) {
        console.warn("[inviteTeamMember] RESEND_API_KEY not set — skipping invite email");
      } else {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
        const inviteToken = upserted?.token;

        if (inviteToken) {
          const { data: venueData } = await ctx.db
            .from("venues")
            .select("name")
            .eq("id", ctx.venueId)
            .single();
          const venueName = venueData?.name ?? "your venue";

          const inviteUrl = `${appUrl}/invite/${inviteToken}`;
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
            // Non-fatal — invite was created in DB, email just failed to send
          }
        }
      }

      return { ok: true };
    }),

  // ── AI USAGE SUMMARY ───────────────────────────────────────────────────
  // Brief: "Dashboard widget showing AI cost per venue per month"
  getAIUsage: venueProcedure.query(async ({ ctx }) => {
    const { data } = await ctx.db
      .from("ai_usage_log")
      .select("provider, task_type, cost_cents, input_tokens, output_tokens, success, fallback_used, created_at")
      .eq("venue_id", ctx.venueId)
      .order("created_at", { ascending: false })
      .limit(500);

    const rows = data ?? [];
    if (rows.length === 0) {
      return { totalCostCents: 0, callCount: 0, byProvider: {}, byTaskType: {}, monthlyTrend: [], fallbackRate: 0 };
    }

    let totalCost = 0;
    let fallbackCount = 0;
    const byProvider: Record<string, { calls: number; costCents: number }> = {};
    const byTaskType: Record<string, { calls: number; costCents: number }> = {};
    const byMonth: Record<string, number> = {};

    for (const row of rows) {
      const cost = (row.cost_cents as number) ?? 0;
      totalCost += cost;
      if (row.fallback_used) fallbackCount++;

      const provider = row.provider as string;
      if (!byProvider[provider]) byProvider[provider] = { calls: 0, costCents: 0 };
      byProvider[provider].calls++;
      byProvider[provider].costCents += cost;

      const taskType = row.task_type as string;
      if (!byTaskType[taskType]) byTaskType[taskType] = { calls: 0, costCents: 0 };
      byTaskType[taskType].calls++;
      byTaskType[taskType].costCents += cost;

      const month = (row.created_at as string).substring(0, 7);
      byMonth[month] = (byMonth[month] ?? 0) + cost;
    }

    const monthlyTrend = Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, costCents]) => ({ month, costCents }));

    return {
      totalCostCents: totalCost,
      callCount: rows.length,
      byProvider,
      byTaskType,
      monthlyTrend,
      fallbackRate: rows.length > 0 ? fallbackCount / rows.length : 0,
    };
  }),

  // ── DATA EXPORT (one-click full venue export) ─────────────────────────
  // Brief: "Data export: one-click full export of all venue data as CSV/JSON."
  // Requires venue_admin or higher
  exportAllData: adminProcedure.query(async ({ ctx }) => {
    // Log this sensitive action
    ctx.logAccess("venue", ctx.venueId, "export");

    const tables = [
      "clients", "inquiries", "tours", "uploads", "planning_events",
      "reviews", "review_language", "referrals", "vendors", "client_vendors",
      "channel_spend", "social_posts", "annotations", "lost_deals",
      "campaigns", "pre_inquiry_signals", "leads", "client_source_touchpoints",
    ];

    const result: Record<string, any[]> = {};

    for (const table of tables) {
      const { data } = await ctx.db
        .from(table)
        .select("*")
        .eq("venue_id", ctx.venueId)
        .limit(10000);
      result[table] = data ?? [];
    }

    // Also export venue config (without sensitive keys)
    const { data: venue } = await ctx.db
      .from("venues")
      .select("id, name, slug, city, state, zip, lat, lng, region, timezone, sage_tone, sage_voice_description, packages, primary_color, secondary_color")
      .eq("id", ctx.venueId)
      .single();

    result.venue = venue ? [venue] : [];

    return result;
  }),

  // ── REACTIVE SIGNAL FUNCTIONS ─────────────────────────────────────────
  // These are callable by external apps (Sage, website, etc.)

  // getSageVocabulary: approved review phrases for Sage to use
  getSageVocabulary: venueProcedure.query(async ({ ctx }) => {
    const { data } = await ctx.db
      .from("review_language")
      .select("phrase, theme, avg_rating, frequency_count")
      .eq("venue_id", ctx.venueId)
      .eq("approved_for_sage", true)
      .order("frequency_count", { ascending: false });
    return data ?? [];
  }),

  // getSageConcerns: flagged concerns for Sage to proactively address
  getSageConcerns: venueProcedure.query(async ({ ctx }) => {
    const { data } = await ctx.db
      .from("review_language")
      .select("phrase, theme, frequency_count")
      .eq("venue_id", ctx.venueId)
      .eq("flagged_as_concern", true)
      .order("frequency_count", { ascending: false });
    return data ?? [];
  }),

  // getSuggestedTestimonials: approved-for-marketing phrases
  getSuggestedTestimonials: venueProcedure.query(async ({ ctx }) => {
    const { data } = await ctx.db
      .from("review_language")
      .select("phrase, theme, avg_rating, frequency_count, source_review_ids")
      .eq("venue_id", ctx.venueId)
      .eq("approved_for_marketing", true)
      .order("avg_rating", { ascending: false });
    return data ?? [];
  }),

  // getDateDemand: inquiry count per date for premium pricing signals
  getDateDemand: venueProcedure.query(async ({ ctx }) => {
    const { data } = await ctx.db
      .from("clients")
      .select("event_date, status")
      .eq("venue_id", ctx.venueId)
      .not("event_date", "is", null)
      .gte("event_date", new Date().toISOString().split("T")[0]);

    const dateMap = new Map<string, { total: number; booked: number }>();
    for (const c of data ?? []) {
      const d = c.event_date as string;
      if (!dateMap.has(d)) dateMap.set(d, { total: 0, booked: 0 });
      const entry = dateMap.get(d)!;
      entry.total++;
      if (["contracted", "event_complete", "held"].includes(c.status)) entry.booked++;
    }

    return Array.from(dateMap.entries())
      .map(([date, stats]) => ({ date, ...stats }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }),

  // getSeasonalPattern: historical demand by month
  getSeasonalPattern: venueProcedure.query(async ({ ctx }) => {
    const { data } = await ctx.db
      .from("clients")
      .select("event_month, status, revenue_cents")
      .eq("venue_id", ctx.venueId)
      .not("event_month", "is", null);

    const months = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      inquiries: 0,
      booked: 0,
      avgRevenue: 0,
      totalRevenue: 0,
    }));

    for (const c of data ?? []) {
      const m = (c.event_month as number) - 1;
      if (m < 0 || m > 11) continue;
      months[m].inquiries++;
      if (["contracted", "event_complete"].includes(c.status)) {
        months[m].booked++;
        months[m].totalRevenue += (c.revenue_cents as number) ?? 0;
      }
    }

    for (const m of months) {
      m.avgRevenue = m.booked > 0 ? Math.round(m.totalRevenue / m.booked) : 0;
    }

    return months;
  }),
});
