import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export async function createTRPCContext() {
  const supabase = await createClient();

  // getSession() decodes the JWT locally — no network round trip.
  // Data queries use ctx.db (service role) so we only need user.id for venueId lookup.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;

  // Service client bypasses RLS — used for all data queries once venueId is resolved.
  // This eliminates a whole class of "RLS returning empty for my own data" bugs.
  const db = createServiceClient();

  // Fast path: venue_id baked into JWT app_metadata — no extra DB round-trip.
  // Fallback: service role lookup for accounts set up before app_metadata was populated.
  let venueId: string | null = null;
  if (user) {
    venueId = (user.app_metadata?.venue_id as string | undefined) ?? null;
    if (!venueId) {
      const { data } = await db
        .from("venue_users")
        .select("venue_id")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .limit(1)
        .single();
      venueId = data?.venue_id ?? null;
    }
  }

  return { supabase, db, user, venueId };
}

type Context = Awaited<ReturnType<typeof createTRPCContext>>;

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

// All venue-scoped procedures — throws if no authenticated venue
export const venueProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user || !ctx.venueId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
      venueId: ctx.venueId,
      /** Fire-and-forget audit log for sensitive operations */
      logAccess: (resourceType: string, resourceId: string, action: string) => {
        Promise.resolve(
          ctx.db.from("data_access_log").insert({
            venue_id: ctx.venueId,
            user_id: ctx.user!.id,
            user_role: "member", // TODO: pull from venue_users
            resource_type: resourceType,
            resource_id: resourceId,
            action,
          })
        ).catch(() => {});
      },
    },
  });
});
