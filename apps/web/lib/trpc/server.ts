import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { DEMO_COOKIE, parseDemoCookie, DEMO_ROLE_DEFAULTS, type DemoSession } from "@/lib/demo";

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
  const cookieStore = await cookies();
  const db = createServiceClient();

  // ── Demo mode: if bloom_demo cookie is present, bypass Supabase auth ──
  const demoCookieRaw = cookieStore.get(DEMO_COOKIE)?.value;
  const demoSession = parseDemoCookie(demoCookieRaw);

  if (demoSession) {
    const supabase = await createClient();
    return {
      supabase,
      db,
      user: {
        id: demoSession.consultantId || "de000000-0000-0000-0000-a00000000001",
        app_metadata: { venue_id: demoSession.venueId },
      } as any,
      venueId: demoSession.venueId,
      isDemo: true as const,
      demoSession,
    };
  }

  // ── Normal auth flow ──────────────────────────────────────────────────
  const supabase = await createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;

  // Resolution order for venueId:
  // 1. bloom_venue cookie (user explicitly switched venues)
  // 2. venue_id in JWT app_metadata (fast path — no DB round-trip)
  // 3. First active venue_users row (fallback for older accounts)
  let venueId: string | null = null;
  if (user) {
    // 1. Check the venue switcher cookie
    const venueCookie = cookieStore.get("bloom_venue")?.value;
    if (venueCookie) {
      // Validate the user actually has access to this venue
      const { data: membership } = await db
        .from("venue_users")
        .select("venue_id")
        .eq("user_id", user.id)
        .eq("venue_id", venueCookie)
        .eq("is_active", true)
        .limit(1)
        .single();
      if (membership) {
        venueId = membership.venue_id;
      }
    }

    // 2. JWT app_metadata
    if (!venueId) {
      venueId = (user.app_metadata?.venue_id as string | undefined) ?? null;
    }

    // 3. First active venue_users row
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

  return { supabase, db, user, venueId, isDemo: false as const, demoSession: null };
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

  // Demo mode: use the role from the demo session, skip DB lookup
  let role: VenueRole;
  if (ctx.isDemo && ctx.demoSession) {
    const roleMap: Record<string, VenueRole> = {
      owner: "enterprise_owner",
      manager: "venue_admin",
      coordinator: "coordinator",
    };
    role = roleMap[ctx.demoSession.role] ?? "readonly";
  } else {
    role = (await getRoleForUser(ctx.db, ctx.user.id, ctx.venueId)) ?? ("readonly" as VenueRole);
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
      venueId: ctx.venueId,
      role,
      isDemo: ctx.isDemo,
      demoSession: ctx.demoSession,
      /** Fire-and-forget audit log for sensitive operations */
      logAccess: (resourceType: string, resourceId: string, action: string) => {
        if (ctx.isDemo) return; // Don't log demo access
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

// ── DEMO WRITE GUARD ────────────────────────────────────────────────────
// Wrap any mutation procedure with this to block writes in demo mode.
// Returns a friendly message instead of throwing.
export const demoWriteGuard = t.middleware(({ ctx, next }) => {
  if ((ctx as any).isDemo) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This is a demo — in your account, you'd be able to edit this.",
    });
  }
  return next({ ctx });
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
