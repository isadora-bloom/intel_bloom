"use client";

import { trpc } from "@/lib/trpc/client";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { useState } from "react";
import {
  ChevronUp,
  ChevronDown,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
} from "lucide-react";

function fmtDollars(cents: number) {
  if (cents >= 100_000_00) return `$${(cents / 100_000_00).toFixed(1)}M`;
  if (cents >= 1_000_00) return `$${(cents / 1_000_00).toFixed(0)}K`;
  return `$${(cents / 100).toFixed(0)}`;
}

function fmtPct(rate: number) {
  return `${Math.round(rate * 100)}%`;
}

function fmtMinutes(minutes: number | null) {
  if (minutes === null) return "—";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  return `${(minutes / 60).toFixed(1)}h`;
}

type SortKey = "venueName" | "inquiries" | "tourRate" | "bookingRate" | "avgRevenueCents" | "healthScore";

function HealthStatusIcon({ status }: { status: string | null }) {
  if (!status) return <span className="w-2 h-2 rounded-full bg-gray-300 inline-block" />;
  if (status === "green") return <CheckCircle2 size={14} className="text-green-500" />;
  if (status === "amber") return <AlertTriangle size={14} className="text-amber-400" />;
  return <AlertCircle size={14} className="text-red-500" />;
}

const CHART_COLORS = [
  "#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981",
  "#06b6d4", "#f97316", "#84cc16", "#6366f1", "#e11d48",
];

export default function CompanyPage() {
  const { data, isLoading } = trpc.enterprise.getCompanyMetrics.useQuery();
  const [sortKey, setSortKey] = useState<SortKey>("inquiries");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center mt-16 text-gray-400 text-sm">
        No organisation data found. Make sure your account is linked to an organisation.
      </div>
    );
  }

  const sortedVenues = [...(data.perVenue ?? [])].sort((a, b) => {
    const av = a[sortKey] ?? 0;
    const bv = b[sortKey] ?? 0;
    const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
    return sortDir === "asc" ? cmp : -cmp;
  });

  // Monthly revenue chart data
  const chartData = (data.monthlyRevenue ?? []).map((row) => ({
    month: row.month.slice(0, 7),
    revenue: row.revenue_cents / 100,
  }));

  // Top channels sorted
  const topChannels = Object.entries(data.sourceCounts ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  const totalChannelInquiries = topChannels.reduce((s, [, c]) => s + c, 0);

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <span className="text-gray-300 ml-1">↕</span>;
    return sortDir === "asc" ? (
      <ChevronUp size={12} className="inline ml-1 text-blue-500" />
    ) : (
      <ChevronDown size={12} className="inline ml-1 text-blue-500" />
    );
  }

  const thCls =
    "px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer hover:text-gray-700 select-none whitespace-nowrap";

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Company Dashboard</h1>
        <p className="text-sm text-gray-500 mt-0.5">Organisation-wide metrics across all venues</p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Inquiries YTD</p>
          <p className="text-2xl font-semibold text-gray-900">
            {data.inquiriesYTD.toLocaleString()}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Last 30d: {data.inquiriesLast30} · 90d: {data.inquiriesLast90}
          </p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Revenue YTD</p>
          <p className="text-2xl font-semibold text-gray-900">{fmtDollars(data.revenueYTD)}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Bookings YTD</p>
          <p className="text-2xl font-semibold text-gray-900">{data.bookedYTD}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Avg booking rate</p>
          <p className="text-2xl font-semibold text-gray-900">{fmtPct(data.avgBookingRate)}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Avg response time</p>
          <p className="text-2xl font-semibold text-gray-900">
            {fmtMinutes(data.avgResponseTime)}
          </p>
        </div>
      </div>

      {/* Revenue chart + top channels */}
      <div className="grid lg:grid-cols-3 gap-6 mb-8">
        {/* Revenue by month */}
        <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Revenue — last 12 months</h2>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} barSize={18}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 10, fill: "#9ca3af" }}
                  tickFormatter={(v) => {
                    const [y, m] = v.split("-");
                    return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][parseInt(m) - 1]} ${y.slice(2)}`;
                  }}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#9ca3af" }}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`}
                />
                <Tooltip
                  formatter={(v: number) => [`$${(v / 1000).toFixed(1)}K`, "Revenue"]}
                  labelFormatter={(l) => {
                    const [y, m] = l.split("-");
                    return `${["January","February","March","April","May","June","July","August","September","October","November","December"][parseInt(m) - 1]} ${y}`;
                  }}
                />
                <Bar dataKey="revenue" radius={[3, 3, 0, 0]}>
                  {chartData.map((_, i) => (
                    <Cell key={i} fill="#3b82f6" fillOpacity={0.8} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[220px] text-sm text-gray-400">
              No revenue data yet
            </div>
          )}
        </div>

        {/* Top channels */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Top inquiry sources</h2>
          {topChannels.length > 0 ? (
            <div className="space-y-3">
              {topChannels.map(([source, count], i) => {
                const pct = totalChannelInquiries > 0 ? (count / totalChannelInquiries) * 100 : 0;
                return (
                  <div key={source}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-gray-600 truncate max-w-[120px]">
                        {source}
                      </span>
                      <span className="text-xs font-medium text-gray-700">
                        {count} ({Math.round(pct)}%)
                      </span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-400">No source data yet</p>
          )}
        </div>
      </div>

      {/* Per-venue comparison table */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Venue comparison</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className={thCls} onClick={() => handleSort("venueName")}>
                  Venue <SortIcon col="venueName" />
                </th>
                <th className={thCls} onClick={() => handleSort("inquiries")}>
                  Inquiries <SortIcon col="inquiries" />
                </th>
                <th className={thCls} onClick={() => handleSort("tourRate")}>
                  Tour rate <SortIcon col="tourRate" />
                </th>
                <th className={thCls} onClick={() => handleSort("bookingRate")}>
                  Book rate <SortIcon col="bookingRate" />
                </th>
                <th className={thCls} onClick={() => handleSort("avgRevenueCents")}>
                  Avg revenue <SortIcon col="avgRevenueCents" />
                </th>
                <th className={thCls} onClick={() => handleSort("healthScore")}>
                  Health <SortIcon col="healthScore" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sortedVenues.map((v) => (
                <tr key={v.venueId} className="hover:bg-gray-50 transition-colors">
                  <td className="px-3 py-3 font-medium text-gray-800">{v.venueName}</td>
                  <td className="px-3 py-3 text-gray-600">{v.inquiries}</td>
                  <td className="px-3 py-3 text-gray-600">{fmtPct(v.tourRate)}</td>
                  <td className="px-3 py-3 text-gray-600">{fmtPct(v.bookingRate)}</td>
                  <td className="px-3 py-3 text-gray-600">
                    {v.avgRevenueCents > 0 ? fmtDollars(v.avgRevenueCents) : "—"}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1.5">
                      <HealthStatusIcon status={v.healthStatus} />
                      <span className="text-gray-600">
                        {v.healthScore !== null ? v.healthScore : "—"}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
              {sortedVenues.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-gray-400 text-sm">
                    No venues found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
