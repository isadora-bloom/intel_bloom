import { z } from "zod";
import { router, venueProcedure } from "@/lib/trpc/server";
import { TRPCError } from "@trpc/server";

export const uploadsRouter = router({
  // List uploads for a client
  listForClient: venueProcedure
    .input(z.object({ clientId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.db
        .from("uploads")
        .select("*")
        .eq("client_id", input.clientId)
        .eq("venue_id", ctx.venueId)
        .order("created_at", { ascending: false });

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return data ?? [];
    }),

  // Create upload record (file upload handled client-side to Supabase Storage)
  create: venueProcedure
    .input(
      z.object({
        clientId: z.string().uuid().optional(),
        fileName: z.string(),
        fileType: z.enum(["audio", "video", "text", "pdf", "image"]),
        fileSizeBytes: z.number().int(),
        storagePath: z.string(),
        uploadType: z.enum([
          "tour_recording", "meeting_recording", "tour_notes", "email_thread",
          "contract", "questionnaire", "invoice", "correspondence", "other",
        ]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.db
        .from("uploads")
        .insert({
          venue_id: ctx.venueId,
          client_id: input.clientId,
          file_name: input.fileName,
          file_type: input.fileType,
          file_size_bytes: input.fileSizeBytes,
          storage_path: input.storagePath,
          upload_type: input.uploadType,
          upload_date: new Date().toISOString(),
          status: "pending",
        })
        .select()
        .single();

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

      // Trigger processing (in production, push to Bull queue)
      // For now, kick off async processing
      await triggerProcessing(data.id);

      return data;
    }),

  // Get upload with extracted signals
  getById: venueProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.db
        .from("uploads")
        .select("*")
        .eq("id", input.id)
        .eq("venue_id", ctx.venueId)
        .single();

      if (error) throw new TRPCError({ code: "NOT_FOUND" });
      return data;
    }),

  // Confirm a single extracted signal → apply to client record
  confirmSignal: venueProcedure
    .input(
      z.object({
        uploadId: z.string().uuid(),
        signalIndex: z.number().int().min(0),
        confirmed: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { data: upload, error: fetchErr } = await ctx.db
        .from("uploads")
        .select("*")
        .eq("id", input.uploadId)
        .eq("venue_id", ctx.venueId)
        .single();

      if (fetchErr) throw new TRPCError({ code: "NOT_FOUND" });

      const extractedSignals = (upload.extracted_signals as any[]) ?? [];
      const signal = extractedSignals[input.signalIndex];
      if (!signal) throw new TRPCError({ code: "BAD_REQUEST", message: "Signal not found" });

      if (input.confirmed && upload.client_id) {
        // Apply to client record
        await applySignalToClient(ctx.db, upload.client_id, ctx.venueId, signal);

        // Log planning event
        await ctx.db.from("planning_events").insert({
          venue_id: ctx.venueId,
          client_id: upload.client_id,
          event_type: "upload",
          event_date: new Date().toISOString(),
          metadata: { signal, signalIndex: input.signalIndex, uploadId: input.uploadId },
          source: "upload",
        });
      }

      // Mark signal as confirmed/dismissed
      const confirmedSignals = [...((upload.confirmed_signals as any[]) ?? [])];
      if (input.confirmed) {
        confirmedSignals.push({ ...signal, confirmedAt: new Date().toISOString() });
      }

      await ctx.db
        .from("uploads")
        .update({ confirmed_signals: confirmedSignals })
        .eq("id", input.uploadId);

      return { success: true };
    }),
});

// Stub — in production this pushes to Bull queue
async function triggerProcessing(uploadId: string) {
  // POST /api/process-upload { uploadId }
  // Or push to Redis queue via Bull
}

// ─── Signal → Data mapping ────────────────────────────────────────────────────
// Handles all 21 extracted signal types. Venue-level signals (advertising_spend)
// write to venue tables; client-level signals write to the clients record.
// Structural signals (vendor_preference, timeline_detail) create child rows.
// Soft signals (emotional_tone, vision_clarity, objection, special_request,
// dietary_requirement, payment_status) are stored in stress_flags JSONB as
// structured notes — they have no dedicated column but are surfaced in the UI.
async function applySignalToClient(
  supabase: any,
  clientId: string,
  venueId: string,
  signal: { type: string; value: string; confidence?: number; quote?: string }
) {
  const updates: Record<string, unknown> = {};

  switch (signal.type) {

    // ── Hard numeric fields ──────────────────────────────────────────────────

    case "budget_signal": {
      const m = signal.value.match(/\$?([\d,]+)/);
      if (m) updates.revenue_cents = parseInt(m[1].replace(/,/g, ""), 10) * 100;
      break;
    }

    case "guest_count": {
      const m = signal.value.match(/(\d+)/);
      if (m) updates.guest_count_initial = parseInt(m[1], 10);
      break;
    }

    case "event_date": {
      // Try to parse a date from the value
      const parsed = Date.parse(signal.value);
      if (!isNaN(parsed)) {
        updates.event_date = new Date(parsed).toISOString().split("T")[0];
      }
      break;
    }

    case "event_logistics": {
      // May contain guest count ("150 guests") or date clues
      const guestM = signal.value.match(/(\d+)\s*(?:guests?|people|persons?)/i);
      if (guestM) updates.guest_count_initial = parseInt(guestM[1], 10);
      break;
    }

    case "package_tier": {
      // Map known tier words to package field; otherwise store verbatim
      updates.package = signal.value.trim();
      break;
    }

    case "contact_info": {
      // Parse email / phone from value and fill empty fields only
      const { data: cur } = await supabase
        .from("clients")
        .select("email_primary, phone_primary, email_partner, phone_partner")
        .eq("id", clientId)
        .single();
      const emailM = signal.value.match(/[\w.+-]+@[\w.-]+\.\w{2,}/);
      const phoneM = signal.value.match(/[\d\s().+-]{7,}/);
      if (emailM && !cur?.email_primary) updates.email_primary = emailM[0];
      else if (emailM && !cur?.email_partner) updates.email_partner = emailM[0];
      if (phoneM && !cur?.phone_primary) updates.phone_primary = phoneM[0].trim();
      break;
    }

    // ── Array fields ─────────────────────────────────────────────────────────

    case "competing_venue": {
      const { data: cur } = await supabase
        .from("clients")
        .select("competing_venues")
        .eq("id", clientId)
        .single();
      const existing = (cur?.competing_venues as string[]) ?? [];
      if (!existing.includes(signal.value)) {
        updates.competing_venues = [...existing, signal.value];
      }
      break;
    }

    // ── Child-row inserts ────────────────────────────────────────────────────

    case "referral_detail": {
      const referringName = signal.value.trim();
      const namePart = referringName.split(",")[0].trim();
      const firstName = namePart.split(/\s+/)[0];
      const { data: candidates } = await supabase
        .from("clients")
        .select("id, name_primary")
        .eq("venue_id", venueId)
        .ilike("name_primary", `%${firstName}%`)
        .neq("id", clientId)
        .limit(5);

      const referralRow: Record<string, unknown> = {
        venue_id: venueId,
        referred_client_id: clientId,
        referring_name: referringName,
        source: "upload_extracted",
      };
      if (candidates?.length === 1) referralRow.referring_client_id = candidates[0].id;

      const { data: referral } = await supabase
        .from("referrals")
        .insert(referralRow)
        .select("id")
        .single();

      if (referral && candidates?.length === 1) {
        // Increment referrals_generated on the referring client
        const { data: refCur } = await supabase
          .from("clients")
          .select("referrals_generated")
          .eq("id", candidates[0].id)
          .single();
        await supabase
          .from("clients")
          .update({ referrals_generated: ((refCur?.referrals_generated as number) ?? 0) + 1 })
          .eq("id", candidates[0].id);
      }
      break;
    }

    case "vendor_preference":
    case "vendor_confirmed": {
      // Find or create vendor record, then link to this client
      const vendorName = signal.value.split(/[,:(]/)[0].trim();
      const categoryHint = signal.type === "vendor_confirmed" ? "confirmed" : null;

      // Try to find existing vendor by name
      const { data: existing } = await supabase
        .from("vendors")
        .select("id")
        .eq("venue_id", venueId)
        .ilike("name", vendorName)
        .maybeSingle();

      let vendorId = existing?.id;
      if (!vendorId) {
        const { data: created } = await supabase
          .from("vendors")
          .insert({ venue_id: venueId, name: vendorName })
          .select("id")
          .single();
        vendorId = created?.id;
      }

      if (vendorId) {
        await supabase
          .from("client_vendors")
          .upsert({
            venue_id: venueId,
            client_id: clientId,
            vendor_id: vendorId,
            confirmed: signal.type === "vendor_confirmed",
          }, { onConflict: "client_id,vendor_id" });
      }
      break;
    }

    case "timeline_detail": {
      // Create a planning event row
      await supabase.from("planning_events").insert({
        venue_id: venueId,
        client_id: clientId,
        event_type: "timeline_note",
        event_date: new Date().toISOString(),
        metadata: { note: signal.value, quote: signal.quote },
        source: "upload_extracted",
      });
      break;
    }

    // ── Venue-level signals (not client-specific) ────────────────────────────

    case "advertising_spend": {
      // Parse platform + amount from signal value
      // e.g. "The Knot: $299" or "Google Ads $450"
      const amountM = signal.value.match(/\$?([\d,]+)/);
      if (!amountM) break;
      const amountCents = parseInt(amountM[1].replace(/,/g, ""), 10) * 100;

      // Try to guess channel from value text
      const valLower = signal.value.toLowerCase();
      const channel =
        valLower.includes("the knot") || valLower.includes("theknot") ? "the_knot" :
        valLower.includes("wedding wire") || valLower.includes("weddingwire") ? "wedding_wire" :
        valLower.includes("google ads") || valLower.includes("google adwords") ? "google_ads" :
        valLower.includes("facebook") ? "facebook_ads" :
        valLower.includes("instagram") ? "instagram_ads" :
        valLower.includes("the wedding channel") ? "wedding_channel" :
        "other";

      const thisMonth = new Date();
      const monthStr = `${thisMonth.getFullYear()}-${String(thisMonth.getMonth() + 1).padStart(2, "0")}-01`;

      await supabase
        .from("channel_spend")
        .upsert({
          venue_id: venueId,
          channel,
          month: monthStr,
          amount_cents: amountCents,
          billing_type: "monthly_subscription",
          notes: signal.value,
        }, { onConflict: "venue_id,channel,month" });
      break;
    }

    case "revenue_item": {
      // Confirmed revenue from an invoice/contract — update revenue_cents if not already set
      const { data: cur } = await supabase
        .from("clients")
        .select("revenue_cents")
        .eq("id", clientId)
        .single();
      if (!cur?.revenue_cents) {
        const m = signal.value.match(/\$?([\d,]+)/);
        if (m) updates.revenue_cents = parseInt(m[1].replace(/,/g, ""), 10) * 100;
      }
      break;
    }

    // ── Soft/qualitative signals → stored in stress_flags JSONB ──────────────
    // These don't have dedicated columns but are surfaced in the client profile.

    case "emotional_tone":
    case "vision_clarity":
    case "objection":
    case "special_request":
    case "dietary_requirement":
    case "payment_status":
    case "family_dynamics":
    case "invoice_total": {
      const { data: cur } = await supabase
        .from("clients")
        .select("stress_flags")
        .eq("id", clientId)
        .single();
      const flags = (cur?.stress_flags as Record<string, unknown>) ?? {};
      const key = signal.type;
      // Append to existing array or create new
      const existing = Array.isArray(flags[key]) ? (flags[key] as string[]) : [];
      if (!existing.includes(signal.value)) {
        updates.stress_flags = { ...flags, [key]: [...existing, signal.value] };
      }
      break;
    }

    // No-op signals (metadata, handled by UI or planning events)
    case "inquiry_intent":
    default:
      break;
  }

  if (Object.keys(updates).length > 0) {
    await supabase
      .from("clients")
      .update(updates)
      .eq("id", clientId)
      .eq("venue_id", venueId);
  }
}
