"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { ChevronRight, Loader2, TrendingUp, BarChart2, Cloud, Users, Globe, Check } from "lucide-react";

const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"];

function pf<T>(value: T, source = "user_estimate", confidence = "estimated") {
  return { value, source, confidence, updatedAt: new Date().toISOString() };
}

const AWARENESS_OPTIONS = [
  { value: "the_knot", label: "The Knot" },
  { value: "weddingwire", label: "WeddingWire" },
  { value: "zola", label: "Zola" },
  { value: "google_search", label: "Google Search" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "reddit", label: "Reddit" },
  { value: "ai_tools", label: "AI tools" },
  { value: "word_of_mouth", label: "Word of mouth" },
  { value: "styled_shoots", label: "Styled shoots" },
  { value: "press", label: "Press / features" },
  { value: "tiktok", label: "TikTok" },
  { value: "pinterest", label: "Pinterest" },
  { value: "other", label: "Other" },
];

const MACRO_SIGNALS = [
  { icon: TrendingUp, color: "bg-blue-50 text-blue-500", title: "Wedding search trends", desc: "Weekly Google Trends for your metro — engagement ring spikes, venue searches" },
  { icon: BarChart2, color: "bg-green-50 text-green-500", title: "Consumer confidence", desc: "Federal Reserve data — when people feel financially cautious, they delay weddings" },
  { icon: Cloud, color: "bg-sky-50 text-sky-500", title: "Weather risk by month", desc: "NOAA climate normals — which months are genuinely risky for outdoor events" },
  { icon: Users, color: "bg-purple-50 text-purple-500", title: "Competitor landscape", desc: "Nearby venue ratings, review counts, and pricing signals" },
  { icon: Globe, color: "bg-amber-50 text-amber-500", title: "Local economic signals", desc: "Employment, income, and housing data for your Federal Reserve district" },
];

