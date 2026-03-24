/**
 * Social Posts Router
 *
 * Tracks Instagram, Facebook, Pinterest, TikTok, and YouTube posts
 * and correlates them with inquiry spikes.
 *
 * The central question this module answers:
 *   "Did that reel actually bring in inquiries, or did it just get likes?"
 *
 * Key metric hierarchy for wedding venues:
 *   website_clicks > saves > profile_visits > shares > comments > likes
 * Reach matters only insofar as it translates to one of the above.
 */

import { z } from "zod";
import { router, venueProcedure } from "@/lib/trpc/server";
import { TRPCError } from "@trpc/server";

// ─── SHARED SCHEMA ────────────────────────────────────────────────────────────

// All editable fields on a social_post — used for both insert and update.
// id / venue_id / created_at are server-controlled.
const socialPostFields = z.object({
  platform: z.enum(["instagram", "facebook", "pinterest", "tiktok", "youtube"]),
  posted_at: z.string(), // ISO timestamp — when the post went live
  post_type: z
    .enum(["reel", "static", "story", "carousel", "video", "pin", "board", "other"])
    .default("other"),
  caption:                  z.string().optional(),
  post_url:                 z.string().url().optional(),
  is_reel:                  z.boolean().default(false),
  reach:                    z.number().int().min(0).optional(),
  impressions:              z.number().int().min(0).optional(),
  saves:                    z.number().int().min(0).optional(),
  shares:                   z.number().int().min(0).optional(),
  comments:                 z.number().int().min(0).optional(),
  likes:                    z.number().int().min(0).optional(),
  website_clicks:           z.number().int().min(0).optional(),
  profile_visits_from_post: z.number().int().min(0).optional(),
  // engagement_rate is calculated server-side — accepting it as optional input
  // only for cases where the platform itself reports it and we want to preserve it
  engagement_rate:          z.number().min(0).max(100).optional(),
  is_viral:                 z.boolean().optional(),
  import_source: z
    .enum(["manual", "instagram_api", "facebook_api", "pinterest_api", "csv"])
    .default("manual"),
  raw_metrics: z.record(z.unknown()).optional(),
  notes: z.string().optional(),
});

// ─── ROUTER ───────────────────────────────────────────────────────────────────

