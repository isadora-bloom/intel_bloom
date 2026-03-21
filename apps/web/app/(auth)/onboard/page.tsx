"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, Loader2, BarChart2, Cloud, TrendingUp, Users, Globe } from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────────

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

function pf<T>(value: T, source = "user_estimate", confidence = "estimated") {
  return { value, source, confidence, updatedAt: new Date().toISOString() };
}

// ── Reusable UI ───────────────────────────────────────────────────────────────

function Chips({
  options, selected, onChange, multi = true,
}: {
  options: { value: string; label: string; desc?: string }[];
  selected: string[];
  onChange: (v: string[]) => void;
  multi?: boolean;
}) {
  function toggle(v: string) {
    if (multi) {
      onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);
    } else {
      onChange([v]);
    }
  }
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(opt => (
        <button
          key={opt.value} type="button"
          onClick={() => toggle(opt.value)}
          className={`px-4 py-2 rounded-full border text-sm transition-colors text-left ${
            selected.includes(opt.value)
              ? "bg-blue-600 border-blue-600 text-white"
              : "bg-white border-gray-200 text-gray-700 hover:border-gray-400"
          }`}
        >
          {opt.label}
          {opt.desc && <span className={`text-xs ml-1 ${selected.includes(opt.value) ? "text-blue-200" : "text-gray-400"}`}>{opt.desc}</span>}
        </button>
      ))}
    </div>
  );
}

