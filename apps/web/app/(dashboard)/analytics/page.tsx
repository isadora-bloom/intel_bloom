"use client";

import { trpc } from "@/lib/trpc/client";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend, ComposedChart, Area,
} from "recharts";

const STAGE_COLORS = {
  saves:      "#94a3b8",  // slate — discovery / passive
  inquiries:  "#60a5fa",  // blue — active consideration
  tours:      "#f59e0b",  // amber — serious intent
  events:     "#10b981",  // green — booked / held wedding
  searchTrend:"#c084fc",  // purple — search interest
};

function pct(n: number | null) {
  if (n === null) return "—";
  return `${(n * 100).toFixed(0)}%`;
}

function days(n: number | null) {
  if (n === null) return "—";
  return `${n}d`;
}

export default function AnalyticsPage() {
  const { data: sourceROI }    = trpc.analytics.sourceROI.useQuery({});
  const { data: revenue }      = trpc.analytics.revenueOverTime.useQuery({ years: 3 });
  const { data: timelines }    = trpc.analytics.timelineBenchmarks.useQuery();
  const { data: funnel }       = trpc.analytics.funnelSeasonality.useQuery({ years: 3 });
  const { data: pipeline }     = trpc.analytics.stagePipeline.useQuery();

  const hasFunnelData = funnel && funnel.some(
    (m) => m.saves > 0 || m.inquiries > 0 || m.tours > 0 || m.events > 0
  );

  return (
    <div className="max-w-6xl space-y-8">
      <h1 className="text-2xl font-semibold text-gray-900">Analytics</h1>

      {/* ── FUNNEL PIPELINE (current snapshot) ── */}
      {pipeline && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Funnel pipeline</h2>
          <p className="text-xs text-gray-400 mb-4">
            Current records at each stage. Each stage is distinct — a save is not an inquiry.
          </p>

          {/* Stage flow */}
          <div className="flex items-stretch gap-0 mb-6 overflow-x-auto">
            {[
              { label: "Saves & visits", value: pipeline.stageCounts.discovery, color: STAGE_COLORS.saves, desc: "discovered you" },
              { label: "Inquiries", value: pipeline.stageCounts.inquiries, color: STAGE_COLORS.inquiries, desc: "reached out" },
              { label: "Touring", value: pipeline.stageCounts.touring, color: STAGE_COLORS.tours, desc: "actively touring" },
              { label: "On hold", value: pipeline.stageCounts.hold, color: "#f97316", desc: "hold placed" },
              { label: "Contracted", value: pipeline.stageCounts.contracted, color: "#22c55e", desc: "signed" },
              { label: "Events held", value: pipeline.stageCounts.completed, color: STAGE_COLORS.events, desc: "complete" },
            ].map((stage, i, arr) => (
              <div key={stage.label} className="flex items-center">
                <div className="flex flex-col items-center min-w-[100px] px-3 py-3 rounded-lg border border-gray-100 bg-gray-50">
                  <span className="text-2xl font-bold text-gray-900">{stage.value}</span>
                  <span className="text-xs font-medium text-gray-700 mt-0.5 text-center">{stage.label}</span>
                  <span className="text-xs text-gray-400 text-center">{stage.desc}</span>
                </div>
                {i < arr.length - 1 && (
                  <svg className="text-gray-300 mx-1 flex-shrink-0" width="16" height="16" viewBox="0 0 16 16">
                    <path d="M6 2l6 6-6 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/>
                  </svg>
                )}
              </div>
            ))}
          </div>

          {/* Conversion rates + lead times */}
          <div className="grid grid-cols-2 gap-6 text-sm">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Conversion rates</p>
              <div className="space-y-1.5">
                {[
                  ["Discovery → Inquiry", pipeline.conversionRates.discoveryToInquiry],
                  ["Inquiry → Toured",    pipeline.conversionRates.inquiryToTour],
                  ["Tour → Booked",       pipeline.conversionRates.tourToBook],
                ].map(([label, val]) => (
                  <div key={label as string} className="flex justify-between">
                    <span className="text-gray-500">{label as string}</span>
                    <span className="font-medium text-gray-900">{pct(val as number | null)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Median lead times</p>
              <div className="space-y-1.5">
                {[
                  ["Inquiry → event date",  pipeline.leadTimes.inquiryToEventDays],
                  ["Tour → contract",       pipeline.leadTimes.tourToContractDays],
                  ["Contract → event date", pipeline.leadTimes.contractToEventDays],
                ].map(([label, val]) => (
                  <div key={label as string} className="flex justify-between">
                    <span className="text-gray-500">{label as string}</span>
                    <span className="font-medium text-gray-900">{days(val as number | null)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── FUNNEL SEASONALITY ── */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Funnel seasonality</h2>
        <p className="text-xs text-gray-400 mb-4">
          Each stage peaks at a different time of year. Discovery spikes in winter (browsing season).
          Tours cluster in spring. Events peak May–Oct. Weather overlaid below.
        </p>

        {hasFunnelData ? (
          <div className="space-y-6">
            {/* Main multi-stage line chart */}
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={funnel} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="saves"     name="Saves / visits"   stroke={STAGE_COLORS.saves}      strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="inquiries" name="Inquiries"         stroke={STAGE_COLORS.inquiries}  strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="tours"     name="Tours completed"   stroke={STAGE_COLORS.tours}      strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="events"    name="Events held"       stroke={STAGE_COLORS.events}     strokeWidth={2} dot={false} />
                {funnel.some((m) => m.searchTrend !== null) && (
                  <Line type="monotone" dataKey="searchTrend" name="Search interest" stroke={STAGE_COLORS.searchTrend} strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
                )}
              </LineChart>
            </ResponsiveContainer>

            {/* Weather overlay */}
            {funnel.some((m) => m.weather.avgTemp !== null) && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Weather by month (avg)</p>
                <ResponsiveContainer width="100%" height={100}>
                  <ComposedChart data={funnel} margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="temp" domain={[20, 90]} tick={{ fontSize: 10 }} unit="°F" width={34} />
                    <YAxis yAxisId="precip" orientation="right" domain={[0, 6]} tick={{ fontSize: 10 }} unit="in" width={28} />
                    <Tooltip formatter={(v: any, name: string) => name === "Precip" ? `${v}in` : `${v}°F`} />
                    <Area yAxisId="precip" type="monotone" dataKey="weather.avgPrecip" name="Precip" fill="#bfdbfe" stroke="#93c5fd" strokeWidth={0} />
                    <Line yAxisId="temp" type="monotone" dataKey="weather.avgTemp" name="Avg temp" stroke="#f97316" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
                <p className="text-xs text-gray-400 mt-1">
                  Blue fill = precipitation. Orange = avg temperature. Events cluster where weather is best.
                  Discovery often spikes when weather is poor (people browse indoors).
                </p>
              </div>
            )}

            {/* Stage interpretation table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-100">
                    <th className="text-left py-1.5 pr-3 font-medium">Month</th>
                    <th className="text-right py-1.5 pr-3">Saves</th>
                    <th className="text-right py-1.5 pr-3">Inquiries</th>
                    <th className="text-right py-1.5 pr-3">Tours</th>
                    <th className="text-right py-1.5 pr-3">Events</th>
                    <th className="text-right py-1.5 pr-3">Avg temp</th>
                    <th className="text-right py-1.5">Search</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {funnel.map((row) => (
                    <tr key={row.month} className="hover:bg-gray-50">
                      <td className="py-1.5 pr-3 font-medium text-gray-700">{row.month}</td>
                      <td className="text-right py-1.5 pr-3 text-gray-600">{row.saves || "—"}</td>
                      <td className="text-right py-1.5 pr-3 text-gray-600">{row.inquiries || "—"}</td>
                      <td className="text-right py-1.5 pr-3 text-gray-600">{row.tours || "—"}</td>
                      <td className="text-right py-1.5 pr-3 text-gray-600">{row.events || "—"}</td>
                      <td className="text-right py-1.5 pr-3 text-gray-400">
                        {row.weather.avgTemp !== null ? `${row.weather.avgTemp}°F` : "—"}
                      </td>
                      <td className="text-right py-1.5 text-gray-400">{row.searchTrend ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="text-sm text-gray-400 space-y-1">
            <p>Not enough data yet to show seasonality patterns.</p>
            <p className="text-xs">Upload The Knot activity logs and historical inquiry data in Quick Capture to populate this.</p>
            <p className="text-xs">Set your NOAA station and Google Trends metro in Settings to add weather and search overlays.</p>
          </div>
        )}
      </div>

      {/* ── SOURCE ROI ── */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Source ROI</h2>
        <p className="text-xs text-gray-400 mb-4">
          Where clients came from and how well each source converts and retains.
        </p>
        {sourceROI && sourceROI.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500 uppercase border-b border-gray-200">
                <tr>
                  <th className="text-left py-2 pr-4">Source</th>
                  <th className="text-right py-2 pr-4">Inquiries</th>
                  <th className="text-right py-2 pr-4">Booked</th>
                  <th className="text-right py-2 pr-4">Conv. rate</th>
                  <th className="text-right py-2 pr-4">Avg revenue</th>
                  <th className="text-right py-2 pr-4">Complexity</th>
                  <th className="text-right py-2">Review rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {sourceROI.map((row: any) => (
                  <tr key={row.source} className="hover:bg-gray-50">
                    <td className="py-2.5 pr-4 font-medium text-gray-900">{row.source}</td>
                    <td className="text-right py-2.5 pr-4 text-gray-600">{row.inquiryCount}</td>
                    <td className="text-right py-2.5 pr-4 text-gray-600">{row.bookedCount}</td>
                    <td className="text-right py-2.5 pr-4 text-gray-600">{pct(row.conversionRate)}</td>
                    <td className="text-right py-2.5 pr-4 text-gray-600">
                      {row.avgRevenue ? `$${(row.avgRevenue / 100).toLocaleString()}` : "—"}
                    </td>
                    <td className="text-right py-2.5 pr-4 text-gray-600">{row.avgComplexityScore ?? "—"}</td>
                    <td className="text-right py-2.5 text-gray-600">{pct(row.reviewRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-400">No source data yet.</p>
        )}
      </div>

      {/* ── REVENUE OVER TIME ── */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Revenue over time</h2>
        {revenue && revenue.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={revenue}>
              <XAxis dataKey="period" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => `$${(v / 100000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: any) => `$${(v / 100).toLocaleString()}`} />
              <Bar dataKey="totalRevenue" fill="#3b82f6" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-sm text-gray-400">No revenue data yet.</p>
        )}
      </div>

      {/* ── TOUR → BOOKING TIMELINE ── */}
      {timelines && timelines.tourToBookingDays.sampleSize > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Tour → booking timeline</h2>
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "Fastest 25%", value: timelines.tourToBookingDays.p25 },
              { label: "Median",      value: timelines.tourToBookingDays.p50 },
              { label: "Slowest 25%", value: timelines.tourToBookingDays.p75 },
              { label: "Average",     value: timelines.tourToBookingDays.mean },
            ].map(({ label, value }) => (
              <div key={label} className="bg-gray-50 rounded p-3 text-center">
                <div className="text-xl font-semibold text-gray-900">{value ?? "—"}</div>
                <div className="text-xs text-gray-500 mt-0.5">{label}</div>
                <div className="text-xs text-gray-400">days</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-3">n={timelines.tourToBookingDays.sampleSize} bookings</p>
        </div>
      )}
    </div>
  );
}
