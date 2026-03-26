"use client";

import { trpc } from "@/lib/trpc/client";
import { useState } from "react";
import { format } from "date-fns";
import { BarChart3, Pencil, Trash2, X, Plus, TrendingUp } from "lucide-react";

const CHANNEL_PRESETS = [
  "The Knot",
  "WeddingWire",
  "Google Ads",
  "Instagram",
  "Facebook",
  "Email",
  "Other",
];

const CAMPAIGN_TYPE_PRESETS = [
  "Listing",
  "Paid Ad",
  "Promotion",
  "Email",
  "Event",
  "Other",
];

interface Campaign {
  id: string;
  name: string;
  campaign_type: string | null;
  channel: string | null;
  start_date: string | null;
  end_date: string | null;
  spend_cents: number | null;
  inquiries_attributed: number | null;
  tours_attributed: number | null;
  bookings_attributed: number | null;
  revenue_attributed_cents: number | null;
  cost_per_inquiry_cents: number | null;
  cost_per_booking_cents: number | null;
  roi_ratio: number | null;
}

interface FormState {
  name: string;
  channel: string;
  campaignType: string;
  startDate: string;
  endDate: string;
  spendDollars: string;
  inquiriesAttributed: string;
  toursAttributed: string;
  bookingsAttributed: string;
  revenueAttributedDollars: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  channel: "",
  campaignType: "",
  startDate: "",
  endDate: "",
  spendDollars: "",
  inquiriesAttributed: "",
  toursAttributed: "",
  bookingsAttributed: "",
  revenueAttributedDollars: "",
};

