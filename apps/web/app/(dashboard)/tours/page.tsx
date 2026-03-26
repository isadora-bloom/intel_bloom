"use client";

import { trpc } from "@/lib/trpc/client";
import { createClient } from "@/lib/supabase/client";
import { useState, useEffect, useCallback } from "react";
import { format } from "date-fns";
import {
  CalendarCheck,
  RefreshCw,
  Plus,
  Pencil,
  X,
  Loader2,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TourClient {
  name_primary: string | null;
  name_partner: string | null;
}

interface Tour {
  id: string;
  venue_id: string;
  client_id: string | null;
  scheduled_at: string | null;
  tour_type: string | null;
  completed: boolean;
  cancelled: boolean;
  cancel_reason: string | null;
  self_reported_source: string | null;
  competing_venues: string[] | null;
  conducted_by: string | null;
  notes_raw: string | null;
  outcome: string | null;
  booking_date: string | null;
  booking_conversion_days: number | null;
  lost_reason: string | null;
  // joined
  client: TourClient | null;
}

type OutcomeValue =
  | "scheduled"
  | "completed_booked"
  | "completed_not_booked"
  | "cancelled";

type FilterTab = "all" | "upcoming" | "completed" | "cancelled";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getOutcomeBadge(tour: Tour): { label: string; className: string } {
  if (tour.booking_date) {
    return { label: "Booked", className: "bg-green-100 text-green-700" };
  }
  if (tour.completed) {
    return { label: "Completed", className: "bg-blue-100 text-blue-700" };
  }
  if (tour.cancelled) {
    return { label: "Cancelled", className: "bg-red-100 text-red-600" };
  }
  return { label: "Scheduled", className: "bg-gray-100 text-gray-600" };
}

function clientDisplayName(tour: Tour): string {
  if (!tour.client) return "—";
  const names = [tour.client.name_primary, tour.client.name_partner]
    .filter(Boolean)
    .join(" & ");
  return names || "—";
}

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  // format as YYYY-MM-DDTHH:MM
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

const TOUR_TYPE_CHIPS = ["In-Person", "Virtual", "Phone"];

interface TourModalProps {
  initial: Partial<Tour> | null;
  onClose: () => void;
  onSaved: () => void;
}

function TourModal({ initial, onClose, onSaved }: TourModalProps) {
  const isEdit = Boolean(initial?.id);

  const [scheduledAt, setScheduledAt] = useState<string>(
    toDatetimeLocal(initial?.scheduled_at ?? null)
  );
  const [tourType, setTourType] = useState<string>(initial?.tour_type ?? "");
  const [conductedBy, setConductedBy] = useState<string>(
    initial?.conducted_by ?? ""
  );
  const [source, setSource] = useState<string>(
    initial?.self_reported_source ?? ""
  );
  const [notesRaw, setNotesRaw] = useState<string>(
    initial?.notes_raw ?? ""
  );
  const [outcome, setOutcome] = useState<OutcomeValue>(() => {
    if (initial?.booking_date) return "completed_booked";
    if (initial?.completed) return "completed_not_booked";
    if (initial?.cancelled) return "cancelled";
    return "scheduled";
  });
  const [bookingDate, setBookingDate] = useState<string>(
    initial?.booking_date ?? ""
  );
  const [competingVenuesRaw, setCompetingVenuesRaw] = useState<string>(
    (initial?.competing_venues ?? []).join(", ")
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const supabase = createClient();

    const competed =
      competingVenuesRaw.trim()
        ? competingVenuesRaw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];

    const payload: Record<string, unknown> = {
      scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      tour_type: tourType || null,
      conducted_by: conductedBy || null,
      self_reported_source: source || null,
      notes_raw: notesRaw || null,
      competing_venues: competed.length > 0 ? competed : null,
      completed: false,
      cancelled: false,
      booking_date: null,
    };

    // Resolve outcome flags
    switch (outcome) {
      case "completed_booked":
        payload.completed = true;
        payload.booking_date = bookingDate || null;
        break;
      case "completed_not_booked":
        payload.completed = true;
        break;
      case "cancelled":
        payload.cancelled = true;
        break;
      case "scheduled":
      default:
        break;
    }

    let dbError: { message: string } | null = null;

    if (isEdit && initial?.id) {
      const { error: updateError } = await supabase
        .from("tours")
        .update(payload)
        .eq("id", initial.id);
      dbError = updateError;
    } else {
      const { error: insertError } = await supabase
        .from("tours")
        .insert(payload);
      dbError = insertError;
    }

    setSaving(false);

    if (dbError) {
      setError(dbError.message);
      return;
    }

    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">
            {isEdit ? "Edit tour" : "Log a tour"}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <form
          onSubmit={handleSave}
          className="overflow-y-auto flex-1 p-5 space-y-4"
        >
          {/* Scheduled at */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Date &amp; time
            </label>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Tour type */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Tour type
            </label>
            <div className="flex flex-wrap gap-2 mb-2">
              {TOUR_TYPE_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => setTourType(chip)}
                  className={`px-3 py-1 rounded-full border text-xs transition-colors ${
                    tourType === chip
                      ? "bg-blue-600 border-blue-600 text-white"
                      : "bg-white border-gray-200 text-gray-700 hover:border-gray-400"
                  }`}
                >
                  {chip}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={tourType}
              onChange={(e) => setTourType(e.target.value)}
              placeholder="Or type a custom label..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Conducted by */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Conducted by
            </label>
            <input
              type="text"
              value={conductedBy}
              onChange={(e) => setConductedBy(e.target.value)}
              placeholder="e.g. Grace, Isadora"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Source */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Self-reported source
            </label>
            <input
              type="text"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="e.g. Google, Instagram, referred by a friend"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Competing venues */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Competing venues{" "}
              <span className="text-gray-400 font-normal">(comma-separated)</span>
            </label>
            <input
              type="text"
              value={competingVenuesRaw}
              onChange={(e) => setCompetingVenuesRaw(e.target.value)}
              placeholder="e.g. Shenandoah Valley Vineyard, Veritas Winery"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Notes
            </label>
            <textarea
              value={notesRaw}
              onChange={(e) => setNotesRaw(e.target.value)}
              rows={3}
              placeholder="Anything worth remembering about this tour..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Outcome */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Outcome
            </label>
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as OutcomeValue)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="scheduled">Scheduled</option>
              <option value="completed_booked">Completed — Booked</option>
              <option value="completed_not_booked">
                Completed — Not Booked
              </option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          {/* Booking date (conditional) */}
          {outcome === "completed_booked" && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Booking date
              </label>
              <input
                type="date"
                value={bookingDate}
                onChange={(e) => setBookingDate(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {isEdit ? "Save changes" : "Log tour"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Stats card ───────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 px-5 py-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "upcoming", label: "Upcoming" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
];

export default function ToursPage() {
  const [tours, setTours] = useState<Tour[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [modalTour, setModalTour] = useState<Partial<Tour> | null | false>(
    false
  ); // false = closed, null = new, Tour = edit
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncSuccess, setSyncSuccess] = useState<string | null>(null);

  // tRPC stats and sync
  const { data: stats } = trpc.calendly.getStats.useQuery();
  const syncMutation = trpc.calendly.syncTours.useMutation({
    onSuccess: (result) => {
      setSyncError(null);
      setSyncSuccess(
        `Synced ${result.synced} new tour${result.synced !== 1 ? "s" : ""}` +
          (result.alreadyExisted > 0
            ? ` (${result.alreadyExisted} already existed)`
            : "") +
          (result.errors.length > 0
            ? `. ${result.errors.length} error${result.errors.length !== 1 ? "s" : ""}.`
            : ".")
      );
      fetchTours();
    },
    onError: (err) => {
      setSyncSuccess(null);
      if (err.data?.code === "PRECONDITION_FAILED") {
        setSyncError(
          "No Calendly API key configured. Add it in Settings → Integrations."
        );
      } else {
        setSyncError(err.message);
      }
    },
  });

  const fetchTours = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("tours")
      .select("*, client:clients(name_primary, name_partner)")
      .order("scheduled_at", { ascending: false });

    if (!error && data) {
      setTours(data as Tour[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTours();
  }, [fetchTours]);

  // ── Derived stats ──────────────────────────────────────────────────────────

  const now = new Date();
  const thisYear = now.getFullYear();

  const toursThisYear = tours.filter((t) => {
    if (!t.scheduled_at) return false;
    return new Date(t.scheduled_at).getFullYear() === thisYear;
  }).length;

  const completedCount = stats?.completedTours ?? 0;
  const conversionPct =
    stats?.conversionRate != null
      ? `${Math.round(stats.conversionRate * 100)}%`
      : "—";
  const avgDays =
    stats?.avgBookingDays != null ? `${stats.avgBookingDays}d` : "—";

  // ── Filtered list ──────────────────────────────────────────────────────────

  const filtered = tours.filter((t) => {
    if (filter === "upcoming") {
      return (
        !t.cancelled &&
        !t.completed &&
        t.scheduled_at != null &&
        new Date(t.scheduled_at) >= now
      );
    }
    if (filter === "completed") return t.completed;
    if (filter === "cancelled") return t.cancelled;
    return true;
  });

  return (
    <div className="max-w-6xl">
      {/* Modal */}
      {modalTour !== false && (
        <TourModal
          initial={modalTour}
          onClose={() => setModalTour(false)}
          onSaved={() => {
            setModalTour(false);
            fetchTours();
          }}
        />
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
            <CalendarCheck size={22} className="text-gray-400" />
            Tours
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Manage tour bookings and track outcomes
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => {
              setSyncError(null);
              setSyncSuccess(null);
              syncMutation.mutate();
            }}
            disabled={syncMutation.isPending}
            className="flex items-center gap-1.5 border border-gray-300 bg-white text-gray-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            {syncMutation.isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            Sync Calendly
          </button>
          <button
            onClick={() => setModalTour(null)}
            className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            <Plus size={14} />
            Log tour
          </button>
        </div>
      </div>

      {/* Sync feedback */}
      {syncError && (
        <div className="mb-4 flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          <X size={14} className="mt-0.5 flex-shrink-0" />
          {syncError}
        </div>
      )}
      {syncSuccess && (
        <div className="mb-4 bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 text-sm">
          {syncSuccess}
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Tours this year" value={toursThisYear} />
        <StatCard label="Completed" value={completedCount} />
        <StatCard label="Conversion rate" value={conversionPct} />
        <StatCard label="Avg days to book" value={avgDays} />
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 mb-4">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === tab.key
                ? "bg-blue-600 text-white"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                Date
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                Client
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                Type
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                Conducted By
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                Outcome
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                Source
              </th>
              <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center">
                  <Loader2
                    size={20}
                    className="mx-auto animate-spin text-gray-300"
                  />
                </td>
              </tr>
            )}

            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-16 text-center">
                  <CalendarCheck
                    size={28}
                    className="mx-auto text-gray-200 mb-3"
                  />
                  {filter !== "all" ? (
                    <>
                      <p className="text-sm font-medium text-gray-500 mb-1">
                        No tours match this filter
                      </p>
                      <p className="text-xs text-gray-400">
                        Try switching to &ldquo;All&rdquo;
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-gray-700 mb-1">
                        No tours yet
                      </p>
                      <p className="text-xs text-gray-400 mb-4 max-w-xs mx-auto">
                        Sync from Calendly or log a tour manually.
                      </p>
                      <button
                        onClick={() => setModalTour(null)}
                        className="inline-flex items-center gap-1.5 bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                      >
                        <Plus size={14} />
                        Log first tour
                      </button>
                    </>
                  )}
                </td>
              </tr>
            )}

            {!loading &&
              filtered.map((tour) => {
                const badge = getOutcomeBadge(tour);
                return (
                  <tr key={tour.id} className="hover:bg-gray-50">
                    {/* Date */}
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                      {tour.scheduled_at ? (
                        format(
                          new Date(tour.scheduled_at),
                          "MMM d, yyyy 'at' h:mm a"
                        )
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>

                    {/* Client */}
                    <td className="px-4 py-3 text-gray-700">
                      {clientDisplayName(tour)}
                    </td>

                    {/* Type */}
                    <td className="px-4 py-3 text-gray-500">
                      {tour.tour_type ?? "—"}
                    </td>

                    {/* Conducted by */}
                    <td className="px-4 py-3 text-gray-500">
                      {tour.conducted_by ?? "—"}
                    </td>

                    {/* Outcome badge */}
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                    </td>

                    {/* Source */}
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {tour.self_reported_source ?? "—"}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setModalTour(tour)}
                        className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 transition-colors px-2 py-1 rounded hover:bg-gray-100"
                        aria-label="Edit tour"
                      >
                        <Pencil size={13} />
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {/* Row count */}
      {!loading && filtered.length > 0 && (
        <p className="mt-3 text-xs text-gray-400 text-right">
          {filtered.length} tour{filtered.length !== 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}