export const socialRouter = router({

  // ── 1. GET POSTS ─────────────────────────────────────────────────────────────
  // Fetch social posts for this venue, newest first.
  // Optional filters: platform, date range, pagination.

  getPosts: venueProcedure
    .input(z.object({
      platform: z.string().optional(),
      dateFrom: z.string().optional(), // ISO date string
      dateTo:   z.string().optional(),
      limit:    z.number().int().min(1).max(200).default(50),
      offset:   z.number().int().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      let q = ctx.supabase
        .from("social_posts")
        .select("*")
        .eq("venue_id", ctx.venueId)
        .order("posted_at", { ascending: false })
        .range(input.offset, input.offset + input.limit - 1);

      if (input.platform) {
        q = q.eq("platform", input.platform);
      }
      if (input.dateFrom) {
        q = q.gte("posted_at", input.dateFrom);
      }
      if (input.dateTo) {
        // dateTo is inclusive — advance to end of day if date-only string
        const to = input.dateTo.length === 10
          ? `${input.dateTo}T23:59:59.999Z`
          : input.dateTo;
        q = q.lte("posted_at", to);
      }

      const { data, error } = await q;
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return data ?? [];
    }),


  // ── 2. UPSERT POST ───────────────────────────────────────────────────────────
  // Insert or update a social post.
  // Uniqueness key: (venue_id, platform, posted_at, post_type).
  // If the same post is imported twice the metrics are updated in place.
  //
  // Server-side calculations on every upsert:
  //   - engagement_rate  = (likes + saves + comments + shares) / reach * 100
  //   - is_viral         = reach > 5 000  (reasonable baseline for a small venue)
  //                        OR caller has explicitly set is_viral = true

  upsertPost: venueProcedure
    .input(socialPostFields)
    .mutation(async ({ ctx, input }) => {
      const reach = input.reach ?? 0;

      // Calculate engagement_rate if we have reach data
      const engagementNumerator =
        (input.likes    ?? 0) +
        (input.saves    ?? 0) +
        (input.comments ?? 0) +
        (input.shares   ?? 0);
      const calculatedEngagementRate = reach > 0
        ? Math.round((engagementNumerator / reach) * 10000) / 100  // 2dp
        : (input.engagement_rate ?? null);

      // Auto-flag viral: reach > 5 000 for a small-venue baseline.
      // The venue team can also set is_viral = true manually at any time.
      const isViral = input.is_viral ?? (reach > 5000);

      const row = {
        venue_id:                 ctx.venueId,
        platform:                 input.platform,
        posted_at:                input.posted_at,
        post_type:                input.post_type,
        caption:                  input.caption      ?? null,
        post_url:                 input.post_url     ?? null,
        is_reel:                  input.is_reel,
        reach:                    input.reach        ?? null,
        impressions:              input.impressions   ?? null,
        saves:                    input.saves        ?? null,
        shares:                   input.shares       ?? null,
        comments:                 input.comments     ?? null,
        likes:                    input.likes        ?? null,
        website_clicks:           input.website_clicks           ?? null,
        profile_visits_from_post: input.profile_visits_from_post ?? null,
        engagement_rate:          calculatedEngagementRate,
        is_viral:                 isViral,
        import_source:            input.import_source,
        raw_metrics:              input.raw_metrics  ?? null,
        notes:                    input.notes        ?? null,
        updated_at:               new Date().toISOString(),
      };

      const { data, error } = await ctx.supabase
        .from("social_posts")
        .upsert(row, { onConflict: "venue_id,platform,posted_at,post_type" })
        .select()
        .single();

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return data;
    }),


  // ── 3. DELETE POST ───────────────────────────────────────────────────────────

  deletePost: venueProcedure
    .input(z.object({
      id: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase
        .from("social_posts")
        .delete()
        .eq("id", input.id)
        .eq("venue_id", ctx.venueId); // RLS + explicit venue guard

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { success: true };
    }),


  // ── 4. GET CORRELATION ───────────────────────────────────────────────────────
  // For a single post, calculate whether it spiked inquiries.
  //
  // Method:
  //   A.  Count inquiries in the `windowDays` days AFTER posted_at          (inquiriesAfter)
  //   B.  Count inquiries in the `windowDays` days BEFORE posted_at         (inquiriesBefore)
  //   C.  Count inquiries in the same window, shifted 4 weeks earlier       (seasonalBaseline)
  //   baselineAvg = average of B and C (smooths out seasonal noise)
  //   upliftAbsolute   = inquiriesAfter - baselineAvg
  //   upliftMultiplier = inquiriesAfter / baselineAvg (null if baseline = 0)
  //   hasSignal        = inquiriesAfter > baselineAvg * 1.5
  //                      (50% above baseline is a meaningful signal for a low-volume business)
  //
  // Limitations:
  //   - Correlation, not causation. A viral reel and a bridal show on the same weekend
  //     will both appear to spike inquiries.
  //   - Small venues receive few inquiries/month — single-digit differences can look like
  //     huge multipliers. Always read upliftAbsolute alongside upliftMultiplier.

  getCorrelation: venueProcedure
    .input(z.object({
      postId:     z.string().uuid(),
      windowDays: z.number().int().min(1).max(90).default(14),
    }))
    .query(async ({ ctx, input }) => {
      // Fetch the post
      const { data: post, error: postError } = await ctx.supabase
        .from("social_posts")
        .select("id, posted_at, platform, post_type, reach, is_viral")
        .eq("id", input.postId)
        .eq("venue_id", ctx.venueId)
        .single();

      if (postError || !post) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Post not found or not accessible." });
      }

      const postedAt = new Date(post.posted_at);
      const windowMs = input.windowDays * 24 * 60 * 60 * 1000;

      // ── Window boundaries ──────────────────────────────────────────────────
      // A: post window — the days right after posting
      const afterStart  = postedAt.toISOString();
      const afterEnd    = new Date(postedAt.getTime() + windowMs).toISOString();

      // B: pre-post window — same length, ending at posted_at
      const beforeStart = new Date(postedAt.getTime() - windowMs).toISOString();
      const beforeEnd   = postedAt.toISOString();

      // C: seasonal baseline — same window shifted 4 weeks earlier
      const fourWeeksMs      = 28 * 24 * 60 * 60 * 1000;
      const seasonalStart    = new Date(postedAt.getTime() - fourWeeksMs).toISOString();
      const seasonalEnd      = new Date(postedAt.getTime() - fourWeeksMs + windowMs).toISOString();

      // ── Fetch inquiry counts in parallel ──────────────────────────────────
      // Supabase doesn't support COUNT directly via the JS client without a
      // workaround. We use { count: "exact", head: true } to get just the
      // count without fetching rows.
      const [afterResult, beforeResult, seasonalResult] = await Promise.all([
        ctx.supabase
          .from("inquiries")
          .select("id", { count: "exact", head: true })
          .eq("venue_id", ctx.venueId)
          .gte("created_at", afterStart)
          .lt("created_at", afterEnd),

        ctx.supabase
          .from("inquiries")
          .select("id", { count: "exact", head: true })
          .eq("venue_id", ctx.venueId)
          .gte("created_at", beforeStart)
          .lt("created_at", beforeEnd),

        ctx.supabase
          .from("inquiries")
          .select("id", { count: "exact", head: true })
          .eq("venue_id", ctx.venueId)
          .gte("created_at", seasonalStart)
          .lt("created_at", seasonalEnd),
      ]);

      if (afterResult.error)    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: afterResult.error.message });
      if (beforeResult.error)   throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: beforeResult.error.message });
      if (seasonalResult.error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: seasonalResult.error.message });

      const inquiriesAfter    = afterResult.count    ?? 0;
      const inquiriesBefore   = beforeResult.count   ?? 0;
      const seasonalBaseline  = seasonalResult.count ?? 0;

      // Average of the two baselines to smooth seasonal noise
      const baselineAvg = (inquiriesBefore + seasonalBaseline) / 2;

      const upliftAbsolute   = inquiriesAfter - baselineAvg;
      const upliftMultiplier = baselineAvg > 0
        ? Math.round((inquiriesAfter / baselineAvg) * 100) / 100
        : null;

      // 50% above baseline = signal. Low bar intentional — venues see few inquiries
      // per week, so even +2 above a baseline of 3 is worth surfacing.
      const hasSignal = inquiriesAfter > baselineAvg * 1.5;

      return {
        postId:            post.id,
        postedAt:          post.posted_at,
        platform:          post.platform,
        postType:          post.post_type,
        reach:             post.reach,
        windowDays:        input.windowDays,
        // After-window
        inquiriesAfter,
        // Baselines
        inquiriesBefore,
        seasonalBaseline,
        baselineAvg:       Math.round(baselineAvg * 100) / 100,
        // Derived
        upliftAbsolute:    Math.round(upliftAbsolute * 100) / 100,
        upliftMultiplier,
        hasSignal,
      };
    }),


  // ── 5. GET VENUE CORRELATION SUMMARY ─────────────────────────────────────────
  // For all posts in the last 12 months, run the correlation logic across the board
  // and return a ranked summary grouped by platform and post_type.
  //
  // This answers: "Over the past year, which type of content has most reliably
  // produced inquiry spikes?"
  //
  // Approach:
  //   - Fetch all posts in the last 12 months for this venue
  //   - For each post, count inquiries in the 14-day window after posting
  //     and calculate a simple pre-post baseline (14 days before)
  //   - Group by platform + post_type
  //   - Return ranked by avgUpliftMultiplier desc
  //
  // Note: We use 14 days as the fixed window for the summary (not configurable)
  // because it's the most actionable default for a business with a ~2-week
  // consideration-to-inquiry cycle for wedding venues.

  getVenueCorrelationSummary: venueProcedure
    .query(async ({ ctx }) => {
      const twelveMonthsAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
      const windowDays = 14;
      const windowMs   = windowDays * 24 * 60 * 60 * 1000;

      // Fetch all posts in last 12 months
      const { data: posts, error: postsError } = await ctx.supabase
        .from("social_posts")
        .select("id, platform, post_type, posted_at, reach")
        .eq("venue_id", ctx.venueId)
        .gte("posted_at", twelveMonthsAgo)
        .order("posted_at", { ascending: false });

      if (postsError) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: postsError.message });
      if (!posts || posts.length === 0) return [];

      // Fetch all inquiries in the broadest possible window we'll need
      // (12 months + 14 days either side) so we can do all the counting
      // in memory rather than firing N+1 queries.
      const windowBuffer    = windowDays * 24 * 60 * 60 * 1000;
      const earliestNeeded  = new Date(Date.parse(twelveMonthsAgo) - windowBuffer).toISOString();
      const latestNeeded    = new Date(Date.now() + windowBuffer).toISOString();

      const { data: inquiries, error: inquiriesError } = await ctx.supabase
        .from("inquiries")
        .select("created_at")
        .eq("venue_id", ctx.venueId)
        .gte("created_at", earliestNeeded)
        .lte("created_at", latestNeeded);

      if (inquiriesError) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: inquiriesError.message });

      // Convert inquiry timestamps to ms for fast comparison
      const inquiryTimes: number[] = (inquiries ?? []).map(i => Date.parse(i.created_at));

      // ── Per-post correlation calculation (in memory) ───────────────────────
      // Group results: { "instagram|reel": { ... } }
      const groups = new Map<string, {
        platform:         string;
        postType:         string;
        postCount:        number;
        totalMultiplier:  number;  // sum — divide by postCount for average
        postsWithSignal:  number;
        totalReach:       number;
        reachCount:       number;  // how many posts have reach data
      }>();

      for (const post of posts) {
        const postedMs     = Date.parse(post.posted_at);
        const afterStart   = postedMs;
        const afterEnd     = postedMs + windowMs;
        const beforeStart  = postedMs - windowMs;
        const beforeEnd    = postedMs;

        const inquiriesAfter  = inquiryTimes.filter(t => t >= afterStart  && t < afterEnd).length;
        const inquiriesBefore = inquiryTimes.filter(t => t >= beforeStart && t < beforeEnd).length;

        // Simple baseline: just the pre-post window (no seasonal shift in the
        // summary to keep it fast — seasonal is available in getCorrelation)
        const baselineAvg     = inquiriesBefore;
        const upliftMultiplier = baselineAvg > 0
          ? inquiriesAfter / baselineAvg
          : (inquiriesAfter > 0 ? inquiriesAfter : 0); // treat zero-baseline with signals as raw count
        const hasSignal = inquiriesAfter > baselineAvg * 1.5;

        const key = `${post.platform}|${post.post_type}`;
        if (!groups.has(key)) {
          groups.set(key, {
            platform:        post.platform,
            postType:        post.post_type,
            postCount:       0,
            totalMultiplier: 0,
            postsWithSignal: 0,
            totalReach:      0,
            reachCount:      0,
          });
        }

        const g = groups.get(key)!;
        g.postCount++;
        g.totalMultiplier += upliftMultiplier;
        if (hasSignal) g.postsWithSignal++;
        if (post.reach != null) {
          g.totalReach += post.reach;
          g.reachCount++;
        }
      }

      // ── Build output — ranked by avgUpliftMultiplier desc ─────────────────
      const summary = Array.from(groups.values())
        .map(g => ({
          platform:             g.platform,
          postType:             g.postType,
          postCount:            g.postCount,
          avgUpliftMultiplier:  Math.round((g.totalMultiplier / g.postCount) * 100) / 100,
          postsWithSignal:      g.postsWithSignal,
          avgReach:             g.reachCount > 0
            ? Math.round(g.totalReach / g.reachCount)
            : null,
        }))
        .sort((a, b) => b.avgUpliftMultiplier - a.avgUpliftMultiplier);

      return summary;
    }),


  // ── 6. SYNC INSTAGRAM (STUB) ─────────────────────────────────────────────────
  // TODO: Implement Instagram Graph API sync.
  //
  // Requirements to make this real:
  //   1. The venue must connect a Facebook Business account and grant permissions:
  //      instagram_basic, instagram_manage_insights, pages_show_list, pages_read_engagement
  //   2. Exchange short-lived token → long-lived token (60-day expiry)
  //      POST https://graph.facebook.com/v19.0/oauth/access_token
  //   3. Get the linked Instagram Business Account ID:
  //      GET /me/accounts → /PAGE_ID?fields=instagram_business_account
  //   4. Fetch media objects:
  //      GET /IG_USER_ID/media?fields=id,timestamp,media_type,caption,permalink,
  //            like_count,comments_count&since=...
  //   5. For each media object, fetch insights:
  //      GET /MEDIA_ID/insights?metric=reach,impressions,saved,shares,
  //            video_views,website_clicks,profile_visits
  //   6. Upsert into social_posts via the upsertPost procedure above.
  //
  // Blockers:
  //   - Instagram API requires a verified Facebook Business Portfolio.
  //   - insights endpoint is only available for Business/Creator accounts.
  //   - Story insights expire after 24 hours — must sync daily.
  //   - Rate limits: 200 calls/hour per token; batch where possible.
  //
  // For now, enter posts manually. The data model is ready for the API.

  syncInstagram: venueProcedure
    .input(z.object({
      accessToken: z.string(),
    }))
    .mutation(async ({ input: _input }) => {
      return {
        message: "Instagram API sync not yet implemented — enter posts manually for now",
      };
    }),

});
