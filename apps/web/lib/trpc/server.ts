import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { createClient } from "@/lib/supabase/server";

export async function createTRPCContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Get venue_id for this user
  let venueId: string | null = null;
  if (user) {
    const { data } = await supabase
      .from("venue_users")
      .select("venue_id")
      .eq("user_id", user.id)
      .single();
    venueId = data?.venue_id ?? null;
  }

  return { supabase, user, venueId };
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
    },
  });
});
