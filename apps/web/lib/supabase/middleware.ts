import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { DEMO_COOKIE, isDemoPath, parseDemoCookie } from "@/lib/demo";

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // ── Demo mode: allow /demo page through without auth ──────────────────
  if (isDemoPath(pathname)) {
    return NextResponse.next({ request });
  }

  // ── Demo mode: if bloom_demo cookie is present, skip auth ─────────────
  const demoCookie = request.cookies.get(DEMO_COOKIE)?.value;
  const demoSession = parseDemoCookie(demoCookie);
  if (demoSession) {
    // Demo user browsing dashboard pages — let them through.
    // tRPC context will detect the cookie and inject demo venueId/role.
    // For API routes, the demo cookie is passed along for tRPC to read.
    return NextResponse.next({ request });
  }

  // ── Normal auth flow ──────────────────────────────────────────────────

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

  // For API routes: refresh the session cookie (so tRPC gets the auth token)
  // but skip redirect logic — API routes handle their own auth errors.
  if (pathname.startsWith("/api/")) {
    await supabase.auth.getSession();
    return supabaseResponse;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

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

    // Plan gating placeholder — billing columns not yet in schema
    void isDashboardRoute;
  }

  return supabaseResponse;
}
