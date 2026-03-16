"use client";

import { trpc } from "@/lib/trpc/client";
import { GitMerge, Check, X, HelpCircle } from "lucide-react";
import { format } from "date-fns";

export default function MatchingPage() {
  const { data, isLoading, refetch } = trpc.matching.listQueue.useQuery({ status: "pending", limit: 20 });

  const confirm = trpc.matching.confirm.useMutation({ onSuccess: () => refetch() });
  const reject = trpc.matching.reject.useMutation({ onSuccess: () => refetch() });
  const flagUnsure = trpc.matching.flagUnsure.useMutation({ onSuccess: () => refetch() });

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Identity Matching</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Review potential matches between inquiries and client records.
          Auto-matches require 90+ confidence score.
        </p>
      </div>

      {isLoading && (
        <div className="text-sm text-gray-400 py-8 text-center">Loading...</div>
      )}

      {!isLoading && (data?.items ?? []).length === 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <GitMerge size={32} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 font-medium">No pending matches</p>
          <p className="text-sm text-gray-400 mt-1">All potential matches have been reviewed</p>
        </div>
      )}

      <div className="space-y-6">
        {(data?.items ?? []).map((item: any) => (
          <div key={item.id} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-gray-700">Match score</span>
                <div className="flex items-center gap-2">
                  <div className="w-32 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        item.match_score >= 80 ? "bg-green-500"
                        : item.match_score >= 60 ? "bg-yellow-500"
                        : "bg-red-500"
                      }`}
                      style={{ width: `${item.match_score}%` }}
                    />
                  </div>
                  <span className="text-sm font-semibold">{item.match_score}</span>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2">
                <button
                  onClick={() => confirm.mutate({ queueItemId: item.id })}
                  className="flex items-center gap-1.5 text-sm text-white bg-green-600 px-3 py-1.5 rounded hover:bg-green-700 transition-colors"
                >
                  <Check size={14} />
                  Same person
                </button>
                <button
                  onClick={() => reject.mutate({ queueItemId: item.id })}
                  className="flex items-center gap-1.5 text-sm text-white bg-red-600 px-3 py-1.5 rounded hover:bg-red-700 transition-colors"
                >
                  <X size={14} />
                  Not the same
                </button>
                <button
                  onClick={() => flagUnsure.mutate({ queueItemId: item.id })}
                  className="flex items-center gap-1.5 text-sm text-gray-700 bg-gray-100 px-3 py-1.5 rounded hover:bg-gray-200 transition-colors"
                >
                  <HelpCircle size={14} />
                  Unsure
                </button>
              </div>
            </div>

            {/* Side-by-side records */}
            <div className="grid grid-cols-2 divide-x divide-gray-100">
              <RecordCard record={item.recordA} type={item.record_a_type} label="Record A" />
              <RecordCard record={item.recordB} type={item.record_b_type} label="Record B" />
            </div>

            {/* Signal breakdown */}
            <div className="px-5 py-4 border-t border-gray-100 bg-gray-50">
              <h4 className="text-xs font-medium text-gray-500 uppercase mb-3">Signal breakdown</h4>
              <div className="flex flex-wrap gap-2">
                {(item.signals_matched ?? []).map((sig: any) => (
                  <span key={sig.name} className="text-xs bg-green-100 text-green-700 border border-green-200 px-2 py-1 rounded">
                    ✓ {sig.name.replace(/_/g, " ")} ({sig.weight})
                  </span>
                ))}
                {(item.signals_unmatched ?? []).map((sig: any) => (
                  <span key={sig.name} className="text-xs bg-red-50 text-red-600 border border-red-100 px-2 py-1 rounded">
                    ✗ {sig.name.replace(/_/g, " ")} ({sig.weight})
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecordCard({ record, type, label }: { record: any; type: string; label: string }) {
  if (!record) return <div className="p-5 text-sm text-gray-400">Record not found</div>;

  const name = type === "inquiry"
    ? record.name_extracted
    : record.name_primary;
  const email = type === "inquiry" ? record.email_extracted : record.email_primary;
  const eventDate = type === "inquiry" ? record.event_date_extracted : record.event_date;
  const phone = type === "inquiry" ? record.phone_extracted : record.phone_primary;

  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-gray-400 uppercase">{label}</span>
        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded capitalize">{type}</span>
      </div>
      <div className="space-y-1.5 text-sm">
        <p className="font-medium text-gray-900">{name ?? "—"}</p>
        <p className="text-gray-500">{email ?? "—"}</p>
        <p className="text-gray-500">{phone ?? "—"}</p>
        <p className="text-gray-500">
          {eventDate ? format(new Date(eventDate), "MMM d, yyyy") : "No date"}
        </p>
        {type === "inquiry" && record.platform && (
          <p className="text-gray-400 text-xs">via {record.platform}</p>
        )}
      </div>
    </div>
  );
}
