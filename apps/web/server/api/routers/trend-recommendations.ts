import { z } from "zod";
import { router, venueProcedure } from "@/lib/trpc/server";
import { TRPCError } from "@trpc/server";
import { callAIJson } from "@/lib/ai";

/**
 * Trend-based recommendations engine.
 * Connects search trends → venue positioning → actionable suggestions.
 *
 * The insight: what couples search for TODAY tells you how to position your
 * venue for inquiries 3-12 months from now. Rising "garden wedding" searches
 * mean updating website copy, hero images, and social content NOW.
 */

// Wedding style/theme terms to track nationally + locally
const STYLE_TERMS = [
  "garden wedding",
  "woodland wedding",
  "intimate wedding",
  "outdoor wedding",
  "barn wedding",
  "estate wedding",
  "mountain wedding",
  "rustic wedding",
  "elegant wedding",
  "boho wedding",
  "micro wedding",
  "destination wedding",
  "fall wedding",
  "spring wedding",
  "summer wedding",
  "winter wedding",
];

// Season-to-search mapping: what people search in month X → what they're booking for
const SEARCH_TO_BOOKING_LAG: Record<string, string> = {
  "fall wedding": "Couples searching now are booking for Sep–Nov. Feature fall foliage and golden hour in your gallery.",
  "spring wedding": "Couples searching now are booking for Apr–Jun. Highlight blooming gardens and mild weather.",
  "summer wedding": "Couples searching now are booking for Jun–Aug. Show outdoor ceremonies and sunset receptions.",
  "winter wedding": "Couples searching now are booking for Nov–Feb. Feature cozy indoor settings, fireplaces, holiday decor.",
  "garden wedding": "Garden/outdoor interest is rising. Lead with your grounds, ceremony lawn, and outdoor cocktail hour photos.",
  "woodland wedding": "Woodland/forest aesthetic is trending. If you have trees, trails, or natural settings — put them front and center.",
  "intimate wedding": "Intimate/micro wedding interest is up. Consider promoting smaller packages and exclusive-use options.",
  "barn wedding": "Barn/rustic interest remains strong. Lean into exposed beams, farm tables, string lights in your content.",
  "boho wedding": "Bohemian style is trending. Feature loose florals, macramé, and natural textures in your social content.",
  "micro wedding": "Micro wedding searches are rising. This is a pricing opportunity — premium per-person with exclusive experience.",
};

