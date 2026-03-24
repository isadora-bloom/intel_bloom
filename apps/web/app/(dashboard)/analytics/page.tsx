"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend, ComposedChart, ReferenceLine, Cell,
} from "recharts";

// Rain score cell: light blue (dry) → deep blue (very wet)
function rainCellColor(score: number | null): string {
  if (score === null) return "#f3f4f6";
  const stops = ["#eff6ff","#dbeafe","#bfdbfe","#93c5fd","#60a5fa","#3b82f6","#2563eb","#1d4ed8","#1e40af","#1e3a8a","#172554"];
  return stops[Math.min(10, Math.max(0, score))];
}

// Heat score cell: green (ideal) → amber → red (extreme)
function heatCellColor(score: number | null): string {
  if (score === null) return "#f3f4f6";
  const stops = ["#f0fdf4","#dcfce7","#bbf7d0","#86efac","#fde68a","#fbbf24","#f97316","#ef4444","#dc2626","#b91c1c","#7f1d1d"];
  return stops[Math.min(10, Math.max(0, score))];
}

const TREND_LABEL: Record<string, { arrow: string; color: string; title: string }> = {
  rising:  { arrow: "↑", color: "text-red-500",   title: "Getting worse over the recorded years" },
  falling: { arrow: "↓", color: "text-green-600",  title: "Improving over the recorded years" },
  stable:  { arrow: "→", color: "text-gray-400",   title: "No clear trend" },
};

