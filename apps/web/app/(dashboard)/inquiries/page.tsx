"use client";

import { trpc } from "@/lib/trpc/client";
import { useState } from "react";
import { format } from "date-fns";
import { Inbox, Filter, ChevronDown, ChevronUp } from "lucide-react";
import Link from "next/link";

function formatAlertType(alertType: string): string {
  return alertType
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function ResponseAlertsBanner() {
  const utils = trpc.useUtils();
  const { data } = trpc.inquiries.getAlerts.useQuery();
  const resolveAlert = trpc.inquiries.resolveAlert.useMutation({
    onSuccess: () => utils.inquiries.getAlerts.invalidate(),
  });
  const [open, setOpen] = useState(true);

  if (!data || data.length === 0) return null;

  return (
    <div className="mb-4 rounded-lg border border-red-200 bg-red-50 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold text-red-700">
          ⚠ {data.length} slow response{data.length !== 1 ? "s" : ""} need attention
        </span>
        {open ? (
          <ChevronUp size={15} className="text-red-500 flex-shrink-0" />
        ) : (
          <ChevronDown size={15} className="text-red-500 flex-shrink-0" />
        )}
      </button>
      {open && (
        <div className="border-t border-red-200 divide-y divide-red-100">
          {data.map((alert: any) => (
            <div key={alert.id} className="flex items-center justify-between gap-4 px-4 py-2.5">
              <span className="text-sm text-gray-800 font-medium w-40 truncate">
                {alert.inquiry?.name_extracted ?? "Unknown"}
              </span>
              <span className="text-sm text-gray-600 flex-1">
                {formatAlertType(alert.alert_type)}
              </span>
              {alert.actual_minutes != null && (
                <span className="text-xs text-red-600 whitespace-nowrap">
                  {alert.actual_minutes} min
                  {alert.threshold_minutes != null && ` (threshold: ${alert.threshold_minutes} min)`}
                </span>
              )}
              <button
                onClick={() => resolveAlert.mutate({ id: alert.id })}
                disabled={resolveAlert.isPending}
                className="flex-shrink-0 text-xs text-gray-500 hover:text-red-600 border border-gray-300 hover:border-red-300 px-2.5 py-1 rounded transition-colors disabled:opacity-50"
              >
                Dismiss
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const PLATFORM_COLORS: Record<string, string> = {
  knot: "bg-purple-100 text-purple-700",
  email: "bg-blue-100 text-blue-700",
  website: "bg-green-100 text-green-700",
  instagram: "bg-pink-100 text-pink-700",
  direct: "bg-gray-100 text-gray-700",
};

const MATCH_COLORS: Record<string, string> = {
  unmatched: "bg-red-100 text-red-700",
  auto_matched: "bg-green-100 text-green-700",
  human_confirmed: "bg-green-100 text-green-700",
  human_rejected: "bg-gray-100 text-gray-500",
};

export default function InquiriesPage() {
  const [matchFilter, setMatchFilter] = useState<string>("all");
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [offset, setOffset] = useState(0);

  const { data, isLoading, refetch } = trpc.inquiries.list.useQuery({
    matchStatus: matchFilter !== "all" ? matchFilter as any : undefined,
    platform: platformFilter !== "all" && platformFilter !== "blast" ? platformFilter : undefined,
    intentFilter: platformFilter === "blast" ? "also_contacted" : undefined,
    limit: 50,
    offset,
  });

  const markResponded = trpc.inquiries.markResponded.useMutation({ onSuccess: () => refetch() });
  const createClient = trpc.inquiries.createClientFromInquiry.useMutation({ onSuccess: () => refetch() });

  return (
    <div className="max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Inquiries</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {data?.total ?? 0} total inquiries
          </p>
        </div>
      </div>

      {/* Response alerts */}
      <ResponseAlertsBanner />

      {/* Filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4 flex items-center gap-4">
        <Filter size={16} className="text-gray-400" />
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Platform:</span>
          {["all", "knot", "email", "website", "instagram", "direct", "blast"].map((p) => (
            <button
              key={p}
              onClick={() => { setPlatformFilter(p); setOffset(0); }}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                platformFilter === p
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
              }`}
            >
              {p === "all" ? "All" : p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
        <div className="h-4 w-px bg-gray-300" />
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Status:</span>
          {["all", "unmatched", "auto_matched", "human_confirmed"].map((s) => (
            <button
              key={s}
              onClick={() => { setMatchFilter(s); setOffset(0); }}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                matchFilter === s
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
              }`}
            >
              {s === "all" ? "All" : s.replace("_", " ")}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Platform</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Day</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Source</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Response</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Match</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-400 text-sm">Loading...</td>
              </tr>
            )}
            {!isLoading && (data?.inquiries ?? []).length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center">
                  <Inbox size={24} className="mx-auto text-gray-300 mb-2" />
                  <p className="text-sm text-gray-400">No inquiries found</p>
                </td>
              </tr>
            )}
            {(data?.inquiries ?? []).map((inq: any) => (
              <tr key={inq.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">
                  {inq.name_extracted ?? "Unknown"}
                </td>
                <td className="px-4 py-3 text-gray-500">
                  {inq.received_at
                    ? format(new Date(inq.received_at), "MMM d, yyyy")
                    : "—"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PLATFORM_COLORS[inq.platform] ?? "bg-gray-100 text-gray-600"}`}>
                      {inq.platform}
                    </span>
                    {inq.inquiry_intent === "also_contacted" && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium leading-tight">
                        blast
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-500">
                  {inq.day_of_week !== null
                    ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][inq.day_of_week]
                    : "—"}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  {inq.resolved_source ?? inq.self_reported_source ?? "—"}
                  {inq.resolved_source_confidence
                    ? <span className="text-gray-400 ml-1">({inq.resolved_source_confidence}%)</span>
                    : null}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  {inq.response_time_minutes
                    ? inq.response_time_minutes < 60
                      ? `${inq.response_time_minutes}m`
                      : `${Math.round(inq.response_time_minutes / 60)}h`
                    : "—"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1 items-start">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${MATCH_COLORS[inq.match_status] ?? "bg-gray-100 text-gray-600"}`}>
                      {inq.match_status.replace("_", " ")}
                    </span>
                    {inq.prior_signal_status === "confirmed" && (
                      <span
                        title={
                          inq.days_from_signal_to_inquiry != null
                            ? `Viewed profile ${inq.days_from_signal_to_inquiry} day${inq.days_from_signal_to_inquiry !== 1 ? "s" : ""} before inquiring`
                            : "Prior engagement signal confirmed"
                        }
                        className="text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700 border border-green-200 cursor-default"
                      >
                        Prior signal ✓
                      </span>
                    )}
                    {inq.prior_signal_status === "pending_review" && (
                      <Link
                        href="/matching"
                        title="Possible prior engagement — click to review in the matching queue"
                        className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700 border border-amber-200 hover:bg-amber-200 transition-colors"
                      >
                        Prior signal?
                      </Link>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {inq.match_status === "unmatched" && (
                      <button
                        onClick={() => createClient.mutate({ inquiryId: inq.id })}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Create client
                      </button>
                    )}
                    {inq.matched_client && (
                      <Link href={`/clients/${inq.matched_client.id}`} className="text-xs text-blue-600 hover:underline">
                        View client
                      </Link>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
