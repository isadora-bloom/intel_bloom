import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

// ── ROLE HIERARCHY ──────────────────────────────────────────────────────
// Ordered from most to least privileged. Each role inherits capabilities
// of all roles below it in the hierarchy.
export const ROLE_HIERARCHY = [
  "super_admin",
  "enterprise_owner",
  "enterprise_admin",
  "enterprise_viewer",
  "venue_owner",
  "venue_admin",
  "coordinator",
  "readonly",
] as const;

export type VenueRole = (typeof ROLE_HIERARCHY)[number];

/**
 * Returns the numeric rank of a role (lower = more privileged).
 * Unknown roles get Infinity so they fail every check.
 */
function roleRank(role: string): number {
  const idx = ROLE_HIERARCHY.indexOf(role as VenueRole);
  return idx === -1 ? Infinity : idx;
}

/**
 * Returns true if `userRole` is at least as privileged as `minimumRole`.
 */
export function hasMinimumRole(userRole: string, minimumRole: VenueRole): boolean {
  return roleRank(userRole) <= roleRank(minimumRole);
}

/**
 * Queries venue_users and returns the user's role for the given venue.
 * Falls back to null if no active membership exists.
 */
export async function getRoleForUser(
  db: SupabaseClient,
  userId: string,
  venueId: string,
): Promise<VenueRole | null> {
  const { data } = await db
    .from("venue_users")
    .select("role")
    .eq("user_id", userId)
    .eq("venue_id", venueId)
    .eq("is_active", true)
    .limit(1)
    .single();

  if (!data?.role) return null;

  // Validate that the stored role is a known role
  const idx = ROLE_HIERARCHY.indexOf(data.role as VenueRole);
  return idx !== -1 ? (data.role as VenueRole) : null;
}

// ── CONTEXT ─────────────────────────────────────────────────────────────

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

// ── VENUE PROCEDURE (unchanged — everyone with a venue) ─────────────────
// All venue-scoped procedures — throws if no authenticated venue
export const venueProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user || !ctx.venueId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  // Resolve role once per request so all downstream procedures can use it
  const role = await getRoleForUser(ctx.db, ctx.user.id, ctx.venueId);

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
      venueId: ctx.venueId,
      role: role ?? ("readonly" as VenueRole),
      /** Fire-and-forget audit log for sensitive operations */
      logAccess: (resourceType: string, resourceId: string, action: string) => {
        Promise.resolve(
          ctx.db.from("data_access_log").insert({
            venue_id: ctx.venueId,
            user_id: ctx.user!.id,
            user_role: role ?? "unknown",
            resource_type: resourceType,
            resource_id: resourceId,
            action,
          })
        ).catch(() => {});
      },
    },
  });
});

// ── ROLE-GATED PROCEDURES ───────────────────────────────────────────────
// These extend venueProcedure — auth + venue check already done.
// They add a role minimum check on top.

/**
 * Requires coordinator or higher.
 * Coordinators can see assigned clients, pipeline, Sage outbox.
 * Cannot see financials or full analytics.
 */
export const coordinatorProcedure = venueProcedure.use(({ ctx, next }) => {
  if (!hasMinimumRole(ctx.role, "coordinator")) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Role "${ctx.role}" does not have coordinator-level access.`,
    });
  }
  return next({ ctx });
});

/**
 * Requires venue_admin or higher.
 * Full data access. Cannot manage billing or delete venue.
 */
export const adminProcedure = venueProcedure.use(({ ctx, next }) => {
  if (!hasMinimumRole(ctx.role, "venue_admin")) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Role "${ctx.role}" does not have admin-level access.`,
    });
  }
  return next({ ctx });
});

/**
 * Requires venue_owner or higher.
 * Full access including billing, settings, user management.
 */
export const ownerProcedure = venueProcedure.use(({ ctx, next }) => {
  if (!hasMinimumRole(ctx.role, "venue_owner")) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Role "${ctx.role}" does not have owner-level access.`,
    });
  }
  return next({ ctx });
});
