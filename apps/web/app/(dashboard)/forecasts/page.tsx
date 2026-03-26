"use client";

import { trpc } from "@/lib/trpc/client";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, Cell,
} from "recharts";
import { TrendingUp, TrendingDown, Minus, DollarSign, Target, BarChart3 } from "lucide-react";

function fmt$(cents: number | null | undefined): string {
  if (!cents) return "—";
  const d = cents / 100;
  if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`;
  if (d >= 1_000) return `$${Math.round(d / 1_000)}k`;
  return `$${Math.round(d)}`;
}

function pct(val: number | null | undefined): string {
  if (val == null) return "—";
  return `${val > 0 ? "+" : ""}${val}%`;
}

const CONFIDENCE_STYLES = {
  high: { bg: "bg-green-50", text: "text-green-700", border: "border-green-200", label: "High confidence" },
  medium: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", label: "Medium confidence" },
  low: { bg: "bg-red-50", text: "text-red-700", border: "border-red-200", label: "Low confidence" },
};

const BAR_COLORS = {
  contracted: "#10b981",
  held: "#f59e0b",
  pipeline: "#93c5fd",
};

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-md shadow-sm text-xs p-2.5 min-w-40">
      <p className="font-medium text-gray-700 mb-1.5">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex justify-between gap-3 mb-0.5">
          <span style={{ color: p.fill || p.color }}>{p.name}</span>
          <span className="font-medium text-gray-800">{fmt$(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export default function ForecastsPage() {
  const { data, isLoading, error } = trpc.forecasts.getRevenueForecast.useQuery(
    { quarters: 4 },
    { staleTime: 1000 * 60 * 10 }
  );

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        <div className="h-6 bg-gray-100 rounded w-48 animate-pulse" />
        <div className="grid grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white rounded-lg border border-gray-200 p-5 animate-pulse">
              <div className="h-3 bg-gray-100 rounded w-24 mb-3" />
              <div className="h-8 bg-gray-100 rounded w-20" />
            </div>
          ))}
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-5 h-64 animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-sm text-red-700">
          Failed to load forecast: {error.message}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const YoyIcon = data.yoyPct == null ? Minus : data.yoyPct > 0 ? TrendingUp : TrendingDown;
  const yoyColor = data.yoyPct == null ? "text-gray-400" : data.yoyPct > 0 ? "text-green-600" : "text-red-500";

  const chartData = data.quarters.map((q) => ({
    name: q.quarter,
    contracted: q.contractedCents,
    held: q.heldCents,
    pipeline: q.pipelineCents,
    total: q.totalForecastCents,
    confidence: q.confidenceLevel,
  }));

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Revenue Forecast</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Pipeline-weighted projections based on historical conversion rates.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign size={14} className="text-emerald-500" />
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total forecast</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">{fmt$(data.totalForecastCents)}</p>
          <p className="text-xs text-gray-400 mt-1">Next {data.quarters.length} quarters</p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <Target size={14} className="text-blue-500" />
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Same period last year</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">{fmt$(data.priorYearCents)}</p>
          <div className="flex items-center gap-1 mt-1">
            <YoyIcon size={14} className={yoyColor} />
            <span className={`text-xs font-medium ${yoyColor}`}>{pct(data.yoyPct)}</span>
            <span className="text-xs text-gray-400">YoY</span>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 size={14} className="text-violet-500" />
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Conversion rates</p>
          </div>
          <div className="space-y-1.5 mt-1">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Hold → Contract</span>
              <span className="font-medium text-gray-800">{data.conversionRates.holdToContract}%</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Tour → Book</span>
              <span className="font-medium text-gray-800">{data.conversionRates.tourToBook}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Stacked bar chart */}
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-4">Quarterly forecast breakdown</h2>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData} barSize={48}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="name" tick={{ fontSize: 12 }} tickLine={false} />
            <YAxis
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => v > 0 ? `$${(v / 100000).toFixed(0)}k` : ""}
            />
            <Tooltip content={<ChartTooltip />} />
            <Legend
              iconSize={10}
              wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
            />
            <Bar dataKey="contracted" name="Contracted" stackId="a" fill={BAR_COLORS.contracted} radius={[0, 0, 0, 0]} />
            <Bar dataKey="held" name="Held (weighted)" stackId="a" fill={BAR_COLORS.held} radius={[0, 0, 0, 0]} />
            <Bar dataKey="pipeline" name="Pipeline (weighted)" stackId="a" fill={BAR_COLORS.pipeline} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Quarter detail cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {data.quarters.map((q) => {
          const styles = CONFIDENCE_STYLES[q.confidenceLevel as keyof typeof CONFIDENCE_STYLES] ?? CONFIDENCE_STYLES.low;
          return (
            <div key={q.quarter} className={`rounded-lg border ${styles.border} ${styles.bg} p-4`}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-800">{q.quarter}</h3>
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${styles.text} bg-white/70`}>
                  {styles.label}
                </span>
              </div>
              <p className="text-xl font-bold text-gray-900 mb-2">{fmt$(q.totalForecastCents)}</p>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-500">Contracted</span>
                  <span className="font-medium text-emerald-700">{fmt$(q.contractedCents)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Held (weighted)</span>
                  <span className="font-medium text-amber-700">{fmt$(q.heldCents)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Pipeline (weighted)</span>
                  <span className="font-medium text-blue-600">{fmt$(q.pipelineCents)}</span>
                </div>
                <div className="flex justify-between pt-1 border-t border-gray-200/50">
                  <span className="text-gray-500">Events</span>
                  <span className="font-medium text-gray-700">{q.eventCount}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Methodology note */}
      <div className="text-xs text-gray-400 leading-relaxed bg-gray-50 rounded-lg p-4 border border-gray-100">
        <strong className="text-gray-500">How this works:</strong> Revenue is weighted by pipeline stage using your
        historical conversion rates. Contracted revenue counts at 100%. Held revenue is weighted by your hold-to-contract
        rate ({data.conversionRates.holdToContract}%). Earlier pipeline stages are weighted by compounded conversion
        probabilities. Confidence level reflects what percentage of the forecast is already contracted.
      </div>
    </div>
  );
}
