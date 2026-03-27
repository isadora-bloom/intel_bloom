import { createClient, createServiceClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import DemoBanner from "@/components/DemoBanner";
import DemoTracker from "@/components/DemoTracker";
import { DEMO_COOKIE, parseDemoCookie } from "@/lib/demo";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();

  // ── Demo mode: skip auth, show demo banner ────────────────────────────
  const demoCookieRaw = cookieStore.get(DEMO_COOKIE)?.value;
  const demoSession = parseDemoCookie(demoCookieRaw);

  if (demoSession) {
    return (
      <div className="flex min-h-screen bg-gray-50">
        <Sidebar />
        <main className="flex-1 lg:pl-56 pt-14 lg:pt-0">
          <DemoBanner session={demoSession} />
          <div className="p-6 lg:p-8">{children}</div>
        </main>
        <DemoTracker />
      </div>
    );
  }

  // ── Normal auth flow ──────────────────────────────────────────────────
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();

  if (!user) redirect("/login");

  const supabase = createServiceClient();

  const { data: venueUser } = await supabase
    .from("venue_users")
    .select("venue_id, venues(onboarding_complete)")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!venueUser) redirect("/onboard");

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 lg:pl-56 pt-14 lg:pt-0">
        <div className="p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
