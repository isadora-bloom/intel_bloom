import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Check onboarding
  const { data: venueUser } = await supabase
    .from("venue_users")
    .select("venue_id, venue:venues(onboarding_complete)")
    .eq("user_id", user.id)
    .single();

  if (!venueUser) redirect("/onboard");

  const venue = venueUser.venue as any;
  if (!venue?.onboarding_complete) redirect("/onboard");

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 lg:pl-64">
        <div className="p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
