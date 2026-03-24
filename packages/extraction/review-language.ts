/**
 * Review Language Extraction
 *
 * Reads all reviews for a venue, extracts phrases and themes,
 * and writes them to review_language for use by Sage and marketing copy.
 *
 * Run: after new reviews are added, or on a weekly cron.
 */

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const THEMES = [
  "coordinator",
  "space",
  "flexibility",
  "value",
  "experience",
  "process",
  "pets",
  "exclusivity",
  "food_catering",
  "accommodation",
  "ceremony",
  "other",
] as const;

type Theme = typeof THEMES[number];

interface ExtractedPhrase {
  phrase: string;
  theme: Theme;
  verbatim: boolean; // true = exact quote, false = paraphrased
}

interface ReviewAnalysis {
  phrases: ExtractedPhrase[];
  themes: Theme[];
  sentiment_score: number; // -1.0 to 1.0
  standout_phrases: string[];
  concerns_mentioned: string[];
  wedding_date_mentioned: string | null;
}

async function analyseReview(reviewText: string, reviewerName: string | null): Promise<ReviewAnalysis> {
  const prompt = `You are analysing a wedding venue review to extract language that can be reused in sales responses and marketing copy.

Review from ${reviewerName ?? "anonymous"}:
"${reviewText}"

Extract the following as JSON:
{
  "phrases": [
    // Verbatim phrases or close paraphrases worth reusing in sales copy
    // Focus on: emotional language, specific features praised, outcomes described
    // Each phrase should be 5–20 words, natural-sounding, usable in context
    { "phrase": "...", "theme": "coordinator|space|flexibility|value|experience|process|pets|exclusivity|food_catering|accommodation|ceremony|other", "verbatim": true/false }
  ],
  "themes": ["array of theme keys mentioned in this review"],
  "sentiment_score": -1.0 to 1.0,
  "standout_phrases": ["1–3 especially powerful quotes, verbatim, that could be used as testimonials"],
  "concerns_mentioned": ["any negatives, caveats, or constructive feedback mentioned"],
  "wedding_date_mentioned": "YYYY-MM-DD if they mention their wedding date, otherwise null"
}

Rules:
- Only extract phrases that sound natural coming from a real couple, not marketing language
- Prioritise specific and emotional over generic ("Isadora kept us completely calm" > "great coordinator")
- If they mention pets, extract that language even if brief
- Concerns are valuable — extract honestly, don't skip them
- Return valid JSON only`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in response");
  return JSON.parse(jsonMatch[0]);
}

export async function extractReviewLanguage(venueId: string): Promise<{
  reviewsProcessed: number;
  phrasesExtracted: number;
  phrasesUpdated: number;
}> {
  // Load all unanalysed reviews for this venue
  const { data: reviews } = await supabase
    .from("reviews")
    .select("id, review_text, reviewer_name, rating")
    .eq("venue_id", venueId)
    .is("analysis_run_at", null)
    .not("review_text", "is", null);

  if (!reviews?.length) return { reviewsProcessed: 0, phrasesExtracted: 0, phrasesUpdated: 0 };

  let phrasesExtracted = 0;
  let phrasesUpdated = 0;

  for (const review of reviews) {
    try {
      const analysis = await analyseReview(review.review_text!, review.reviewer_name);

      // Update review record with analysis results
      await supabase
        .from("reviews")
        .update({
          sentiment_score: analysis.sentiment_score,
          themes: analysis.themes,
          standout_phrases: analysis.standout_phrases,
          concerns_mentioned: analysis.concerns_mentioned,
          wedding_date_mentioned: analysis.wedding_date_mentioned,
          analysis_run_at: new Date().toISOString(),
        })
        .eq("id", review.id);

      // Upsert each phrase into review_language
      for (const { phrase, theme } of analysis.phrases) {
        const { data: existing } = await supabase
          .from("review_language")
          .select("id, frequency, source_review_ids, avg_rating")
          .eq("venue_id", venueId)
          .eq("phrase", phrase)
          .single();

        if (existing) {
          // Update frequency and include this review in sources
          const sourceIds = [...new Set([...(existing.source_review_ids ?? []), review.id])];
          const newAvgRating = existing.avg_rating
            ? ((existing.avg_rating * existing.frequency) + (review.rating ?? 5)) / (existing.frequency + 1)
            : review.rating;

          await supabase
            .from("review_language")
            .update({
              frequency: existing.frequency + 1,
              source_review_ids: sourceIds,
              avg_rating: newAvgRating,
              updated_at: new Date().toISOString(),
            })
            .eq("id", existing.id);
          phrasesUpdated++;
        } else {
          await supabase
            .from("review_language")
            .insert({
              venue_id: venueId,
              phrase,
              theme,
              frequency: 1,
              avg_rating: review.rating,
              source_review_ids: [review.id],
              approved_for_sage: false,      // Human approves before Sage uses it
              approved_for_marketing: false, // Human approves before marketing uses it
            });
          phrasesExtracted++;
        }
      }
    } catch (err) {
      console.error(`Failed to analyse review ${review.id}:`, err);
    }
  }

  return {
    reviewsProcessed: reviews.length,
    phrasesExtracted,
    phrasesUpdated,
  };
}

