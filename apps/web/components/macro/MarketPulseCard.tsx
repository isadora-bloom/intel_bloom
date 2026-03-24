"use client";

import { TrendingUp, TrendingDown, Minus, AlertTriangle, Cloud } from "lucide-react";

type Pulse = {
  demand_outlook: string | null;
  demand_score: number | null;
  consumer_confidence_trend: string | null;
  consumer_confidence_latest: number | null;
  search_volume_vs_seasonal: number | null;
  marriage_rate_trend: string | null;
  regional_economy_summary: string | null;
  weather_caution_months: string[] | null;
  competitor_change_alert: string | null;
  engagement_seasonality_signal: string | null;
  calculated_at: string;
} | null;

const OUTLOOK_CONFIG = {
  positive: { color: "text-green-700", bg: "bg-green-50 border-green-200", label: "Positive demand outlook" },
  neutral: { color: "text-gray-700", bg: "bg-gray-50 border-gray-200", label: "Neutral demand outlook" },
  cautionary: { color: "text-amber-700", bg: "bg-amber-50 border-amber-200", label: "Cautionary signals" },
  negative: { color: "text-red-700", bg: "bg-red-50 border-red-200", label: "Negative signals" },
};

function TrendIcon({ trend }: { trend: string | null }) {
  if (trend === "rising") return <TrendingUp size={14} className="text-green-600" />;
  if (trend === "falling") return <TrendingDown size={14} className="text-red-600" />;
  return <Minus size={14} className="text-gray-400" />;
}

export default function MarketPulseCard({ pulse }: { pulse: Pulse }) {
  if (!pulse) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-2">Market Pulse</h2>
        <p className="text-sm text-gray-500 mb-3">
          No pulse score yet. Market Pulse needs weather and economic data to calculate.
        </p>
        <div className="text-xs text-gray-400 space-y-1">
          <p>To generate your first pulse:</p>
          <ol className="list-decimal list-inside space-y-1 text-gray-500">
            <li>Go to <a href="/settings" className="text-blue-600 hover:underline">Settings → Intelligence Calibration</a></li>
            <li>Set your NOAA station ID and click <strong>Populate</strong> (weather data)</li>
            <li>Set your Federal Reserve district and click <strong>Populate</strong> (FRED data)</li>
            <li>Click <strong>Refresh</strong> next to Market Pulse score</li>
          </ol>
        </div>
      </div>
    );
  }

  const outlook = pulse.demand_outlook ?? "neutral";
  const config = OUTLOOK_CONFIG[outlook as keyof typeof OUTLOOK_CONFIG] ?? OUTLOOK_CONFIG.neutral;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-gray-900">Market Pulse</h2>
        <span className="text-xs text-gray-400">
          Updated {new Date(pulse.calculated_at).toLocaleDateString()}
        </span>
      </div>

      {/* Demand outlook banner */}
      <div className={`rounded-lg border px-4 py-3 mb-4 flex items-center justify-between ${config.bg}`}>
        <span className={`text-sm font-medium ${config.color}`}>{config.label}</span>
        {pulse.demand_score !== null && (
          <div className="flex items-center gap-2">
            <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-500"
                style={{ width: `${pulse.demand_score}%` }}
              />
            </div>
            <span className="text-xs text-gray-500">{pulse.demand_score}/100</span>
          </div>
        )}
      </div>

      {/* Signal grid */}
      <div className="grid grid-cols-2 gap-3">
        {/* Consumer confidence */}
        <div className="bg-gray-50 rounded-md p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendIcon trend={pulse.consumer_confidence_trend} />
            <span className="text-xs font-medium text-gray-700">Consumer confidence</span>
          </div>
          <div className="text-lg font-semibold text-gray-900">
            {pulse.consumer_confidence_latest
              ? Math.round(Number(pulse.consumer_confidence_latest))
              : "—"}
          </div>
          <div className="text-xs text-gray-500 capitalize">
            {pulse.consumer_confidence_trend ?? "No data"}
          </div>
        </div>

        {/* Search volume */}
        <div className="bg-gray-50 rounded-md p-3">
          <div className="flex items-center gap-1.5 mb-1">
            {(pulse.search_volume_vs_seasonal ?? 0) > 0
              ? <TrendingUp size={14} className="text-green-600" />
              : (pulse.search_volume_vs_seasonal ?? 0) < 0
              ? <TrendingDown size={14} className="text-red-600" />
              : <Minus size={14} className="text-gray-400" />}
            <span className="text-xs font-medium text-gray-700">Search demand</span>
          </div>
          <div className="text-lg font-semibold text-gray-900">
            {pulse.search_volume_vs_seasonal !== null
              ? `${pulse.search_volume_vs_seasonal > 0 ? "+" : ""}${pulse.search_volume_vs_seasonal}%`
              : "—"}
          </div>
          <div className="text-xs text-gray-500">vs seasonal avg</div>
        </div>

        {/* Marriage rate */}
        <div className="bg-gray-50 rounded-md p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendIcon trend={pulse.marriage_rate_trend} />
            <span className="text-xs font-medium text-gray-700">Marriage rate</span>
          </div>
          <div className="text-sm font-medium text-gray-900 capitalize">
            {pulse.marriage_rate_trend ?? "Stable"}
          </div>
          <div className="text-xs text-gray-500">Regional trend</div>
        </div>

        {/* Weather caution */}
        <div className="bg-gray-50 rounded-md p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Cloud size={14} className="text-blue-500" />
            <span className="text-xs font-medium text-gray-700">Weather caution</span>
          </div>
          <div className="text-sm font-medium text-gray-900">
            {pulse.weather_caution_months && pulse.weather_caution_months.length > 0
              ? pulse.weather_caution_months.join(", ")
              : "None flagged"}
          </div>
          <div className="text-xs text-gray-500">High-risk months</div>
        </div>
      </div>

      {/* Regional economy summary */}
      {pulse.regional_economy_summary && (
        <div className="mt-4 text-sm text-gray-600 border-t border-gray-100 pt-3">
          {pulse.regional_economy_summary}
        </div>
      )}

      {/* Competitor alert */}
      {pulse.competitor_change_alert && (
        <div className="mt-3 flex items-start gap-2 text-sm text-amber-700 bg-amber-50 rounded-md p-3">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          {pulse.competitor_change_alert}
        </div>
      )}
    </div>
  );
}
