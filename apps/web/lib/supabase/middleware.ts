import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  const isAuthRoute =
    pathname.startsWith("/login") ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/onboard") ||
    pathname.startsWith("/invite") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/upgrade");

  if (!user && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // Plan gating — only run for authenticated users on dashboard routes
  if (user) {
    const isDashboardRoute =
      !pathname.startsWith("/login") &&
      !pathname.startsWith("/signup") &&
      !pathname.startsWith("/onboard") &&
      !pathname.startsWith("/invite") &&
      !pathname.startsWith("/api/") &&
      !pathname.startsWith("/upgrade");

    if (isDashboardRoute) {
      const { data: venueData } = await supabase
        .from("venue_users")
        .select("venues(plan_status, trial_ends_at)")
        .eq("user_id", user.id)
        .limit(1)
        .single();

      const venue = (venueData?.venues as any) ?? null;

      if (venue) {
        const isTrialExpired =
          venue.plan_status === "trial" &&
          venue.trial_ends_at &&
          new Date(venue.trial_ends_at) < new Date();

        const isCancelled = venue.plan_status === "cancelled";

        if (isTrialExpired || isCancelled) {
          const url = request.nextUrl.clone();
          url.pathname = "/upgrade";
          return NextResponse.redirect(url);
        }
      }
    }
  }

  return supabaseResponse;
}