/**
 * Match reviews to client records.
 * Uses wedding date mentioned in review + reviewer name to find the client.
 */
export async function matchReviewsToClients(venueId: string): Promise<{
  matched: number;
  queued: number;
}> {
  const { data: unmatched } = await supabase
    .from("reviews")
    .select("id, reviewer_name, review_date, wedding_date_mentioned, review_text")
    .eq("venue_id", venueId)
    .eq("match_status", "unmatched");

  if (!unmatched?.length) return { matched: 0, queued: 0 };

  const { data: clients } = await supabase
    .from("clients")
    .select("id, name_primary, event_date")
    .eq("venue_id", venueId)
    .not("event_date", "is", null);

  let matched = 0;
  let queued = 0;

  for (const review of unmatched) {
    let bestScore = 0;
    let bestClientId: string | null = null;

    for (const client of clients ?? []) {
      let score = 0;

      // Wedding date match (strongest signal)
      if (review.wedding_date_mentioned && client.event_date) {
        const reviewDate = new Date(review.wedding_date_mentioned);
        const clientDate = new Date(client.event_date);
        if (reviewDate.toDateString() === clientDate.toDateString()) score += 70;
        else if (
          reviewDate.getFullYear() === clientDate.getFullYear() &&
          reviewDate.getMonth() === clientDate.getMonth()
        ) score += 40;
      }

      // Name match (weaker — reviewers often use first name only)
      if (review.reviewer_name && client.name_primary) {
        const reviewFirst = review.reviewer_name.split(" ")[0].toLowerCase();
        const clientFirst = client.name_primary.split(" ")[0].toLowerCase();
        if (reviewFirst === clientFirst) score += 20;
      }

      // Review date proximity to event date (posted shortly after wedding)
      if (review.review_date && client.event_date) {
        const reviewPosted = new Date(review.review_date);
        const eventDate = new Date(client.event_date);
        const daysDiff = (reviewPosted.getTime() - eventDate.getTime()) / (1000 * 60 * 60 * 24);
        if (daysDiff >= 0 && daysDiff <= 180) score += 10;
      }

      if (score > bestScore) {
        bestScore = score;
        bestClientId = client.id;
      }
    }

    if (bestClientId && bestScore >= 70) {
      await supabase
        .from("reviews")
        .update({
          matched_client_id: bestClientId,
          match_confidence: bestScore,
          match_status: bestScore >= 90 ? "auto_matched" : "matched",
        })
        .eq("id", review.id);

      // Update client record
      await supabase
        .from("clients")
        .update({ review_submitted: true, review_submitted_at: review.review_date })
        .eq("id", bestClientId);

      matched++;
    } else if (bestClientId && bestScore >= 30) {
      // Surface for human review but don't auto-match
      await supabase
        .from("reviews")
        .update({
          matched_client_id: bestClientId,
          match_confidence: bestScore,
          match_status: "matched",
        })
        .eq("id", review.id);
      queued++;
    }
  }

  return { matched, queued };
}
