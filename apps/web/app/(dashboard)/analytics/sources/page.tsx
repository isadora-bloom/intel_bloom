"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Legend, CartesianGrid,
} from "recharts";

// ── helpers ────────────────────────────────────────────────────────────────

function fmt$(cents: number | null | undefined, decimals = 0): string {
  if (!cents) return "—";
  return "$" + (cents / 100).toLocaleString(undefined, { maximumFractionDigits: decimals });
}
function pct(rate: number | null | undefined): string {
  if (rate == null) return "—";
  return (rate * 100).toFixed(1) + "%";
}
function shortMonth(ym: string): string {
  const [y, m] = ym.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return (months[parseInt(m, 10) - 1] ?? m) + " '" + y.slice(2);
}

const STATUS_COLOR: Record<string, string> = {
  inquiry:        "bg-gray-100 text-gray-600",
  tour_booked:    "bg-blue-100 text-blue-700",
  toured:         "bg-indigo-100 text-indigo-700",
  held:           "bg-violet-100 text-violet-700",
  contracted:     "bg-emerald-100 text-emerald-700",
  event_complete: "bg-green-100 text-green-700",
  archived:       "bg-gray-100 text-gray-400",
  lost:           "bg-red-100 text-red-500",
};

const INTENT_COLOR: Record<string, string> = {
  chosen:         "bg-emerald-100 text-emerald-700",
  also_contacted: "bg-amber-100 text-amber-700",
  unknown:        "bg-gray-100 text-gray-400",
};

// ── stat card ──────────────────────────────────────────────────────────────

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-semibold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ── intent comparison bar ──────────────────────────────────────────────────

