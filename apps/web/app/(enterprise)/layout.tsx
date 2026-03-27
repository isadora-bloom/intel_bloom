import { createClient, createServiceClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import EnterpriseSidebar from "@/components/EnterpriseSidebar";
import DemoBanner from "@/components/DemoBanner";
import DemoTracker from "@/components/DemoTracker";
import { DEMO_COOKIE, parseDemoCookie } from "@/lib/demo";

export default async function EnterpriseLayout({
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
        <EnterpriseSidebar />
        <main className="flex-1 lg:pl-56 pt-14 lg:pt-0">
          <DemoBanner session={demoSession} />
          <div className="p-6 lg:p-8">{children}</div>
        </main>
        <DemoTracker />
      </div>
    );
  }

  // ── Normal auth flow ──────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const db = createServiceClient();

  const { data: venueUser } = await db
    .from("venue_users")
    .select("role, organisation_id")
    .eq("user_id", user.id)
    .single();

  const enterpriseRoles = [
    "super_admin",
    "enterprise_owner",
    "enterprise_admin",
    "enterprise_viewer",
  ];
  if (!venueUser || !enterpriseRoles.includes(venueUser.role)) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <EnterpriseSidebar />
      <main className="flex-1 lg:pl-56 pt-14 lg:pt-0">
        <div className="p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
