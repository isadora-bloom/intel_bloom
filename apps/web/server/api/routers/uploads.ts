import { z } from "zod";
import { router, venueProcedure } from "@/lib/trpc/server";
import { TRPCError } from "@trpc/server";

export const uploadsRouter = router({
  // List uploads for a client
  listForClient: venueProcedure
    .input(z.object({ clientId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
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
        uploadType: z.enum(["tour_recording", "meeting_recording", "tour_notes", "email_thread", "other"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
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
      const { data, error } = await ctx.supabase
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
      const { data: upload, error: fetchErr } = await ctx.supabase
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
        await applySignalToClient(ctx.supabase, upload.client_id, ctx.venueId, signal);

        // Log planning event
        await ctx.supabase.from("planning_events").insert({
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

      await ctx.supabase
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

async function applySignalToClient(
  supabase: any,
  clientId: string,
  venueId: string,
  signal: { type: string; value: string }
) {
  const updates: Record<string, unknown> = {};

  switch (signal.type) {
    case "budget_signal":
      // Parse budget from value if it's a dollar amount
      const budgetMatch = signal.value.match(/\$?([\d,]+)/);
      if (budgetMatch) {
        const amount = parseInt(budgetMatch[1].replace(",", ""), 10) * 100;
        updates.revenue_cents = amount;
      }
      break;
    case "event_logistics":
      // May contain guest count
      const guestMatch = signal.value.match(/(\d+)\s*(?:guests?|people|persons?)/i);
      if (guestMatch) {
        updates.guest_count_initial = parseInt(guestMatch[1], 10);
      }
      break;
    case "competing_venue":
      // Append to competing_venues array
      const { data: client } = await supabase
        .from("clients")
        .select("competing_venues")
        .eq("id", clientId)
        .single();
      const existing = (client?.competing_venues as string[]) ?? [];
      if (!existing.includes(signal.value)) {
        updates.competing_venues = [...existing, signal.value];
      }
      break;
    case "referral_detail":
      // Create a referrals row — this couple was referred by someone.
      // signal.value is the referring person's name or description
      // (e.g. "Sarah Thompson, October 2023 wedding").
      // We create the referral record and try a loose name match to find
      // the referring client. Human can confirm the link in the matching queue.
      await (async () => {
        const referringName = signal.value.trim();

        // Attempt to find a matching past client by name
        const namePart = referringName.split(",")[0].trim(); // strip date hints
        const firstName = namePart.split(/\s+/)[0];
        const { data: candidates } = await supabase
          .from("clients")
          .select("id, name_primary")
          .eq("venue_id", venueId)
          .ilike("name_primary", `%${firstName}%`)
          .neq("id", clientId)
          .limit(5);

        // Build the referral row
        const referralRow: Record<string, unknown> = {
          venue_id: venueId,
          referred_client_id: clientId,
          referring_name: referringName,
          source: "sage_extracted",
        };

        // If exactly one candidate matches, auto-link with a pending_review status
        // so a human can confirm. Never auto-confirm.
        if (candidates && candidates.length === 1) {
          referralRow.referring_client_id = candidates[0].id;
        }

        const { data: referral } = await supabase
          .from("referrals")
          .insert(referralRow)
          .select("id")
          .single();

        // Increment referral_count on the referring client if we have a match
        if (referral && candidates && candidates.length === 1) {
          await supabase.rpc("increment_referral_count", {
            p_client_id: candidates[0].id,
          }).catch(() => {
            // Fallback if RPC not available: manual increment
            supabase
              .from("clients")
              .select("referral_count")
              .eq("id", candidates[0].id)
              .single()
              .then(({ data: c }: { data: { referral_count: number } | null }) => {
                if (c) {
                  supabase
                    .from("clients")
                    .update({ referral_count: ((c.referral_count as number) ?? 0) + 1 })
                    .eq("id", candidates[0].id);
                }
              });
          });
        }
      })();
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
