"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";

const FEATURES = [
  "Source attribution — see exactly where your leads come from",
  "Weather & macro intelligence — NOAA climate data + economic signals by month",
  "AI Q&A — ask questions about your pipeline and get instant answers",
  "Email scanning — auto-extract client details from your inbox",
  "Team access — invite coordinators and staff at no extra cost",
];

export default function UpgradePage() {
  const router = useRouter();
  const supabase = createClient();
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Redirect active subscribers away from this page
  useEffect(() => {
    async function checkPlan() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from("venue_users")
        .select("venues(plan_status)")
        .eq("user_id", user.id)
        .limit(1)
        .single();

      const venue = (data?.venues as any) ?? null;
      if (venue?.plan_status === "active") {
        router.replace("/dashboard");
      }
    }
    checkPlan();
  }, []);

  async function handleCheckout() {
    setCheckoutLoading(true);
    setError(null);

    const res = await fetch("/api/stripe/create-checkout", { method: "POST" });
    const data = await res.json();

    if (!res.ok || !data.url) {
      setError(data.error ?? "Something went wrong. Please try again.");
      setCheckoutLoading(false);
      return;
    }

    window.location.href = data.url;
  }

  async function handlePortal() {
    setPortalLoading(true);
    setError(null);

    const res = await fetch("/api/billing/portal", { method: "POST" });
    const data = await res.json();

    if (!res.ok || !data.url) {
      setError(data.error ?? "Something went wrong. Please try again.");
      setPortalLoading(false);
      return;
    }

    window.location.href = data.url;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-gray-900">Bloom Intelligence</h1>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Your trial has ended</h2>
          <p className="text-sm text-gray-600 mb-6">
            Bloom Intelligence is <span className="font-semibold text-gray-900">$250/month</span>.
            Unlock everything — no per-seat fees.
          </p>

          <ul className="space-y-3 mb-8">
            {FEATURES.map((feature) => (
              <li key={feature} className="flex items-start gap-3 text-sm text-gray-700">
                <Check className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3 mb-4">
              {error}
            </div>
          )}

          <button
            onClick={handleCheckout}
            disabled={checkoutLoading || portalLoading}
            className="w-full bg-blue-600 text-white rounded-md py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {checkoutLoading ? "Redirecting..." : "Continue with Bloom — $250/month"}
          </button>

          <button
            onClick={handlePortal}
            disabled={checkoutLoading || portalLoading}
            className="w-full mt-3 text-sm text-gray-500 hover:text-gray-700 underline underline-offset-2 disabled:opacity-50"
          >
            {portalLoading ? "Loading..." : "Manage existing subscription"}
          </button>
        </div>
      </div>
    </div>
  );
}
