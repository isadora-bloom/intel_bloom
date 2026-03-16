import { z } from "zod";
import { router, venueProcedure } from "@/lib/trpc/server";
import { TRPCError } from "@trpc/server";

export const macroRouter = router({
  // Get latest market pulse (from cache)
  getMarketPulse: venueProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from("market_pulse")
      .select("*")
      .eq("venue_id", ctx.venueId)
      .order("calculated_at", { ascending: false })
      .limit(1)
      .single();

    if (error) return null;
    return data;
  }),

  // Get consumer sentiment trend (last 12 months)
  getConsumerSentiment: venueProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from("macro_economic")
      .select("period_date, value, signal_type")
      .eq("geo_scope", "national")
      .in("signal_type", ["consumer_sentiment", "conference_board"])
      .order("period_date", { ascending: false })
      .limit(24);

    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    return data ?? [];
  }),

  // Get search trends for venue's metro
  getSearchTrends: venueProcedure.query(async ({ ctx }) => {
    const { data: venue } = await ctx.supabase
      .from("venues")
      .select("google_trends_metro")
      .eq("id", ctx.venueId)
      .single();

    if (!venue?.google_trends_metro) return [];

    const { data, error } = await ctx.supabase
      .from("macro_search_trends")
      .select("week_start, term, relative_interest")
      .eq("geo", venue.google_trends_metro)
      .in("term", ["wedding venue", "wedding venues", "barn wedding"])
      .order("week_start", { ascending: false })
      .limit(52);

    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    return data ?? [];
  }),

  // Get weather seasonality for venue's station
  getWeatherSeasonality: venueProcedure.query(async ({ ctx }) => {
    const { data: venue } = await ctx.supabase
      .from("venues")
      .select("noaa_station_id")
      .eq("id", ctx.venueId)
      .single();

    if (!venue?.noaa_station_id) return [];

    const { data, error } = await ctx.supabase
      .from("weather_monthly")
      .select("year, month, precipitation_inches, temp_avg_f, weather_score")
      .eq("noaa_station_id", venue.noaa_station_id)
      .order("year", { ascending: false })
      .order("month", { ascending: true })
      .limit(120); // 10 years

    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    return data ?? [];
  }),

  // Get competitor landscape
  getCompetitors: venueProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from("macro_competitor_landscape")
      .select("*")
      .eq("venue_id", ctx.venueId)
      .order("scanned_at", { ascending: false })
      .limit(50);

    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    return data ?? [];
  }),

  // Get economic signals by Fed district
  getRegionalEconomics: venueProcedure.query(async ({ ctx }) => {
    const { data: venue } = await ctx.supabase
      .from("venues")
      .select("fed_district")
      .eq("id", ctx.venueId)
      .single();

    const districtScope = venue?.fed_district ? `district_${venue.fed_district}` : "national";

    const { data, error } = await ctx.supabase
      .from("macro_economic")
      .select("period_date, value, signal_type, geo_scope, raw_data")
      .in("geo_scope", ["national", districtScope])
      .order("period_date", { ascending: false })
      .limit(36);

    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    return data ?? [];
  }),
});
