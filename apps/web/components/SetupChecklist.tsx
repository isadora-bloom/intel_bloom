"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Check, ChevronRight, X, Loader2 } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChecklistStatus {
  funnelConfig: Record<string, any>;
  venueProfile: Record<string, any>;
  calendlyConnected: boolean;
  briefingEmail: string | null;
  emailConnected: boolean;
  clientCount: number;
  teamCount: number;
  venueName: string | null;
}

// ── Chip multi-select ─────────────────────────────────────────────────────────

function Chips({ options, selected, onChange }: {
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(opt => (
        <button key={opt.value} type="button"
          onClick={() => onChange(selected.includes(opt.value) ? selected.filter(x => x !== opt.value) : [...selected, opt.value])}
          className={`px-3 py-1.5 rounded-full border text-sm transition-colors ${
            selected.includes(opt.value) ? "bg-blue-600 border-blue-600 text-white" : "bg-white border-gray-200 text-gray-700 hover:border-gray-400"
          }`}>
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function RangeBuckets({ options, selected, onChange }: { options: string[]; selected: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(opt => (
        <button key={opt} type="button" onClick={() => onChange(opt)}
          className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
            selected === opt ? "bg-blue-600 border-blue-600 text-white" : "bg-white border-gray-200 text-gray-700 hover:border-gray-400"
          }`}>
          {opt}
        </button>
      ))}
    </div>
  );
}

// ── Modal wrapper ─────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors"><X size={18} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ── Individual modal content ───────────────────────────────────────────────────

const AWARENESS_OPTIONS = [
  { value: "the_knot", label: "The Knot" }, { value: "weddingwire", label: "WeddingWire" },
  { value: "zola", label: "Zola" }, { value: "google_search", label: "Google Search" },
  { value: "instagram", label: "Instagram" }, { value: "facebook", label: "Facebook" },
  { value: "reddit", label: "Reddit" }, { value: "ai_tools", label: "AI tools" },
  { value: "word_of_mouth", label: "Word of mouth" }, { value: "styled_shoots", label: "Styled shoots" },
  { value: "press", label: "Press / features" }, { value: "tiktok", label: "TikTok" },
  { value: "pinterest", label: "Pinterest" }, { value: "other", label: "Other" },
];

const FIRST_TOUCH_OPTIONS = [
  { value: "email", label: "Email" }, { value: "phone", label: "Phone call" },
  { value: "the_knot_inquiry", label: "The Knot inquiry" }, { value: "weddingwire_inquiry", label: "WeddingWire inquiry" },
  { value: "zola_inquiry", label: "Zola inquiry" }, { value: "website_form", label: "Website contact form" },
  { value: "book_tour_direct", label: "Book a tour directly" }, { value: "instagram_dm", label: "Instagram DM" },
];

const TOUR_OPTIONS = [
  { value: "calendly", label: "Calendly" }, { value: "acuity", label: "Acuity Scheduling" },
  { value: "manual_email", label: "Manual / email" }, { value: "phone_only", label: "Phone only" },
  { value: "no_tours", label: "No in-person tours" },
];

const CONTRACT_OPTIONS = [
  { value: "honeybook", label: "HoneyBook" }, { value: "dubsado", label: "Dubsado" },
  { value: "17hats", label: "17hats" }, { value: "manual", label: "Manual / PDF" }, { value: "other", label: "Other" },
];

// ── Main component ────────────────────────────────────────────────────────────

export default function SetupChecklist({ venueId }: { venueId: string }) {
  const { data: status, refetch } = trpc.venues.getChecklistStatus.useQuery();
  const saveSection = trpc.venues.saveOnboardingSection.useMutation({ onSuccess: () => refetch() });
  const inviteMember = trpc.venues.inviteTeamMember.useMutation({ onSuccess: () => { setInviteEmail(""); refetch(); } });

  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Modal state
  const [awareness, setAwareness] = useState<string[]>([]);
  const [firstTouch, setFirstTouch] = useState<string[]>([]);
  const [tourMethod, setTourMethod] = useState("");
  const [contractMethod, setContractMethod] = useState("");
  const [avgPackage, setAvgPackage] = useState("");
  const [adSpend, setAdSpend] = useState("");
  const [toursToBook, setToursToBook] = useState("");
  const [calendlyPat, setCalendlyPat] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [briefingEmail, setBriefingEmail] = useState("");

  if (!status || dismissed) return null;

  function openModal(id: string) {
    if (!status) return;
    // Pre-fill from existing data
    const fc = status.funnelConfig;
    const vp = status.venueProfile;
    if (id === "awareness") setAwareness(fc.awareness_channels ?? []);
    if (id === "first_touch") setFirstTouch(fc.first_touch_methods ?? []);
    if (id === "tour_contract") { setTourMethod(fc.tour_method ?? ""); setContractMethod(fc.contract_method ?? ""); }
    if (id === "economics") { setAvgPackage(vp.avg_package_value_bucket?.value ?? ""); setAdSpend(vp.monthly_ad_spend_bucket?.value ?? ""); setToursToBook(vp.typical_tours_per_booking_bucket?.value ?? ""); }
    if (id === "briefing") setBriefingEmail(status.briefingEmail ?? "");
    setActiveModal(id);
  }

  async function save(data: Parameters<typeof saveSection.mutate>[0]) {
    setSaving(true);
    await saveSection.mutateAsync(data);
    setSaving(false);
    setActiveModal(null);
  }

  function pf<T>(value: T) {
    return { value, source: "user_input", confidence: "confirmed", updatedAt: new Date().toISOString() };
  }

  // ── Checklist items ──────────────────────────────────────────────────────────

  const items = [
    {
      id: "awareness",
      title: "Where couples find you",
      description: "Shapes attribution across all your data",
      unlocks: "Source ROI · Cost per inquiry · Platform comparison",
      complete: (status.funnelConfig.awareness_channels?.length ?? 0) > 0,
      category: "Your funnel",
    },
    {
      id: "first_touch",
      title: "How couples first reach out",
      description: "Improves email scan accuracy and stage matching",
      unlocks: "Email matching · Pipeline stage tracking",
      complete: (status.funnelConfig.first_touch_methods?.length ?? 0) > 0,
      category: "Your funnel",
    },
    {
      id: "tour_contract",
      title: "Tour & contract tools",
      description: "Tells us which integrations matter for you",
      unlocks: "Calendly sync · HoneyBook import",
      complete: !!status.funnelConfig.tour_method,
      category: "Your funnel",
    },
    {
      id: "economics",
      title: "Your business economics",
      description: "We calculate your real cost-per-booking by source",
      unlocks: "CPA by platform · Revenue attribution · ROI comparison",
      complete: !!status.venueProfile.avg_package_value_bucket?.value,
      category: "Your profile",
    },
    {
      id: "gmail",
      title: "Connect Gmail",
      description: "Auto-extract source attribution from inquiry emails",
      unlocks: "Source attribution · Lead matching · Email timeline",
      complete: status.emailConnected,
      category: "Integrations",
      isLink: true,
      href: `/api/auth/google?venue_id=${venueId}`,
    },
    {
      id: "calendly",
      title: "Connect Calendly",
      description: "Auto-track tours and real conversion rates",
      unlocks: "Tour tracking · Real tours-per-booking · Pipeline velocity",
      complete: status.calendlyConnected,
      category: "Integrations",
    },
    {
      id: "client_history",
      title: "Import client history",
      description: "Upload your HoneyBook or spreadsheet export",
      unlocks: "Revenue analytics · Historical source ROI · Trend baselines",
      complete: status.clientCount > 0,
      category: "Integrations",
      isLink: true,
      href: "/settings",
    },
    {
      id: "team",
      title: "Invite your team",
      description: "Coordinators and assistants get their own access",
      unlocks: "Shared intelligence · Team collaboration",
      complete: status.teamCount > 1,
      category: "Your team",
    },
    {
      id: "briefing",
      title: "Weekly briefing email",
      description: "AI summary of your business and market, in your inbox",
      unlocks: "Weekly insights · Trend alerts · Action recommendations",
      complete: !!status.briefingEmail,
      category: "Your team",
    },
  ];

  const completedCount = items.filter(i => i.complete).length;
  const pct = Math.round((completedCount / items.length) * 100);

  // Group by category
  const categories = ["Your funnel", "Your profile", "Integrations", "Your team"];

  // Don't show if everything is done
  if (completedCount === items.length) return null;

  return (
    <>
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Finish setting up your profile</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {completedCount} of {items.length} complete — each item unlocks more insight
            </p>
          </div>
          <button onClick={() => setDismissed(true)} className="text-gray-300 hover:text-gray-500 transition-colors ml-4"><X size={16} /></button>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 bg-gray-100 rounded-full mb-5 overflow-hidden">
          <div className="h-full bg-blue-600 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>

        {/* Items by category */}
        <div className="space-y-5">
          {categories.map(cat => {
            const catItems = items.filter(i => i.category === cat);
            const allDone = catItems.every(i => i.complete);
            if (allDone) return null;
            return (
              <div key={cat}>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{cat}</p>
                <div className="space-y-2">
                  {catItems.map(item => (
                    <div key={item.id} className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                      item.complete ? "border-gray-100 bg-gray-50 opacity-60" : "border-gray-200 bg-white hover:border-gray-300"
                    }`}>
                      <div className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5 ${
                        item.complete ? "bg-green-500 border-green-500" : "border-gray-300"
                      }`}>
                        {item.complete && <Check size={11} className="text-white" strokeWidth={3} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${item.complete ? "text-gray-400 line-through" : "text-gray-900"}`}>{item.title}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{item.description}</p>
                        {!item.complete && (
                          <p className="text-xs text-blue-600 mt-0.5">Unlocks: {item.unlocks}</p>
                        )}
                      </div>
                      {!item.complete && (
                        (item as any).isLink ? (
                          <a href={(item as any).href} className="flex-shrink-0 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors">
                            Set up <ChevronRight size={13} />
                          </a>
                        ) : (
                          <button onClick={() => openModal(item.id)}
                            className="flex-shrink-0 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors">
                            Set up <ChevronRight size={13} />
                          </button>
                        )
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Modals ── */}

      {activeModal === "awareness" && (
        <Modal title="Where do couples find you?" onClose={() => setActiveModal(null)}>
          <p className="text-xs text-gray-500 mb-4">Select all that apply — even occasional sources. This shapes how we read attribution across all your data.</p>
          <Chips options={AWARENESS_OPTIONS} selected={awareness} onChange={setAwareness} />
          <button onClick={() => save({ funnelConfig: { awareness_channels: awareness } })} disabled={saving || !awareness.length}
            className="mt-5 w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-2">
            {saving && <Loader2 size={13} className="animate-spin" />} Save
          </button>
        </Modal>
      )}

      {activeModal === "first_touch" && (
        <Modal title="How do couples first reach out?" onClose={() => setActiveModal(null)}>
          <p className="text-xs text-gray-500 mb-4">After discovering you, what&apos;s their typical first move?</p>
          <Chips options={FIRST_TOUCH_OPTIONS} selected={firstTouch} onChange={setFirstTouch} />
          <button onClick={() => save({ funnelConfig: { first_touch_methods: firstTouch } })} disabled={saving || !firstTouch.length}
            className="mt-5 w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-2">
            {saving && <Loader2 size={13} className="animate-spin" />} Save
          </button>
        </Modal>
      )}

      {activeModal === "tour_contract" && (
        <Modal title="How does booking work?" onClose={() => setActiveModal(null)}>
          <div className="space-y-6">
            <div>
              <p className="text-sm font-medium text-gray-800 mb-3">How do you schedule tours?</p>
              <Chips options={TOUR_OPTIONS} selected={tourMethod ? [tourMethod] : []} onChange={v => setTourMethod(v[0] ?? "")} />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-800 mb-3">How do contracts happen?</p>
              <Chips options={CONTRACT_OPTIONS} selected={contractMethod ? [contractMethod] : []} onChange={v => setContractMethod(v[0] ?? "")} />
            </div>
          </div>
          <button onClick={() => save({ funnelConfig: { tour_method: tourMethod, contract_method: contractMethod } })} disabled={saving || (!tourMethod && !contractMethod)}
            className="mt-5 w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-2">
            {saving && <Loader2 size={13} className="animate-spin" />} Save
          </button>
        </Modal>
      )}

      {activeModal === "economics" && (
        <Modal title="Your business economics" onClose={() => setActiveModal(null)}>
          <p className="text-xs text-gray-500 mb-5">Estimates are fine — we refine these automatically as real data comes in. We use these to calculate your cost-per-booking by source.</p>
          <div className="space-y-6">
            <div>
              <p className="text-sm font-medium text-gray-800 mb-1">Average wedding package value</p>
              <p className="text-xs text-gray-400 mb-2">All-in — venue fee, catering, bar, whatever you charge.</p>
              <RangeBuckets options={["Under $5k","$5–10k","$10–15k","$15–20k","$20–30k","$30k+"]} selected={avgPackage} onChange={setAvgPackage} />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-800 mb-1">Monthly advertising spend</p>
              <p className="text-xs text-gray-400 mb-2">Total across all paid channels — listings, ads, etc.</p>
              <RangeBuckets options={["$0","Under $500","$500–1k","$1–3k","$3–5k","$5k+"]} selected={adSpend} onChange={setAdSpend} />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-800 mb-1">Tours until one booking</p>
              <p className="text-xs text-gray-400 mb-2">Your gut feel — we&apos;ll calculate the real number from your data.</p>
              <RangeBuckets options={["1–2","3–4","5–7","8+"]} selected={toursToBook} onChange={setToursToBook} />
            </div>
          </div>
          <button onClick={() => save({ venueProfile: {
            avg_package_value_bucket: avgPackage ? { value: avgPackage, source: "user_estimate", confidence: "estimated", updatedAt: new Date().toISOString() } : undefined,
            monthly_ad_spend_bucket: adSpend ? { value: adSpend, source: "user_estimate", confidence: "estimated", updatedAt: new Date().toISOString() } : undefined,
            typical_tours_per_booking_bucket: toursToBook ? { value: toursToBook, source: "user_estimate", confidence: "estimated", updatedAt: new Date().toISOString() } : undefined,
          }})} disabled={saving || (!avgPackage && !adSpend && !toursToBook)}
            className="mt-5 w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-2">
            {saving && <Loader2 size={13} className="animate-spin" />} Save
          </button>
        </Modal>
      )}

      {activeModal === "calendly" && (
        <Modal title="Connect Calendly" onClose={() => setActiveModal(null)}>
          <p className="text-xs text-gray-500 mb-4">
            Your Personal Access Token lets Bloom sync your tour history and track conversion rates automatically.
          </p>
          <input type="password" value={calendlyPat} onChange={e => setCalendlyPat(e.target.value)}
            placeholder="Paste your Personal Access Token"
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <p className="text-xs text-gray-400 mt-2">
            Find it at <span className="text-blue-600 font-medium">calendly.com → Integrations → API & Webhooks</span>
          </p>
          <button onClick={() => save({ calendlyApiKey: calendlyPat })} disabled={saving || !calendlyPat.trim()}
            className="mt-5 w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-2">
            {saving && <Loader2 size={13} className="animate-spin" />} Connect Calendly
          </button>
        </Modal>
      )}

      {activeModal === "team" && (
        <Modal title="Invite a team member" onClose={() => setActiveModal(null)}>
          <p className="text-xs text-gray-500 mb-4">They&apos;ll get an email with a link to join your venue&apos;s dashboard.</p>
          <div className="space-y-3">
            <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
              placeholder="coordinator@yourvenue.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <select value={inviteRole} onChange={e => setInviteRole(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="member">Member — view & edit data</option>
              <option value="admin">Admin — full access including settings</option>
            </select>
          </div>
          <button onClick={async () => { setSaving(true); await inviteMember.mutateAsync({ email: inviteEmail, role: inviteRole as "admin" | "member" }); setSaving(false); setActiveModal(null); }}
            disabled={saving || !inviteEmail.includes("@")}
            className="mt-5 w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-2">
            {saving && <Loader2 size={13} className="animate-spin" />} Send invitation
          </button>
        </Modal>
      )}

      {activeModal === "briefing" && (
        <Modal title="Weekly briefing email" onClose={() => setActiveModal(null)}>
          <p className="text-xs text-gray-500 mb-4">
            A short AI-written summary of your business and market, sent every Monday morning. No spam — you can turn it off anytime in Settings.
          </p>
          <input type="email" value={briefingEmail} onChange={e => setBriefingEmail(e.target.value)}
            placeholder="you@yourvenue.com"
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <button onClick={() => save({ briefingEmail })} disabled={saving || !briefingEmail.includes("@")}
            className="mt-5 w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-2">
            {saving && <Loader2 size={13} className="animate-spin" />} Save
          </button>
        </Modal>
      )}
    </>
  );
}
