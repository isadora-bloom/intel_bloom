"use client";

import { trpc } from "@/lib/trpc/client";
import { useState } from "react";
import { format } from "date-fns";
import { DollarSign, Pencil, Trash2, X, Plus } from "lucide-react";

const CHANNEL_PRESETS = [
  "The Knot",
  "WeddingWire",
  "Google Ads",
  "Instagram",
  "Facebook",
  "Referral",
  "Other",
];

interface SpendEntry {
  id: string;
  channel: string;
  month: string;
  spend_cents: number;
  notes: string | null;
}

interface ModalState {
  channel: string;
  month: string;
  amountDollars: string;
  notes: string;
}

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];

function formatDollars(cents: number): string {
  return `$${(cents / 100).toLocaleString()}`;
}

function monthInputToDate(monthValue: string): string {
  // "YYYY-MM" → "YYYY-MM-01"
  return `${monthValue}-01`;
}

function dateToMonthInput(dateStr: string): string {
  // "YYYY-MM-01" or full ISO → "YYYY-MM"
  return dateStr.slice(0, 7);
}

export default function SpendPage() {
  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR);
  const [showModal, setShowModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<SpendEntry | null>(null);

  const [form, setForm] = useState<ModalState>({
    channel: "",
    month: "",
    amountDollars: "",
    notes: "",
  });

  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.touchpoints.getChannelSpend.useQuery({
    year: selectedYear,
  });

  const upsertMutation = trpc.touchpoints.upsertChannelSpend.useMutation({
    onSuccess: () => {
      utils.touchpoints.getChannelSpend.invalidate();
      closeModal();
    },
  });

  const deleteMutation = trpc.touchpoints.deleteChannelSpend.useMutation({
    onSuccess: () => {
      utils.touchpoints.getChannelSpend.invalidate();
    },
  });

  const entries: SpendEntry[] = (data ?? []).slice().sort((a, b) =>
    b.month.localeCompare(a.month)
  );

  // Summary computations
  const totalSpendCents = entries.reduce((sum, e) => sum + e.spend_cents, 0);

  const spendByChannel = entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.channel] = (acc[e.channel] ?? 0) + e.spend_cents;
    return acc;
  }, {});

  const topChannel =
    Object.entries(spendByChannel).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";

  const monthsWithEntries = new Set(entries.map((e) => e.month)).size;

  function openAddModal() {
    setEditingEntry(null);
    setForm({ channel: "", month: "", amountDollars: "", notes: "" });
    setShowModal(true);
  }

  function openEditModal(entry: SpendEntry) {
    setEditingEntry(entry);
    setForm({
      channel: entry.channel,
      month: dateToMonthInput(entry.month),
      amountDollars: String(entry.spend_cents / 100),
      notes: entry.notes ?? "",
    });
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditingEntry(null);
    setForm({ channel: "", month: "", amountDollars: "", notes: "" });
  }

  function handleSave() {
    const amountCents = Math.round(parseFloat(form.amountDollars) * 100);
    if (!form.channel || !form.month || isNaN(amountCents) || amountCents < 0) return;

    upsertMutation.mutate({
      channel: form.channel,
      month: monthInputToDate(form.month),
      amountCents,
      notes: form.notes || undefined,
    });
  }

  function handleDelete(entry: SpendEntry) {
    if (!window.confirm(`Delete ${entry.channel} spend for ${format(new Date(entry.month), "MMM yyyy")}?`)) return;
    deleteMutation.mutate({ id: entry.id });
  }

  const isSaving = upsertMutation.isPending;

  return (
    <div className="max-w-5xl">
      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            {/* Modal header */}
            <div className="flex items-start justify-between p-5 pb-0">
              <div>
                <h2 className="text-base font-semibold text-gray-900">
                  {editingEntry ? "Edit spend entry" : "Add spend entry"}
                </h2>
              </div>
              <button
                onClick={closeModal}
                className="ml-4 flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal body */}
            <div className="p-5 space-y-4">
              {/* Channel */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Channel
                </label>
                <input
                  type="text"
                  value={form.channel}
                  onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value }))}
                  placeholder="e.g. Google Ads"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {CHANNEL_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, channel: preset }))}
                      className={`px-2.5 py-1 rounded-full border text-xs transition-colors ${
                        form.channel === preset
                          ? "bg-blue-600 border-blue-600 text-white"
                          : "bg-white border-gray-200 text-gray-700 hover:border-gray-400"
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Month */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Month
                </label>
                <input
                  type="month"
                  value={form.month}
                  onChange={(e) => setForm((f) => ({ ...f, month: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* Amount */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Amount ($)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.amountDollars}
                  onChange={(e) => setForm((f) => ({ ...f, amountDollars: e.target.value }))}
                  placeholder="0.00"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Notes <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="e.g. Q1 campaign budget"
                  rows={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            {/* Modal actions */}
            <div className="flex items-center justify-end gap-2 px-5 pb-5">
              <button
                onClick={closeModal}
                disabled={isSaving}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving || !form.channel || !form.month || !form.amountDollars}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {isSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Channel Spend</h1>
          <p className="text-sm text-gray-500 mt-0.5">Track monthly spend per acquisition channel</p>
        </div>
        <button
          onClick={openAddModal}
          className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus size={15} />
          Add entry
        </button>
      </div>

      {/* Year filter */}
      <div className="flex items-center gap-2 mb-5">
        {YEAR_OPTIONS.map((year) => (
          <button
            key={year}
            onClick={() => setSelectedYear(year)}
            className={`px-3 py-1.5 rounded-full border text-sm font-medium transition-colors ${
              selectedYear === year
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
            }`}
          >
            {year}
          </button>
        ))}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Total spend</p>
          <p className="text-2xl font-semibold text-gray-900">
            {isLoading ? "—" : formatDollars(totalSpendCents)}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">{selectedYear}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Top channel</p>
          <p className="text-2xl font-semibold text-gray-900 truncate">
            {isLoading ? "—" : entries.length === 0 ? "—" : topChannel}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">by total spend</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Months tracked</p>
          <p className="text-2xl font-semibold text-gray-900">
            {isLoading ? "—" : monthsWithEntries}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">with at least one entry</p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Channel</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Month</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Amount</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Notes</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  Loading...
                </td>
              </tr>
            )}
            {!isLoading && entries.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-16 text-center">
                  <DollarSign size={28} className="mx-auto text-gray-200 mb-3" />
                  <p className="text-sm font-medium text-gray-700 mb-1">No spend entries yet</p>
                  <p className="text-xs text-gray-400 mb-4">
                    Track what you spend per channel each month to understand your acquisition costs.
                  </p>
                  <button
                    onClick={openAddModal}
                    className="inline-flex items-center gap-1.5 bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                  >
                    <Plus size={14} />
                    Add entry
                  </button>
                </td>
              </tr>
            )}
            {entries.map((entry) => (
              <tr key={entry.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{entry.channel}</td>
                <td className="px-4 py-3 text-gray-500">
                  {format(new Date(entry.month), "MMM yyyy")}
                </td>
                <td className="px-4 py-3 text-gray-700 tabular-nums">
                  {formatDollars(entry.spend_cents)}
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs">
                  {entry.notes
                    ? entry.notes.length > 40
                      ? entry.notes.slice(0, 40) + "…"
                      : entry.notes
                    : "—"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openEditModal(entry)}
                      className="text-gray-400 hover:text-blue-600 transition-colors"
                      aria-label="Edit"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(entry)}
                      disabled={deleteMutation.isPending}
                      className="text-gray-400 hover:text-red-500 transition-colors disabled:opacity-40"
                      aria-label="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
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
