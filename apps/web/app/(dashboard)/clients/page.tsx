"use client";

import { trpc } from "@/lib/trpc/client";
import { useState } from "react";
import { format } from "date-fns";
import { Users, Search, X, ChevronDown } from "lucide-react";
import Link from "next/link";

const STATUS_COLORS: Record<string, string> = {
  inquiry: "bg-gray-100 text-gray-600",
  tour_booked: "bg-blue-100 text-blue-700",
  booked: "bg-indigo-100 text-indigo-700",
  planning: "bg-purple-100 text-purple-700",
  event_complete: "bg-green-100 text-green-700",
  archived: "bg-gray-100 text-gray-400",
};

const ALL_STATUSES = [
  "inquiry",
  "tour_booked",
  "booked",
  "planning",
  "event_complete",
  "archived",
] as const;
type ClientStatus = typeof ALL_STATUSES[number];

const LOST_REASON_OPTIONS: { value: string; label: string }[] = [
  { value: "too_expensive", label: "Too expensive" },
  { value: "date_taken", label: "Date already taken" },
  { value: "chose_competitor", label: "Chose a competitor" },
  { value: "no_response", label: "We never replied" },
  { value: "not_right_fit", label: "Not the right fit" },
  { value: "budget_cut", label: "Budget cut or postponed" },
  { value: "unknown", label: "Not sure / other" },
];

interface LostReasonModalProps {
  clientId: string;
  clientName: string;
  onConfirm: (reason: string | null, note: string) => void;
  onSkip: () => void;
  onCancel: () => void;
  isPending: boolean;
}

