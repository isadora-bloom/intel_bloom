import { z } from "zod";
import { router, venueProcedure } from "@/lib/trpc/server";
import { TRPCError } from "@trpc/server";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── GOOGLE PLACES API ─────────────────────────────────────────────────────────

async function fetchGoogleReviews(placeId: string): Promise<any[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "GOOGLE_PLACES_API_KEY not configured" });

  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=reviews,rating,user_ratings_total&key=${apiKey}&reviews_sort=newest`;
  const res = await fetch(url);
  if (!res.ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Google Places API error" });

  const data = await res.json();
  if (data.status !== "OK") {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Google Places: ${data.status} — ${data.error_message ?? ""}` });
  }

  return data.result?.reviews ?? [];
}

// ── THE KNOT SCRAPE + CLAUDE EXTRACT ─────────────────────────────────────────

async function scrapeKnotReviews(profileUrl: string): Promise<Array<{
  reviewer: string;
  rating: number;
  text: string;
  date: string | null;
  weddingDate: string | null;
}>> {
  // Fetch the public Knot profile page
  const res = await fetch(profileUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" },
  });
  if (!res.ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Could not fetch The Knot page (${res.status})` });

  const html = await res.text();
  // Strip scripts/styles, keep readable text
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60000); // cap for token limits

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4000,
    messages: [{
      role: "user",
      content: `Extract ALL reviews from this scraped wedding venue page text.

For each review extract:
- reviewer: reviewer's name (first name or full name as shown)
- rating: star rating as a number 1-5
- text: the full review text verbatim
- date: date review was posted (ISO YYYY-MM-DD if you can determine it, otherwise null)
- weddingDate: wedding date mentioned in the review text (ISO YYYY-MM-DD if parseable, otherwise null)

Return a JSON array. If no reviews found, return [].

Page text:
${text}

Return ONLY the JSON array, no other text.`,
    }],
  });

  const raw = response.content[0].type === "text" ? response.content[0].text : "[]";
  try {
    const match = raw.match(/\[[\s\S]*\]/);
    return JSON.parse(match?.[0] ?? "[]");
  } catch {
    return [];
  }
}

// ── AUTO-MATCH REVIEW TO CLIENT ───────────────────────────────────────────────

async function tryMatchReview(
  supabase: any,
  venueId: string,
  reviewerName: string | null,
  weddingDate: string | null,
  reviewDate: string | null
): Promise<{ clientId: string; confidence: number } | null> {
  if (!reviewerName && !weddingDate) return null;

  const firstName = reviewerName?.trim().split(/\s+/)[0]?.toLowerCase();

  const queries: Promise<any>[] = [];

  // Match by wedding date + first name prefix
  if (weddingDate && firstName) {
    queries.push(
      supabase
        .from("clients")
        .select("id, name_primary")
        .eq("venue_id", venueId)
        .eq("event_date", weddingDate)
        .ilike("name_primary", `${firstName.slice(0, 3)}%`)
        .limit(3)
    );
  }

  // Match by first name near review date (±90 days of event_date)
  if (firstName && reviewDate) {
    const d = new Date(reviewDate);
    const from = new Date(d); from.setFullYear(from.getFullYear() - 1);
    const to = new Date(d); to.setMonth(to.getMonth() + 3);
    queries.push(
      supabase
        .from("clients")
        .select("id, name_primary, event_date")
        .eq("venue_id", venueId)
        .gte("event_date", from.toISOString().split("T")[0])
        .lte("event_date", to.toISOString().split("T")[0])
        .ilike("name_primary", `${firstName.slice(0, 3)}%`)
        .limit(5)
    );
  }

  if (queries.length === 0) return null;
  const results = await Promise.all(queries);

  // Wedding date match is strong (80 confidence)
  if (results[0]?.data?.length > 0) {
    return { clientId: results[0].data[0].id, confidence: 80 };
  }
  // Name-near-date match is weaker (50)
  if (results[1]?.data?.length === 1) {
    return { clientId: results[1].data[0].id, confidence: 50 };
  }

  return null;
}

// ── ROUTER ────────────────────────────────────────────────────────────────────

export const reviewsRouter = router({
  // List all venue reviews — paginated
  list: venueProcedure
    .input(z.object({
      platform: z.string().optional(),
      matchStatus: z.enum(["matched", "unmatched", "all"]).default("all"),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      let query = ctx.supabase
        .from("reviews")
        .select("*, matched_client:clients(id, name_primary, name_partner, event_date)", { count: "exact" })
        .eq("venue_id", ctx.venueId)
        .order("review_date", { ascending: false, nullsFirst: false })
        .range(input.offset, input.offset + input.limit - 1);

      if (input.platform) query = query.eq("platform", input.platform);
      if (input.matchStatus === "matched") query = query.not("matched_client_id", "is", null);
      if (input.matchStatus === "unmatched") query = query.is("matched_client_id", null);

      const { data, error, count } = await query;
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { reviews: data ?? [], total: count ?? 0 };
    }),

  // Sync reviews from Google Places API
  syncGoogle: venueProcedure
    .mutation(async ({ ctx }) => {
      const { data: venue } = await ctx.supabase
        .from("venues")
        .select("google_place_id")
        .eq("id", ctx.venueId)
        .single();

      if (!venue?.google_place_id) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Google Place ID not set. Add it in Settings → Integrations." });
      }

      const googleReviews = await fetchGoogleReviews(venue.google_place_id);

      let synced = 0;
      let matched = 0;

      for (const r of googleReviews) {
        const reviewDate = r.time ? new Date(r.time * 1000).toISOString().split("T")[0] : null;
        const reviewerName = r.author_name ?? null;

        // Try to match to a client
        const matchResult = await tryMatchReview(ctx.supabase, ctx.venueId, reviewerName, null, reviewDate);

        const { error } = await ctx.supabase
          .from("reviews")
          .upsert({
            venue_id: ctx.venueId,
            platform: "google",
            platform_review_id: r.time?.toString() ?? `google-${synced}`,
            platform_url: r.author_url ?? null,
            reviewer_name: reviewerName,
            rating: r.rating ?? null,
            review_text: r.text ?? null,
            review_date: reviewDate,
            matched_client_id: matchResult?.clientId ?? null,
            match_confidence: matchResult?.confidence ?? null,
            match_status: matchResult ? "auto_matched" : "unmatched",
            import_source: "google_api",
          }, { onConflict: "venue_id,platform,platform_review_id", ignoreDuplicates: false });

        if (!error) {
          synced++;
          if (matchResult) matched++;
        }
      }

      // Back-fill review fields on matched clients
      const { data: matchedReviews } = await ctx.supabase
        .from("reviews")
        .select("matched_client_id, rating, review_text, review_date")
        .eq("venue_id", ctx.venueId)
        .eq("platform", "google")
        .not("matched_client_id", "is", null);

      for (const rev of matchedReviews ?? []) {
        await ctx.supabase
          .from("clients")
          .update({
            review_left: true,
            review_platform: "Google",
            review_star_rating: rev.rating,
            review_text: rev.review_text ?? undefined,
          })
          .eq("id", rev.matched_client_id)
          .is("review_star_rating", null); // only if not already set
      }

      return { synced, matched, total: googleReviews.length };
    }),

  // Sync reviews from The Knot (scrape + Claude extract)
  syncKnot: venueProcedure
    .input(z.object({ profileUrl: z.string().url() }))
    .mutation(async ({ ctx, input }) => {
      const reviews = await scrapeKnotReviews(input.profileUrl);

      let synced = 0;
      let matched = 0;

      for (let i = 0; i < reviews.length; i++) {
        const r = reviews[i];
        if (!r.text) continue;

        const matchResult = await tryMatchReview(
          ctx.supabase, ctx.venueId,
          r.reviewer ?? null,
          r.weddingDate ?? null,
          r.date ?? null
        );

        const { error } = await ctx.supabase
          .from("reviews")
          .upsert({
            venue_id: ctx.venueId,
            platform: "the_knot",
            platform_review_id: `knot-${r.reviewer ?? i}-${r.date ?? i}`,
            platform_url: input.profileUrl,
            reviewer_name: r.reviewer ?? null,
            rating: r.rating ?? null,
            review_text: r.text,
            review_date: r.date ?? null,
            wedding_date_mentioned: r.weddingDate ?? null,
            matched_client_id: matchResult?.clientId ?? null,
            match_confidence: matchResult?.confidence ?? null,
            match_status: matchResult ? "auto_matched" : "unmatched",
            import_source: "scrape",
          }, { onConflict: "venue_id,platform,platform_review_id", ignoreDuplicates: false });

        if (!error) {
          synced++;
          if (matchResult) matched++;
        }
      }

      // Back-fill client review fields for high-confidence matches
      const { data: matchedReviews } = await ctx.supabase
        .from("reviews")
        .select("matched_client_id, rating, review_text, review_date")
        .eq("venue_id", ctx.venueId)
        .eq("platform", "the_knot")
        .not("matched_client_id", "is", null);

      for (const rev of matchedReviews ?? []) {
        await ctx.supabase
          .from("clients")
          .update({
            review_left: true,
            review_platform: "The Knot",
            review_star_rating: rev.rating,
            review_text: rev.review_text ?? undefined,
          })
          .eq("id", rev.matched_client_id)
          .is("review_star_rating", null);
      }

      return { synced, matched, total: reviews.length };
    }),

  // Manually link a review to a client
  matchToClient: venueProcedure
    .input(z.object({
      reviewId: z.string().uuid(),
      clientId: z.string().uuid().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { data: review, error: fetchError } = await ctx.supabase
        .from("reviews")
        .select("rating, review_text, platform")
        .eq("id", input.reviewId)
        .eq("venue_id", ctx.venueId)
        .single();

      if (fetchError || !review) throw new TRPCError({ code: "NOT_FOUND" });

      await ctx.supabase
        .from("reviews")
        .update({
          matched_client_id: input.clientId,
          match_status: input.clientId ? "matched" : "unmatched",
          match_confidence: input.clientId ? 100 : null,
        })
        .eq("id", input.reviewId);

      // Update client's review fields if linking
      if (input.clientId && review.rating) {
        await ctx.supabase
          .from("clients")
          .update({
            review_left: true,
            review_platform: review.platform === "google" ? "Google" : review.platform === "the_knot" ? "The Knot" : review.platform,
            review_star_rating: review.rating,
            review_text: review.review_text ?? undefined,
          })
          .eq("id", input.clientId)
          .is("review_star_rating", null);
      }

      return { ok: true };
    }),

  // Run Claude analysis on all unanalyzed reviews — extract themes + standout phrases
  analyzeLanguage: venueProcedure
    .mutation(async ({ ctx }) => {
      const { data: reviews } = await ctx.supabase
        .from("reviews")
        .select("id, review_text, rating")
        .eq("venue_id", ctx.venueId)
        .not("review_text", "is", null)
        .is("analysis_run_at", null)
        .limit(50);

      if (!reviews || reviews.length === 0) return { analyzed: 0 };

      const prompt = `You are analyzing wedding venue reviews to extract reusable language and themes.

For each review, extract:
- themes: array of 1-4 relevant themes from: coordinator, space, flexibility, value, experience, process, pets, exclusivity, food_catering, accommodation, ceremony, other
- standout_phrases: array of 1-3 verbatim phrases (5-15 words each) that are memorable and could be used in marketing or sales
- sentiment_score: number -1.0 to 1.0
- concerns_mentioned: array of any negatives/caveats mentioned (empty array if none)

Reviews:
${reviews.map((r, i) => `[${i}] Rating: ${r.rating}/5\n${r.review_text}`).join("\n\n---\n\n")}

Return a JSON array of exactly ${reviews.length} objects:
[{ "themes": [], "standout_phrases": [], "sentiment_score": 0.0, "concerns_mentioned": [] }, ...]`;

      const response = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 3000,
        messages: [{ role: "user", content: prompt }],
      });

      const text = response.content[0].type === "text" ? response.content[0].text : "[]";
      const parsed = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? "[]");
      const now = new Date().toISOString();

      for (let i = 0; i < reviews.length; i++) {
        const analysis = parsed[i];
        if (!analysis) continue;

        await ctx.supabase
          .from("reviews")
          .update({
            themes: analysis.themes ?? [],
            standout_phrases: analysis.standout_phrases ?? [],
            sentiment_score: analysis.sentiment_score ?? null,
            concerns_mentioned: analysis.concerns_mentioned ?? [],
            analysis_run_at: now,
          })
          .eq("id", reviews[i].id);

        // Upsert standout phrases into review_language
        for (const phrase of analysis.standout_phrases ?? []) {
          await ctx.supabase
            .from("review_language")
            .upsert({
              venue_id: ctx.venueId,
              phrase,
              theme: analysis.themes?.[0] ?? "other",
              frequency: 1,
              avg_rating: reviews[i].rating,
              source_review_ids: [reviews[i].id],
            }, { onConflict: "venue_id,phrase", ignoreDuplicates: true });
        }
      }

      return { analyzed: reviews.length };
    }),

  // Stats summary for dashboard widget
  summary: venueProcedure.query(async ({ ctx }) => {
    const { data } = await ctx.supabase
      .from("reviews")
      .select("rating, platform, review_date, matched_client_id")
      .eq("venue_id", ctx.venueId);

    if (!data || data.length === 0) return { total: 0, avgRating: null, byPlatform: {}, recentCount: 0 };

    const total = data.length;
    const withRating = data.filter((r) => r.rating !== null);
    const avgRating = withRating.length > 0
      ? withRating.reduce((s, r) => s + r.rating, 0) / withRating.length
      : null;

    const byPlatform: Record<string, number> = {};
    for (const r of data) {
      byPlatform[r.platform] = (byPlatform[r.platform] ?? 0) + 1;
    }

    const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 1);
    const recentCount = data.filter((r) => r.review_date && new Date(r.review_date) >= cutoff).length;

    return { total, avgRating, byPlatform, recentCount };
  }),
});
