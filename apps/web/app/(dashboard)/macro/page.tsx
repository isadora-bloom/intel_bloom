"use client";

import { trpc } from "@/lib/trpc/client";
import MarketPulseCard from "@/components/macro/MarketPulseCard";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { format } from "date-fns";

export default function MacroPage() {
  const { data: pulse } = trpc.macro.getMarketPulse.useQuery();
  const { data: sentiment } = trpc.macro.getConsumerSentiment.useQuery();
  const { data: searchTrends } = trpc.macro.getSearchTrends.useQuery();
  const { data: weatherData } = trpc.macro.getWeatherSeasonality.useQuery();
  const { data: economics } = trpc.macro.getRegionalEconomics.useQuery();
  const { data: competitors } = trpc.macro.getCompetitors.useQuery();

  // Group sentiment by type for chart
  const sentimentChart = (sentiment ?? [])
    .filter((s: any) => s.signal_type === "consumer_sentiment")
    .slice(0, 24)
    .reverse()
    .map((s: any) => ({
      date: format(new Date(s.period_date), "MMM yy"),
      value: Number(s.value),
    }));

  // Build monthly weather averages for seasonality display
  const weatherByMonth = Array.from({ length: 12 }, (_, i) => {
    const monthData = (weatherData ?? []).filter((w: any) => w.month === i + 1);
    const avgScore = monthData.length > 0
      ? monthData.reduce((sum: number, w: any) => sum + (w.weather_score ?? 0), 0) / monthData.length
      : null;
    return {
      month: ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][i],
      avgScore: avgScore !== null ? Math.round(avgScore * 10) / 10 : null,
    };
  });

  return (
    <div className="max-w-6xl space-y-8">
      <h1 className="text-2xl font-semibold text-gray-900">Market Pulse</h1>

      <MarketPulseCard pulse={pulse as any} />

      {/* Consumer sentiment */}
      {sentimentChart.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Consumer confidence (UMich)</h2>
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

      {/* Weather seasonality */}
      {weatherByMonth.some((m) => m.avgScore !== null) && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-2">Weather seasonality</h2>
          <p className="text-sm text-gray-500 mb-4">Average weather difficulty score (0=ideal, 10=severe)</p>
          <div className="grid grid-cols-12 gap-1">
            {weatherByMonth.map((m) => (
              <div key={m.month} className="text-center">
                <div
                  className="rounded mx-auto mb-1"
                  style={{
                    height: 60,
                    width: "100%",
                    background: m.avgScore !== null
                      ? `hsl(${220 - (m.avgScore * 22)}, 70%, 55%)`
                      : "#e5e7eb",
                    opacity: m.avgScore !== null ? 0.7 + (m.avgScore * 0.03) : 0.3,
                  }}
                />
                <span className="text-xs text-gray-400">{m.month}</span>
                {m.avgScore !== null && (
                  <span className="block text-xs font-medium text-gray-600">{m.avgScore}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Competitors */}
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
            Last scanned {competitors[0]?.scanned_at ? format(new Date(competitors[0].scanned_at), "MMM d, yyyy") : "never"}
          </p>
        </div>
      )}
    </div>
  );
}