function WeatherHeatmap({
  label, scoreKey, subtitle, lowLabel, highLabel, cellColor, grid, years, trendKey, tooltipFn,
}: {
  label: string;
  scoreKey: "rainScore" | "heatScore";
  subtitle: string;
  lowLabel: string;
  highLabel: string;
  cellColor: (score: number | null) => string;
  grid: any[];
  years: number[];
  trendKey: "rainTrend" | "heatTrend";
  tooltipFn: (yearRow: any) => string | null;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1">
        <p className="text-xs font-medium text-gray-700">{label}</p>
        <p className="text-xs text-gray-400">{subtitle}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs border-separate border-spacing-0.5">
          <thead>
            <tr>
              <th className="text-left pr-2 pb-1 font-normal text-gray-400 w-8">Year</th>
              {grid.map((g) => (
                <th key={g.monthNum} className="text-center pb-1 font-normal text-gray-500 w-9">
                  {g.month}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {years.map((yr) => (
              <tr key={yr}>
                <td className="pr-2 text-gray-400 font-normal text-right">{yr}</td>
                {grid.map((g) => {
                  const yrRow = g.years.find((y: any) => y.year === yr);
                  const score = yrRow?.[scoreKey] ?? null;
                  const tip = yrRow ? tooltipFn(yrRow) : null;
                  return (
                    <td
                      key={g.monthNum}
                      title={tip ? `${g.month} ${yr}: score ${score} (${tip})` : `${g.month} ${yr}: no data`}
                      className="rounded w-9 h-7 text-center align-middle"
                      style={{ backgroundColor: cellColor(score) }}
                    >
                      {score !== null ? (
                        <span className={`text-[10px] font-medium ${score >= 6 ? "text-white" : "text-gray-700"}`}>{score}</span>
                      ) : (
                        <span className="text-[10px] text-gray-300">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {/* Trend row */}
            <tr>
              <td className="pr-2 text-gray-400 text-right pt-1">trend</td>
              {grid.map((g) => {
                const t = g[trendKey] as string | null;
                const info = t ? TREND_LABEL[t] : null;
                return (
                  <td key={g.monthNum} className="text-center pt-1" title={info?.title}>
                    {info ? (
                      <span className={`text-sm font-bold ${info.color}`}>{info.arrow}</span>
                    ) : (
                      <span className="text-xs text-gray-200">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
        {/* Legend */}
        <div className="flex items-center gap-2 mt-2">
          <span className="text-[10px] text-gray-400">{lowLabel}</span>
          {[0,1,2,3,4,5,6,7,8,9,10].map(s => (
            <div key={s} className="w-4 h-3 rounded-sm" style={{ backgroundColor: cellColor(s) }} />
          ))}
          <span className="text-[10px] text-gray-400">{highLabel}</span>
        </div>
      </div>
    </div>
  );
}

const STAGE_COLORS = {
  saves:           "#94a3b8",  // slate — discovery / passive
  inquiries:       "#60a5fa",  // blue — active consideration
  tours:           "#f59e0b",  // amber — serious intent
  events:          "#10b981",  // green — booked / held wedding
  searchTrend:     "#c084fc",  // purple — wedding venue search interest
  engagementTrend: "#f43f5e",  // rose — engagement ring searches (leading indicator)
  divorceTrend:    "#64748b",  // slate-500 — divorce searches (confidence dampener)
};

function pct(n: number | null) {
  if (n === null) return "—";
  return `${(n * 100).toFixed(0)}%`;
}

function days(n: number | null) {
  if (n === null) return "—";
  return `${n}d`;
}

function formatMinutes(mins: number | null | undefined): string {
  if (mins == null) return "—";
  if (mins < 60) return `${Math.round(mins)} min`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return m > 0 ? `${h} hrs ${m} min` : `${h} hrs`;
}

function formatCurrency(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toLocaleString()}`;
}

function formatDaysAsMonths(d: number | null | undefined): string {
  if (d == null) return "—";
  const months = Math.round(d / 30.4);
  return `${months} mo`;
}

const MONTH_ABBR: Record<string, string> = {
  "01": "Jan", "02": "Feb", "03": "Mar", "04": "Apr",
  "05": "May", "06": "Jun", "07": "Jul", "08": "Aug",
  "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dec",
};

function periodToMonthAbbr(period: string): string {
  // period format: "2025-01" → "Jan"
  const parts = period.split("-");
  if (parts.length >= 2) {
    return MONTH_ABBR[parts[1]] ?? period;
  }
  return period;
}

const LOST_REASON_COLORS: Record<string, string> = {
  date_taken:        "#ef4444",
  chose_competitor:  "#f87171",
  too_expensive:     "#fbbf24",
  budget_cut:        "#9ca3af",
  postponed:         "#9ca3af",
  no_response:       "#dc2626",
  other:             "#6b7280",
};

function lostReasonColor(reason: string): string {
  return LOST_REASON_COLORS[reason] ?? "#6b7280";
}

function lostReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    date_taken:       "Date taken",
    chose_competitor: "Chose competitor",
    too_expensive:    "Too expensive",
    budget_cut:       "Budget cut",
    postponed:        "Postponed",
    no_response:      "No response",
    other:            "Other",
  };
  return labels[reason] ?? reason;
}

const CURRENT_MONTH = new Date().toISOString().slice(0, 7); // "2025-03"

function periodToDateFrom(period: "1m" | "3m" | "6m" | "1y" | "all"): string | undefined {
  if (period === "all") return undefined;
  const now = new Date();
  if (period === "1m") now.setMonth(now.getMonth() - 1);
  else if (period === "3m") now.setMonth(now.getMonth() - 3);
  else if (period === "6m") now.setMonth(now.getMonth() - 6);
  else if (period === "1y") now.setFullYear(now.getFullYear() - 1);
  return now.toISOString().split("T")[0];
}

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<"1m" | "3m" | "6m" | "1y" | "all">("1y");
  const dateFrom = periodToDateFrom(period);

  const { data: sourceROI }         = trpc.analytics.sourceROI.useQuery({ dateFrom });
  const { data: revenue }           = trpc.analytics.revenueOverTime.useQuery({ years: 3, dateFrom });
  const { data: timelines }         = trpc.analytics.timelineBenchmarks.useQuery();
  const { data: funnel }            = trpc.analytics.funnelSeasonality.useQuery({ years: 3 });
  const { data: pipeline }          = trpc.analytics.stagePipeline.useQuery();
  const { data: holdAlerts }        = trpc.analytics.getHoldAlerts.useQuery();
  const { data: lostReasons }       = trpc.analytics.getLostReasons.useQuery();
  const { data: bookingHorizon }    = trpc.analytics.getBookingHorizon.useQuery();
  const { data: capacityOutlook }   = trpc.analytics.getCapacityOutlook.useQuery();
  const { data: responseTimes }     = trpc.analytics.getResponseTimes.useQuery();
  const { data: revenueProjection } = trpc.analytics.getRevenueProjection.useQuery();
  const { data: reviewLanguage }    = trpc.analytics.getReviewLanguage.useQuery();
  const { data: websiteTraffic }    = trpc.analytics.getWebsiteTraffic.useQuery({ months: 12 });

  const funnelMonths = funnel?.months ?? [];
  const hasFunnelData = funnelMonths.some(
    (m) => m.saves > 0 || m.inquiries > 0 || m.tours > 0 || m.events > 0
  );
  const hasWeatherData = (funnel?.weatherGrid ?? []).some(g =>
    g.years.some((y: any) => y.rainScore !== null || y.heatScore !== null)
  );

  // Trim capacity outlook to only rows with actual data
  const trimmedCapacity = (capacityOutlook ?? []).filter(
    (row: any) => row.contractedEvents > 0 || row.scheduledTours > 0
  );

  return (
    <div className="max-w-6xl space-y-8">
      <h1 className="text-2xl font-semibold text-gray-900">Analytics</h1>

      {/* Period selector */}
      <div className="flex items-center gap-2">
        {(["1m", "3m", "6m", "1y", "all"] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              period === p
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
            }`}
          >
            {p === "1m" ? "1 month" : p === "3m" ? "3 months" : p === "6m" ? "6 months" : p === "1y" ? "1 year" : "All time"}
          </button>
        ))}
      </div>

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

      {/* ── HOLDS & PIPELINE ── */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Holds &amp; pipeline</h2>
        <p className="text-xs text-gray-400 mb-4">
          Active holds with upcoming expiry dates. Reach out before they lapse.
        </p>
        {holdAlerts && holdAlerts.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500 uppercase border-b border-gray-200">
                <tr>
                  <th className="text-left py-2 pr-4">Couple</th>
                  <th className="text-right py-2 pr-4">Event date</th>
                  <th className="text-right py-2 pr-4">Revenue</th>
                  <th className="text-right py-2 pr-4">Hold expires</th>
                  <th className="text-right py-2">Days left</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {holdAlerts.map((row: any) => (
                  <tr
                    key={row.id}
                    className={row.urgent
                      ? "bg-red-50 hover:bg-red-100"
                      : row.daysLeft <= 7
                      ? "bg-amber-50 hover:bg-amber-100"
                      : "hover:bg-gray-50"
                    }
                  >
                    <td className="py-2.5 pr-4 font-medium text-gray-900">{row.name}</td>
                    <td className="text-right py-2.5 pr-4 text-gray-600">
                      {new Date(row.eventDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </td>
                    <td className="text-right py-2.5 pr-4 text-gray-600">
                      {formatCurrency(row.revenueCents)}
                    </td>
                    <td className="text-right py-2.5 pr-4 text-gray-600">
                      {new Date(row.holdExpiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </td>
                    <td className={`text-right py-2.5 font-medium ${row.urgent ? "text-red-600" : row.daysLeft <= 7 ? "text-amber-600" : "text-gray-700"}`}>
                      {row.daysLeft}d
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-400 text-center py-4">No active holds</p>
        )}
      </div>

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
              <LineChart data={funnelMonths} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="saves"     name="Saves / visits"   stroke={STAGE_COLORS.saves}      strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="inquiries" name="Inquiries"         stroke={STAGE_COLORS.inquiries}  strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="tours"     name="Tours completed"   stroke={STAGE_COLORS.tours}      strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="events"    name="Events held"       stroke={STAGE_COLORS.events}     strokeWidth={2} dot={false} />
                {funnelMonths.some((m) => m.searchTrend !== null) && (
                  <Line type="monotone" dataKey="searchTrend" name="Venue searches" stroke={STAGE_COLORS.searchTrend} strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
                )}
                {funnelMonths.some((m) => m.engagementTrend !== null) && (
                  <Line type="monotone" dataKey="engagementTrend" name="Engagement ring searches ↑ pipeline" stroke={STAGE_COLORS.engagementTrend} strokeWidth={1.5} strokeDasharray="2 3" dot={false} />
                )}
                {funnelMonths.some((m) => m.divorceTrend !== null) && (
                  <Line type="monotone" dataKey="divorceTrend" name="Divorce searches ↓ confidence" stroke={STAGE_COLORS.divorceTrend} strokeWidth={1} strokeDasharray="1 4" dot={false} />
                )}
              </LineChart>
            </ResponsiveContainer>

            {/* Stage interpretation table with YoY */}
            <div className="overflow-x-auto">
              <p className="text-xs text-gray-400 mb-1">
                YoY = {funnel?.currentYear ?? "this year"} vs {funnel?.priorYear ?? "last year"} (same month).
                <span className="text-green-600 ml-1">Green = up</span>, <span className="text-red-500 ml-1">red = down</span>.
              </p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-100">
                    <th className="text-left py-1.5 pr-3 font-medium">Month</th>
                    <th className="text-right py-1.5 pr-3">Saves</th>
                    <th className="text-right py-1.5 pr-2 text-gray-300">vs LY</th>
                    <th className="text-right py-1.5 pr-3">Inquiries</th>
                    <th className="text-right py-1.5 pr-2 text-gray-300">vs LY</th>
                    <th className="text-right py-1.5 pr-3">Tours</th>
                    <th className="text-right py-1.5 pr-3">Events</th>
                    <th className="text-right py-1.5 pr-3">Avg temp</th>
                    <th className="text-right py-1.5 pr-3" title="Venue search interest">Venue</th>
                    <th className="text-right py-1.5 pr-3" title="Engagement ring searches — leading indicator">Ring 💍</th>
                    <th className="text-right py-1.5" title="Divorce searches — confidence signal">Divorce</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {funnelMonths.map((row) => {
                    function yoyDelta(curr: number, prev: number) {
                      if (!prev && !curr) return null;
                      if (!prev) return null;
                      const pct = Math.round(((curr - prev) / prev) * 100);
                      const color = pct > 0 ? "text-green-600" : pct < 0 ? "text-red-500" : "text-gray-400";
                      return <span className={color}>{pct > 0 ? `+${pct}%` : `${pct}%`}</span>;
                    }
                    return (
                      <tr key={row.month} className="hover:bg-gray-50">
                        <td className="py-1.5 pr-3 font-medium text-gray-700">{row.month}</td>
                        <td className="text-right py-1.5 pr-3 text-gray-600">{row.yoy.savesThis || "—"}</td>
                        <td className="text-right py-1.5 pr-2 text-gray-400">
                          {yoyDelta(row.yoy.savesThis, row.yoy.savesLast) ?? "—"}
                        </td>
                        <td className="text-right py-1.5 pr-3 text-gray-600">{row.yoy.inqThis || "—"}</td>
                        <td className="text-right py-1.5 pr-2 text-gray-400">
                          {yoyDelta(row.yoy.inqThis, row.yoy.inqLast) ?? "—"}
                        </td>
                        <td className="text-right py-1.5 pr-3 text-gray-600">{row.tours || "—"}</td>
                        <td className="text-right py-1.5 pr-3 text-gray-600">{row.events || "—"}</td>
                        <td className="text-right py-1.5 pr-3 text-gray-400">
                          {row.weather.avgTemp !== null ? `${row.weather.avgTemp}°F` : "—"}
                        </td>
                        <td className="text-right py-1.5 pr-3 text-gray-400">{row.searchTrend ?? "—"}</td>
                        <td className="text-right py-1.5 pr-3 text-rose-400">{row.engagementTrend ?? "—"}</td>
                        <td className="text-right py-1.5 text-slate-400">{row.divorceTrend ?? "—"}</td>
                      </tr>
                    );
                  })}
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

      {/* ── WEATHER HEATMAPS ── */}
      {hasWeatherData && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
          <div>
            <h2 className="text-base font-semibold text-gray-900 mb-1">Weather risk by month</h2>
            <p className="text-xs text-gray-400">
              Each cell = one year. Darker = higher risk. Trend arrows show whether risk is rising or falling over the recorded years.
            </p>
          </div>

          <WeatherHeatmap
            label="Rain risk"
            scoreKey="rainScore"
            subtitle="How wet each month has been. Higher score = more precipitation."
            lowLabel="Dry"
            highLabel="Very wet"
            cellColor={rainCellColor}
            grid={funnel!.weatherGrid}
            years={funnel!.weatherYears}
            trendKey="rainTrend"
            tooltipFn={(y: any) => y.precip !== null ? `${y.precip}"` : null}
          />

          <WeatherHeatmap
            label="Temperature discomfort"
            scoreKey="heatScore"
            subtitle="How uncomfortable the temperature is for an outdoor event. 0 = ideal (65–78°F). Rises toward freezing or sweltering."
            lowLabel="Ideal"
            highLabel="Extreme"
            cellColor={heatCellColor}
            grid={funnel!.weatherGrid}
            years={funnel!.weatherYears}
            trendKey="heatTrend"
            tooltipFn={(y: any) => y.tempAvg !== null ? `${y.tempAvg}°F avg` : null}
          />
        </div>
      )}

      {/* ── SOURCE ROI ── */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="text-base font-semibold text-gray-900">Source ROI</h2>
          {period !== "all" && <span className="text-xs text-gray-400">Filtered: last {period === "1m" ? "month" : period === "3m" ? "3 months" : period === "6m" ? "6 months" : "year"}</span>}
        </div>
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
                  <th className="text-right py-2 pr-4">Review rate</th>
                  <th className="text-right py-2 pr-4 text-[10px]">Spend</th>
                  <th className="text-right py-2 pr-4 text-[10px]">Cost/booking</th>
                  <th className="text-right py-2 text-[10px]">Cost/$1 rev</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {sourceROI.map((row: any) => (
                  <tr key={row.source} className="hover:bg-gray-50">
                    <td className="py-2.5 pr-4 font-medium text-gray-900">
                      {row.source}
                      {/* Intent breakdown sub-line */}
                      {(row.blastRate > 0 || (row.chosenConversionRate != null && Math.abs(row.chosenConversionRate - row.conversionRate) >= 5)) && (
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {row.blastRate > 0 && (
                            <span className="text-[10px] px-1.5 py-0 rounded-full bg-amber-100 text-amber-700 font-medium leading-4">
                              {Math.round(row.blastRate)}% blast
                            </span>
                          )}
                          {row.chosenConversionRate != null && Math.abs(row.chosenConversionRate - row.conversionRate) >= 5 && (
                            <span className="text-[10px] text-gray-400" title="Conversion rate among inquiries that chose you specifically (excluding blast)">
                              {pct(row.chosenConversionRate)} chosen only
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="text-right py-2.5 pr-4 text-gray-600">{row.inquiryCount}</td>
                    <td className="text-right py-2.5 pr-4 text-gray-600">{row.bookedCount}</td>
                    <td className="text-right py-2.5 pr-4 text-gray-600">{pct(row.conversionRate)}</td>
                    <td className="text-right py-2.5 pr-4 text-gray-600">
                      {row.avgRevenue ? `$${(row.avgRevenue / 100).toLocaleString()}` : "—"}
                    </td>
                    <td className="text-right py-2.5 pr-4 text-gray-600">{row.avgComplexityScore ?? "—"}</td>
                    <td className="text-right py-2.5 pr-4 text-gray-600">{pct(row.reviewRate)}</td>
                    <td className="text-right py-2.5 pr-4 text-xs text-gray-500">
                      {row.spendCents > 0
                        ? `$${(row.spendCents / 100).toLocaleString()}/mo`
                        : <a href="/settings#spend" className="text-gray-400 hover:text-gray-600 text-[10px]">Add spend →</a>}
                    </td>
                    <td className="text-right py-2.5 pr-4 text-xs text-gray-500">
                      {row.costPerBooking != null
                        ? `$${(row.costPerBooking / 100).toLocaleString()}`
                        : "—"}
                    </td>
                    <td className="text-right py-2.5 text-xs text-gray-500">
                      {row.costPerRevenueDollar != null
                        ? `$${(row.costPerRevenueDollar / 100).toFixed(2)}`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-400">No source data yet.</p>
        )}
      </div>

      {/* ── LOST DEAL ANALYSIS ── */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Why leads didn&apos;t convert</h2>
        <p className="text-xs text-gray-400 mb-4">
          Patterns from archived leads. Use this to spot fixable drop-off.
        </p>
        {lostReasons && lostReasons.total > 0 ? (
          <div className="space-y-4">
            {/* Total revenue not captured */}
            <div className="inline-flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
              <span className="text-sm text-amber-800 font-medium">
                Total revenue not captured:
              </span>
              <span className="text-sm font-semibold text-amber-900">
                {formatCurrency(lostReasons.breakdown.reduce((sum: number, r: any) => sum + (r.revenueLostCents ?? 0), 0))}
              </span>
            </div>

            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={lostReasons.breakdown.map((r: any) => ({
                  ...r,
                  label: lostReasonLabel(r.reason),
                  fill: lostReasonColor(r.reason),
                }))}
                layout="vertical"
                margin={{ top: 4, right: 60, bottom: 0, left: 120 }}
              >
                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} width={115} />
                <Tooltip
                  formatter={(value: any, name: any, props: any) =>
                    [`${value} (${props.payload.pct}%)`, "Count"]
                  }
                />
                <Bar dataKey="count" radius={[0, 3, 3, 0]}>
                  {lostReasons.breakdown.map((r: any, index: number) => (
                    <Cell key={index} fill={lostReasonColor(r.reason)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm text-gray-400">
            No archived leads yet — when you archive a client, you&apos;ll be asked why.
            This chart shows patterns over time.
          </p>
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

      {/* ── REVENUE PROJECTION ── */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Revenue projection</h2>
        <p className="text-xs text-gray-400 mb-4">
          Contracted and estimated revenue for the next 12 months. Projected figures use your average package value where actual contracts aren&apos;t signed yet.
        </p>

        {revenueProjection ? (
          <div className="space-y-4">
            {/* Stat cards */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-blue-50 rounded-lg p-4">
                <p className="text-xs text-blue-600 font-medium uppercase tracking-wide mb-1">Contracted (next 12 mo)</p>
                <p className="text-2xl font-bold text-blue-900">
                  {formatCurrency(revenueProjection.totalContractedRevenue)}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Projected (next 12 mo)</p>
                <p className="text-2xl font-bold text-gray-800">
                  {formatCurrency(revenueProjection.totalProjectedRevenue)}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">(estimated)</p>
              </div>
            </div>

            {/* Composed chart */}
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart
                data={revenueProjection.months.map((m: any) => ({
                  ...m,
                  label: periodToMonthAbbr(m.period),
                  actual: m.isProjection ? null : m.actualRevenue / 100,
                  projected: m.isProjection ? m.projectedRevenue / 100 : null,
                }))}
                margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
              >
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(value: any, name: string) => [
                    `$${Number(value).toLocaleString()}`,
                    name === "actual" ? "Actual" : "Projected",
                  ]}
                  labelFormatter={(label) => label}
                />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine x={periodToMonthAbbr(CURRENT_MONTH)} stroke="#9ca3af" strokeDasharray="4 2" label={{ value: "Today", fontSize: 10, fill: "#9ca3af" }} />
                <Bar dataKey="actual" name="Actual" fill="#2563eb" radius={[3, 3, 0, 0]} />
                <Bar dataKey="projected" name="Projected" fill="#bfdbfe" radius={[3, 3, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm text-gray-400">
            No revenue data yet — import clients or connect HoneyBook to populate this chart.
          </p>
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

      {/* ── PLANNING INTELLIGENCE ── */}
      <div className="space-y-6">
        <h2 className="text-lg font-semibold text-gray-900">Planning intelligence</h2>

        {/* Booking Horizon */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-base font-semibold text-gray-900 mb-1">How far in advance couples book</h3>
          <p className="text-xs text-gray-400 mb-4">
            Days between inquiry and event date, bucketed by range.
          </p>

          {bookingHorizon && bookingHorizon.buckets.length > 0 ? (
            <div className="space-y-4">
              {/* Stat callouts */}
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: "25th percentile", value: formatDaysAsMonths(bookingHorizon.p25) },
                  { label: "Median",           value: formatDaysAsMonths(bookingHorizon.median) },
                  { label: "75th percentile",  value: formatDaysAsMonths(bookingHorizon.p75) },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-blue-50 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-blue-900">{value}</p>
                    <p className="text-xs text-blue-600 mt-0.5">{label}</p>
                  </div>
                ))}
              </div>

              {/* Horizontal bar chart */}
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={bookingHorizon.buckets}
                  layout="vertical"
                  margin={{ top: 4, right: 60, bottom: 0, left: 120 }}
                >
                  <XAxis type="number" tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
                  <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} width={115} />
                  <Tooltip formatter={(v: any) => [`${v}%`, "Share"]} />
                  <Bar dataKey="pct" radius={[0, 3, 3, 0]}>
                    {bookingHorizon.buckets.map((_: any, index: number) => {
                      const blues = ["#dbeafe", "#bfdbfe", "#93c5fd", "#60a5fa", "#3b82f6", "#2563eb"];
                      return <Cell key={index} fill={blues[Math.min(index, blues.length - 1)]} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-gray-400">Not enough data yet to show booking horizon patterns.</p>
          )}
        </div>

        {/* Venue Capacity Outlook */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-base font-semibold text-gray-900 mb-1">Contracted events &amp; tours — next 18 months</h3>
          <p className="text-xs text-gray-400 mb-4">
            A forward look at your contracted events and scheduled tours to identify open windows.
          </p>

          {trimmedCapacity.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={trimmedCapacity}
                margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
              >
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  formatter={(value: any, name: string) => [
                    value,
                    name === "contractedEvents" ? "Contracted" : "Tours scheduled",
                  ]}
                />
                <Legend
                  iconSize={10}
                  wrapperStyle={{ fontSize: 12 }}
                  formatter={(value) => value === "contractedEvents" ? "Contracted" : "Tours scheduled"}
                />
                <Bar dataKey="contractedEvents" name="contractedEvents" fill="#2563eb" radius={[3, 3, 0, 0]} />
                <Bar dataKey="scheduledTours"   name="scheduledTours"   fill="#bfdbfe" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-gray-400">No upcoming events yet — import clients to populate this view.</p>
          )}
        </div>
      </div>

      {/* ── REVIEW LANGUAGE ── */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-1">What couples say</h2>
        <p className="text-xs text-gray-400 mb-4">
          Word frequency from all review text. Larger = mentioned more often.
          <span className="text-green-600 ml-1">Green = appears in 4-5★ reviews</span>.
          <span className="text-red-500 ml-1">Red = appears in lower reviews</span>.
        </p>
        {reviewLanguage && reviewLanguage.words.length > 0 ? (
          <div>
            <p className="text-xs text-gray-400 mb-3">From {reviewLanguage.reviewCount} reviews</p>
            <div className="flex flex-wrap gap-2 leading-relaxed">
              {reviewLanguage.words.map((w) => {
                // Font size: 12px (count=2) → 28px (count=max)
                const maxCount = reviewLanguage.words[0]?.count ?? 1;
                const minSize = 12;
                const maxSize = 28;
                const size = Math.round(minSize + ((w.count - 2) / Math.max(maxCount - 2, 1)) * (maxSize - minSize));

                // Color: mostly positive → green, mostly negative → red, neutral → gray
                const posRatio = w.count > 0 ? w.posCount / w.count : 0;
                const negRatio = w.count > 0 ? w.negCount / w.count : 0;
                const color = posRatio > 0.7
                  ? "text-green-700 bg-green-50"
                  : negRatio > 0.5
                  ? "text-red-600 bg-red-50"
                  : "text-gray-700 bg-gray-50";

                return (
                  <span
                    key={w.word}
                    title={`"${w.word}" — mentioned ${w.count} times (${w.posCount} positive, ${w.negCount} negative reviews)`}
                    className={`inline-block px-2 py-0.5 rounded cursor-default transition-colors hover:opacity-80 ${color}`}
                    style={{ fontSize: size }}
                  >
                    {w.word}
                  </span>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-400">
            No review text yet. Add review text to client profiles and it will appear here.
          </p>
        )}
      </div>

      {/* ── WEBSITE TRAFFIC ── */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Website traffic</h2>
        <p className="text-xs text-gray-400 mb-4">
          Monthly sessions from your Google Analytics export.
          Upload a GA4 CSV in <a href="/settings" className="text-blue-600 hover:underline">Settings → Website traffic</a>.
        </p>
        {websiteTraffic && websiteTraffic.hasData ? (
          <div className="space-y-4">
            {/* Source breakdown */}
            {websiteTraffic.topSources.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {websiteTraffic.topSources.map((s: any) => (
                  <span key={s.source} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">
                    {s.source}: {s.sessions.toLocaleString()} sessions
                  </span>
                ))}
              </div>
            )}
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={websiteTraffic.monthly.map((m: any) => ({
                ...m,
                label: m.period.slice(5), // MM
              }))}>
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  formatter={(v: any, name: string) => [v.toLocaleString(), name === "sessions" ? "Sessions" : "Users"]}
                />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="sessions" name="sessions" fill="#3b82f6" radius={[3,3,0,0]} />
                <Bar dataKey="users"    name="users"    fill="#93c5fd" radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="text-sm text-gray-400 space-y-1">
            <p>No traffic data yet.</p>
            <p className="text-xs">
              Export from GA4: Reports → Acquisition → Traffic acquisition → set date range → Export CSV.
              Then upload in <a href="/settings" className="text-blue-600 hover:underline">Settings → Website traffic</a>.
            </p>
          </div>
        )}
      </div>

      {/* ── INQUIRY RESPONSE TIMES ── */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Inquiry response speed</h2>
        <p className="text-xs text-gray-400 mb-4">
          Industry research: responding within 5 minutes increases conversion 3×.
        </p>

        {responseTimes && responseTimes.total > 0 ? (
          <div className="space-y-4">
            {/* 4 stat blocks */}
            <div className="grid grid-cols-4 gap-4">
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="text-lg font-bold text-gray-900">{formatMinutes(responseTimes.avg)}</p>
                <p className="text-xs text-gray-500 mt-0.5">Avg response</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="text-lg font-bold text-gray-900">{formatMinutes(responseTimes.median)}</p>
                <p className="text-xs text-gray-500 mt-0.5">Median response</p>
              </div>
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <p className="text-lg font-bold text-green-800">
                  {responseTimes.under5min} ({Math.round((responseTimes.under5min / responseTimes.total) * 100)}%)
                </p>
                <p className="text-xs text-green-600 mt-0.5">Under 5 min</p>
              </div>
              <div className={`rounded-lg p-3 text-center ${
                (responseTimes.over24hr / responseTimes.total) > 0.2
                  ? "bg-amber-50"
                  : "bg-gray-50"
              }`}>
                <p className={`text-lg font-bold ${
                  (responseTimes.over24hr / responseTimes.total) > 0.2
                    ? "text-amber-800"
                    : "text-gray-900"
                }`}>
                  {responseTimes.over24hr} ({Math.round((responseTimes.over24hr / responseTimes.total) * 100)}%)
                </p>
                <p className={`text-xs mt-0.5 ${
                  (responseTimes.over24hr / responseTimes.total) > 0.2
                    ? "text-amber-600"
                    : "text-gray-500"
                }`}>Over 24 hrs</p>
              </div>
            </div>

            {/* Day-of-week chart */}
            {responseTimes.byDayOfWeek && responseTimes.byDayOfWeek.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Avg response time by day</p>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart
                    data={responseTimes.byDayOfWeek}
                    margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                  >
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(v) => `${Math.round(v / 60)}h`} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: any) => [formatMinutes(v), "Avg response"]} />
                    <Bar dataKey="avgMinutes" radius={[3, 3, 0, 0]}>
                      {responseTimes.byDayOfWeek.map((row: any, index: number) => {
                        const fill = row.avgMinutes > 480
                          ? "#ef4444"
                          : row.avgMinutes > 120
                          ? "#fbbf24"
                          : "#3b82f6";
                        return <Cell key={index} fill={fill} />;
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-400">
            Mark inquiries as responded to track this metric. Response times appear here once you have at least one logged response.
          </p>
        )}
      </div>
    </div>
  );
}
