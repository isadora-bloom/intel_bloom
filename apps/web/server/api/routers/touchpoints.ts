/**
 * Touchpoints Router
 * Handles channel spend, pre-inquiry signal import (Knot CSV),
 * and touchpoint attribution queries.
 */

import { z } from "zod";
import { router, venueProcedure } from "@/lib/trpc/server";
import { TRPCError } from "@trpc/server";
import { parseKnotActivityCsv, summariseKnotActivity } from "@/lib/parsers/the-knot-activity";

// ─── CHANNEL SPEND ────────────────────────────────────────────────────────────

export const touchpointsRouter = router({

  // List all channel spend entries for this venue
  getChannelSpend: venueProcedure
    .input(z.object({
      year: z.number().int().optional(),
    }))
    .query(async ({ ctx, input }) => {
      let q = ctx.db
        .from("channel_spend")
        .select("*")
        .eq("venue_id", ctx.venueId)
        .order("month", { ascending: false });

      if (input.year) {
        q = q.gte("month", `${input.year}-01-01`).lte("month", `${input.year}-12-31`);
      }

      const { data, error } = await q;
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return data ?? [];
    }),

  // Upsert a channel spend entry (one per channel per month)
  upsertChannelSpend: venueProcedure
    .input(z.object({
      channel:      z.string(),
      month:        z.string(), // YYYY-MM-01
      amountCents:  z.number().int().min(0),
      billingType:  z.enum(["monthly_subscription", "annual_subscription", "pay_per_click", "flat_fee"]).optional(),
      notes:        z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.db
        .from("channel_spend")
        .upsert({
          venue_id:     ctx.venueId,
          channel:      input.channel,
          month:        input.month,
          amount_cents: input.amountCents,
          billing_type: input.billingType,
          notes:        input.notes,
        }, { onConflict: "venue_id,channel,month" });

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { success: true };
    }),

  deleteChannelSpend: venueProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.db
        .from("channel_spend")
        .delete()
        .eq("id", input.id)
        .eq("venue_id", ctx.venueId);

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { success: true };
    }),

  // ─── KNOT ACTIVITY IMPORT ───────────────────────────────────────────────────

  // Preview what a Knot CSV will import before committing
  previewKnotImport: venueProcedure
    .input(z.object({ csvText: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const records = parseKnotActivityCsv(input.csvText);
      const summary = summariseKnotActivity(records);
      const named = records.filter(r => !r.isAnonymous);
      return {
        summary,
        sampleRecords: named.slice(0, 10).map(r => ({
          date: r.date,
          name: `${r.firstName} ${r.lastInitial}.`,
          signalType: r.signalType,
          platform: r.platform,
        })),
        totalRecords: records.length,
        namedRecords: named.length,
      };
    }),

  // Commit Knot activity CSV to pre_inquiry_signals
  importKnotActivity: venueProcedure
    .input(z.object({
      csvText: z.string(),
      platform: z.enum(["the_knot", "wedding_wire"]).default("the_knot"),
    }))
    .mutation(async ({ ctx, input }) => {
      const records = parseKnotActivityCsv(input.csvText);
      const named = records.filter(r => !r.isAnonymous && r.firstName && r.lastInitial);

      // Skip signals we already have (unique constraint handles it gracefully)
      const rows = named
        .filter(r => r.signalType !== "unknown")
        .map(r => ({
          venue_id:      ctx.venueId,
          platform:      r.platform === "both" ? input.platform : r.platform,
          first_name:    r.firstName!,
          last_initial:  r.lastInitial!,
          signal_type:   r.signalType,
          occurred_at:   r.date + "T12:00:00Z",
          import_source: "csv_upload",
          raw_data:      { rawLine: r.rawLine },
        }));

      let inserted = 0;
      let skipped = 0;

      // Insert in batches of 100
      for (let i = 0; i < rows.length; i += 100) {
        const batch = rows.slice(i, i + 100);
        const { data, error } = await ctx.db
          .from("pre_inquiry_signals")
          .upsert(batch, {
            onConflict: "venue_id,platform,first_name,last_initial,signal_type,occurred_at",
            ignoreDuplicates: true,
          })
          .select("id");

        if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
        inserted += data?.length ?? 0;
        skipped  += batch.length - (data?.length ?? 0);
      }

      // Also count anonymous for summary stats (not stored as signals, just aggregates)
      const summary = summariseKnotActivity(records);

      return {
        inserted,
        skipped,
        totalNamedRecords: named.length,
        summary,
      };
    }),

  // ─── PRE-INQUIRY SIGNALS ────────────────────────────────────────────────────

  getPreInquirySignals: venueProcedure
    .input(z.object({
      matchStatus: z.enum(["unmatched", "matched", "pending_review", "dismissed", "all"]).default("all"),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      let q = ctx.db
        .from("pre_inquiry_signals")
        .select("*", { count: "exact" })
        .eq("venue_id", ctx.venueId)
        .order("occurred_at", { ascending: false })
        .range(input.offset, input.offset + input.limit - 1);

      if (input.matchStatus !== "all") q = q.eq("match_status", input.matchStatus);

      const { data, error, count } = await q;
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { signals: data ?? [], total: count ?? 0 };
    }),

  // Confirm or dismiss a pending signal match
  resolveSignalMatch: venueProcedure
    .input(z.object({
      signalId:  z.string().uuid(),
      inquiryId: z.string().uuid(),
      action:    z.enum(["confirm", "dismiss"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const status = input.action === "confirm" ? "matched" : "dismissed";

      const { error } = await ctx.db
        .from("pre_inquiry_signals")
        .update({
          linked_inquiry_id: input.action === "confirm" ? input.inquiryId : null,
          match_status: status,
          match_reviewed_by: ctx.user.id,
          match_reviewed_at: new Date().toISOString(),
        })
        .eq("id", input.signalId)
        .eq("venue_id", ctx.venueId);

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { success: true };
    }),

  // ─── ATTRIBUTION SUMMARY ────────────────────────────────────────────────────

  // High-level: how many pre-inquiry signals have been matched vs. unmatched
  getAttributionHealth: venueProcedure.query(async ({ ctx }) => {
    const [signals, inquiries] = await Promise.all([
      ctx.db
        .from("pre_inquiry_signals")
        .select("match_status, signal_type", { count: "exact" })
        .eq("venue_id", ctx.venueId),
      ctx.db
        .from("inquiries")
        .select("touchpoint_classification, inquiry_intent, first_contact_channel")
        .eq("venue_id", ctx.venueId)
        .then(r => {
          // Graceful fallback if columns don't exist yet (pre-migration)
          if (r.error?.message?.includes("column")) return { data: [], error: null };
          return r;
        }),
    ]);

    const signalCounts = (signals.data ?? []).reduce<Record<string, number>>((acc, r) => {
      acc[r.match_status] = (acc[r.match_status] ?? 0) + 1;
      return acc;
    }, {});

    const classificationCounts = (inquiries.data ?? []).reduce<Record<string, number>>((acc, r) => {
      const k = r.touchpoint_classification ?? "unknown";
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});

    const intentCounts = (inquiries.data ?? []).reduce<Record<string, number>>((acc, r) => {
      const k = r.inquiry_intent ?? "unknown";
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});

    return {
      signals: {
        total:         signals.count ?? 0,
        unmatched:     signalCounts["unmatched"] ?? 0,
        matched:       signalCounts["matched"] ?? 0,
        pendingReview: signalCounts["pending_review"] ?? 0,
        dismissed:     signalCounts["dismissed"] ?? 0,
      },
      inquiries: {
        firstTouch:     classificationCounts["inquiry_is_first_touch"] ?? 0,
        warmLead:       classificationCounts["inquiry_preceded_by_awareness"] ?? 0,
        returning:      classificationCounts["returning_inquiry"] ?? 0,
        unknown:        classificationCounts["unknown"] ?? 0,
        intentChosen:   intentCounts["chosen"] ?? 0,
        intentBlast:    intentCounts["also_contacted"] ?? 0,
      },
    };
  }),

  // ── Leads (pre-inquiry named touches) ─────────────────────────────────
  getLeads: venueProcedure
    .input(z.object({
      limit: z.number().int().default(50),
      offset: z.number().int().default(0),
      linked: z.boolean().optional(), // filter: linked to inquiry or not
    }).optional())
    .query(async ({ ctx, input }) => {
      let query = ctx.db
        .from("leads")
        .select("*")
        .eq("venue_id", ctx.venueId)
        .order("source_date", { ascending: false })
        .range(input?.offset ?? 0, (input?.offset ?? 0) + (input?.limit ?? 50) - 1);

      if (input?.linked === true) query = query.not("linked_client_id", "is", null);
      if (input?.linked === false) query = query.is("linked_client_id", null);

      const { data, error } = await query;
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

      // Also get total count
      const { count } = await ctx.db
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("venue_id", ctx.venueId);

      return { leads: data ?? [], total: count ?? 0 };
    }),

  // ── Referrals summary ─────────────────────────────────────────────────
  getReferralsSummary: venueProcedure.query(async ({ ctx }) => {
    const { data } = await ctx.db
      .from("referrals")
      .select("id, referring_client_id, referred_client_id, source, converted, referral_noted_at")
      .eq("venue_id", ctx.venueId)
      .order("referral_noted_at", { ascending: false });

    const referrals = data ?? [];
    const total = referrals.length;
    const converted = referrals.filter(r => r.converted).length;
    const conversionRate = total > 0 ? converted / total : 0;

    // Unique referrers
    const referrerIds = new Set(referrals.map(r => r.referring_client_id).filter(Boolean));

    return {
      total,
      converted,
      conversionRate,
      uniqueReferrers: referrerIds.size,
      recent: referrals.slice(0, 10),
    };
  }),
});