function formatDollars(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toLocaleString()}`;
}

function formatDateRange(start: string | null, end: string | null): string {
  if (!start && !end) return "—";
  const fmt = (d: string) => format(new Date(d), "MMM d, yyyy");
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  if (start) return `From ${fmt(start)}`;
  return `Until ${fmt(end!)}`;
}

export default function CampaignsPage() {
  const [showModal, setShowModal] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.campaigns.list.useQuery();

  const upsertMutation = trpc.campaigns.upsert.useMutation({
    onSuccess: () => {
      utils.campaigns.list.invalidate();
      closeModal();
    },
  });

  const deleteMutation = trpc.campaigns.delete.useMutation({
    onSuccess: () => {
      utils.campaigns.list.invalidate();
    },
  });

  const campaigns: Campaign[] = data ?? [];

  // Summary computations
  const totalCampaigns = campaigns.length;

  const totalSpendCents = campaigns.reduce(
    (sum, c) => sum + (c.spend_cents ?? 0),
    0
  );

  const totalBookings = campaigns.reduce(
    (sum, c) => sum + (c.bookings_attributed ?? 0),
    0
  );

  const roiValues = campaigns
    .map((c) => c.roi_ratio)
    .filter((r): r is number => r != null);
  const avgRoi =
    roiValues.length > 0
      ? roiValues.reduce((sum, r) => sum + r, 0) / roiValues.length
      : null;

  function openAddModal() {
    setEditingCampaign(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  }

  function openEditModal(campaign: Campaign) {
    setEditingCampaign(campaign);
    setForm({
      name: campaign.name,
      channel: campaign.channel ?? "",
      campaignType: campaign.campaign_type ?? "",
      startDate: campaign.start_date ?? "",
      endDate: campaign.end_date ?? "",
      spendDollars:
        campaign.spend_cents != null
          ? String(campaign.spend_cents / 100)
          : "",
      inquiriesAttributed:
        campaign.inquiries_attributed != null
          ? String(campaign.inquiries_attributed)
          : "",
      toursAttributed:
        campaign.tours_attributed != null
          ? String(campaign.tours_attributed)
          : "",
      bookingsAttributed:
        campaign.bookings_attributed != null
          ? String(campaign.bookings_attributed)
          : "",
      revenueAttributedDollars:
        campaign.revenue_attributed_cents != null
          ? String(campaign.revenue_attributed_cents / 100)
          : "",
    });
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditingCampaign(null);
    setForm(EMPTY_FORM);
  }

  function handleSave() {
    if (!form.name.trim()) return;

    const spendCents =
      form.spendDollars !== ""
        ? Math.round(parseFloat(form.spendDollars) * 100)
        : undefined;

    const revenueAttributedCents =
      form.revenueAttributedDollars !== ""
        ? Math.round(parseFloat(form.revenueAttributedDollars) * 100)
        : undefined;

    upsertMutation.mutate({
      id: editingCampaign?.id,
      name: form.name.trim(),
      channel: form.channel || undefined,
      campaignType: form.campaignType || undefined,
      startDate: form.startDate || undefined,
      endDate: form.endDate || undefined,
      spendCents: spendCents != null && !isNaN(spendCents) ? spendCents : undefined,
      inquiriesAttributed:
        form.inquiriesAttributed !== ""
          ? parseInt(form.inquiriesAttributed, 10)
          : undefined,
      toursAttributed:
        form.toursAttributed !== ""
          ? parseInt(form.toursAttributed, 10)
          : undefined,
      bookingsAttributed:
        form.bookingsAttributed !== ""
          ? parseInt(form.bookingsAttributed, 10)
          : undefined,
      revenueAttributedCents:
        revenueAttributedCents != null && !isNaN(revenueAttributedCents)
          ? revenueAttributedCents
          : undefined,
    });
  }

  function handleDelete(campaign: Campaign) {
    if (
      !window.confirm(
        `Delete campaign "${campaign.name}"? This cannot be undone.`
      )
    )
      return;
    deleteMutation.mutate({ id: campaign.id });
  }

  const isSaving = upsertMutation.isPending;

  return (
    <div className="max-w-6xl">
      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
            {/* Modal header */}
            <div className="flex items-start justify-between p-5 pb-0 flex-shrink-0">
              <h2 className="text-base font-semibold text-gray-900">
                {editingCampaign ? "Edit campaign" : "Add campaign"}
              </h2>
              <button
                onClick={closeModal}
                className="ml-4 flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal body */}
            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              {/* Campaign name */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Campaign name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                  placeholder="e.g. Q1 Knot Promotion"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* Channel */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Channel
                </label>
                <input
                  type="text"
                  value={form.channel}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, channel: e.target.value }))
                  }
                  placeholder="e.g. Google Ads"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {CHANNEL_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() =>
                        setForm((f) => ({ ...f, channel: preset }))
                      }
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

              {/* Campaign type */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Campaign type
                </label>
                <input
                  type="text"
                  value={form.campaignType}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, campaignType: e.target.value }))
                  }
                  placeholder="e.g. Paid Ad"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {CAMPAIGN_TYPE_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() =>
                        setForm((f) => ({ ...f, campaignType: preset }))
                      }
                      className={`px-2.5 py-1 rounded-full border text-xs transition-colors ${
                        form.campaignType === preset
                          ? "bg-blue-600 border-blue-600 text-white"
                          : "bg-white border-gray-200 text-gray-700 hover:border-gray-400"
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Start date
                  </label>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, startDate: e.target.value }))
                    }
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    End date
                  </label>
                  <input
                    type="date"
                    value={form.endDate}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, endDate: e.target.value }))
                    }
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>

              {/* Spend */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Spend ($)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.spendDollars}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, spendDollars: e.target.value }))
                  }
                  placeholder="0.00"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* Attribution */}
              <div>
                <p className="text-xs font-medium text-gray-700 mb-2">
                  Outcomes attributed to this campaign
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">
                      Inquiries
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={form.inquiriesAttributed}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          inquiriesAttributed: e.target.value,
                        }))
                      }
                      placeholder="0"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">
                      Tours
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={form.toursAttributed}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          toursAttributed: e.target.value,
                        }))
                      }
                      placeholder="0"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">
                      Bookings
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={form.bookingsAttributed}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          bookingsAttributed: e.target.value,
                        }))
                      }
                      placeholder="0"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">
                      Revenue ($)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.revenueAttributedDollars}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          revenueAttributedDollars: e.target.value,
                        }))
                      }
                      placeholder="0.00"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Modal actions */}
            <div className="flex items-center justify-end gap-2 px-5 pb-5 flex-shrink-0">
              <button
                onClick={closeModal}
                disabled={isSaving}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving || !form.name.trim()}
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
          <h1 className="text-2xl font-semibold text-gray-900">Campaigns</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Track marketing campaigns and their downstream attribution.
          </p>
        </div>
        <button
          onClick={openAddModal}
          className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus size={15} />
          Add campaign
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">
            Total campaigns
          </p>
          <p className="text-2xl font-semibold text-gray-900">
            {isLoading ? "—" : totalCampaigns}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">all time</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">
            Total spend
          </p>
          <p className="text-2xl font-semibold text-gray-900">
            {isLoading ? "—" : formatDollars(totalSpendCents)}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">across all campaigns</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">
            Total bookings
          </p>
          <p className="text-2xl font-semibold text-gray-900">
            {isLoading ? "—" : totalBookings}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">attributed</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">
            Avg ROI
          </p>
          <p className="text-2xl font-semibold text-gray-900">
            {isLoading
              ? "—"
              : avgRoi != null
              ? `${avgRoi.toFixed(1)}x`
              : "—"}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">across campaigns with data</p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
                  Campaign
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
                  Channel
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
                  Dates
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
                  Spend
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
                  Inquiries
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
                  Tours
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
                  Bookings
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
                  Revenue
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
                  ROI
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading && (
                <tr>
                  <td
                    colSpan={10}
                    className="px-4 py-8 text-center text-gray-400"
                  >
                    Loading...
                  </td>
                </tr>
              )}
              {!isLoading && campaigns.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-16 text-center">
                    <BarChart3
                      size={28}
                      className="mx-auto text-gray-200 mb-3"
                    />
                    <p className="text-sm font-medium text-gray-700 mb-1">
                      No campaigns yet
                    </p>
                    <p className="text-xs text-gray-400 mb-4">
                      Add your first campaign to start tracking spend and
                      attribution.
                    </p>
                    <button
                      onClick={openAddModal}
                      className="inline-flex items-center gap-1.5 bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                    >
                      <Plus size={14} />
                      Add campaign
                    </button>
                  </td>
                </tr>
              )}
              {campaigns.map((campaign) => (
                <tr key={campaign.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">
                      {campaign.name}
                    </div>
                    {campaign.campaign_type && (
                      <div className="text-xs text-gray-400">
                        {campaign.campaign_type}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {campaign.channel ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                    {formatDateRange(campaign.start_date, campaign.end_date)}
                  </td>
                  <td className="px-4 py-3 text-gray-700 tabular-nums whitespace-nowrap">
                    {formatDollars(campaign.spend_cents)}
                  </td>
                  <td className="px-4 py-3 text-gray-600 tabular-nums text-center">
                    {campaign.inquiries_attributed ?? 0}
                  </td>
                  <td className="px-4 py-3 text-gray-600 tabular-nums text-center">
                    {campaign.tours_attributed ?? 0}
                  </td>
                  <td className="px-4 py-3 text-gray-600 tabular-nums text-center">
                    {campaign.bookings_attributed ?? 0}
                  </td>
                  <td className="px-4 py-3 text-gray-700 tabular-nums whitespace-nowrap">
                    {campaign.revenue_attributed_cents
                      ? formatDollars(campaign.revenue_attributed_cents)
                      : "—"}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {campaign.roi_ratio != null ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 font-medium tabular-nums">
                        <TrendingUp size={13} />
                        {campaign.roi_ratio.toFixed(1)}x
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openEditModal(campaign)}
                        className="text-gray-400 hover:text-blue-600 transition-colors"
                        aria-label="Edit"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(campaign)}
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
    </div>
  );
}
