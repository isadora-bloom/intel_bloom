"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, Users, CalendarCheck, ArrowRight, Loader2 } from "lucide-react";
import { type DemoRole } from "@/lib/demo";

const ROLES: {
  key: DemoRole;
  icon: React.ElementType;
  label: string;
  subtitle: string;
  bullets: string[];
}[] = [
  {
    key: "owner",
    icon: Building2,
    label: "I run a venue group",
    subtitle: "Portfolio view across all 4 venues",
    bullets: [
      "Comparative analytics & benchmarking",
      "Cost-per-booking by source across venues",
      "Anomaly alerts & AI briefings",
      "Revenue forecasts & health scores",
    ],
  },
  {
    key: "manager",
    icon: Users,
    label: "I manage a venue",
    subtitle: "Single-venue deep dive",
    bullets: [
      "Full pipeline: inquiries → tours → bookings",
      "Source performance & attribution",
      "Consultant leaderboard & response times",
      "Reviews, market pulse & trends",
    ],
  },
  {
    key: "coordinator",
    icon: CalendarCheck,
    label: "I book weddings",
    subtitle: "Personal pipeline & performance",
    bullets: [
      "Your active leads & upcoming tours",
      "Response time trends",
      "Your conversion rate vs. team average",
      "Tasks & follow-ups",
    ],
  },
];

export default function DemoPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState<DemoRole | null>(null);

  async function selectRole(role: DemoRole) {
    setLoading(role);
    try {
      const res = await fetch("/api/demo/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role,
          utm_source: searchParams.get("utm_source"),
          utm_medium: searchParams.get("utm_medium"),
          utm_campaign: searchParams.get("utm_campaign"),
        }),
      });

      if (!res.ok) throw new Error("Failed to start demo");
      router.push("/dashboard");
    } catch (err) {
      console.error(err);
      setLoading(null);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white flex flex-col items-center justify-center px-4 py-12">
      {/* Header */}
      <div className="text-center mb-10 max-w-lg">
        <div className="inline-flex items-center gap-2 bg-blue-50 text-blue-700 rounded-full px-3 py-1 text-xs font-medium mb-4">
          Interactive Demo
        </div>
        <h1 className="text-3xl font-semibold text-gray-900 mb-2">
          Bloom Intelligence
        </h1>
        <p className="text-gray-500 text-sm leading-relaxed">
          Explore real venue analytics for Crestwood Hospitality Group — a fictional 4-venue
          portfolio with 24 months of data. Pick a role to see the product from that perspective.
        </p>
      </div>

      {/* Role cards */}
      <div className="grid gap-4 sm:grid-cols-3 w-full max-w-3xl">
        {ROLES.map(({ key, icon: Icon, label, subtitle, bullets }) => (
          <button
            key={key}
            onClick={() => selectRole(key)}
            disabled={loading !== null}
            className={`group relative flex flex-col text-left rounded-xl border p-5 transition-all ${
              loading === key
                ? "border-blue-300 bg-blue-50 shadow-md"
                : "border-gray-200 bg-white hover:border-blue-300 hover:shadow-md"
            } ${loading !== null && loading !== key ? "opacity-50" : ""}`}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-50 text-blue-600 group-hover:bg-blue-100 transition-colors">
                <Icon size={18} />
              </div>
              <div>
                <div className="text-sm font-semibold text-gray-900">{label}</div>
                <div className="text-xs text-gray-500">{subtitle}</div>
              </div>
            </div>

            <ul className="space-y-1.5 mb-4 flex-1">
              {bullets.map((b, i) => (
                <li key={i} className="text-xs text-gray-600 flex items-start gap-1.5">
                  <span className="text-blue-400 mt-0.5">•</span>
                  {b}
                </li>
              ))}
            </ul>

            <div className="flex items-center justify-center gap-1.5 rounded-md bg-gray-50 group-hover:bg-blue-50 py-2 text-xs font-medium text-gray-600 group-hover:text-blue-700 transition-colors">
              {loading === key ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  Loading...
                </>
              ) : (
                <>
                  Explore as {key}
                  <ArrowRight size={13} />
                </>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* Footer */}
      <div className="mt-10 text-center">
        <p className="text-xs text-gray-400">
          Demo data is read-only · Session expires after 60 minutes
        </p>
        <p className="text-xs text-gray-400 mt-1">
          Already have an account?{" "}
          <a href="/login" className="text-blue-600 hover:underline">
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}
