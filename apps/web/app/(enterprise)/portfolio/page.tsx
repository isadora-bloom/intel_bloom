"use client";

import { trpc } from "@/lib/trpc/client";
import { useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  Building2,
} from "lucide-react";

function fmtDollars(cents: number) {
  if (cents >= 100_000_00) return `$${(cents / 100_000_00).toFixed(1)}M`;
  if (cents >= 1_000_00) return `$${(cents / 1_000_00).toFixed(0)}K`;
  return `$${(cents / 100).toFixed(0)}`;
}

function fmtPct(rate: number) {
  return `${Math.round(rate * 100)}%`;
}

function HealthBadge({ score, status }: { score: number | null; status: string | null }) {
  if (score === null || status === null) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
        No data
      </span>
    );
  }
  const cls =
    status === "green"
      ? "bg-green-100 text-green-700"
      : status === "amber"
      ? "bg-amber-100 text-amber-700"
      : "bg-red-100 text-red-700";

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${cls}`}>
      {status === "green" ? (
        <CheckCircle2 size={11} />
      ) : status === "amber" ? (
        <AlertTriangle size={11} />
      ) : (
        <AlertCircle size={11} />
      )}
      {score}
    </span>
  );
}

function StatusDot({ status }: { status: string | null }) {
  if (!status) return <span className="w-2 h-2 rounded-full bg-gray-300 inline-block" />;
  const cls =
    status === "green"
      ? "bg-green-500"
      : status === "amber"
      ? "bg-amber-400"
      : "bg-red-500";
  return <span className={`w-2 h-2 rounded-full inline-block flex-shrink-0 ${cls}`} />;
}

function InquiryTrend({
  thisMonth,
  lastMonth,
}: {
  thisMonth: number;
  lastMonth: number;
}) {
  if (lastMonth === 0) {
    return (
      <span className="flex items-center gap-0.5 text-gray-500">
        <Minus size={12} />
        {thisMonth}
      </span>
    );
  }
  const diff = thisMonth - lastMonth;
  if (diff > 0) {
    return (
      <span className="flex items-center gap-0.5 text-green-600">
        <TrendingUp size={12} />
        {thisMonth}
        <span className="text-xs text-green-500">+{diff}</span>
      </span>
    );
  }
  if (diff < 0) {
    return (
      <span className="flex items-center gap-0.5 text-red-500">
        <TrendingDown size={12} />
        {thisMonth}
        <span className="text-xs text-red-400">{diff}</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-0.5 text-gray-600">
      <Minus size={12} />
      {thisMonth}
    </span>
  );
}

export default function PortfolioPage() {
  const { data, isLoading, refetch, isFetching } = trpc.enterprise.getPortfolio.useQuery();
  const calculateHealth = trpc.enterprise.calculateVenueHealth.useMutation();
  const [recalculating, setRecalculating] = useState(false);

  async function handleRecalculate() {
    if (!data?.venues) return;
    setRecalculating(true);
    for (const venue of data.venues) {
      await calculateHealth.mutateAsync({ venueId: venue.id });
    }
    await refetch();
    setRecalculating(false);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!data || data.venues.length === 0) {
    return (
      <div className="max-w-2xl mx-auto mt-16 text-center">
        <Building2 size={40} className="mx-auto mb-4 text-gray-300" />
        <h2 className="text-lg font-semibold text-gray-700 mb-2">No other venues found</h2>
        <p className="text-sm text-gray-500">
          Your account is not linked to an organisation with multiple venues. Contact your
          administrator to enable enterprise access.
        </p>
      </div>
    );
  }

  const { venues, orgName } = data;
  const avgHealth =
    venues.filter((v) => v.healthScore !== null).length > 0
      ? Math.round(
          venues
            .filter((v) => v.healthScore !== null)
            .reduce((s, v) => s + (v.healthScore ?? 0), 0) /
            venues.filter((v) => v.healthScore !== null).length
        )
      : null;
  const redCount = venues.filter((v) => v.healthStatus === "red").length;
  const greenCount = venues.filter((v) => v.healthStatus === "green").length;

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            {orgName ?? "Portfolio"}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">All venues</p>
        </div>
        <button
          onClick={handleRecalculate}
          disabled={recalculating || isFetching}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <RefreshCw size={14} className={recalculating ? "animate-spin" : ""} />
          {recalculating ? "Recalculating..." : "Recalculate health scores"}
        </button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Total venues</p>
          <p className="text-2xl font-semibold text-gray-900">{venues.length}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Avg health score</p>
          <p className="text-2xl font-semibold text-gray-900">
            {avgHealth !== null ? avgHealth : "—"}
          </p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Venues in red</p>
          <p className={`text-2xl font-semibold ${redCount > 0 ? "text-red-600" : "text-gray-900"}`}>
            {redCount}
          </p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Venues in green</p>
          <p className={`text-2xl font-semibold ${greenCount > 0 ? "text-green-600" : "text-gray-900"}`}>
            {greenCount}
          </p>
        </div>
      </div>

      {/* Venue cards grid */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {venues.map((venue) => (
          <div
            key={venue.id}
            className="bg-white rounded-lg border border-gray-200 p-5 flex flex-col gap-3"
          >
            {/* Top row: name + health badge */}
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-gray-900 leading-tight">
                  {venue.name}
                </h2>
                {(venue.city || venue.state) && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    {[venue.city, venue.state].filter(Boolean).join(", ")}
                  </p>
                )}
              </div>
              <HealthBadge score={venue.healthScore} status={venue.healthStatus} />
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <p className="text-gray-400 mb-0.5">Inquiries this mo.</p>
                <div className="font-medium text-gray-700">
                  <InquiryTrend
                    thisMonth={venue.inquiriesThisMonth}
                    lastMonth={venue.inquiriesLastMonth}
                  />
                </div>
              </div>
              <div>
                <p className="text-gray-400 mb-0.5">Revenue YTD</p>
                <p className="font-medium text-gray-700">{fmtDollars(venue.revenueYTD)}</p>
              </div>
              <div>
                <p className="text-gray-400 mb-0.5">Booking rate</p>
                <p className="font-medium text-gray-700">{fmtPct(venue.bookingRate)}</p>
              </div>
            </div>

            {/* Alert row */}
            {venue.alerts && venue.alerts.length > 0 ? (
              <div className="flex items-start gap-1.5 bg-red-50 rounded px-2.5 py-1.5">
                <StatusDot status={venue.healthStatus} />
                <p className="text-xs text-red-700 leading-snug">{venue.alerts[0]}</p>
              </div>
            ) : venue.healthStatus ? (
              <div className="flex items-center gap-1.5">
                <StatusDot status={venue.healthStatus} />
                <p className="text-xs text-gray-400">
                  {venue.healthStatus === "green"
                    ? "All metrics on track"
                    : "No critical alerts"}
                </p>
              </div>
            ) : null}

            {/* Footer link */}
            <div className="pt-1 border-t border-gray-100">
              <Link
                href="/dashboard"
                className="text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                View venue →
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