export const trendRecommendationsRouter = router({
  // Get actionable recommendations based on current search trends
  getRecommendations: venueProcedure.query(async ({ ctx }) => {
    const { data: venue } = await ctx.db
      .from("venues")
      .select("google_trends_metro, trends_custom_terms, name")
      .eq("id", ctx.venueId)
      .single();

    if (!venue?.google_trends_metro) {
      return { recommendations: [], trendsAvailable: false };
    }

    const metro = venue.google_trends_metro;

    // Get recent trend data for style terms
    const eightWeeksAgo = new Date(Date.now() - 56 * 86400000).toISOString().split("T")[0];
    const sixteenWeeksAgo = new Date(Date.now() - 112 * 86400000).toISOString().split("T")[0];

    const { data: recentTrends } = await ctx.db
      .from("macro_search_trends")
      .select("term, week_start, relative_interest")
      .eq("geo", metro)
      .gte("week_start", sixteenWeeksAgo)
      .order("week_start", { ascending: false });

    // Also get national trends for comparison
    const { data: nationalTrends } = await ctx.db
      .from("macro_search_trends")
      .select("term, week_start, relative_interest")
      .eq("geo", "US")
      .gte("week_start", sixteenWeeksAgo)
      .order("week_start", { ascending: false });

    if (!recentTrends || recentTrends.length === 0) {
      return { recommendations: [], trendsAvailable: false };
    }

    // Calculate trend direction for each term
    interface TrendSignal {
      term: string;
      recentAvg: number;
      priorAvg: number;
      changePct: number;
      direction: "rising" | "falling" | "stable";
      nationalAvg: number | null;
      localVsNational: number | null; // % difference
    }

    const signals: TrendSignal[] = [];

    const allTerms = [...new Set(recentTrends.map(r => r.term))];

    for (const term of allTerms) {
      const termRows = recentTrends.filter(r => r.term === term);
      const recent = termRows.filter(r => r.week_start >= eightWeeksAgo);
      const prior = termRows.filter(r => r.week_start < eightWeeksAgo);

      if (recent.length < 2) continue;

      const recentAvg = recent.reduce((s, r) => s + r.relative_interest, 0) / recent.length;
      const priorAvg = prior.length > 0
        ? prior.reduce((s, r) => s + r.relative_interest, 0) / prior.length
        : recentAvg;

      const changePct = priorAvg > 0 ? Math.round(((recentAvg - priorAvg) / priorAvg) * 100) : 0;

      // National comparison
      const natRows = (nationalTrends ?? []).filter(r => r.term === term && r.week_start >= eightWeeksAgo);
      const nationalAvg = natRows.length > 0
        ? natRows.reduce((s, r) => s + r.relative_interest, 0) / natRows.length
        : null;
      const localVsNational = nationalAvg && nationalAvg > 0
        ? Math.round(((recentAvg - nationalAvg) / nationalAvg) * 100)
        : null;

      signals.push({
        term,
        recentAvg: Math.round(recentAvg),
        priorAvg: Math.round(priorAvg),
        changePct,
        direction: changePct > 10 ? "rising" : changePct < -10 ? "falling" : "stable",
        nationalAvg: nationalAvg ? Math.round(nationalAvg) : null,
        localVsNational,
      });
    }

    // Sort by absolute change — biggest movers first
    signals.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));

    // Generate recommendations
    const recommendations: Array<{
      type: "website" | "gallery" | "social" | "pricing" | "content";
      priority: "high" | "medium" | "low";
      headline: string;
      body: string;
      searchTerm: string;
      changePct: number;
      direction: string;
    }> = [];

    for (const signal of signals) {
      if (signal.direction === "stable") continue;

      const context = SEARCH_TO_BOOKING_LAG[signal.term];

      if (signal.direction === "rising" && signal.changePct > 15) {
        recommendations.push({
          type: STYLE_TERMS.some(s => signal.term.includes("wedding")) ? "website" : "content",
          priority: signal.changePct > 30 ? "high" : "medium",
          headline: `"${signal.term}" searches up ${signal.changePct}% in your area`,
          body: context ?? `Interest in "${signal.term}" is rising in ${metro}. Consider updating your website and social content to align with this trend.`,
          searchTerm: signal.term,
          changePct: signal.changePct,
          direction: "rising",
        });
      }

      if (signal.direction === "falling" && signal.changePct < -20) {
        recommendations.push({
          type: "content",
          priority: "low",
          headline: `"${signal.term}" interest declining (${signal.changePct}%)`,
          body: `Search interest for "${signal.term}" has dropped in your area. If this is a key positioning term for your venue, consider diversifying your messaging.`,
          searchTerm: signal.term,
          changePct: signal.changePct,
          direction: "falling",
        });
      }

      // Local vs national divergence
      if (signal.localVsNational !== null && Math.abs(signal.localVsNational) > 25) {
        const local = signal.localVsNational > 0 ? "hotter" : "cooler";
        recommendations.push({
          type: "content",
          priority: "medium",
          headline: `"${signal.term}" is ${Math.abs(signal.localVsNational)}% ${local} in your market vs national`,
          body: signal.localVsNational > 0
            ? `Your local market shows stronger interest in "${signal.term}" than the national average. This is a local advantage — lean into it.`
            : `National interest in "${signal.term}" is higher than your local market. If you're competing for destination couples, this matters.`,
          searchTerm: signal.term,
          changePct: signal.localVsNational,
          direction: local,
        });
      }
    }

    // Seasonal recommendation based on current month
    const currentMonth = new Date().getMonth(); // 0-11
    const seasonalRecs: Record<number, string> = {
      0: "January: engagement season is ending. Couples who got engaged in Nov-Dec are now venue shopping. Your inquiry volume should be climbing.",
      1: "February: peak venue search month. Make sure your website loads fast, gallery is updated, and inquiry response time is under 15 minutes.",
      2: "March: couples booking fall weddings are looking now. Feature October/November imagery prominently.",
      3: "April: summer wedding searches peak. Lead with outdoor ceremony photos and warm-weather content.",
      4: "May: couples are booking for next spring/summer. This is when 12-month-out planners commit. Your hold-to-contract follow-up matters most this month.",
      5: "June: wedding season is live — your team is busy. But couples planning 2027 are searching now. Don't let inquiry response slip.",
      6: "July: search volume dips (couples are attending weddings, not planning). Good month to update your website and gallery.",
      7: "August: fall booking inquiries arrive. Feature harvest themes, golden light, and cooler-weather comfort in your content.",
      8: "September: engagement season is about to start. Prepare for the Nov-Jan inquiry surge by refreshing your response templates.",
      9: "October: prime engagement month begins. Your venue should look its absolute best online right now — this is first-impression season.",
      10: "November: Thanksgiving proposals incoming. December will bring your biggest inquiry spike. Make sure your calendar for next year is updated.",
      11: "December: holiday proposals = January inquiry flood. Pre-load your Sage auto-replies and ensure tour availability is visible.",
    };

    if (seasonalRecs[currentMonth]) {
      recommendations.unshift({
        type: "content",
        priority: "high",
        headline: "Seasonal positioning",
        body: seasonalRecs[currentMonth],
        searchTerm: "seasonal",
        changePct: 0,
        direction: "seasonal",
      });
    }

    return {
      recommendations: recommendations.slice(0, 8), // Cap at 8 recommendations
      signals: signals.slice(0, 12),
      trendsAvailable: true,
      metro,
    };
  }),

  // AI-generated headline and gallery suggestions based on trends + reviews
  getSuggestedPositioning: venueProcedure.query(async ({ ctx }) => {
    // Pull top review themes + rising search terms
    const [{ data: phrases }, { data: trends }] = await Promise.all([
      ctx.db
        .from("review_language")
        .select("phrase, theme, frequency_count, avg_rating")
        .eq("venue_id", ctx.venueId)
        .order("frequency_count", { ascending: false })
        .limit(20),
      ctx.db
        .from("macro_search_trends")
        .select("term, relative_interest")
        .eq("geo", "US")
        .gte("week_start", new Date(Date.now() - 28 * 86400000).toISOString().split("T")[0])
        .order("relative_interest", { ascending: false })
        .limit(20),
    ]);

    if ((!phrases || phrases.length === 0) && (!trends || trends.length === 0)) {
      return null;
    }

    const topPhrases = (phrases ?? []).slice(0, 10).map(p => `"${p.phrase}" (theme: ${p.theme}, mentioned ${p.frequency_count}x)`).join("\n");
    const topTrends = (trends ?? []).slice(0, 10).map(t => `"${t.term}" (interest: ${t.relative_interest}/100)`).join("\n");

    const result = await callAIJson<{
      suggestedHeadline: string;
      suggestedSubheadline: string;
      galleryOrder: string[];
      socialContentIdeas: string[];
      reasoning: string;
    }>(
      `You are a wedding venue marketing advisor. Based on what real couples say about this venue and current search trends, suggest positioning updates.

WHAT COUPLES SAY (from reviews):
${topPhrases || "No review data yet"}

WHAT COUPLES ARE SEARCHING FOR:
${topTrends || "No trend data yet"}

Suggest:
1. A website headline (8-12 words) that connects what couples love about the venue with what they're searching for
2. A subheadline (15-25 words) that expands on the headline
3. Gallery image order priorities (list 5 types of images that should be featured prominently)
4. 3 social media content ideas that align with trending terms
5. Brief reasoning (2-3 sentences)

Return JSON:
{
  "suggestedHeadline": "...",
  "suggestedSubheadline": "...",
  "galleryOrder": ["ceremony lawn", "sunset reception", ...],
  "socialContentIdeas": ["Behind-the-scenes garden setup timelapse", ...],
  "reasoning": "..."
}`,
      { taskType: "positioning_suggestion", venueId: ctx.venueId, maxTokens: 800 }
    );

    return result;
  }),
});
