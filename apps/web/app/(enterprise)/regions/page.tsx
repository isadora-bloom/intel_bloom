"use client";

import { trpc } from "@/lib/trpc/client";
import { MapPin, Info } from "lucide-react";

function fmtDollars(cents: number) {
  if (cents >= 100_000_00) return `$${(cents / 100_000_00).toFixed(1)}M`;
  if (cents >= 1_000_00) return `$${(cents / 1_000_00).toFixed(0)}K`;
  return `$${(cents / 100).toFixed(0)}`;
}

function HealthPill({ score }: { score: number | null }) {
  if (score === null) {
    return <span className="text-gray-400">—</span>;
  }
  const cls =
    score >= 80
      ? "bg-green-100 text-green-700"
      : score >= 50
      ? "bg-amber-100 text-amber-700"
      : "bg-red-100 text-red-700";

  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${cls}`}>
      {score}
    </span>
  );
}

export default function RegionsPage() {
  const { data, isLoading } = trpc.enterprise.getRegions.useQuery();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  const regions = data?.regions ?? [];
  const hasNoRegions = data?.hasNoRegions;

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Regional Performance</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Venue performance grouped by region
        </p>
      </div>

      {/* Empty: no regions set */}
      {(hasNoRegions || regions.length === 0) && (
        <div className="bg-white rounded-lg border border-gray-200 p-10 text-center">
          <MapPin size={36} className="mx-auto mb-3 text-gray-300" />
          <h2 className="text-sm font-semibold text-gray-600 mb-1">No regions configured</h2>
          <p className="text-sm text-gray-400 max-w-sm mx-auto">
            Set the <code className="bg-gray-100 px-1 rounded text-xs">region</code> field for each
            venue in Settings to see regional rollup.
          </p>
        </div>
      )}

      {/* Region cards */}
      {regions.length > 0 && (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {regions.map((region) => (
            <div
              key={region.region}
              className="bg-white rounded-lg border border-gray-200 p-6 flex flex-col gap-4"
            >
              {/* Region name */}
              <div className="flex items-center gap-2">
                <MapPin size={16} className="text-gray-400 flex-shrink-0" />
                <h2 className="text-base font-semibold text-gray-900">{region.region}</h2>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Venues</p>
                  <p className="text-lg font-semibold text-gray-800">{region.venueCount}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Avg health</p>
                  <div className="mt-0.5">
                    <HealthPill score={region.avgHealthScore} />
                  </div>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Total inquiries</p>
                  <p className="text-lg font-semibold text-gray-800">
                    {region.totalInquiries.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Total revenue</p>
                  <p className="text-lg font-semibold text-gray-800">
                    {region.totalRevenueCents > 0 ? fmtDollars(region.totalRevenueCents) : "—"}
                  </p>
                </div>
              </div>

              {/* Top source */}
              {region.topSource && (
                <div className="flex items-center gap-1.5 bg-blue-50 rounded px-3 py-2 text-xs text-blue-700">
                  <Info size={12} className="flex-shrink-0" />
                  Top source: <span className="font-medium ml-1">{region.topSource}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
