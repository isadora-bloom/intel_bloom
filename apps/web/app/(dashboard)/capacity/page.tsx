"use client";

import { trpc } from "@/lib/trpc/client";
import { useState } from "react";
import { CalendarDays, TrendingUp } from "lucide-react";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];

function formatDollars(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function OccupancyBar({ pct }: { pct: number }) {
  let barColor = "bg-gray-300";
  if (pct >= 75) barColor = "bg-green-500";
  else if (pct >= 50) barColor = "bg-amber-400";
  else if (pct >= 25) barColor = "bg-blue-400";

  return (
    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${barColor}`}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <div className="flex items-center gap-2 mb-1">
        <Icon size={16} className="text-gray-400" />
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-2xl font-semibold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function CapacityPage() {
  const [year, setYear] = useState(CURRENT_YEAR);

  const { data, isLoading, isError } = trpc.analytics.getCapacityYield.useQuery({ year });

  const peakHighCount = data?.months.filter((m) => m.isPeak && m.occupancyPct >= 75).length ?? 0;
  const hasAnyEvents = (data?.totalBooked ?? 0) > 0 || (data?.months.some((m) => m.heldDates > 0) ?? false);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Capacity &amp; Yield</h1>
          <p className="text-sm text-gray-500 mt-0.5">Monthly occupancy and pricing signals.</p>
        </div>
        <div className="flex gap-1.5">
          {YEAR_OPTIONS.map((y) => (
            <button
              key={y}
              onClick={() => setYear(y)}
              className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${
                year === y
                  ? "bg-blue-600 text-white"
                  : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {y}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="text-sm text-gray-500 py-12 text-center">Loading capacity data…</div>
      )}

      {isError && (
        <div className="text-sm text-red-500 py-12 text-center">Failed to load capacity data.</div>
      )}

      {data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <SummaryCard
              label="Overall occupancy"
              value={`${data.overallOccupancy}%`}
              sub={`${year} year-to-date`}
              icon={CalendarDays}
            />
            <SummaryCard
              label="Total bookings"
              value={String(data.totalBooked)}
              sub="contracted + completed"
              icon={CalendarDays}
            />
            <SummaryCard
              label="Revenue booked"
              value={data.totalRevenue > 0 ? formatDollars(data.totalRevenue) : "—"}
              sub="contracted / completed events"
              icon={TrendingUp}
            />
            <SummaryCard
              label="High-demand peaks"
              value={String(peakHighCount)}
              sub="peak months ≥ 75% full"
              icon={TrendingUp}
            />
          </div>

          {/* Empty state */}
          {!hasAnyEvents && (
            <div className="bg-white rounded-lg border border-gray-200 py-16 text-center">
              <CalendarDays size={32} className="text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-500">No events booked for this year yet.</p>
            </div>
          )}

          {/* Month grid */}
          {hasAnyEvents && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {data.months.map((m) => (
                <div
                  key={m.month}
                  className="bg-white rounded-lg border border-gray-200 p-4 flex flex-col gap-2"
                >
                  {/* Month name + PEAK badge */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-900">
                      {MONTH_NAMES[m.month - 1]}
                    </span>
                    {m.isPeak && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                        Peak
                      </span>
                    )}
                  </div>

                  {/* Occupancy bar */}
                  <OccupancyBar pct={m.occupancyPct} />

                  {/* Occupancy % */}
                  <p className="text-lg font-semibold text-gray-900">{m.occupancyPct}%</p>

                  {/* Booked / held */}
                  <p className="text-xs text-gray-500">
                    {m.bookedDates}/{m.totalAvailableDates} booked
                    {m.heldDates > 0 && (
                      <span className="ml-1 text-amber-600">· {m.heldDates} held</span>
                    )}
                  </p>

                  {/* Avg revenue */}
                  {m.avgRevenueCents !== null && (
                    <p className="text-xs text-gray-500">
                      avg {formatDollars(m.avgRevenueCents)} / event
                    </p>
                  )}

                  {/* Price adjustment badges */}
                  {m.suggestedPriceAdjPct > 0 && (
                    <span className="self-start text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-100 text-green-700">
                      +{m.suggestedPriceAdjPct}% suggested
                    </span>
                  )}
                  {m.suggestedPriceAdjPct < 0 && (
                    <span className="self-start text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-600">
                      {m.suggestedPriceAdjPct}% consider discount
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
