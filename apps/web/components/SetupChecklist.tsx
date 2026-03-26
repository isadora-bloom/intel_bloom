"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Check, ChevronRight, X, Loader2 } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChecklistStatus {
  hasNoaaStation: boolean;
  hasTrends: boolean;
  hasFedDistrict: boolean;
  sageTone: string | null;
  onboardingComplete: boolean;
  clientCount: number;
  teamCount: number;
  city: string | null;
  state: string | null;
  venueName: string | null;
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

// ── Main component ────────────────────────────────────────────────────────────

export default function SetupChecklist({ venueId }: { venueId: string }) {
  const { data: status, refetch } = trpc.venues.getChecklistStatus.useQuery();
  const updateVenue = trpc.venues.update.useMutation({ onSuccess: () => refetch() });
  const inviteMember = trpc.venues.inviteTeamMember.useMutation({ onSuccess: () => { setInviteEmail(""); refetch(); } });

  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Team invite state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");

  if (!status || dismissed) return null;

  // ── Checklist items ──────────────────────────────────────────────────────────

  const items = [
    {
      id: "gmail",
      title: "Connect Gmail",
      description: "Auto-extract source attribution from inquiry emails",
      unlocks: "Source attribution · Lead matching · Email timeline",
      // No direct check on checklistStatus for email — link directs user to connect
      complete: false,
      category: "Integrations",
      isLink: true,
      href: `/api/auth/google?venue_id=${venueId}`,
    },
    {
      id: "client_history",
      title: "Import client history",
      description: "Upload your HoneyBook or spreadsheet export",
      unlocks: "Revenue analytics · Historical source ROI · Trend baselines",
      complete: status.clientCount > 0,
      category: "Integrations",
      isLink: true,
      href: "/import",
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
      id: "configure_sage",
      title: "Configure Sage",
      description: "Set your venue's NOAA station and intelligence signals",
      unlocks: "Weather risk · Macro signals · Trend data",
      // Use hasNoaaStation as proxy for "configured" (sageTone defaults to warm_professional)
      complete: status.hasNoaaStation,
      category: "Intelligence",
      isLink: true,
      href: "/settings",
    },
  ];

  const completedCount = items.filter(i => i.complete).length;
  const pct = Math.round((completedCount / items.length) * 100);

  // Group by category
  const categories = ["Integrations", "Your team", "Intelligence"];

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
                          <button onClick={() => setActiveModal(item.id)}
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

      {activeModal === "team" && (
        <Modal title="Invite a team member" onClose={() => setActiveModal(null)}>
          <p className="text-xs text-gray-500 mb-4">They&apos;ll get an email with a link to join your venue&apos;s dashboard.</p>
          <div className="space-y-3">
            <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
              placeholder="coordinator@yourvenue.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <select value={inviteRole} onChange={e => setInviteRole(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="member">Member — view &amp; edit data</option>
              <option value="admin">Admin — full access including settings</option>
            </select>
          </div>
          <button onClick={async () => {
            setSaving(true);
            await inviteMember.mutateAsync({ email: inviteEmail, role: inviteRole as "admin" | "member" });
            setSaving(false);
            setActiveModal(null);
          }}
            disabled={saving || !inviteEmail.includes("@")}
            className="mt-5 w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-2">
            {saving && <Loader2 size={13} className="animate-spin" />} Send invitation
          </button>
        </Modal>
      )}
    </>
  );
}
