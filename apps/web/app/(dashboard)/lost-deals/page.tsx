"use client";

import { trpc } from "@/lib/trpc/client";
import { useState } from "react";
import { format } from "date-fns";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { XCircle, Loader2, ChevronDown, ChevronUp } from "lucide-react";

// ── Label maps ───────────────────────────────────────────────────────────────

const STAGE_LABELS: Record<string, string> = {
  inquiry: "Inquiry",
  tour: "Tour",
  hold: "Hold",
  contract: "Contract",
};

const REASON_LABELS: Record<string, string> = {
  no_response: "No response",
  pricing: "Pricing",
  competitor: "Chose competitor",
  date_unavailable: "Date unavailable",
  ghosted: "Ghosted",
  changed_plans: "Changed plans",
  venue_mismatch: "Venue mismatch",
  budget_change: "Budget changed",
  other: "Other",
};

const REASON_OPTIONS = Object.entries(REASON_LABELS).map(([value, label]) => ({ value, label }));
const STAGE_OPTIONS = Object.entries(STAGE_LABELS).map(([value, label]) => ({ value, label }));

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-1">{label}</p>
      <p className="text-2xl font-semibold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Log form (inline expand) ──────────────────────────────────────────────────

function LogDealForm({
  prefillClientId,
  prefillClientName,
  onSuccess,
}: {
  prefillClientId?: string;
  prefillClientName?: string;
  onSuccess: () => void;
}) {
  const utils = trpc.useUtils();

  const { data: candidates } = trpc.lostDeals.autoDetect.useQuery();
  const record = trpc.lostDeals.record.useMutation({
    onSuccess: () => {
      utils.lostDeals.getStats.invalidate();
      utils.lostDeals.list.invalidate();
      utils.lostDeals.autoDetect.invalidate();
      onSuccess();
    },
  });

  const [clientSearch, setClientSearch] = useState(prefillClientName ?? "");
  const [clientId, setClientId] = useState(prefillClientId ?? "");
  const [stage, setStage] = useState<"inquiry" | "tour" | "hold" | "contract">("inquiry");
  const [reason, setReason] = useState("");
  const [competitor, setCompetitor] = useState("");
  const [notes, setNotes] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);

  const filteredCandidates = (candidates ?? []).filter(
    (c) =>
      clientSearch.length > 0 &&
      (c.name_primary?.toLowerCase().includes(clientSearch.toLowerCase()) ||
        c.name_partner?.toLowerCase().includes(clientSearch.toLowerCase()))
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!clientId) return;
    record.mutate({
      clientId,
      lostAtStage: stage,
      reasonCategory: reason ? (reason as Parameters<typeof record.mutate>[0]["reasonCategory"]) : undefined,
      competitorName: competitor || undefined,
      reasonDetail: notes || undefined,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 pt-4 border-t border-gray-100 mt-4">
      {/* Client search */}
      <div className="relative">
        <label className="block text-xs font-medium text-gray-700 mb-1">Client</label>
        <input
          type="text"
          value={clientSearch}
          onChange={(e) => {
            setClientSearch(e.target.value);
            setClientId("");
            setShowDropdown(true);
          }}
          onFocus={() => setShowDropdown(true)}
          placeholder="Type a name to search…"
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {showDropdown && filteredCandidates.length > 0 && (
          <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-md max-h-48 overflow-y-auto">
            {filteredCandidates.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setClientId(c.id);
                  setClientSearch(
                    c.name_primary + (c.name_partner ? ` & ${c.name_partner}` : "")
                  );
                  setShowDropdown(false);
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center justify-between"
              >
                <span className="font-medium text-gray-900">
                  {c.name_primary}
                  {c.name_partner ? ` & ${c.name_partner}` : ""}
                </span>
                <span className="text-xs text-gray-400 capitalize">{c.status}</span>
              </button>
            ))}
          </div>
        )}
        {clientId && (
          <p className="text-xs text-green-700 mt-1">Client selected</p>
        )}
      </div>

      {/* Stage + Reason row */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Stage lost at</label>
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value as typeof stage)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            {STAGE_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Reason category</label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">— select —</option>
            {REASON_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Competitor name */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Competitor name <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <input
          type="text"
          value={competitor}
          onChange={(e) => setCompetitor(e.target.value)}
          placeholder="e.g. Morais Vineyards"
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Notes */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Notes <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Any additional context…"
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!clientId || record.isPending}
          className="flex items-center gap-1.5 bg-gray-900 text-white text-sm px-4 py-2 rounded font-medium hover:bg-gray-700 disabled:opacity-40 transition-colors"
        >
          {record.isPending ? (
            <><Loader2 size={13} className="animate-spin" /> Saving…</>
          ) : (
            "Save lost deal"
          )}
        </button>
        {record.isSuccess && (
          <span className="text-xs text-green-700">Saved successfully</span>
        )}
        {record.isError && (
          <span className="text-xs text-red-600">Something went wrong</span>
        )}
      </div>
    </form>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LostDealsPage() {
  const [stageFilter, setStageFilter] = useState<string | undefined>();
  const [reasonFilter, setReasonFilter] = useState<string | undefined>();
  const [showForm, setShowForm] = useState(false);
  const [prefillId, setPrefillId] = useState<string | undefined>();
  const [prefillName, setPrefillName] = useState<string | undefined>();
  const [recoveryTarget, setRecoveryTarget] = useState<string | null>(null);
  const [recoveryOutcome, setRecoveryOutcome] = useState("");

  const utils = trpc.useUtils();

  const { data: stats, isLoading: statsLoading } = trpc.lostDeals.getStats.useQuery();
  const { data: deals, isLoading: dealsLoading } = trpc.lostDeals.list.useQuery({
    stage: stageFilter,
    reason: reasonFilter,
  });
  const { data: unlogged } = trpc.lostDeals.autoDetect.useQuery();

  const markRecovery = trpc.lostDeals.markRecoveryAttempt.useMutation({
    onSuccess: () => {
      utils.lostDeals.getStats.invalidate();
      utils.lostDeals.list.invalidate();
      setRecoveryTarget(null);
      setRecoveryOutcome("");
    },
  });

  const total = stats?.total ?? 0;
  const byStage = stats?.byStage ?? {};
  const inquiryPct = total > 0 ? Math.round(((byStage.inquiry ?? 0) / total) * 100) : 0;
  const tourPct = total > 0 ? Math.round(((byStage.tour ?? 0) / total) * 100) : 0;
  const holdContractPct =
    total > 0
      ? Math.round((((byStage.hold ?? 0) + (byStage.contract ?? 0)) / total) * 100)
      : 0;

  function handleLogSuccess() {
    setShowForm(false);
    setPrefillId(undefined);
    setPrefillName(undefined);
  }

  function openFormForClient(id: string, name: string) {
    setPrefillId(id);
    setPrefillName(name);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Lost Deals</h1>
          <p className="text-sm text-gray-500 mt-0.5">Where couples drop off and why</p>
        </div>
        <button
          onClick={() => {
            setShowForm((v) => !v);
            setPrefillId(undefined);
            setPrefillName(undefined);
          }}
          className="flex items-center gap-1.5 bg-gray-900 text-white text-sm px-4 py-2 rounded font-medium hover:bg-gray-700 transition-colors flex-shrink-0"
        >
          {showForm ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          Log lost deal
        </button>
      </div>

      {/* Inline log form */}
      {showForm && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-1">Log a lost deal</h2>
          <p className="text-xs text-gray-500">
            Recording a lost deal marks the client as lost and adds it to your analytics.
          </p>
          <LogDealForm
            prefillClientId={prefillId}
            prefillClientName={prefillName}
            onSuccess={handleLogSuccess}
          />
        </div>
      )}

      {/* Summary stat cards */}
      {statsLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-gray-100 rounded-lg h-24 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Total lost"
            value={total}
            sub={stats?.lostRate != null ? `${stats.lostRate}% overall loss rate` : undefined}
          />
          <StatCard
            label="Lost at inquiry"
            value={`${inquiryPct}%`}
            sub={`${byStage.inquiry ?? 0} deals`}
          />
          <StatCard
            label="Lost at tour"
            value={`${tourPct}%`}
            sub={`${byStage.tour ?? 0} deals`}
          />
          <StatCard
            label="Lost at hold / contract"
            value={`${holdContractPct}%`}
            sub={`${(byStage.hold ?? 0) + (byStage.contract ?? 0)} deals`}
          />
        </div>
      )}

      {/* Two-column: Why they leave + Competitor tracker */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Why they leave */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">Why they leave</h2>
          {!statsLoading && (stats?.topReasons ?? []).length === 0 ? (
            <p className="text-sm text-gray-400">No reason data yet — add reasons when logging deals.</p>
          ) : (
            <div className="space-y-3">
              {(stats?.topReasons ?? []).map(({ category, count }) => {
                const maxCount = Math.max(...(stats?.topReasons ?? []).map((r) => r.count), 1);
                const pct = Math.round((count / maxCount) * 100);
                return (
                  <div key={category}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-gray-700">
                        {REASON_LABELS[category] ?? category}
                      </span>
                      <span className="text-xs font-medium text-gray-500">{count}</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-red-400 rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Competitor tracker */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">Competitor loss tracker</h2>
          {!statsLoading && (stats?.topCompetitors ?? []).length === 0 ? (
            <p className="text-sm text-gray-400">
              No competitor data yet — add it when recording a lost deal.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase pb-2">Venue</th>
                  <th className="text-right text-xs font-medium text-gray-500 uppercase pb-2">
                    Lost to
                  </th>
                  <th className="text-right text-xs font-medium text-gray-500 uppercase pb-2">
                    Win rate vs.
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(stats?.topCompetitors ?? []).map(({ name, lostCount, winRate }) => (
                  <tr key={name}>
                    <td className="py-2 text-gray-900 font-medium">{name}</td>
                    <td className="py-2 text-right text-gray-600">{lostCount}×</td>
                    <td className="py-2 text-right">
                      {winRate != null ? (
                        <span
                          className={`text-xs font-medium ${winRate >= 50 ? "text-green-700" : "text-red-600"}`}
                        >
                          {winRate}%
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Monthly trend chart */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-800 mb-4">Monthly trend — last 12 months</h2>
        {statsLoading ? (
          <div className="h-40 bg-gray-100 rounded animate-pulse" />
        ) : (
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={stats?.monthlyTrend ?? []} barSize={18}>
              <XAxis
                dataKey="month"
                tick={{ fontSize: 11, fill: "#9ca3af" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: "#9ca3af" }}
                axisLine={false}
                tickLine={false}
                width={24}
              />
              <Tooltip
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 6,
                  border: "1px solid #e5e7eb",
                }}
                cursor={{ fill: "#f3f4f6" }}
              />
              <Bar dataKey="count" name="Lost" fill="#f87171" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Filters + Recent deals table */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
          <h2 className="text-sm font-semibold text-gray-800">Recent lost deals</h2>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Stage filter */}
            <select
              value={stageFilter ?? ""}
              onChange={(e) => setStageFilter(e.target.value || undefined)}
              className="border border-gray-300 rounded px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All stages</option>
              {STAGE_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            {/* Reason filter */}
            <select
              value={reasonFilter ?? ""}
              onChange={(e) => setReasonFilter(e.target.value || undefined)}
              className="border border-gray-300 rounded px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All reasons</option>
              {REASON_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </div>

        {dealsLoading ? (
          <div className="py-12 text-center text-gray-400 text-sm">Loading…</div>
        ) : (deals ?? []).length === 0 ? (
          <div className="py-12 text-center">
            <XCircle size={28} className="mx-auto text-gray-200 mb-3" />
            <p className="text-sm font-medium text-gray-500 mb-1">No lost deals recorded yet</p>
            <p className="text-xs text-gray-400">
              Use the &ldquo;Log lost deal&rdquo; button above to start tracking.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-6 px-6">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="border-b border-gray-200">
                <tr>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase pb-2 pr-4">Name</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase pb-2 pr-4">Stage lost</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase pb-2 pr-4">Reason</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase pb-2 pr-4">Competitor</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase pb-2 pr-4">Source</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase pb-2 pr-4">Date</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase pb-2">Recovery</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(deals ?? []).map((d: any) => {
                  const client = d.client;
                  const name = client
                    ? client.name_primary + (client.name_partner ? ` & ${client.name_partner}` : "")
                    : "—";
                  return (
                    <tr key={d.id} className="hover:bg-gray-50">
                      <td className="py-2.5 pr-4 font-medium text-gray-900">{name}</td>
                      <td className="py-2.5 pr-4">
                        <span className="text-xs bg-red-50 text-red-700 px-2 py-0.5 rounded-full capitalize">
                          {STAGE_LABELS[d.lost_at_stage] ?? d.lost_at_stage}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 text-gray-600 text-xs">
                        {d.reason_category
                          ? REASON_LABELS[d.reason_category] ?? d.reason_category
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-2.5 pr-4 text-gray-600 text-xs">
                        {d.competitor_name ?? <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-2.5 pr-4 text-xs text-gray-500">
                        {client?.resolved_source ?? <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-2.5 pr-4 text-xs text-gray-400">
                        {d.created_at
                          ? format(new Date(d.created_at), "MMM d, yyyy")
                          : "—"}
                      </td>
                      <td className="py-2.5">
                        {d.recovery_attempted ? (
                          <span className="text-xs text-gray-500">
                            {d.recovery_outcome ?? "Attempted"}
                          </span>
                        ) : recoveryTarget === d.id ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={recoveryOutcome}
                              onChange={(e) => setRecoveryOutcome(e.target.value)}
                              placeholder="Outcome…"
                              className="border border-gray-300 rounded px-2 py-1 text-xs w-28 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                            <button
                              onClick={() =>
                                markRecovery.mutate({ id: d.id, outcome: recoveryOutcome })
                              }
                              disabled={markRecovery.isPending || !recoveryOutcome}
                              className="text-xs bg-gray-900 text-white px-2 py-1 rounded disabled:opacity-40 hover:bg-gray-700"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setRecoveryTarget(null)}
                              className="text-xs text-gray-400 hover:text-gray-600 px-1"
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setRecoveryTarget(d.id)}
                            className="text-xs text-blue-600 hover:underline"
                          >
                            + Log attempt
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Unlogged clients */}
      {(unlogged ?? []).length > 0 && (
        <div className="bg-white rounded-lg border border-amber-200 p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-1">
            Unlogged lost clients
            <span className="ml-2 bg-amber-100 text-amber-700 text-xs px-2 py-0.5 rounded-full font-medium">
              {unlogged!.length}
            </span>
          </h2>
          <p className="text-xs text-gray-500 mb-4">
            These clients have a lost or archived status but no lost deal record. Log them to keep
            your analytics accurate.
          </p>
          <div className="space-y-2">
            {(unlogged ?? []).map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-4 py-2 border-b border-gray-100 last:border-0"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {c.name_primary}
                    {c.name_partner ? ` & ${c.name_partner}` : ""}
                  </p>
                  <p className="text-xs text-gray-400">
                    <span className="capitalize">{c.status}</span>
                    {c.inquired_at
                      ? ` · Inquired ${format(new Date(c.inquired_at), "MMM d, yyyy")}`
                      : ""}
                    {c.resolved_source ? ` · via ${c.resolved_source}` : ""}
                  </p>
                </div>
                <button
                  onClick={() =>
                    openFormForClient(
                      c.id,
                      c.name_primary + (c.name_partner ? ` & ${c.name_partner}` : "")
                    )
                  }
                  className="flex-shrink-0 text-xs bg-gray-900 text-white px-3 py-1.5 rounded font-medium hover:bg-gray-700 transition-colors"
                >
                  Log this
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
