"use client";

import { trpc } from "@/lib/trpc/client";
import { format } from "date-fns";
import { AlertTriangle } from "lucide-react";
import Link from "next/link";

export default function HoldAlertsWidget() {
  const { data: holds, isLoading, isError } = trpc.analytics.getHoldAlerts.useQuery(undefined, {
    staleTime: 1000 * 60 * 2,
  });

  if (isError) return null;

  if (isLoading) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-4 bg-gray-100 rounded w-28 animate-pulse" />
          <div className="h-5 bg-gray-100 rounded-full w-6 animate-pulse" />
        </div>
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex items-center justify-between animate-pulse">
              <div className="space-y-1.5">
                <div className="h-3.5 bg-gray-100 rounded w-36" />
                <div className="h-3 bg-gray-100 rounded w-24" />
              </div>
              <div className="h-3.5 bg-gray-100 rounded w-20" />
              <div className="h-6 bg-gray-100 rounded-full w-20" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!holds || holds.length === 0) return null;

  const urgentCount = holds.filter((h) => h.urgent).length;

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
      {urgentCount > 0 && (
        <div className="flex items-center gap-2 mb-4 bg-red-50 border border-red-200 text-red-700 text-sm font-medium rounded-lg px-4 py-2.5">
          <AlertTriangle size={15} className="flex-shrink-0" />
          <span>
            {urgentCount} hold{urgentCount > 1 ? "s" : ""} expiring within 3 days — follow up now
          </span>
        </div>
      )}

      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-semibold text-gray-900">Active Holds</h2>
        <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5 font-medium">
          {holds.length}
        </span>
      </div>

      <div className="space-y-2.5">
        {holds.map((hold) => (
          <div key={hold.id} className="flex items-center gap-3 py-1.5">
            {/* Left: name + date */}
            <div className="flex-1 min-w-0">
              <Link href={`/clients/${hold.id}`} className="text-sm font-semibold text-gray-900 hover:text-blue-600 truncate block transition-colors">
                {hold.name}
              </Link>
              {hold.eventDate && (
                <p className="text-xs text-gray-400">
                  {format(new Date(hold.eventDate), "MMM d, yyyy")}
                </p>
              )}
            </div>

            {/* Center: revenue */}
            <div className="text-sm text-gray-700 w-24 text-right">
              {hold.revenueCents != null ? (
                <span>${(hold.revenueCents / 100).toLocaleString()}</span>
              ) : (
                <span className="text-gray-400 text-xs">Revenue TBD</span>
              )}
            </div>

            {/* Right: days-left badge */}
            <div className="flex-shrink-0">
              {hold.urgent ? (
                <span className="text-xs font-semibold bg-red-100 text-red-700 rounded-full px-2.5 py-1">
                  {hold.daysLeft} day{hold.daysLeft !== 1 ? "s" : ""} left
                </span>
              ) : (
                <span className="text-xs font-semibold bg-amber-100 text-amber-700 rounded-full px-2.5 py-1">
                  {hold.daysLeft} day{hold.daysLeft !== 1 ? "s" : ""} left
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
