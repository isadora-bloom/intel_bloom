"use client";

import { trpc } from "@/lib/trpc/client";
import MarketPulseCard from "@/components/macro/MarketPulseCard";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, ComposedChart, Bar, Cell, ReferenceLine,
} from "recharts";
import { format } from "date-fns";

function yoyColor(pct: number | null) {
  if (pct === null) return "text-gray-400";
  if (pct > 5) return "text-green-600";
  if (pct < -5) return "text-red-500";
  return "text-gray-500";
}

function yoyLabel(pct: number | null) {
  if (pct === null) return "—";
  return pct > 0 ? `+${pct}% vs LY` : `${pct}% vs LY`;
}

function rainColor(s: number): string {
  const stops = ["#eff6ff","#dbeafe","#bfdbfe","#93c5fd","#60a5fa","#3b82f6","#2563eb","#1d4ed8","#1e40af","#1e3a8a","#172554"];
  return stops[Math.min(10, s)];
}
function heatColor(s: number): string {
  const stops = ["#f0fdf4","#dcfce7","#bbf7d0","#86efac","#fde68a","#fbbf24","#f97316","#ef4444","#dc2626","#b91c1c","#7f1d1d"];
  return stops[Math.min(10, s)];
}

export default function MacroPage() {
  const { data: pulse }      = trpc.macro.getMarketPulse.useQuery();
  const { data: sentiment }  = trpc.macro.getConsumerSentiment.useQuery();
  const { data: trends }     = trpc.macro.getSearchTrends.useQuery();
  const { data: weatherData }= trpc.macro.getWeatherSeasonality.useQuery();
  const { data: competitors }= trpc.macro.getCompetitors.useQuery();

  // Sentiment chart: last 24 months
  const sentimentChart = (sentiment ?? [])
    .filter((s: any) => s.signal_type === "consumer_sentiment")
    .slice(0, 24)
    .reverse()
    .map((s: any) => ({
      date: format(new Date(s.period_date), "MMM yy"),
      value: Number(s.value),
    }));

  const weatherByMonth = weatherData?.monthly ?? [];

  return (
    <div className="max-w-6xl space-y-8">
      <h1 className="text-2xl font-semibold text-gray-900">Market Pulse</h1>

      <MarketPulseCard pulse={pulse as any} />

      {/* ── GOOGLE TRENDS ── */}
      {trends && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-5">
          <div>
            <h2 className="text-base font-semibold text-gray-900 mb-0.5">Search trends — {trends.geo}</h2>
            <p className="text-xs text-gray-400">
              Weekly Google Trends data, averaged by month. Engagement ring searches are a leading indicator
              — proposals in Nov–Jan produce venue inquiries 3–12 months later.
              Divorce searches are a confidence dampener.
            </p>
          </div>

          {/* YoY callouts */}
          <div className="grid grid-cols-3 gap-4">
            {[
              {
                label: "Venue searches",
                current: trends.yoy.venueThis,
                pct: trends.yoy.venuePct,
                color: "#3b82f6",
                desc: "\"wedding venue\" interest",
              },
              {
                label: "Engagement searches",
                current: trends.yoy.engagementThis,
                pct: trends.yoy.engagementPct,
                color: "#f43f5e",
                desc: "\"engagement ring\" + \"how to propose\"",
              },
              {
                label: "Divorce searches",
                current: trends.yoy.divorceThis,
                pct: trends.yoy.divorcePct,
                color: "#64748b",
                desc: "\"divorce lawyer\" — confidence signal",
              },
            ].map((item) => (
              <div key={item.label} className="rounded-lg bg-gray-50 p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="text-xs font-medium text-gray-700">{item.label}</span>
                </div>
                <div className="text-2xl font-bold text-gray-900">
                  {item.current ?? "—"}
                  <span className="text-sm text-gray-400 font-normal">/100</span>
                </div>
                <div className={`text-xs mt-0.5 ${yoyColor(item.pct)}`}>
                  {yoyLabel(item.pct)}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">{item.desc}</div>
              </div>
            ))}
          </div>

          {/* 24-month trend chart */}
          {trends.monthly.length > 0 && (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trends.monthly} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={2} />
                <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} unit="" />
                <Tooltip formatter={(v: any) => `${v}/100`} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                <Line
                  type="monotone" dataKey="venue" name="Venue searches"
                  stroke="#3b82f6" strokeWidth={2} dot={false}
                />
                <Line
                  type="monotone" dataKey="engagement" name="Engagement ring searches"
                  stroke="#f43f5e" strokeWidth={2} strokeDasharray="4 2" dot={false}
                />
                <Line
                  type="monotone" dataKey="divorce" name="Divorce searches"
                  stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="2 4" dot={false}
                />
                {(trends.customTerms ?? []).map((term: string, i: number) => (
                  <Line
                    key={term}
                    type="monotone"
                    dataKey={(d: any) => d.custom?.[i]?.value ?? null}
                    name={term}
                    stroke={["#f97316","#8b5cf6","#06b6d4","#84cc16"][i % 4]}
                    strokeWidth={1.5}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}

          <p className="text-xs text-gray-400">
            Index is relative — 100 = peak search week in the period. Useful for comparing
            seasonal patterns and year-over-year shifts, not absolute volume.
          </p>
        </div>
      )}

      {/* ── OUTDOOR EVENT SCORE CHART ── */}
      {weatherByMonth.length > 0 && weatherByMonth.some((m: any) => m.eventScore !== null) && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900 mb-0.5">Outdoor event conditions by month</h2>
            <p className="text-xs text-gray-400">
              Based on avg afternoon temperature and rainfall. Ideal = 70–80°F and dry. Score 10 = perfect, 0 = terrible.
            </p>
          </div>

          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={weatherByMonth} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} />
              <YAxis yAxisId="score" tick={{ fontSize: 11 }} domain={[0, 10]} tickLine={false} axisLine={false} width={28} />
              <YAxis yAxisId="temp" orientation="right" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={40}
                tickFormatter={(v: number) => `${v}°F`} />
              <Tooltip
                formatter={(v: any, name: string) =>
                  name === "Avg high (≈4pm)" ? `${v}°F` :
                  name === "Avg rainfall" ? `${v}"` :
                  v
                }
              />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="score" dataKey="eventScore" name="Event score" fill="#10b981" maxBarSize={28} radius={[3,3,0,0]}>
                {weatherByMonth.map((m: any, i: number) => {
                  const s = m.eventScore ?? 0;
                  const fill = s >= 7 ? "#10b981" : s >= 4 ? "#f59e0b" : "#ef4444";
                  return <Cell key={i} fill={fill} />;
                })}
              </Bar>
              <Line yAxisId="temp" type="monotone" dataKey="avgTemp" name="Avg high (≈4pm)" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} />
              <ReferenceLine yAxisId="temp" y={70} stroke="#10b981" strokeDasharray="4 4" label={{ value: "70°F", position: "left", fontSize: 9, fill: "#10b981" }} />
              <ReferenceLine yAxisId="temp" y={80} stroke="#10b981" strokeDasharray="4 4" label={{ value: "80°F", position: "left", fontSize: 9, fill: "#10b981" }} />
            </ComposedChart>
          </ResponsiveContainer>

          {/* Monthly detail strip */}
          <div className="grid grid-cols-12 gap-1 text-center">
            {weatherByMonth.map((m: any) => (
              <div key={m.month} className="text-[10px]">
                <div className="font-medium text-gray-700">{m.month}</div>
                <div className="text-gray-500">{m.avgTemp ?? "—"}°F</div>
                <div className="text-blue-500">{m.avgPrecip ?? "—"}&quot;</div>
                <div className={`font-bold ${(m.eventScore ?? 0) >= 7 ? "text-green-600" : (m.eventScore ?? 0) >= 4 ? "text-amber-600" : "text-red-500"}`}>
                  {m.eventScore ?? "—"}/10
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── WEATHER SEASONALITY (heat + rain split) ── */}
      {weatherByMonth.some((m: any) => m.avgRainScore !== null) && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-5">
          <div>
            <h2 className="text-base font-semibold text-gray-900 mb-0.5">Weather risk breakdown</h2>
            <p className="text-xs text-gray-400">
              3-year monthly averages. 0 = no risk, 10 = high risk for outdoor events.
              Ideal range: 70–80°F and dry. Trend arrows show whether risk is rising ↑ or falling ↓.
            </p>
          </div>

          {/* Rain score */}
          <div>
            <p className="text-xs font-medium text-gray-600 mb-2">
              Rain risk — <span className="font-normal text-gray-400">0 = dry, 10 = 5"+ monthly avg</span>
            </p>
            <div className="grid grid-cols-12 gap-1">
              {weatherByMonth.map((m: any) => {
                const t = m.rainTrend;
                return (
                  <div key={m.month} className="text-center">
                    <div
                      className="rounded mx-auto mb-0.5 flex items-center justify-center"
                      style={{ height: 44, backgroundColor: m.avgRainScore !== null ? rainColor(m.avgRainScore) : "#e5e7eb" }}
                    >
                      {m.avgRainScore !== null && (
                        <span className={`text-xs font-bold ${m.avgRainScore >= 6 ? "text-white" : "text-gray-700"}`}>
                          {m.avgRainScore}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-gray-400">{m.month}</span>
                    {m.avgPrecip !== null && (
                      <span className="block text-[9px] text-gray-400">{m.avgPrecip}"</span>
                    )}
                    {t && t !== "stable" && (
                      <span
                        className={`block text-xs font-bold ${t === "rising" ? "text-red-400" : "text-green-500"}`}
                        title={t === "rising" ? "Getting wetter over past 3 years" : "Getting drier over past 3 years"}
                      >
                        {t === "rising" ? "↑" : "↓"}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Heat score */}
          <div>
            <p className="text-xs font-medium text-gray-600 mb-2">
              Temperature discomfort — <span className="font-normal text-gray-400">based on avg 3pm high. 0 = ideal 65–75°F, rises toward cold or sweltering</span>
            </p>
            <div className="grid grid-cols-12 gap-1">
              {weatherByMonth.map((m: any) => {
                const t = m.heatTrend;
                return (
                  <div key={m.month} className="text-center">
                    <div
                      className="rounded mx-auto mb-0.5 flex items-center justify-center"
                      style={{ height: 44, backgroundColor: m.avgHeatScore !== null ? heatColor(m.avgHeatScore) : "#e5e7eb" }}
                    >
                      {m.avgHeatScore !== null && (
                        <span className={`text-xs font-bold ${m.avgHeatScore >= 6 ? "text-white" : "text-gray-700"}`}>
                          {m.avgHeatScore}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-gray-400">{m.month}</span>
                    {m.avgTemp !== null && (
                      <span className="block text-[9px] text-gray-400">{m.avgTemp}° 3pm</span>
                    )}
                    {t && t !== "stable" && (
                      <span
                        className={`block text-xs font-bold ${t === "rising" ? "text-red-400" : "text-green-500"}`}
                        title={t === "rising" ? "Temperatures becoming more extreme over past 3 years" : "Temperatures becoming more comfortable over past 3 years"}
                      >
                        {t === "rising" ? "↑" : "↓"}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── CONSUMER SENTIMENT ── */}
      {sentimentChart.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Consumer confidence (UMich)</h2>
          <p className="text-xs text-gray-400 mb-4">
            University of Michigan Consumer Sentiment Index. Lower values = consumers feel financially cautious,
            which depresses discretionary spend like weddings.
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={sentimentChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── COMPETITORS ── */}
      {competitors && competitors.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">
            Competitor landscape ({competitors.length} venues)
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500 uppercase border-b border-gray-200">
                <tr>
                  <th className="text-left py-2 pr-4">Venue</th>
                  <th className="text-right py-2 pr-4">Distance</th>
                  <th className="text-right py-2 pr-4">Google rating</th>
                  <th className="text-right py-2">Reviews</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {competitors.slice(0, 20).map((c: any) => (
                  <tr key={c.id}>
                    <td className="py-2 pr-4 text-gray-900">{c.competitor_name}</td>
                    <td className="text-right py-2 pr-4 text-gray-500">
                      {c.distance_miles ? `${c.distance_miles} mi` : "—"}
                    </td>
                    <td className="text-right py-2 pr-4 text-gray-600">
                      {c.google_rating ? `${c.google_rating}★` : "—"}
                    </td>
                    <td className="text-right py-2 text-gray-500">
                      {c.review_count?.toLocaleString() ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400 mt-3">
            Last scanned {(competitors[0] as any)?.scanned_at ? format(new Date((competitors[0] as any).scanned_at), "MMM d, yyyy") : "never"}
          </p>
        </div>
      )}
    </div>
  );
}