function IntentBar({ chosen, blast, chosenRate, blastRate }: {
  chosen: number; blast: number;
  chosenRate: number | null; blastRate: number | null;
}) {
  const total = chosen + blast;
  if (total === 0) return <p className="text-sm text-gray-400">No intent data recorded.</p>;
  const chosenPct = Math.round((chosen / total) * 100);

  return (
    <div className="space-y-4">
      {/* proportion bar */}
      <div>
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>Chose you specifically ({chosen})</span>
          <span>Platform blast ({blast})</span>
        </div>
        <div className="h-4 rounded-full overflow-hidden flex bg-gray-100">
          <div
            className="bg-emerald-400 transition-all"
            style={{ width: `${chosenPct}%` }}
            title={`${chosenPct}% chose you specifically`}
          />
          <div
            className="bg-amber-300 flex-1 transition-all"
            title={`${100 - chosenPct}% platform blast`}
          />
        </div>
        <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
          <span>{chosenPct}% intentional</span>
          <span>{100 - chosenPct}% blast</span>
        </div>
      </div>

      {/* conversion split */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-md bg-emerald-50 p-3">
          <p className="text-xs font-medium text-emerald-700 mb-0.5">Intentional inquiries</p>
          <p className="text-xl font-semibold text-emerald-800">{pct(chosenRate)}</p>
          <p className="text-[11px] text-emerald-600 mt-0.5">booking rate ({chosen} inquiries)</p>
        </div>
        <div className="rounded-md bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-700 mb-0.5">Blast inquiries</p>
          <p className="text-xl font-semibold text-amber-800">{pct(blastRate)}</p>
          <p className="text-[11px] text-amber-600 mt-0.5">booking rate ({blast} inquiries)</p>
        </div>
      </div>

      <p className="text-xs text-gray-400">
        "Intentional" = couple marked you as their specific choice. "Blast" = platform sent your info alongside 10+ other venues.
        Intent is recorded from inquiries — if missing, this section won't populate.
      </p>
    </div>
  );
}

// ── custom tooltip ─────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-md shadow-sm text-xs p-2.5 min-w-32">
      <p className="font-medium text-gray-700 mb-1.5">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex justify-between gap-3 mb-0.5">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="font-medium text-gray-800">
            {p.dataKey === "spendCents" || p.dataKey === "revenueCents"
              ? fmt$(p.value)
              : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── main page ──────────────────────────────────────────────────────────────

export default function SourcesPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const initialSource = searchParams.get("source") ?? "";
  const [selectedSource, setSelectedSource] = useState(initialSource);

  const { data: sourceList } = trpc.analytics.listSources.useQuery();
  const { data: detail, isLoading } = trpc.analytics.getSourceDetail.useQuery(
    { source: selectedSource },
    { enabled: !!selectedSource },
  );

  function handleSourceChange(source: string) {
    setSelectedSource(source);
    router.replace(`/analytics/sources?source=${encodeURIComponent(source)}`, { scroll: false });
  }

  // Auto-select first source when list loads and no source chosen yet
  if (sourceList && sourceList.length > 0 && !selectedSource) {
    handleSourceChange(sourceList[0].source);
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">

      {/* Header + source picker */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <a href="/analytics" className="text-xs text-gray-400 hover:text-gray-600 mb-1 inline-block">
            ← Analytics
          </a>
          <h1 className="text-xl font-semibold text-gray-900">Lead Source Deep-Dive</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Funnel performance, spend efficiency, and intent quality per source.
          </p>
        </div>

        <div className="shrink-0">
          <label className="sr-only">Source</label>
          <select
            value={selectedSource}
            onChange={(e) => handleSourceChange(e.target.value)}
            className="block w-full sm:w-56 rounded-md border border-gray-300 bg-white py-2 px-3 text-sm text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {!sourceList && <option value="">Loading…</option>}
            {sourceList?.map((s) => (
              <option key={s.source} value={s.source}>
                {s.source} ({s.clientCount})
                {s.hasSpend ? " ✓" : ""}
              </option>
            ))}
          </select>
          {selectedSource && !detail?.totalSpend && (
            <p className="text-[11px] text-gray-400 mt-1 text-right">
              No spend data —{" "}
              <a href="/settings" className="text-blue-500 hover:underline">add in Settings</a>
            </p>
          )}
        </div>
      </div>

      {!selectedSource && (
        <div className="rounded-lg border border-gray-200 bg-white p-12 text-center text-gray-400 text-sm">
          Select a source above to see its deep-dive.
        </div>
      )}

      {selectedSource && isLoading && (
        <div className="rounded-lg border border-gray-200 bg-white p-12 text-center text-gray-400 text-sm animate-pulse">
          Loading…
        </div>
      )}

      {detail && (
        <>
          {/* ── Summary cards ── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Card label="Inquiries" value={String(detail.totalInquiries)}
              sub={`${pct(detail.bookingRate)} book`} />
            <Card label="Toured" value={String(detail.totalToured)}
              sub={`${pct(detail.tourRate)} of inquiries`} />
            <Card label="Booked" value={String(detail.totalBooked)}
              sub={detail.avgRevenueCents ? `avg ${fmt$(detail.avgRevenueCents)}` : undefined} />
            <Card label="Total revenue" value={fmt$(detail.totalRevenue)} />
            <Card label="Cost / tour"
              value={detail.costPerTour ? fmt$(detail.costPerTour) : "—"}
              sub={detail.totalSpend ? `${fmt$(detail.totalSpend)} total spend` : "no spend data"} />
            <Card label="Cost / booking"
              value={detail.costPerBooking ? fmt$(detail.costPerBooking) : "—"}
              sub={detail.avgTouchpoints != null ? `avg ${detail.avgTouchpoints} touchpoints` : undefined} />
          </div>

          {/* ── Monthly trend chart ── */}
          {detail.months.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-800 mb-4">Monthly trend</h2>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={detail.months.map(m => ({ ...m, label: shortMonth(m.yearMonth) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} />
                  <YAxis yAxisId="count" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={28} />
                  <YAxis yAxisId="spend" orientation="right" tick={{ fontSize: 11 }} tickLine={false} axisLine={false}
                    width={60} tickFormatter={(v) => v > 0 ? `$${(v / 100 / 1000).toFixed(0)}k` : ""} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="count" dataKey="inquiries" name="Inquiries" fill="#93c5fd" maxBarSize={32} />
                  <Bar yAxisId="count" dataKey="toured" name="Toured" fill="#6366f1" maxBarSize={32} />
                  <Bar yAxisId="count" dataKey="booked" name="Booked" fill="#10b981" maxBarSize={32} />
                  {detail.totalSpend > 0 && (
                    <Line yAxisId="spend" dataKey="spendCents" name="Spend" stroke="#f59e0b"
                      strokeWidth={1.5} dot={false} />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ── Intent breakdown + monthly table ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

            {/* Intent split */}
            <div className="bg-white rounded-lg border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-800 mb-4">Inquiry intent</h2>
              <IntentBar
                chosen={detail.totalChosen}
                blast={detail.totalBlast}
                chosenRate={detail.chosenBookingRate}
                blastRate={detail.blastBookingRate}
              />
            </div>

            {/* Quick stats */}
            <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
              <h2 className="text-sm font-semibold text-gray-800">Engagement depth</h2>

              <div className="space-y-3">
                <div className="flex justify-between items-baseline border-b border-gray-50 pb-2">
                  <span className="text-sm text-gray-600">Avg inquiries / month</span>
                  <span className="text-sm font-medium text-gray-900">
                    {detail.avgInquiriesPerMonth.toFixed(1)}
                    <span className="text-xs text-gray-400 ml-1">rolling 12mo</span>
                  </span>
                </div>
                <div className="flex justify-between items-baseline border-b border-gray-50 pb-2">
                  <span className="text-sm text-gray-600">Tour rate</span>
                  <span className="text-sm font-medium text-gray-900">{pct(detail.tourRate)}</span>
                </div>
                <div className="flex justify-between items-baseline border-b border-gray-50 pb-2">
                  <span className="text-sm text-gray-600">Booking rate</span>
                  <span className="text-sm font-medium text-gray-900">{pct(detail.bookingRate)}</span>
                </div>
                {detail.avgTouchpoints != null && (
                  <div className="flex justify-between items-baseline border-b border-gray-50 pb-2">
                    <span className="text-sm text-gray-600">Avg touchpoints per inquiry</span>
                    <span className="text-sm font-medium text-gray-900">{detail.avgTouchpoints}</span>
                  </div>
                )}
                {detail.totalSpend > 0 && (
                  <>
                    <div className="flex justify-between items-baseline border-b border-gray-50 pb-2">
                      <span className="text-sm text-gray-600">Total spend (all time)</span>
                      <span className="text-sm font-medium text-gray-900">{fmt$(detail.totalSpend)}</span>
                    </div>
                    <div className="flex justify-between items-baseline border-b border-gray-50 pb-2">
                      <span className="text-sm text-gray-600">Cost per tour</span>
                      <span className="text-sm font-medium text-gray-900">{fmt$(detail.costPerTour)}</span>
                    </div>
                    <div className="flex justify-between items-baseline">
                      <span className="text-sm text-gray-600">Cost per booking</span>
                      <span className="text-sm font-medium text-gray-900">{fmt$(detail.costPerBooking)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* ── Monthly breakdown table ── */}
          {detail.months.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-800 mb-3">Month-by-month breakdown</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-gray-500 uppercase border-b border-gray-100">
                    <tr>
                      <th className="text-left py-2 pr-4">Month</th>
                      <th className="text-right py-2 pr-4">Inquiries</th>
                      <th className="text-right py-2 pr-4">Toured</th>
                      <th className="text-right py-2 pr-4">Booked</th>
                      <th className="text-right py-2 pr-4">Revenue</th>
                      <th className="text-right py-2 pr-4">Spend</th>
                      <th className="text-right py-2 pr-4">Cost/tour</th>
                      <th className="text-right py-2">Cost/booking</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {[...detail.months].reverse().map((m) => {
                      const cpt = m.spendCents > 0 && m.toured > 0
                        ? Math.round(m.spendCents / m.toured) : null;
                      const cpb = m.spendCents > 0 && m.booked > 0
                        ? Math.round(m.spendCents / m.booked) : null;
                      return (
                        <tr key={m.yearMonth} className="hover:bg-gray-50 text-gray-600">
                          <td className="py-2 pr-4 font-medium text-gray-700">{shortMonth(m.yearMonth)}</td>
                          <td className="text-right py-2 pr-4">{m.inquiries || "—"}</td>
                          <td className="text-right py-2 pr-4">{m.toured || "—"}</td>
                          <td className="text-right py-2 pr-4">{m.booked || "—"}</td>
                          <td className="text-right py-2 pr-4">{m.revenueCents > 0 ? fmt$(m.revenueCents) : "—"}</td>
                          <td className="text-right py-2 pr-4 text-gray-400">
                            {m.spendCents > 0 ? fmt$(m.spendCents) : "—"}
                          </td>
                          <td className="text-right py-2 pr-4">{fmt$(cpt)}</td>
                          <td className="text-right py-2">{fmt$(cpb)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Individual clients ── */}
          {detail.clients.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-5">
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-800">Clients from this source</h2>
                <span className="text-xs text-gray-400">
                  {detail.clients.length < detail.totalInquiries
                    ? `Showing most recent ${detail.clients.length} of ${detail.totalInquiries}`
                    : `${detail.totalInquiries} total`}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-gray-500 uppercase border-b border-gray-100">
                    <tr>
                      <th className="text-left py-2 pr-4">Couple</th>
                      <th className="text-left py-2 pr-4">Inquired</th>
                      <th className="text-left py-2 pr-4">Event</th>
                      <th className="text-left py-2 pr-4">Status</th>
                      <th className="text-left py-2 pr-4">Intent</th>
                      <th className="text-right py-2 pr-4">Touchpoints</th>
                      <th className="text-right py-2">Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {detail.clients.map((c) => (
                      <tr key={c.id} className="hover:bg-gray-50">
                        <td className="py-2 pr-4 font-medium text-gray-800">
                          {c.name}
                          {c.partner ? <span className="text-gray-400"> & {c.partner}</span> : null}
                        </td>
                        <td className="py-2 pr-4 text-gray-500 text-xs">
                          {c.inquiredAt ? new Date(c.inquiredAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                        </td>
                        <td className="py-2 pr-4 text-gray-500 text-xs">
                          {c.eventDate ? new Date(c.eventDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                        </td>
                        <td className="py-2 pr-4">
                          <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLOR[c.status ?? ""] ?? "bg-gray-100 text-gray-500"}`}>
                            {(c.status ?? "—").replace("_", " ")}
                          </span>
                        </td>
                        <td className="py-2 pr-4">
                          {c.intent !== "unknown" ? (
                            <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium ${INTENT_COLOR[c.intent] ?? "bg-gray-100 text-gray-400"}`}>
                              {c.intent === "also_contacted" ? "blast" : c.intent}
                            </span>
                          ) : (
                            <span className="text-gray-300 text-xs">—</span>
                          )}
                        </td>
                        <td className="text-right py-2 pr-4 text-gray-500">
                          {c.touchpointCount > 0 ? c.touchpointCount : "—"}
                        </td>
                        <td className="text-right py-2 text-gray-700 font-medium">
                          {fmt$(c.revenueCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {detail.totalInquiries === 0 && (
            <div className="rounded-lg border border-gray-200 bg-white p-10 text-center text-gray-400 text-sm">
              No clients attributed to <strong className="text-gray-600">{selectedSource}</strong> yet.
            </div>
          )}
        </>
      )}
    </div>
  );
}
