"use client";

import { trpc } from "@/lib/trpc/client";
import { Info } from "lucide-react";

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

function ConversionBadge({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100);
  if (pct > 50) {
    return (
      <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-green-100 text-green-700">
        {pct}%
      </span>
    );
  }
  if (pct >= 30) {
    return (
      <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-700">
        {pct}%
      </span>
    );
  }
  return (
    <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-700">
      {pct}%
    </span>
  );
}

export default function TeamPage() {
  const { data, isLoading } = trpc.enterprise.getTeamPerformance.useQuery();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  const coordinators = data?.coordinators ?? [];
  const named = coordinators.filter((c) => !c.isUnassigned);
  const unassigned = coordinators.find((c) => c.isUnassigned);

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Team Performance</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Conversion rates and revenue by coordinator across all venues
        </p>
      </div>

      {/* Role note */}
      <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 mb-6 text-sm text-blue-700">
        <Info size={15} className="flex-shrink-0 mt-0.5" />
        <span>Only venue_admin and above can see this view.</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Coordinator
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Venue(s)
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Clients
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Toured
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Booked
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Conv. rate
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Avg rev / booking
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Avg response
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {named.map((coord) => (
                <tr key={coord.coordinatorKey} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-800">{coord.name}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {coord.venues.join(", ") || "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600">{coord.totalClients}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{coord.toured}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{coord.booked}</td>
                  <td className="px-4 py-3 text-center">
                    <ConversionBadge rate={coord.conversionRate} />
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600">
                    {coord.avgRevenueCents > 0 ? fmtDollars(coord.avgRevenueCents) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600">
                    {fmtMinutes(coord.avgResponseTimeMinutes)}
                  </td>
                </tr>
              ))}

              {named.length === 0 && !unassigned && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-gray-400">
                    No coordinator data found. Make sure clients have an{" "}
                    <code className="text-xs bg-gray-100 px-1 rounded">assigned_coordinator</code>{" "}
                    field set.
                  </td>
                </tr>
              )}

              {/* Unassigned row */}
              {unassigned && (
                <tr className="bg-gray-50/60 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-gray-400 italic">Unassigned</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {unassigned.venues.join(", ") || "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-400">{unassigned.totalClients}</td>
                  <td className="px-4 py-3 text-right text-gray-400">{unassigned.toured}</td>
                  <td className="px-4 py-3 text-right text-gray-400">{unassigned.booked}</td>
                  <td className="px-4 py-3 text-center">
                    <ConversionBadge rate={unassigned.conversionRate} />
                  </td>
                  <td className="px-4 py-3 text-right text-gray-400">
                    {unassigned.avgRevenueCents > 0 ? fmtDollars(unassigned.avgRevenueCents) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-400">
                    {fmtMinutes(unassigned.avgResponseTimeMinutes)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer totals */}
        {coordinators.length > 0 && (
          <div className="px-4 py-3 border-t border-gray-100 bg-gray-50 text-xs text-gray-400">
            {coordinators.length} coordinator{coordinators.length !== 1 ? "s" : ""} ·{" "}
            {coordinators.reduce((s, c) => s + c.totalClients, 0)} total clients
          </div>
        )}
      </div>
    </div>
  );
}