function RangeBuckets({
  options, selected, onChange,
}: {
  options: string[]; selected: string; onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(opt => (
        <button
          key={opt} type="button"
          onClick={() => onChange(opt)}
          className={`px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
            selected === opt
              ? "bg-blue-600 border-blue-600 text-white"
              : "bg-white border-gray-200 text-gray-700 hover:border-gray-400"
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function StepShell({
  step, totalSteps, title, subtitle, onBack, onSkip, onContinue,
  continueLabel = "Continue", continueDisabled = false, saving = false, children,
}: {
  step: number; totalSteps: number; title: string; subtitle?: string;
  onBack?: () => void; onSkip?: () => void;
  onContinue: () => void; continueLabel?: string;
  continueDisabled?: boolean; saving?: boolean;
  children: React.ReactNode;
}) {
  const pct = Math.round((step / totalSteps) * 100);
  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header + progress */}
      <div className="border-b border-gray-100">
        <div className="max-w-2xl mx-auto px-6 h-14 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-900">Bloom Intelligence</span>
          <span className="text-xs text-gray-400">Step {step} of {totalSteps}</span>
        </div>
        <div className="h-1 bg-gray-100">
          <div className="h-full bg-blue-600 transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col max-w-2xl mx-auto w-full px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
          {subtitle && <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">{subtitle}</p>}
        </div>

        <div className="flex-1">{children}</div>

        <div className="mt-10 space-y-3">
          <button
            onClick={onContinue}
            disabled={continueDisabled || saving}
            className="w-full bg-blue-600 text-white rounded-lg py-3 text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : null}
            {continueLabel}
            {!saving && <ChevronRight size={15} />}
          </button>
          <div className="flex justify-between">
            {onBack ? (
              <button onClick={onBack} className="text-sm text-gray-400 hover:text-gray-600">← Back</button>
            ) : <span />}
            {onSkip && (
              <button onClick={onSkip} className="text-sm text-gray-400 hover:text-gray-600">Skip for now</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main wizard ───────────────────────────────────────────────────────────────

const TOTAL_STEPS = 9;

export default function OnboardPage() {
  const router = useRouter();
  const supabase = createClient();

  // Step state
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 0: venue creation
  const [venueId, setVenueId] = useState<string | null>(null);
  const [venueName, setVenueName] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("VA");
  const [zip, setZip] = useState("");

  // Step 2: Awareness
  const [awarenessChannels, setAwarenessChannels] = useState<string[]>([]);

  // Step 3: First contact
  const [firstTouchMethods, setFirstTouchMethods] = useState<string[]>([]);

  // Step 4: Tour + contract
  const [tourMethod, setTourMethod] = useState("");
  const [contractMethod, setContractMethod] = useState("");

  // Step 5: Brand
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [instagramHandle, setInstagramHandle] = useState("");
  const [brandWords, setBrandWords] = useState(["", "", ""]);

  // Step 6: Economics
  const [avgPackageBucket, setAvgPackageBucket] = useState("");
  const [adSpendBucket, setAdSpendBucket] = useState("");
  const [adPlatforms, setAdPlatforms] = useState<string[]>([]);
  const [toursToBooking, setToursToBooking] = useState("");

  // Step 7: Analytics
  const [analyticsPlatform, setAnalyticsPlatform] = useState("");
  const [gaId, setGaId] = useState("");

  // Step 8: Integrations — Calendly PAT
  const [calendlyPat, setCalendlyPat] = useState("");
  const [knotId, setKnotId] = useState("");
  const [gmailConnected, setGmailConnected] = useState(false);

  // Check on mount — resume if venue already exists
  useEffect(() => {
    async function checkResume() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: vu } = await supabase
        .from("venue_users")
        .select("venue_id, venue:venues(id, name, onboarding_step, onboarding_complete, funnel_config, venue_profile, city, state, zip, address_line1, honeybook_api_key, knot_venue_id)")
        .eq("user_id", user.id)
        .single();
      if (!vu) return;
      const v = vu.venue as any;
      if (v?.onboarding_complete) { router.replace("/dashboard"); return; }
      setVenueId(vu.venue_id);
      if (v?.name) setVenueName(v.name);
      if (v?.address_line1) setAddressLine1(v.address_line1);
      if (v?.city) setCity(v.city);
      if (v?.state) setState(v.state);
      if (v?.zip) setZip(v.zip);
      if (v?.knot_venue_id) setKnotId(v.knot_venue_id);
      if (v?.funnel_config) {
        const fc = v.funnel_config;
        if (fc.awareness_channels) setAwarenessChannels(fc.awareness_channels);
        if (fc.first_touch_methods) setFirstTouchMethods(fc.first_touch_methods);
        if (fc.tour_method) setTourMethod(fc.tour_method);
        if (fc.contract_method) setContractMethod(fc.contract_method);
      }
      if (v?.venue_profile) {
        const vp = v.venue_profile;
        if (vp.website_url?.value) setWebsiteUrl(vp.website_url.value);
        if (vp.instagram_handle?.value) setInstagramHandle(vp.instagram_handle.value);
        if (vp.brand_keywords?.value) setBrandWords([...vp.brand_keywords.value, "", "", ""].slice(0, 3));
        if (vp.avg_package_value_bucket?.value) setAvgPackageBucket(vp.avg_package_value_bucket.value);
        if (vp.monthly_ad_spend_bucket?.value) setAdSpendBucket(vp.monthly_ad_spend_bucket.value);
        if (vp.typical_tours_per_booking_bucket?.value) setToursToBooking(vp.typical_tours_per_booking_bucket.value);
        if (vp.advertising_platforms?.value) setAdPlatforms(vp.advertising_platforms.value);
        if (vp.google_analytics_id?.value) setGaId(vp.google_analytics_id.value);
      }
      // Resume at saved step (min 1 since venue exists)
      const savedStep = Math.max(1, v?.onboarding_step ?? 1);
      setStep(savedStep);
    }
    checkResume();
  }, []);

  // ── Save helpers ─────────────────────────────────────────────────────────────

  async function savePartial(data: Record<string, unknown>) {
    if (!venueId) return;
    await supabase.from("venues").update(data).eq("id", venueId);
  }

  function advance(nextStep: number) {
    setStep(nextStep);
    window.scrollTo(0, 0);
  }

  // ── Step handlers ─────────────────────────────────────────────────────────────

  async function handleVenueCreate() {
    if (!venueName.trim() || !city.trim() || !zip.trim()) return;
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
      // Kick off calibration (NOAA, trends, competitors) async
      fetch("/api/onboard", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ venueId: venue.id }) });
      setVenueId(venue.id);
      advance(1);
    } catch (err: any) {
      setError(err.message ?? "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function handleAwareness() {
    setSaving(true);
    await savePartial({ onboarding_step: 3, funnel_config: { awareness_channels: awarenessChannels, first_touch_methods: firstTouchMethods, tour_method: tourMethod, contract_method: contractMethod } });
    setSaving(false);
    advance(3);
  }

  async function handleFirstTouch() {
    setSaving(true);
    await savePartial({ onboarding_step: 4, funnel_config: { awareness_channels: awarenessChannels, first_touch_methods: firstTouchMethods, tour_method: tourMethod, contract_method: contractMethod } });
    setSaving(false);
    advance(4);
  }

  async function handleTourContract() {
    setSaving(true);
    await savePartial({ onboarding_step: 5, funnel_config: { awareness_channels: awarenessChannels, first_touch_methods: firstTouchMethods, tour_method: tourMethod, contract_method: contractMethod } });
    setSaving(false);
    advance(5);
  }

  async function handleBrand() {
    setSaving(true);
    const words = brandWords.filter(w => w.trim());
    const vp: Record<string, unknown> = {};
    if (websiteUrl) vp.website_url = pf(websiteUrl, "user_input", "confirmed");
    if (instagramHandle) vp.instagram_handle = pf(instagramHandle.replace(/^@/, ""), "user_input", "confirmed");
    if (words.length) vp.brand_keywords = pf(words, "user_input", "confirmed");
    await savePartial({ onboarding_step: 6, venue_profile: vp });
    setSaving(false);
    advance(6);
  }

  async function handleEconomics() {
    setSaving(true);
    const vp: Record<string, unknown> = {};
    if (avgPackageBucket) vp.avg_package_value_bucket = pf(avgPackageBucket);
    if (adSpendBucket) vp.monthly_ad_spend_bucket = pf(adSpendBucket);
    if (adPlatforms.length) vp.advertising_platforms = pf(adPlatforms);
    if (toursToBooking) vp.typical_tours_per_booking_bucket = pf(toursToBooking);
    await savePartial({ onboarding_step: 7, venue_profile: vp });
    setSaving(false);
    advance(7);
  }

  async function handleAnalytics() {
    setSaving(true);
    const vp: Record<string, unknown> = {};
    if (analyticsPlatform) vp.analytics_platform = pf(analyticsPlatform, "user_input", "confirmed");
    if (gaId) vp.google_analytics_id = pf(gaId, "user_input", "confirmed");
    await savePartial({ onboarding_step: 8, venue_profile: vp, funnel_config: { awareness_channels: awarenessChannels, first_touch_methods: firstTouchMethods, tour_method: tourMethod, contract_method: contractMethod, analytics_platform: analyticsPlatform } });
    setSaving(false);
    advance(8);
  }

  async function handleIntegrations() {
    setSaving(true);
    const updates: Record<string, unknown> = { onboarding_step: 9 };
    if (knotId) updates.knot_venue_id = knotId;
    if (calendlyPat) updates.calendly_api_key = calendlyPat;
    await savePartial(updates);
    setSaving(false);
    advance(9);
  }

  async function handleComplete() {
    setSaving(true);
    await savePartial({ onboarding_complete: true, onboarding_step: 9 });
    router.push("/dashboard");
  }

  // ── Step options ──────────────────────────────────────────────────────────────

  const AWARENESS_OPTIONS = [
    { value: "the_knot", label: "The Knot" },
    { value: "weddingwire", label: "WeddingWire" },
    { value: "zola", label: "Zola" },
    { value: "google_search", label: "Google Search" },
    { value: "instagram", label: "Instagram" },
    { value: "facebook", label: "Facebook" },
    { value: "reddit", label: "Reddit" },
    { value: "ai_tools", label: "AI tools", desc: "(ChatGPT etc.)" },
    { value: "word_of_mouth", label: "Word of mouth" },
    { value: "styled_shoots", label: "Styled shoots" },
    { value: "press", label: "Press / features" },
    { value: "tiktok", label: "TikTok" },
    { value: "pinterest", label: "Pinterest" },
    { value: "other", label: "Other" },
  ];

  const FIRST_TOUCH_OPTIONS = [
    { value: "email", label: "Email" },
    { value: "phone", label: "Phone call" },
    { value: "the_knot_inquiry", label: "The Knot inquiry form" },
    { value: "weddingwire_inquiry", label: "WeddingWire inquiry" },
    { value: "zola_inquiry", label: "Zola inquiry" },
    { value: "website_form", label: "Website contact form" },
    { value: "book_tour_direct", label: "Book a tour directly" },
    { value: "instagram_dm", label: "Instagram DM" },
  ];

  const TOUR_OPTIONS = [
    { value: "calendly", label: "Calendly", desc: "— we'll connect it next" },
    { value: "acuity", label: "Acuity Scheduling" },
    { value: "manual_email", label: "Manual / email back-and-forth" },
    { value: "phone_only", label: "Phone only" },
    { value: "no_tours", label: "We don't do in-person tours" },
  ];

  const CONTRACT_OPTIONS = [
    { value: "honeybook", label: "HoneyBook", desc: "— export CSV to import history" },
    { value: "dubsado", label: "Dubsado" },
    { value: "17hats", label: "17hats" },
    { value: "manual", label: "Manual / email + PDF" },
    { value: "other", label: "Other" },
  ];

  const AD_PLATFORMS = AWARENESS_OPTIONS.filter(o =>
    ["the_knot","weddingwire","zola","google_search","instagram","facebook","tiktok","pinterest"].includes(o.value)
  );

  // Integration cards — shown dynamically based on funnel answers
  const integrationCards = [
    tourMethod === "calendly" && {
      id: "calendly", title: "Calendly", icon: "📅",
      description: "Connect your Calendly to auto-track tours, calculate real tours-per-booking, and match bookings to inquiries.",
      unlocks: "Real tours-per-booking · Tour-to-contract timing · Pipeline velocity",
      field: (
        <input
          type="password" value={calendlyPat} onChange={e => setCalendlyPat(e.target.value)}
          placeholder="Paste your Personal Access Token"
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mt-2"
        />
      ),
      hint: <>Get it at <span className="text-blue-600">calendly.com/integrations/api_webhooks</span></>,
    },
    awarenessChannels.includes("the_knot") && {
      id: "knot", title: "The Knot", icon: "💍",
      description: "Your Knot venue ID lets us track storefront saves, match inquiry notifications to real people, and measure your listing ROI.",
      unlocks: "Storefront saves · Inquiry attribution · Listing ROI",
      field: (
        <input
          type="text" value={knotId} onChange={e => setKnotId(e.target.value)}
          placeholder="Your venue ID from your Knot URL"
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mt-2"
        />
      ),
    },
    firstTouchMethods.includes("email") && !gmailConnected && {
      id: "gmail", title: "Gmail", icon: "✉️",
      description: "Connect your venue inbox to extract source attribution from inquiry emails — automatically linking The Knot, Instagram, and referral mentions to real inquiries.",
      unlocks: "Source attribution · Auto-matching · Email timeline",
      field: (
        <a
          href={venueId ? `/api/auth/google?venue_id=${venueId}` : "#"}
          className="inline-flex items-center gap-2 mt-2 px-4 py-2 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:border-gray-400 transition-colors"
        >
          Connect Gmail
        </a>
      ),
    },
    (contractMethod === "honeybook" || contractMethod === "dubsado") && {
      id: "honeybook", title: contractMethod === "honeybook" ? "HoneyBook" : "Dubsado", icon: "📋",
      description: `Export your ${contractMethod === "honeybook" ? "HoneyBook" : "Dubsado"} client list as CSV to import historical bookings, revenue, and event dates. We'll calculate real average package value and source ROI.`,
      unlocks: "Revenue per source · Real avg package value · Booking history",
      field: <p className="text-xs text-gray-500 mt-2">You can upload the CSV anytime in <span className="font-medium">Settings → Import</span>. No rush to do it now.</p>,
    },
  ].filter(Boolean) as Array<{ id: string; title: string; icon: string; description: string; unlocks: string; field: React.ReactNode; hint?: React.ReactNode }>;

  // ── Render ────────────────────────────────────────────────────────────────────

  // Step 0: Venue creation
  if (step === 0) {
    return (
      <div className="min-h-screen bg-white flex flex-col">
        <div className="border-b border-gray-100">
          <div className="max-w-2xl mx-auto px-6 h-14 flex items-center">
            <span className="text-sm font-semibold text-gray-900">Bloom Intelligence</span>
          </div>
          <div className="h-1 bg-gray-100" />
        </div>
        <div className="flex-1 flex flex-col max-w-2xl mx-auto w-full px-6 py-10">
          <div className="mb-8">
            <h1 className="text-2xl font-semibold text-gray-900">Welcome to Bloom Intelligence</h1>
            <p className="text-sm text-gray-500 mt-1.5">Let's start with the basics. You can always fill in more detail later.</p>
          </div>
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3 mb-4">{error}</div>}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Venue name</label>
              <input type="text" value={venueName} onChange={e => setVenueName(e.target.value)} placeholder="Rixey Manor" required
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Street address <span className="text-gray-400 font-normal">(optional)</span></label>
              <input type="text" value={addressLine1} onChange={e => setAddressLine1(e.target.value)} placeholder="1234 Manor Road"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                <input type="text" value={city} onChange={e => setCity(e.target.value)} required
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                <select value={state} onChange={e => setState(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ZIP</label>
                <input type="text" value={zip} onChange={e => setZip(e.target.value)} pattern="\d{5}" required
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
          </div>
          <div className="mt-10">
            <button onClick={handleVenueCreate} disabled={!venueName.trim() || !city.trim() || saving}
              className="w-full bg-blue-600 text-white rounded-lg py-3 text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-40 flex items-center justify-center gap-2">
              {saving ? <Loader2 size={15} className="animate-spin" /> : null}
              Get started <ChevronRight size={15} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Step 1: What we track for you (no questions)
  if (step === 1) {
    return (
      <StepShell step={1} totalSteps={TOTAL_STEPS} title="You're in good hands."
        subtitle="We'll ask you a few questions about your business. Be as vague or precise as you like — everything can be updated in Settings, and as you connect integrations the fields fill themselves in automatically."
        onContinue={() => advance(2)} continueLabel="Let's build your profile">
        <div className="space-y-4">
          <p className="text-sm font-medium text-gray-700">While you answer, we're already doing this for free:</p>
          <div className="grid grid-cols-1 gap-3">
            {[
              { icon: TrendingUp, color: "text-blue-500 bg-blue-50", title: "Wedding search trends", desc: "Google Trends for your metro — engagement ring spikes, venue searches, week by week" },
              { icon: BarChart2, color: "text-green-500 bg-green-50", title: "Consumer confidence", desc: "Federal Reserve data — when people feel financially cautious, they delay weddings" },
              { icon: Cloud, color: "text-sky-500 bg-sky-50", title: "Weather risk by month", desc: "NOAA climate normals for your location — which months are genuinely risky for outdoor events" },
              { icon: Users, color: "text-purple-500 bg-purple-50", title: "Competitor landscape", desc: "Nearby venue ratings, review counts, and pricing signals" },
              { icon: Globe, color: "text-amber-500 bg-amber-50", title: "Local economic signals", desc: "Employment, income, and housing data for your Federal Reserve district" },
            ].map(({ icon: Icon, color, title, desc }) => (
              <div key={title} className="flex items-start gap-3 p-4 rounded-lg border border-gray-100 bg-gray-50">
                <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${color}`}>
                  <Icon size={15} />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">{title}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 leading-relaxed border-t border-gray-100 pt-4">
            Every metric about your business is shown alongside what's happening in the broader economy. When inquiries drop, we tell you whether it's a 'you' problem — or whether consumer confidence is down and even your strongest competitors are struggling.
          </p>
        </div>
      </StepShell>
    );
  }

  // Step 2: Awareness channels
  if (step === 2) {
    return (
      <StepShell step={2} totalSteps={TOTAL_STEPS}
        title="How do couples find out about you?"
        subtitle="Select everything that applies — even if it's occasional. This shapes how we attribute your inquiries."
        onBack={() => advance(1)} onSkip={() => advance(3)}
        onContinue={() => { savePartial({ onboarding_step: 3 }); advance(3); }}
        saving={saving}>
        <Chips options={AWARENESS_OPTIONS} selected={awarenessChannels} onChange={setAwarenessChannels} />
      </StepShell>
    );
  }

  // Step 3: First contact
  if (step === 3) {
    return (
      <StepShell step={3} totalSteps={TOTAL_STEPS}
        title="How do couples first reach out to you?"
        subtitle="After discovering you, what's their typical first move?"
        onBack={() => advance(2)} onSkip={() => advance(4)}
        onContinue={handleAwareness} saving={saving}>
        <Chips options={FIRST_TOUCH_OPTIONS} selected={firstTouchMethods} onChange={setFirstTouchMethods} />
      </StepShell>
    );
  }

  // Step 4: Tour + Contract
  if (step === 4) {
    return (
      <StepShell step={4} totalSteps={TOTAL_STEPS}
        title="How does the booking process work?"
        subtitle="This helps us track the right milestones and connect the right tools."
        onBack={() => advance(3)} onSkip={() => advance(5)}
        onContinue={handleFirstTouch} saving={saving}>
        <div className="space-y-8">
          <div>
            <p className="text-sm font-semibold text-gray-800 mb-3">How do you schedule venue tours?</p>
            <Chips options={TOUR_OPTIONS} selected={tourMethod ? [tourMethod] : []} onChange={v => setTourMethod(v[0] ?? "")} multi={false} />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-800 mb-3">How do contracts happen?</p>
            <Chips options={CONTRACT_OPTIONS} selected={contractMethod ? [contractMethod] : []} onChange={v => setContractMethod(v[0] ?? "")} multi={false} />
          </div>
        </div>
      </StepShell>
    );
  }

  // Step 5: Brand
  if (step === 5) {
    return (
      <StepShell step={5} totalSteps={TOTAL_STEPS}
        title="A bit about your brand"
        subtitle="We use this to find how people talk about you online and track your venue's name in search trends."
        onBack={() => advance(4)} onSkip={() => advance(6)}
        onContinue={handleTourContract} saving={saving}>
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Website URL</label>
            <input type="url" value={websiteUrl} onChange={e => setWebsiteUrl(e.target.value)} placeholder="https://rixeymanor.com"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Instagram handle <span className="text-gray-400 font-normal">(optional)</span></label>
            <div className="flex items-center">
              <span className="border border-r-0 border-gray-300 rounded-l-md px-3 py-2 text-sm text-gray-400 bg-gray-50">@</span>
              <input type="text" value={instagramHandle} onChange={e => setInstagramHandle(e.target.value)} placeholder="rixeymanor"
                className="flex-1 border border-gray-300 rounded-r-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Three words that describe your venue <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <p className="text-xs text-gray-400 mb-3">These seed our brand perception analysis — we'll compare them against what couples actually say in reviews.</p>
            <div className="flex gap-2">
              {brandWords.map((w, i) => (
                <input key={i} type="text" value={w}
                  onChange={e => setBrandWords(prev => { const n = [...prev]; n[i] = e.target.value; return n; })}
                  placeholder={["rustic", "elegant", "private"][i]}
                  className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              ))}
            </div>
          </div>
        </div>
      </StepShell>
    );
  }

  // Step 6: Economics
  if (step === 6) {
    const payingPlatforms = AD_PLATFORMS.filter(p => awarenessChannels.includes(p.value));
    return (
      <StepShell step={6} totalSteps={TOTAL_STEPS}
        title="What does your business look like financially?"
        subtitle="Estimates are completely fine here — we'll refine these automatically as real data comes in from your integrations."
        onBack={() => advance(5)} onSkip={() => advance(7)}
        onContinue={handleBrand} saving={saving}>
        <div className="space-y-8">
          <div>
            <p className="text-sm font-semibold text-gray-800 mb-1">Average wedding package value</p>
            <p className="text-xs text-gray-400 mb-3">All-in — venue fee, catering, bar, whatever you charge. Rough range is fine.</p>
            <RangeBuckets options={["Under $5k", "$5–10k", "$10–15k", "$15–20k", "$20–30k", "$30k+"]} selected={avgPackageBucket} onChange={setAvgPackageBucket} />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-800 mb-1">Monthly advertising spend</p>
            <p className="text-xs text-gray-400 mb-3">Total across all paid channels — listings, ads, etc.</p>
            <RangeBuckets options={["$0", "Under $500", "$500–1k", "$1–3k", "$3–5k", "$5k+"]} selected={adSpendBucket} onChange={setAdSpendBucket} />
          </div>
          {payingPlatforms.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-gray-800 mb-1">Which of these do you pay to advertise on?</p>
              <p className="text-xs text-gray-400 mb-3">We'll use this to calculate cost-per-inquiry and cost-per-booking by platform.</p>
              <Chips options={payingPlatforms} selected={adPlatforms} onChange={setAdPlatforms} />
            </div>
          )}
          <div>
            <p className="text-sm font-semibold text-gray-800 mb-1">Roughly, how many tours until one booking?</p>
            <p className="text-xs text-gray-400 mb-3">Your gut feel is fine — we'll calculate the real number from your tour data.</p>
            <RangeBuckets options={["1–2", "3–4", "5–7", "8+"]} selected={toursToBooking} onChange={setToursToBooking} />
          </div>
        </div>
      </StepShell>
    );
  }

  // Step 7: Analytics
  if (step === 7) {
    return (
      <StepShell step={7} totalSteps={TOTAL_STEPS}
        title="Do you track your website traffic?"
        subtitle="This lets us show you which traffic sources turn into actual inquiries."
        onBack={() => advance(6)} onSkip={() => advance(8)}
        onContinue={handleEconomics} saving={saving}>
        <div className="space-y-5">
          <Chips
            options={[
              { value: "google_analytics", label: "Google Analytics" },
              { value: "wix", label: "Wix Analytics" },
              { value: "squarespace", label: "Squarespace Analytics" },
              { value: "other", label: "Other / not sure" },
              { value: "none", label: "None" },
            ]}
            selected={analyticsPlatform ? [analyticsPlatform] : []}
            onChange={v => setAnalyticsPlatform(v[0] ?? "")}
            multi={false}
          />
          {analyticsPlatform === "google_analytics" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Google Analytics Measurement ID <span className="text-gray-400 font-normal">(optional)</span></label>
              <input type="text" value={gaId} onChange={e => setGaId(e.target.value)} placeholder="G-XXXXXXXXXX"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <p className="text-xs text-gray-400 mt-1">Found in Analytics → Admin → Data Streams</p>
            </div>
          )}
        </div>
      </StepShell>
    );
  }

  // Step 8: Integrations
  if (step === 8) {
    return (
      <StepShell step={8} totalSteps={TOTAL_STEPS}
        title="Let's connect your tools"
        subtitle="Based on your setup, here's what we can connect. Everything can also be done later in Settings."
        onBack={() => advance(7)} onSkip={() => advance(9)}
        onContinue={handleAnalytics} continueLabel="Save & continue" saving={saving}>
        {integrationCards.length === 0 ? (
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-5 text-sm text-gray-500">
            Your setup doesn't require any integrations right now. You can connect tools anytime in Settings as your needs grow.
          </div>
        ) : (
          <div className="space-y-4">
            {integrationCards.map(card => (
              <div key={card.id} className="rounded-lg border border-gray-200 p-5">
                <div className="flex items-start gap-3">
                  <span className="text-xl">{card.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{card.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{card.description}</p>
                    <p className="text-xs text-blue-600 mt-1.5">{card.unlocks}</p>
                    {card.field}
                    {card.hint && <p className="text-xs text-gray-400 mt-1.5">{card.hint}</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </StepShell>
    );
  }

  // Step 9: Done
  if (step === 9) {
    const profileItems = [
      awarenessChannels.length > 0 && { label: "Awareness channels", value: awarenessChannels.length + " configured", source: "Your answers" },
      tourMethod && { label: "Tour booking", value: TOUR_OPTIONS.find(o => o.value === tourMethod)?.label ?? tourMethod, source: "Your answers" },
      contractMethod && { label: "Contract method", value: CONTRACT_OPTIONS.find(o => o.value === contractMethod)?.label ?? contractMethod, source: "Your answers" },
      avgPackageBucket && { label: "Avg package value", value: avgPackageBucket, source: "Your estimate · will auto-refine" },
      adSpendBucket && { label: "Monthly ad spend", value: adSpendBucket, source: "Your estimate · will auto-refine" },
      toursToBooking && { label: "Tours per booking", value: toursToBooking, source: "Your estimate · will auto-refine" },
      websiteUrl && { label: "Website", value: websiteUrl, source: "Confirmed" },
      instagramHandle && { label: "Instagram", value: "@" + instagramHandle.replace(/^@/, ""), source: "Confirmed" },
    ].filter(Boolean) as Array<{ label: string; value: string; source: string }>;

    return (
      <StepShell step={9} totalSteps={TOTAL_STEPS}
        title="You're all set."
        subtitle="Your intelligence profile is live. The dashboard will get smarter as you connect more data — and we're already pulling macro signals in the background."
        onContinue={handleComplete} continueLabel="Go to my dashboard" saving={saving}>
        <div className="space-y-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Your profile so far</p>
          <div className="divide-y divide-gray-50 border border-gray-100 rounded-lg overflow-hidden">
            {profileItems.length > 0 ? profileItems.map(item => (
              <div key={item.label} className="flex items-center justify-between px-4 py-3 bg-white">
                <span className="text-sm text-gray-700">{item.label}</span>
                <div className="text-right">
                  <span className="text-sm font-medium text-gray-900">{item.value}</span>
                  <p className="text-xs text-gray-400">{item.source}</p>
                </div>
              </div>
            )) : (
              <div className="px-4 py-3 bg-white text-sm text-gray-400">No details added yet — you can fill these in from Settings.</div>
            )}
          </div>
          <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
            <p className="text-xs font-semibold text-blue-700 mb-2">Already tracking for you</p>
            <ul className="text-xs text-blue-600 space-y-1">
              <li>→ National consumer confidence (Federal Reserve, monthly)</li>
              <li>→ Wedding search trends in your metro (Google Trends, weekly)</li>
              <li>→ Weather risk for your location (NOAA, 3-year rolling)</li>
              <li>→ Competitor landscape in your radius</li>
            </ul>
          </div>
        </div>
      </StepShell>
    );
  }

  return null;
}
