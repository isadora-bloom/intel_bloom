import { createClient, createServiceClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Use anon client only to verify the session (auth check)
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();

  if (!user) redirect("/login");

  // Use service role to bypass RLS for onboarding check —
  // avoids infinite redirect loop caused by venue_id_for_user() returning
  // null while the user's venue_users row hasn't been picked up by RLS yet.
  const supabase = createServiceClient();

  const { data: venueUser } = await supabase
    .from("venue_users")
    .select("venue_id, venues(onboarding_complete)")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!venueUser) redirect("/onboard");

  const venue = (venueUser as any).venues;
  if (!venue?.onboarding_complete) redirect("/onboard");

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 lg:pl-64 pt-14 lg:pt-0">
        <div className="p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