function LostReasonModal({
  clientName,
  onConfirm,
  onSkip,
  onCancel,
  isPending,
}: LostReasonModalProps) {
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [note, setNote] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-start justify-between p-5 pb-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Why didn&apos;t this one happen?</h2>
            <p className="text-sm text-gray-500 mt-1">
              This helps you understand which leads are worth more effort.
            </p>
            <p className="text-xs text-gray-400 mt-0.5">{clientName}</p>
          </div>
          <button
            onClick={onCancel}
            className="ml-4 flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Cancel"
          >
            <X size={18} />
          </button>
        </div>

        {/* Options */}
        <div className="p-5">
          <div className="flex flex-wrap gap-2 mb-4">
            {LOST_REASON_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSelectedReason(opt.value)}
                className={`px-3 py-1.5 rounded-full border text-sm transition-colors ${
                  selectedReason === opt.value
                    ? "bg-blue-600 border-blue-600 text-white"
                    : "bg-white border-gray-200 text-gray-700 hover:border-gray-400"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. they mentioned Shenandoah Valley Vineyard"
            rows={2}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <p className="text-xs text-gray-400 mt-1">Any notes? (optional)</p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between px-5 pb-5">
          <button
            onClick={onSkip}
            disabled={isPending}
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
          >
            Skip
          </button>
          <button
            onClick={() => onConfirm(selectedReason, note)}
            disabled={isPending}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {isPending ? "Saving..." : "Save & archive"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface StatusDropdownProps {
  clientId: string;
  currentStatus: ClientStatus;
  onStatusChange: (clientId: string, newStatus: ClientStatus) => void;
}

function StatusDropdown({ clientId, currentStatus, onStatusChange }: StatusDropdownProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium cursor-pointer transition-opacity hover:opacity-80 ${
          STATUS_COLORS[currentStatus] ?? "bg-gray-100 text-gray-600"
        }`}
      >
        {currentStatus.replace(/_/g, " ")}
        <ChevronDown size={10} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[160px]">
            {ALL_STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => {
                  setOpen(false);
                  if (s !== currentStatus) onStatusChange(clientId, s);
                }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 transition-colors ${
                  s === currentStatus ? "font-semibold text-blue-600" : "text-gray-700"
                }`}
              >
                {s.replace(/_/g, " ")}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const PAGE_SIZE = 100;

export default function ClientsPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(0);

  // Lost reason modal state
  const [pendingArchive, setPendingArchive] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.clients.list.useQuery({
    search: search || undefined,
    status: statusFilter !== "all" ? (statusFilter as ClientStatus) : undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const updateMutation = trpc.clients.update.useMutation({
    onSuccess: () => {
      utils.clients.list.invalidate();
      setPendingArchive(null);
    },
  });

  function handleStatusChange(clientId: string, newStatus: ClientStatus) {
    if (newStatus === "archived") {
      const client = data?.clients.find((c: any) => c.id === clientId);
      const displayName = client
        ? [client.name_primary, client.name_partner].filter(Boolean).join(" & ")
        : "this client";
      setPendingArchive({ id: clientId, name: displayName });
    } else {
      updateMutation.mutate({ id: clientId, status: newStatus });
    }
  }

  function handleLostReasonConfirm(reason: string | null, note: string) {
    if (!pendingArchive) return;
    updateMutation.mutate({
      id: pendingArchive.id,
      status: "archived",
      lostReason: reason as any ?? "unknown",
      lostReasonNote: note || null,
    });
  }

  function handleLostReasonSkip() {
    if (!pendingArchive) return;
    updateMutation.mutate({ id: pendingArchive.id, status: "archived" });
  }

  return (
    <div className="max-w-6xl">
      {pendingArchive && (
        <LostReasonModal
          clientId={pendingArchive.id}
          clientName={pendingArchive.name}
          onConfirm={handleLostReasonConfirm}
          onSkip={handleLostReasonSkip}
          onCancel={() => setPendingArchive(null)}
          isPending={updateMutation.isPending}
        />
      )}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Clients</h1>
          <p className="text-sm text-gray-500 mt-0.5">{data?.total ?? 0} records</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/import"
            className="flex items-center gap-1.5 border border-gray-300 bg-white text-gray-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Import CSV
          </Link>
          <Link
            href="/capture"
            className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            + Add client
          </Link>
        </div>
      </div>

      {/* Search + filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="w-full border border-gray-300 rounded-md pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {["all", ...ALL_STATUSES].map((s) => (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setPage(0); }}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                statusFilter === s
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
              }`}
            >
              {s === "all" ? "All" : s.replace(/_/g, " ")}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Client</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Event date</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Source</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Revenue</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Review</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
            )}
            {!isLoading && (data?.clients ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-16 text-center">
                  <Users size={28} className="mx-auto text-gray-200 mb-3" />
                  {statusFilter !== "all" || search ? (
                    <>
                      <p className="text-sm font-medium text-gray-500 mb-1">No clients match this filter</p>
                      <p className="text-xs text-gray-400">Try clearing the search or switching to "All"</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-gray-700 mb-1">No clients yet</p>
                      <p className="text-xs text-gray-400 mb-4 max-w-xs mx-auto">
                        Import from a HoneyBook CSV export, or add clients one at a time.
                      </p>
                      <div className="flex items-center justify-center gap-2">
                        <Link
                          href="/import"
                          className="inline-flex items-center gap-1.5 border border-gray-300 bg-white text-gray-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
                        >
                          Import CSV
                        </Link>
                        <Link
                          href="/capture"
                          className="inline-flex items-center gap-1.5 bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                        >
                          + Add client
                        </Link>
                      </div>
                    </>
                  )}
                </td>
              </tr>
            )}
            {(data?.clients ?? []).map((client: any) => (
              <tr key={client.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link href={`/clients/${client.id}`} className="font-medium text-gray-900 hover:text-blue-600">
                    {client.name_primary}
                  </Link>
                  {client.name_partner && (
                    <span className="text-gray-400"> & {client.name_partner}</span>
                  )}
                  {client.email_primary && (
                    <p className="text-xs text-gray-400">{client.email_primary}</p>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-500">
                  {client.event_date
                    ? format(new Date(client.event_date), "MMM d, yyyy")
                    : "TBD"}
                </td>
                <td className="px-4 py-3">
                  <StatusDropdown
                    clientId={client.id}
                    currentStatus={client.status as ClientStatus}
                    onStatusChange={handleStatusChange}
                  />
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  {client.resolved_source ?? client.self_reported_source ?? client.first_touch_platform ?? "—"}
                </td>
                <td className="px-4 py-3 text-gray-700">
                  {client.revenue_cents
                    ? `$${(client.revenue_cents / 100).toLocaleString()}`
                    : "—"}
                </td>
                <td className="px-4 py-3 text-gray-700">
                  {client.review_star_rating
                    ? `${client.review_star_rating}★`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {(data?.total ?? 0) > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
          <span>
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, data?.total ?? 0)} of {data?.total ?? 0}
          </span>
          <div className="flex items-center gap-2">
            <button
              disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
              className="px-3 py-1.5 border border-gray-300 rounded text-sm hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ← Prev
            </button>
            <button
              disabled={(page + 1) * PAGE_SIZE >= (data?.total ?? 0)}
              onClick={() => setPage(p => p + 1)}
              className="px-3 py-1.5 border border-gray-300 rounded text-sm hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