export default function OnboardPage() {
  const router = useRouter();
  const supabase = createClient();

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 0 fields
  const [venueName, setVenueName] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("VA");
  const [zip, setZip] = useState("");
  const [venueId, setVenueId] = useState<string | null>(null);

  // Step 2 fields
  const [awarenessChannels, setAwarenessChannels] = useState<string[]>([]);
  const [briefingEmail, setBriefingEmail] = useState("");

  function toggleAwareness(v: string) {
    setAwarenessChannels(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);
  }

  async function handleVenueCreate() {
    if (!venueName.trim() || !city.trim()) return;
    setSaving(true); setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const slug = venueName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const { data: venue, error: ve } = await supabase
        .from("venues")
        .insert({ name: venueName, slug: `${slug}-${Date.now()}`, address_line1: addressLine1, city, state, zip, onboarding_step: 1 })
        .select().single();
      if (ve) throw ve;
      await supabase.from("venue_users").insert({ venue_id: venue.id, user_id: user.id, role: "owner" });
      fetch("/api/onboard", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ venueId: venue.id }) });
      setVenueId(venue.id);
      setStep(1);
      window.scrollTo(0, 0);
    } catch (err: any) {
      setError(err.message ?? "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function handleComplete() {
    if (!venueId) return;
    setSaving(true);
    const vp: Record<string, unknown> = {};
    if (awarenessChannels.length)
      vp.awareness_channels = pf(awarenessChannels, "user_input", "confirmed");

    await supabase.from("venues").update({
      onboarding_complete: true,
      onboarding_step: 3,
      funnel_config: { awareness_channels: awarenessChannels },
      venue_profile: vp,
      ...(briefingEmail ? { briefing_email: briefingEmail } : {}),
    }).eq("id", venueId);

    router.push("/dashboard");
  }

  // Progress dots
  function Dots({ current }: { current: number }) {
    return (
      <div className="flex items-center gap-1.5">
        {[0, 1, 2].map(i => (
          <div key={i} className={`rounded-full transition-all duration-300 ${i <= current ? "w-6 h-2 bg-blue-600" : "w-2 h-2 bg-gray-200"}`} />
        ))}
      </div>
    );
  }

  // ── STEP 0: Venue setup ────────────────────────────────────────────────────
  if (step === 0) return (
    <div className="min-h-screen bg-white flex flex-col">
      <div className="border-b border-gray-100 px-6 h-14 flex items-center justify-between max-w-2xl mx-auto w-full">
        <span className="text-sm font-semibold text-gray-900">Bloom Intelligence</span>
        <span className="text-xs text-gray-400">About 90 seconds</span>
      </div>
      <div className="flex-1 max-w-2xl mx-auto w-full px-6 py-10">
        <div className="mb-8">
          <Dots current={0} />
          <h1 className="text-2xl font-semibold text-gray-900 mt-4">Welcome. Let&apos;s get your venue set up.</h1>
          <p className="text-sm text-gray-500 mt-1.5">We only need the basics for now — you can fill in everything else from your dashboard.</p>
        </div>
        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3 mb-4">{error}</div>}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Venue name</label>
            <input type="text" value={venueName} onChange={e => setVenueName(e.target.value)}
              placeholder="Rixey Manor" autoFocus
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Street address <span className="text-gray-400 font-normal">(optional)</span></label>
            <input type="text" value={addressLine1} onChange={e => setAddressLine1(e.target.value)}
              placeholder="1234 Manor Road"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="grid grid-cols-5 gap-3">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
              <input type="text" value={city} onChange={e => setCity(e.target.value)} required
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
              <select value={state} onChange={e => setState(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">ZIP</label>
              <input type="text" value={zip} onChange={e => setZip(e.target.value)} pattern="\d{5}"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
        </div>
        <div className="mt-8 space-y-3">
          <button onClick={handleVenueCreate} disabled={!venueName.trim() || !city.trim() || saving}
            className="w-full bg-blue-600 text-white rounded-lg py-3 text-sm font-medium hover:bg-blue-700 disabled:opacity-40 flex items-center justify-center gap-2 transition-colors">
            {saving ? <Loader2 size={15} className="animate-spin" /> : null}
            Continue <ChevronRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );

  // ── STEP 1: Market intelligence preview ───────────────────────────────────
  if (step === 1) return (
    <div className="min-h-screen bg-white flex flex-col">
      <div className="border-b border-gray-100 px-6 h-14 flex items-center justify-between max-w-2xl mx-auto w-full">
        <span className="text-sm font-semibold text-gray-900">Bloom Intelligence</span>
      </div>
      <div className="flex-1 max-w-2xl mx-auto w-full px-6 py-10">
        <div className="mb-8">
          <Dots current={1} />
          <h1 className="text-2xl font-semibold text-gray-900 mt-4">
            We&apos;re already working for {city || "your venue"}.
          </h1>
          <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">
            While you were filling that in, we started pulling real data for your market.
            This runs automatically — no setup needed.
          </p>
        </div>

        <div className="space-y-3 mb-8">
          {MACRO_SIGNALS.map(({ icon: Icon, color, title, desc }) => (
            <div key={title} className="flex items-start gap-3 p-4 rounded-xl border border-gray-100 bg-gray-50">
              <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${color}`}>
                <Icon size={15} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-gray-900">{title}</p>
                  <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full">
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                    Live
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-8">
          <p className="text-sm text-blue-900 font-medium mb-1">Your data vs. the market</p>
          <p className="text-xs text-blue-700 leading-relaxed">
            Every metric about your business is shown alongside what&apos;s happening in the broader economy.
            When inquiries drop, you&apos;ll know immediately whether it&apos;s a &apos;you&apos; problem — or whether
            consumer confidence is down and even your strongest competitors are struggling.
          </p>
        </div>

        <div className="space-y-3">
          <button onClick={() => { setStep(2); window.scrollTo(0, 0); }}
            className="w-full bg-blue-600 text-white rounded-lg py-3 text-sm font-medium hover:bg-blue-700 flex items-center justify-center gap-2 transition-colors">
            One last thing <ChevronRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );

  // ── STEP 2: Two questions + done ───────────────────────────────────────────
  if (step === 2) return (
    <div className="min-h-screen bg-white flex flex-col">
      <div className="border-b border-gray-100 px-6 h-14 flex items-center justify-between max-w-2xl mx-auto w-full">
        <span className="text-sm font-semibold text-gray-900">Bloom Intelligence</span>
      </div>
      <div className="flex-1 max-w-2xl mx-auto w-full px-6 py-10">
        <div className="mb-8">
          <Dots current={2} />
          <h1 className="text-2xl font-semibold text-gray-900 mt-4">Two quick questions.</h1>
          <p className="text-sm text-gray-500 mt-1.5">
            Everything else can be filled in from your dashboard — these two shape everything else.
          </p>
        </div>

        <div className="space-y-8">
          <div>
            <p className="text-sm font-semibold text-gray-800 mb-1">Where do couples find out about you?</p>
            <p className="text-xs text-gray-400 mb-3">
              This is the most important question for attribution accuracy — it shapes how we read your inquiry emails and match leads.
            </p>
            <div className="flex flex-wrap gap-2">
              {AWARENESS_OPTIONS.map(opt => (
                <button key={opt.value} type="button" onClick={() => toggleAwareness(opt.value)}
                  className={`px-4 py-2 rounded-full border text-sm transition-colors ${
                    awarenessChannels.includes(opt.value)
                      ? "bg-blue-600 border-blue-600 text-white"
                      : "bg-white border-gray-200 text-gray-700 hover:border-gray-400"
                  }`}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold text-gray-800 mb-1">Where should we send your weekly briefing?</p>
            <p className="text-xs text-gray-400 mb-3">
              A short AI-written summary of what&apos;s happening in your business and market. No spam — you can turn it off anytime.
            </p>
            <input type="email" value={briefingEmail} onChange={e => setBriefingEmail(e.target.value)}
              placeholder="you@yourvenue.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>

        <div className="mt-10 space-y-3">
          <button onClick={handleComplete} disabled={saving}
            className="w-full bg-blue-600 text-white rounded-lg py-3 text-sm font-medium hover:bg-blue-700 disabled:opacity-40 flex items-center justify-center gap-2 transition-colors">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            Go to my dashboard
          </button>
          <button onClick={() => { setStep(1); }} className="w-full text-sm text-gray-400 hover:text-gray-600 py-2">← Back</button>
          <p className="text-center text-xs text-gray-400">
            You can fill in the rest from your dashboard — it takes 5 minutes and unlocks more insights as you go.
          </p>
        </div>
      </div>
    </div>
  );

  return null;
}
