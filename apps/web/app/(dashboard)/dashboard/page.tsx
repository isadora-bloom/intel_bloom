import { createClient } from "@/lib/supabase/server";
import MarketPulseCard from "@/components/macro/MarketPulseCard";
import { Users, Inbox, TrendingUp, Calendar } from "lucide-react";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: venueUser } = await supabase
    .from("venue_users")
    .select("venue_id")
    .single();

  const venueId = venueUser?.venue_id;

  // Stats
  const [
    { count: totalClients },
    { count: activeClients },
    { count: totalInquiries },
    { count: pendingMatches },
  ] = await Promise.all([
    supabase.from("clients").select("id", { count: "exact", head: true }).eq("venue_id", venueId),
    supabase.from("clients").select("id", { count: "exact", head: true }).eq("venue_id", venueId).eq("status", "planning"),
    supabase.from("inquiries").select("id", { count: "exact", head: true }).eq("venue_id", venueId),
    supabase.from("matching_queue").select("id", { count: "exact", head: true }).eq("venue_id", venueId).eq("status", "pending"),
  ]);

  // Market pulse
  const { data: pulse } = await supabase
    .from("market_pulse")
    .select("*")
    .eq("venue_id", venueId)
    .order("calculated_at", { ascending: false })
    .limit(1)
    .single();

  // System-detected annotations awaiting response
  const { data: pendingAnnotations } = await supabase
    .from("annotations")
    .select("id, annotation_type, detected_signal, period_start, period_end, notes")
    .eq("venue_id", venueId)
    .eq("source", "system_detected")
    .eq("annotation_type", "unknown")
    .limit(3);

  const stats = [
    { label: "Total clients", value: totalClients ?? 0, icon: Users, color: "text-blue-600" },
    { label: "In planning", value: activeClients ?? 0, icon: Calendar, color: "text-green-600" },
    { label: "Total inquiries", value: totalInquiries ?? 0, icon: Inbox, color: "text-purple-600" },
    { label: "Pending matches", value: pendingMatches ?? 0, icon: TrendingUp, color: "text-amber-600", href: "/matching" },
  ];

  return (
    <div className="space-y-6 max-w-6xl">
      <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-500">{stat.label}</span>
              <stat.icon size={16} className={stat.color} />
            </div>
            <div className="text-2xl font-semibold text-gray-900">{stat.value}</div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Market Pulse */}
        <div className="lg:col-span-2">
          <MarketPulseCard pulse={pulse} />
        </div>

        {/* Alerts */}
        <div className="space-y-4">
          {/* Annotation flags */}
          {pendingAnnotations && pendingAnnotations.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-amber-800 mb-2">
                {pendingAnnotations.length} flag{pendingAnnotations.length > 1 ? "s" : ""} need context
              </h3>
              <div className="space-y-2">
                {pendingAnnotations.map((ann) => (
                  <p key={ann.id} className="text-xs text-amber-700">{ann.notes}</p>
                ))}
              </div>
              <a href="/annotations" className="text-xs text-amber-800 font-medium mt-2 block hover:underline">
                Review all →
              </a>
            </div>
          )}

          {/* Match queue */}
          {(pendingMatches ?? 0) > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-blue-800 mb-1">Identity matching</h3>
              <p className="text-xs text-blue-700">{pendingMatches} potential matches awaiting your review</p>
              <a href="/matching" className="text-xs text-blue-800 font-medium mt-2 block hover:underline">
                Review matches →
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
