"use client";

import { trpc } from "@/lib/trpc/client";
import { useState, useEffect } from "react";
import { Mail, Check, AlertCircle, Loader2, X, CloudDownload, Upload, Plus, Trash2, ChevronDown, ChevronUp, HelpCircle } from "lucide-react";
import { getPaidChannels, TOUCHPOINTS } from "@/lib/touchpoints";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

// ── Source provenance badge ────────────────────────────────────────────────
const SOURCE_BADGE: Record<string, { label: string; className: string }> = {
  user_estimate: { label: "Estimated",    className: "bg-gray-100 text-gray-600" },
  user_input:    { label: "You told us",  className: "bg-blue-100 text-blue-700" },
  api_sync:      { label: "Auto-synced",  className: "bg-green-100 text-green-700" },
  csv_import:    { label: "Imported",     className: "bg-purple-100 text-purple-700" },
  email_scan:    { label: "From emails",  className: "bg-teal-100 text-teal-700" },
  calculated:    { label: "Calculated",   className: "bg-green-100 text-green-700" },
};

function SourceBadge({ source }: { source: string | null | undefined }) {
  if (!source) return null;
  const badge = SOURCE_BADGE[source];
  if (!badge) return null;
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${badge.className}`}>
      {badge.label}
    </span>
  );
}

function ProfileRow({
  label,
  value,
  source,
}: {
  label: string;
  value: string | null | undefined;
  source: string | null | undefined;
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-500 flex-shrink-0 w-52">{label}</span>
      <span className={`text-sm font-medium flex-1 px-2 ${value ? "text-gray-900" : "text-gray-300"}`}>
        {value ?? "Not set"}
      </span>
      <SourceBadge source={source} />
    </div>
  );
}

function TagPills({ values }: { values: string[] | null | undefined }) {
  if (!values || values.length === 0) {
    return <span className="text-sm text-gray-300">Not set</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {values.map((v) => (
        <span key={v} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full border border-blue-200">
          {v}
        </span>
      ))}
    </div>
  );
}

export default function SettingsPage() {
  const { data: venue, refetch, isLoading: venueLoading, isError: venueError } = trpc.venues.getCurrent.useQuery();
  const { data: computedProfile } = trpc.venues.getComputedProfile.useQuery();
  const { data: emailConn, refetch: refetchEmail } = trpc.email.getConnection.useQuery();
  const update = trpc.venues.update.useMutation({ onSuccess: () => refetch() });
  const deleteSeedData = trpc.venues.deleteSeedData.useMutation();
  const disconnect = trpc.email.disconnect.useMutation({ onSuccess: () => refetchEmail() });
  const scan = trpc.email.scan.useMutation();
  const syncTours = trpc.calendly.syncTours.useMutation();
  const backfill = trpc.clients.backfillSourceAttribution.useMutation();

  const searchParams = useSearchParams();
  const [saved, setSaved] = useState(false);
  const [scanResult, setScanResult] = useState<any>(null);
  const [backfillResult, setBackfillResult] = useState<{ updated: number; total: number } | null>(null);
  const [syncToursResult, setSyncToursResult] = useState<{ synced: number; alreadyExisted: number; errors: string[] } | null>(null);
  const [emailDaysBack, setEmailDaysBack] = useState(730);
  const [weatherIngesting, setWeatherIngesting] = useState(false);
  const [weatherResult, setWeatherResult] = useState<{ monthsIngested: number; errors: number } | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  const [calibrated, setCalibrated] = useState(false);
  const [fredIngesting, setFredIngesting] = useState(false);
  const [fredResult, setFredResult] = useState<{ ingested: number } | null>(null);
  const [pulsing, setPulsing] = useState(false);
  const [pulseResult, setPulseResult] = useState<boolean | null>(null);
  const [backfillingWeather, setBackfillingWeather] = useState(false);
  const [backfillWeatherResult, setBackfillWeatherResult] = useState<{ backfilled: number; skipped: number } | null>(null);
  const [trafficUploading, setTrafficUploading] = useState(false);
  const [trafficResult, setTrafficResult] = useState<{ upserted: number; skipped: number } | null>(null);
  const [trafficError, setTrafficError] = useState<string | null>(null);

  const [showAllSpend, setShowAllSpend] = useState(false);

  // ── Channel spend ──────────────────────────────────────────────────────────
  const [showSpendForm, setShowSpendForm] = useState(false);
  const [spendForm, setSpendForm] = useState({
    channel: "",
    month: "",
    amount: "",
    billingType: "monthly_subscription" as "monthly_subscription" | "annual_subscription" | "pay_per_click" | "flat_fee",
    notes: "",
  });
  const { data: channelSpend, refetch: refetchChannelSpend } = trpc.touchpoints.getChannelSpend.useQuery({});
  const upsertChannelSpend = trpc.touchpoints.upsertChannelSpend.useMutation({
    onSuccess: () => {
      refetchChannelSpend();
      setShowSpendForm(false);
      setSpendForm({ channel: "", month: "", amount: "", billingType: "monthly_subscription", notes: "" });
    },
  });
  const deleteChannelSpend = trpc.touchpoints.deleteChannelSpend.useMutation({
    onSuccess: () => refetchChannelSpend(),
  });

  const { data: setupStatus, refetch: refetchSetupStatus } = trpc.venues.getSetupStatus.useQuery();
  const { data: checklistStatus } = trpc.venues.getChecklistStatus.useQuery();

  const [form, setForm] = useState({
    googlePlaceId: "",
    knotVenueId: "",
    calendlyApiKey: "",
    competitorRadiusMiles: 30,
    maxEventsPerMonth: 4,
    contributesToBenchmark: true,
    googleTrendsMetro: "",
    noaaStationId: "",
    fedDistrict: "",
    trendsCustomTerms: ["", "", "", ""] as string[],
  });

  // Pre-fill all form fields from saved venue data
  useEffect(() => {
    if (!venue) return;
    const v = venue as any;
    const savedTerms: string[] = v.trends_custom_terms ?? [];
    const padded = [...savedTerms, "", "", "", ""].slice(0, 4);
    setForm({
      googlePlaceId: v.google_place_id ?? "",
      knotVenueId: v.knot_venue_id ?? "",
      calendlyApiKey: v.calendly_api_key ?? "",
      competitorRadiusMiles: v.competitor_radius_miles ?? 30,
      maxEventsPerMonth: v.max_events_per_month ?? 4,
      contributesToBenchmark: v.contributes_to_benchmark ?? true,
      googleTrendsMetro: v.google_trends_metro ?? "",
      noaaStationId: v.noaa_station_id ?? "",
      fedDistrict: v.fed_district ? String(v.fed_district) : "",
      trendsCustomTerms: padded,
    });
  }, [venue]);

  // Flash success/error from OAuth callback
  useEffect(() => {
    if (searchParams.get("email_connected") === "1") {
      refetchEmail();
    }
  }, [searchParams]);

  function handleSave() {
    update.mutate({
      googlePlaceId: form.googlePlaceId || undefined,
      knotVenueId: form.knotVenueId || undefined,
      calendlyApiKey: form.calendlyApiKey || undefined,
      contributesToBenchmark: form.contributesToBenchmark,
      googleTrendsMetro: form.googleTrendsMetro || undefined,
      noaaStationId: form.noaaStationId || undefined,
      fedDistrict: form.fedDistrict ? parseInt(form.fedDistrict) : undefined,
      trendsCustomTerms: form.trendsCustomTerms,
      competitorRadiusMiles: form.competitorRadiusMiles,
      maxEventsPerMonth: form.maxEventsPerMonth,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  async function handleFredBackfill() {
    setFredIngesting(true);
    setFredResult(null);
    try {
      const res = await fetch("/api/macro/fred", { method: "POST" });
      const json = await res.json();
      if (json.ingested !== undefined) { setFredResult({ ingested: json.ingested }); refetchSetupStatus(); }
    } finally {
      setFredIngesting(false);
    }
  }

  async function handleBackfillClientWeather() {
    setBackfillingWeather(true);
    setBackfillWeatherResult(null);
    try {
      const res = await fetch("/api/admin/backfill-client-weather", { method: "POST" });
      const json = await res.json();
      if (json.ok) { setBackfillWeatherResult({ backfilled: json.backfilled, skipped: json.skipped }); refetchSetupStatus(); }
    } finally {
      setBackfillingWeather(false);
    }
  }

  async function handleRefreshPulse() {
    setPulsing(true);
    setPulseResult(null);
    try {
      const res = await fetch("/api/admin/refresh-pulse", { method: "POST" });
      setPulseResult(res.ok);
    } finally {
      setPulsing(false);
    }
  }

  async function handleRecalibrate() {
    if (!venue) return;
    setCalibrating(true);
    setCalibrated(false);
    try {
      await fetch("/api/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ venueId: venue.id }),
      });
      setCalibrated(true);
      setTimeout(() => { setCalibrated(false); refetch(); }, 3000);
    } finally {
      setCalibrating(false);
    }
  }

  async function handleIngestWeather() {
    setWeatherIngesting(true);
    setWeatherResult(null);
    try {
      const res = await fetch("/api/admin/ingest-weather", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const json = await res.json();
      if (json.ok) { setWeatherResult({ monthsIngested: json.monthsIngested, errors: json.errors }); refetchSetupStatus(); }
    } finally {
      setWeatherIngesting(false);
    }
  }

  async function handleScan() {
    const result = await scan.mutateAsync({ maxEmails: 500, daysBack: emailDaysBack });
    setScanResult(result);
    refetchEmail();
    // After scanning, back-fill attribution for any clients whose email was found
    const bf = await backfill.mutateAsync();
    setBackfillResult(bf);
  }

  async function handleBackfill() {
    const bf = await backfill.mutateAsync();
    setBackfillResult(bf);
  }

  async function handleSyncTours() {
    const result = await syncTours.mutateAsync();
    setSyncToursResult(result);
  }

  async function handleTrafficUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setTrafficUploading(true);
    setTrafficResult(null);
    setTrafficError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/import-traffic", { method: "POST", body: fd });
      const json = await res.json();
      if (json.ok) {
        setTrafficResult({ upserted: json.upserted, skipped: json.skipped });
      } else {
        setTrafficError(json.error ?? "Upload failed");
      }
    } finally {
      setTrafficUploading(false);
      // Reset file input so same file can be re-uploaded
      e.target.value = "";
    }
  }

  if (venueLoading) return <div className="text-sm text-gray-400 p-8">Loading settings…</div>;
  if (venueError || !venue) return <div className="text-sm text-red-500 p-8">Failed to load venue. Try signing out and back in.</div>;

  const connectGmailUrl = `/api/auth/google?venue_id=${venue.id}`;
  const emailError = searchParams.get("email_error") === "1";

  // ── Channel spend helpers ──────────────────────────────────────────────────
  const paidChannels = getPaidChannels();

  function fmtDollars(cents: number): string {
    return "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function fmtMonth(yyyyMm: string): string {
    const [y, m] = yyyyMm.split("-");
    const d = new Date(parseInt(y), parseInt(m) - 1, 1);
    return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }

  function channelLabel(channelId: string): string {
    return TOUCHPOINTS.find((t) => t.value === channelId)?.label ?? channelId;
  }

  const now = new Date();
  const twelveMonthsAgo = `${now.getFullYear() - 1}-${String(now.getMonth() + 2).padStart(2, "0")}`;
  const last12Total = (channelSpend ?? [])
    .filter((s: any) => (s.month ?? "").substring(0, 7) >= twelveMonthsAgo)
    .reduce((sum: number, s: any) => sum + (s.amount_cents ?? 0), 0);

  const BILLING_LABELS: Record<string, string> = {
    monthly_subscription:  "Monthly subscription",
    annual_subscription:   "Annual subscription",
    pay_per_click:         "Pay per click",
    flat_fee:              "Flat fee",
  };

  async function handleSaveSpend() {
    if (!spendForm.channel || !spendForm.month || !spendForm.amount) return;
    const amountCents = Math.round(parseFloat(spendForm.amount) * 100);
    if (isNaN(amountCents) || amountCents < 0) return;
    // channel_spend table expects YYYY-MM-01 format
    const monthDate = spendForm.month + "-01";
    await upsertChannelSpend.mutateAsync({
      channel:      spendForm.channel,
      month:        monthDate,
      amountCents,
      billingType:  spendForm.billingType,
      notes:        spendForm.notes || undefined,
    });
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>

      {/* Venue info */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Venue</h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Name</span>
            <span className="text-gray-900">{venue.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Location</span>
            <span className="text-gray-900">{venue.city}, {venue.state}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">NOAA station</span>
            <span className="text-gray-700">{(venue as any).noaa_station_id ?? "Not calibrated"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Fed district</span>
            <span className="text-gray-700">{(venue as any).fed_district ?? "Not calibrated"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Google Trends metro</span>
            <span className="text-gray-700">{(venue as any).google_trends_metro ?? "Not calibrated"}</span>
          </div>
        </div>
        {(!(venue as any).noaa_station_id || !(venue as any).fed_district || !(venue as any).google_trends_metro) && (
          <div className="mt-4 flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
            <p className="text-sm text-amber-800">
              Venue not calibrated — weather, macro, and trend signals won't appear on the dashboard.
            </p>
            <button
              onClick={handleRecalibrate}
              disabled={calibrating}
              className="flex-shrink-0 flex items-center gap-1.5 bg-amber-600 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-amber-700 disabled:opacity-50 transition-colors"
            >
              {calibrating ? <><Loader2 size={13} className="animate-spin" /> Running…</> : calibrated ? <><Check size={13} /> Done!</> : "Auto-calibrate"}
            </button>
          </div>
        )}
      </div>

      {/* ── INTELLIGENCE PROFILE ── */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="mb-4">
          <h2 className="text-base font-semibold text-gray-900">Intelligence profile</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Calculated automatically from your client records and spend data. Updates as you add more data.
          </p>
        </div>

        {computedProfile ? (
          <>
            <div className="mb-4">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Economics</p>
              <div className="space-y-0">
                <ProfileRow
                  label="Average package value"
                  value={computedProfile.avgPackageCents
                    ? `$${Math.round(computedProfile.avgPackageCents / 100).toLocaleString()} avg (${computedProfile.bookedClientCount} bookings)`
                    : null}
                  source={computedProfile.bookedClientCount > 0 ? "calculated" : null}
                />
                <ProfileRow
                  label="Last month ad spend"
                  value={computedProfile.lastMonthSpendCents > 0
                    ? `$${Math.round(computedProfile.lastMonthSpendCents / 100).toLocaleString()} in ${computedProfile.lastMonthLabel}`
                    : null}
                  source={computedProfile.lastMonthSpendCents > 0 ? "calculated" : null}
                />
                <ProfileRow
                  label="Tours per booking"
                  value={computedProfile.toursPerBooking !== null
                    ? `${computedProfile.toursPerBooking} tours (${computedProfile.touredCount} toured → ${computedProfile.contractedCount} booked)`
                    : null}
                  source={computedProfile.contractedCount > 0 ? "calculated" : null}
                />
              </div>
            </div>

            <div className="mb-2">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Funnel</p>
              <div className="space-y-3 py-2">
                <div className="flex items-start justify-between gap-4">
                  <span className="text-sm text-gray-500 flex-shrink-0 w-52 pt-0.5">Top inquiry channels</span>
                  <div className="flex-1">
                    <TagPills values={computedProfile.topInquiryChannels.length > 0 ? computedProfile.topInquiryChannels : null} />
                  </div>
                  {computedProfile.topInquiryChannels.length > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 bg-green-100 text-green-700">Calculated</span>
                  )}
                </div>
                <div className="flex items-start justify-between gap-4">
                  <span className="text-sm text-gray-500 flex-shrink-0 w-52 pt-0.5">Top lead sources</span>
                  <div className="flex-1">
                    <TagPills values={computedProfile.topLeadSources.length > 0 ? computedProfile.topLeadSources : null} />
                  </div>
                  {computedProfile.topLeadSources.length > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 bg-green-100 text-green-700">Calculated</span>
                  )}
                </div>
              </div>
            </div>

            {!computedProfile.hasData && (
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                No client data yet — import clients to start seeing calculated values here.
              </p>
            )}
          </>
        ) : (
          <div className="space-y-2">
            {["Average package value", "Last month ad spend", "Tours per booking"].map((l) => (
              <div key={l} className="flex items-center justify-between py-2 border-b border-gray-100">
                <span className="text-sm text-gray-400">{l}</span>
                <div className="h-3 w-24 bg-gray-100 rounded animate-pulse" />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── ADVERTISING SPEND ── */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Advertising spend</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Track what you pay each platform monthly. This unlocks real cost-per-booking calculations in Analytics.
            </p>
          </div>
          <button
            onClick={() => setShowSpendForm((v) => !v)}
            className="flex-shrink-0 flex items-center gap-1.5 border border-gray-300 bg-white text-gray-700 px-3 py-1.5 rounded text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            <Plus size={14} />
            Add spend
          </button>
        </div>

        {showSpendForm && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3">
            <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">New entry</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Channel</label>
                <select
                  value={spendForm.channel}
                  onChange={(e) => setSpendForm((f) => ({ ...f, channel: e.target.value }))}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white"
                >
                  <option value="">Select channel…</option>
                  {["Directories", "Search & Maps", "Social — Paid"].map((cat) => (
                    <optgroup key={cat} label={cat}>
                      {paidChannels
                        .filter((c) => c.category === cat)
                        .map((c) => (
                          <option key={c.id} value={c.id}>{c.label}</option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Month</label>
                <input
                  type="month"
                  value={spendForm.month}
                  onChange={(e) => setSpendForm((f) => ({ ...f, month: e.target.value }))}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Amount ($)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="e.g. 299"
                  value={spendForm.amount}
                  onChange={(e) => setSpendForm((f) => ({ ...f, amount: e.target.value }))}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Billing type</label>
                <select
                  value={spendForm.billingType}
                  onChange={(e) => setSpendForm((f) => ({ ...f, billingType: e.target.value as typeof spendForm.billingType }))}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white"
                >
                  <option value="monthly_subscription">Monthly subscription</option>
                  <option value="annual_subscription">Annual subscription (split monthly)</option>
                  <option value="pay_per_click">Pay per click</option>
                  <option value="flat_fee">Flat fee</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-700 mb-1">Notes <span className="font-normal text-gray-400">(optional)</span></label>
                <input
                  type="text"
                  placeholder="e.g. Enhanced listing tier"
                  value={spendForm.notes}
                  onChange={(e) => setSpendForm((f) => ({ ...f, notes: e.target.value }))}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white"
                />
              </div>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={handleSaveSpend}
                disabled={upsertChannelSpend.isPending || !spendForm.channel || !spendForm.month || !spendForm.amount}
                className="flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {upsertChannelSpend.isPending ? <><Loader2 size={13} className="animate-spin" /> Saving…</> : "Save"}
              </button>
              <button onClick={() => setShowSpendForm(false)} className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}

        {channelSpend && channelSpend.length > 0 ? (() => {
          // Show last month's rows by default; expand to show all
          const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
          const prevMonth = `${now.getFullYear()}-${String(now.getMonth()).padStart(2, "0")}`;
          // Find the most recent month that has data
          const sortedMonths = [...new Set((channelSpend as any[]).map((r: any) => (r.month ?? "").substring(0, 7)))].sort().reverse();
          const latestMonth = sortedMonths[0] ?? "";
          const displayedRows = showAllSpend
            ? (channelSpend as any[])
            : (channelSpend as any[]).filter((r: any) => (r.month ?? "").substring(0, 7) === latestMonth);

          const latestTotal = (channelSpend as any[])
            .filter((r: any) => (r.month ?? "").substring(0, 7) === latestMonth)
            .reduce((s: number, r: any) => s + (r.amount_cents ?? 0), 0);

          return (
            <>
              {/* Last month summary line */}
              {!showAllSpend && (
                <div className="flex items-center justify-between text-sm bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
                  <div>
                    <span className="font-medium text-gray-900">{fmtDollars(latestTotal)}</span>
                    <span className="text-gray-500 ml-1.5">in {latestMonth ? fmtMonth(latestMonth) : "—"}</span>
                  </div>
                  <button
                    onClick={() => setShowAllSpend(true)}
                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                  >
                    <ChevronDown size={13} />
                    View all history
                  </button>
                </div>
              )}

              {showAllSpend && (
                <>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs text-gray-500">
                      Total last 12 months: <span className="font-semibold text-gray-900">{fmtDollars(last12Total)}</span>
                    </p>
                    <button
                      onClick={() => setShowAllSpend(false)}
                      className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
                    >
                      <ChevronUp size={13} />
                      Collapse
                    </button>
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="text-xs w-full">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium text-gray-500">Channel</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-500">Month</th>
                          <th className="text-right px-3 py-2 font-medium text-gray-500">Amount</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-500">Type</th>
                          <th className="px-3 py-2" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {(channelSpend as any[]).map((row: any) => (
                          <tr key={row.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2 text-gray-900 font-medium">{channelLabel(row.channel)}</td>
                            <td className="px-3 py-2 text-gray-600">{fmtMonth((row.month ?? "").substring(0, 7))}</td>
                            <td className="px-3 py-2 text-gray-900 text-right font-medium">{fmtDollars(row.amount_cents)}</td>
                            <td className="px-3 py-2 text-gray-400">{row.billing_type ? BILLING_LABELS[row.billing_type] : "—"}</td>
                            <td className="px-3 py-2 text-right">
                              <button
                                onClick={() => deleteChannelSpend.mutate({ id: row.id })}
                                className="text-gray-300 hover:text-red-500 transition-colors"
                                title="Delete"
                              >
                                <Trash2 size={13} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          );
        })() : (
          !showSpendForm && (
            <p className="text-sm text-gray-400">No spend tracked yet. Click "Add spend" to get started.</p>
          )
        )}
      </div>

      {/* Gmail connection */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-1">
          <Mail size={16} className="text-gray-500" />
          <h2 className="text-base font-semibold text-gray-900">Gmail</h2>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Connect your venue inbox to automatically extract source attribution and match email
          senders to your leads, inquiries, and clients.
        </p>

        {emailError && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mb-4">
            <AlertCircle size={14} />
            Connection failed. Please try again.
          </div>
        )}

        {emailConn ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                <span className="text-sm text-gray-700">{emailConn.email_address}</span>
              </div>
              <button
                onClick={() => disconnect.mutate()}
                className="text-xs text-gray-400 hover:text-red-500 transition-colors"
              >
                Disconnect
              </button>
            </div>

            {emailConn.last_synced_at && (
              <p className="text-xs text-gray-400">
                Last scanned {new Date(emailConn.last_synced_at).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              </p>
            )}

            <div className="flex items-center gap-2">
              <select
                value={emailDaysBack}
                onChange={(e) => setEmailDaysBack(Number(e.target.value))}
                disabled={scan.isPending}
                className="border border-gray-300 rounded px-2 py-2 text-sm text-gray-700 bg-white"
              >
                <option value={90}>Last 3 months</option>
                <option value={365}>Last 1 year</option>
                <option value={730}>Last 2 years</option>
                <option value={1095}>Last 3 years</option>
                <option value={1825}>Last 5 years</option>
              </select>
              <button
                onClick={handleScan}
                disabled={scan.isPending || backfill.isPending}
                className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {scan.isPending ? (
                  <><Loader2 size={14} className="animate-spin" /> Scanning inbox…</>
                ) : backfill.isPending ? (
                  <><Loader2 size={14} className="animate-spin" /> Attributing…</>
                ) : (
                  <><Mail size={14} /> Scan inbox</>
                )}
              </button>
              <button
                onClick={handleBackfill}
                disabled={backfill.isPending || scan.isPending}
                className="flex items-center gap-2 border border-gray-300 bg-white text-gray-700 px-3 py-2 rounded text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
                title="Match already-scanned emails to imported clients and fill in their source"
              >
                {backfill.isPending ? (
                  <><Loader2 size={14} className="animate-spin" /> Attributing…</>
                ) : (
                  "Attribute from emails"
                )}
              </button>
            </div>

            {/* Scan results */}
            {scanResult && (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  {[
                    ["Emails scanned", scanResult.scanned],
                    ["Wedding emails", scanResult.newWeddingEmails],
                    ["Source attribution found", scanResult.sourceAttribFound],
                    ["Auto-linked", scanResult.autoLinked],
                    ["Pending review", scanResult.pendingReview],
                  ].map(([label, val]) => (
                    <div key={label} className="bg-gray-50 rounded p-3">
                      <p className="text-lg font-semibold text-gray-900">{val}</p>
                      <p className="text-xs text-gray-500">{label}</p>
                    </div>
                  ))}
                </div>

                {scanResult.extractions?.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Extracted</p>
                    {scanResult.extractions.map((e: any) => (
                      <div
                        key={e.id}
                        className={`rounded border p-3 text-sm ${
                          e.matchStatus === "auto_linked"
                            ? "border-green-200 bg-green-50"
                            : e.matchStatus === "pending_review"
                            ? "border-amber-200 bg-amber-50"
                            : "border-gray-200 bg-white"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium text-gray-900 truncate">
                              {e.extractedName ?? e.fromName ?? e.fromEmail}
                            </p>
                            <p className="text-xs text-gray-500 truncate">{e.subject}</p>
                          </div>
                          <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${
                            e.matchStatus === "auto_linked"
                              ? "bg-green-100 text-green-700"
                              : e.matchStatus === "pending_review"
                              ? "bg-amber-100 text-amber-700"
                              : "bg-gray-100 text-gray-500"
                          }`}>
                            {e.matchStatus === "auto_linked" ? "linked" : e.matchStatus === "pending_review" ? "review" : "new"}
                          </span>
                        </div>
                        {e.extractedSource && (
                          <p className="text-xs text-blue-700 mt-1.5">
                            Source: <span className="font-medium">{e.extractedSource}</span>
                            {e.sourceQuote && (
                              <span className="text-gray-500"> — "{e.sourceQuote.slice(0, 80)}"</span>
                            )}
                          </p>
                        )}
                        {e.matchSignals?.length > 0 && (
                          <p className="text-xs text-gray-400 mt-1">
                            {e.matchSignals.join(" · ")}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {scanResult.newWeddingEmails === 0 && (
                  <p className="text-sm text-gray-500">
                    No new wedding inquiry emails found in the last year.
                  </p>
                )}

                {backfillResult && (
                  <p className="text-sm text-gray-600">
                    Source attribution back-filled on{" "}
                    <span className="font-medium text-green-700">{backfillResult.updated}</span> of{" "}
                    {backfillResult.total} previously unattributed clients.
                  </p>
                )}
              </div>
            )}
          </div>
        ) : (
          <a
            href={connectGmailUrl}
            className="inline-flex items-center gap-2 border border-gray-300 bg-white text-gray-700 px-4 py-2 rounded text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            <Mail size={14} />
            Connect Gmail
          </a>
        )}
      </div>

      {/* Other integrations */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <h2 className="text-base font-semibold text-gray-900">Integrations</h2>

        {/* HoneyBook — CSV import, no API */}
        <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-gray-700">HoneyBook</p>
            <p className="text-xs text-gray-400 mt-0.5">
              HoneyBook doesn't offer a public API. Export your projects as CSV from
              HoneyBook → Reports → Projects report → Export, then import here.
            </p>
          </div>
          <Link
            href="/import"
            className="flex-shrink-0 text-sm text-blue-600 hover:text-blue-800 font-medium whitespace-nowrap"
          >
            Import CSV →
          </Link>
        </div>

        {/* Calendly connection */}
        <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-700">Calendly</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Tour bookings sync automatically when you run a sync from here.
              </p>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <button
                onClick={handleSyncTours}
                disabled={syncTours.isPending}
                className="flex items-center gap-1.5 text-sm bg-blue-600 text-white px-3 py-1.5 rounded font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {syncTours.isPending ? (
                  <><Loader2 size={13} className="animate-spin" /> Syncing…</>
                ) : (
                  "Sync appointments"
                )}
              </button>
            </div>
          </div>
          {syncToursResult && (
            <p className="text-xs text-gray-500">
              Synced: <span className="font-medium text-green-700">{syncToursResult.synced} new</span>, {syncToursResult.alreadyExisted} already imported{syncToursResult.errors.length > 0 ? `, ${syncToursResult.errors.length} errors` : ""}
            </p>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Calendly API key</label>
            <input
              type="password"
              placeholder={(venue as any).calendly_api_key ? "••••••••••••" : "ey..."}
              value={form.calendlyApiKey}
              onChange={(e) => setForm(f => ({ ...f, calendlyApiKey: e.target.value }))}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white"
            />
            <details className="mt-1.5">
              <summary className="text-xs text-blue-600 cursor-pointer hover:text-blue-800 list-none flex items-center gap-1">
                <HelpCircle size={11} />
                How to find your Calendly API key
              </summary>
              <ol className="text-xs text-gray-500 mt-1.5 space-y-0.5 list-decimal list-inside ml-1">
                <li>Go to <span className="font-medium">calendly.com</span> → click your avatar → Integrations</li>
                <li>Scroll to "API & Webhooks" → click <span className="font-medium">Get a token</span></li>
                <li>Copy the Personal Access Token (starts with "ey...")</li>
                <li>Paste it here and click Save settings</li>
              </ol>
            </details>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Google Place ID</label>
          <input
            type="text"
            placeholder={(venue as any).google_place_id ?? "e.g. ChIJN1t_tDeuEmsRUsoyG83frY4"}
            value={form.googlePlaceId}
            onChange={(e) => setForm(f => ({ ...f, googlePlaceId: e.target.value }))}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
          />
          <details className="mt-1.5">
            <summary className="text-xs text-blue-600 cursor-pointer hover:text-blue-800 list-none flex items-center gap-1">
              <HelpCircle size={11} />
              How to find your Google Place ID
            </summary>
            <ol className="text-xs text-gray-500 mt-1.5 space-y-0.5 list-decimal list-inside ml-1">
              <li>Go to <span className="font-medium">developers.google.com/maps/documentation/places/web-service/place-id</span></li>
              <li>Type your venue name in the "Find a Place ID" search box</li>
              <li>Select your venue from the results</li>
              <li>Copy the Place ID (starts with "ChIJ...")</li>
            </ol>
            <p className="text-xs text-gray-400 mt-1">Used for Google review monitoring and local competitor scanning.</p>
          </details>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">The Knot venue ID</label>
          <input
            type="text"
            placeholder={(venue as any).knot_venue_id ?? "e.g. rixey-manor-virginia"}
            value={form.knotVenueId}
            onChange={(e) => setForm(f => ({ ...f, knotVenueId: e.target.value }))}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
          />
          <details className="mt-1.5">
            <summary className="text-xs text-blue-600 cursor-pointer hover:text-blue-800 list-none flex items-center gap-1">
              <HelpCircle size={11} />
              How to find your The Knot venue ID
            </summary>
            <ol className="text-xs text-gray-500 mt-1.5 space-y-0.5 list-decimal list-inside ml-1">
              <li>Go to your venue's listing on <span className="font-medium">theknot.com</span></li>
              <li>Look at the URL — e.g. <span className="font-medium">theknot.com/marketplace/rixey-manor-sperryvile-va-2140285</span></li>
              <li>Copy the slug after "/marketplace/" (everything after the last slash)</li>
            </ol>
          </details>
        </div>

      </div>

      {/* ── WEBSITE TRAFFIC ── */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Website traffic</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Upload a Google Analytics CSV to track sessions and traffic sources over time.
            Data appears in Analytics → Website traffic.
          </p>
        </div>

        <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 space-y-3">
          <div>
            <p className="text-sm font-medium text-gray-700 mb-1">How to export from GA4</p>
            <ol className="text-xs text-gray-500 space-y-0.5 list-decimal list-inside">
              <li>Open GA4 → Reports → Acquisition → Traffic acquisition</li>
              <li>Set your date range (e.g. last 12 months)</li>
              <li>Click the download icon → Download CSV</li>
              <li>Upload the file here</li>
            </ol>
            <p className="text-xs text-gray-400 mt-2">
              Both date-aggregated and source/medium CSVs work.
              Re-uploading the same period is safe — rows are upserted.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <label className={`flex items-center gap-2 border border-gray-300 bg-white text-gray-700 px-3 py-1.5 rounded text-sm font-medium hover:bg-gray-50 transition-colors cursor-pointer ${trafficUploading ? "opacity-50 pointer-events-none" : ""}`}>
              {trafficUploading ? (
                <><Loader2 size={14} className="animate-spin" /> Uploading…</>
              ) : (
                <><Upload size={14} /> Choose CSV</>
              )}
              <input
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleTrafficUpload}
                disabled={trafficUploading}
              />
            </label>

            {trafficResult && (
              <span className="text-xs text-green-600 flex items-center gap-1">
                <Check size={12} />
                {trafficResult.upserted} rows imported
                {trafficResult.skipped > 0 && `, ${trafficResult.skipped} skipped`}
              </span>
            )}
            {trafficError && (
              <span className="text-xs text-red-600 flex items-center gap-1">
                <AlertCircle size={12} />
                {trafficError}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Intelligence calibration */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Intelligence calibration</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            These tell Bloom which data sources map to your venue's location.
            Without them, weather, search trend, and macro signals won't appear.
          </p>
        </div>

        {/* Setup status summary */}
        {setupStatus && (
          <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Data status</p>
            {[
              {
                label: "NOAA weather station",
                ok: setupStatus.hasNoaaStation,
                detail: setupStatus.noaaStationId ?? "not set",
              },
              {
                label: "Historical weather data",
                ok: setupStatus.weatherMonthCount > 0,
                detail: setupStatus.weatherMonthCount > 0 ? `${setupStatus.weatherMonthCount} months` : "not populated",
              },
              {
                label: "Client weather scores",
                ok: setupStatus.clientsWithEventDate === 0 || setupStatus.clientsWithWeatherScore === setupStatus.clientsWithEventDate,
                detail: setupStatus.clientsWithEventDate === 0
                  ? "no clients with event dates"
                  : `${setupStatus.clientsWithWeatherScore} of ${setupStatus.clientsWithEventDate} clients`,
              },
              {
                label: "Federal Reserve district",
                ok: setupStatus.hasFedDistrict,
                detail: setupStatus.hasFedDistrict ? `District ${(venue as any).fed_district}` : "not set",
              },
              {
                label: "FRED economic data",
                ok: setupStatus.fredDataPoints > 0,
                detail: setupStatus.fredDataPoints > 0 ? `${setupStatus.fredDataPoints} data points` : "not populated",
              },
              {
                label: "Google Trends metro",
                ok: setupStatus.hasTrends,
                detail: setupStatus.googleTrendsMetro ?? "not set",
              },
            ].map(({ label, ok, detail }) => (
              <div key={label} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${ok ? "bg-green-500" : "bg-amber-400"}`} />
                  <span className={ok ? "text-gray-700" : "text-gray-500"}>{label}</span>
                </div>
                <span className={`font-medium ${ok ? "text-green-700" : "text-amber-600"}`}>{detail}</span>
              </div>
            ))}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Google Trends metro
          </label>
          <input
            type="text"
            placeholder={(venue as any).google_trends_metro ?? "e.g. Washington DC"}
            value={form.googleTrendsMetro}
            onChange={(e) => setForm(f => ({ ...f, googleTrendsMetro: e.target.value }))}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
          />
          <p className="text-xs text-gray-400 mt-1">
            SerpAPI geo code for local search trend data. Use a country + state code:
            {" "}<span className="font-medium">US-DC</span> (DC/NoVA market),
            {" "}<span className="font-medium">US-VA</span> (all Virginia),
            {" "}<span className="font-medium">US-NY</span>,
            {" "}<span className="font-medium">US-GA</span>,
            {" "}<span className="font-medium">US-TX</span>.
            Venues in the same market share one data pull.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Custom search terms <span className="font-normal text-gray-400">(up to 4)</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            {form.trendsCustomTerms.map((term, i) => (
              <input
                key={i}
                type="text"
                placeholder={`Term ${i + 1} — e.g. "elopement"`}
                value={term}
                maxLength={80}
                onChange={(e) => {
                  const next = [...form.trendsCustomTerms];
                  next[i] = e.target.value;
                  setForm(f => ({ ...f, trendsCustomTerms: next }));
                }}
                className="border border-gray-300 rounded px-3 py-2 text-sm"
              />
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-1">
            These appear as extra lines on the Market Pulse trends chart. Use exact phrases as you'd search Google Trends — e.g. "vineyard wedding", "micro wedding", "elopement Virginia".
            Save settings then re-run the trends ingestion script to populate them.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            NOAA station ID
          </label>
          <input
            type="text"
            placeholder={(venue as any).noaa_station_id ?? "e.g. USW00013741"}
            value={form.noaaStationId}
            onChange={(e) => setForm(f => ({ ...f, noaaStationId: e.target.value }))}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
          />
          <p className="text-xs text-gray-400 mt-1">
            Nearest weather station GHCND ID (without the GHCND: prefix). For VA/DC area: <span className="font-medium">USW00013741</span> (Richmond)
            or <span className="font-medium">USW00093738</span> (Dulles).
            Find yours at <span className="font-medium">ncdc.noaa.gov/cdo-web/datatools/findstation</span>
          </p>
          <p className="text-xs text-blue-600 mt-1">After saving, scroll down and click "Populate" to load weather data.</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Federal Reserve district
          </label>
          <select
            value={form.fedDistrict}
            onChange={(e) => setForm(f => ({ ...f, fedDistrict: e.target.value }))}
            className="border border-gray-300 rounded px-3 py-2 text-sm"
          >
            <option value="">{(venue as any).fed_district ? `Currently: District ${(venue as any).fed_district}` : "Select district"}</option>
            <option value="1">1 — Boston</option>
            <option value="2">2 — New York</option>
            <option value="3">3 — Philadelphia</option>
            <option value="4">4 — Cleveland</option>
            <option value="5">5 — Richmond (VA, MD, NC, SC, WV, DC)</option>
            <option value="6">6 — Atlanta</option>
            <option value="7">7 — Chicago</option>
            <option value="8">8 — St. Louis</option>
            <option value="9">9 — Minneapolis</option>
            <option value="10">10 — Kansas City</option>
            <option value="11">11 — Dallas</option>
            <option value="12">12 — San Francisco</option>
          </select>
          <p className="text-xs text-gray-400 mt-1">Virginia venues use District 5 (Richmond Fed).</p>
        </div>

        {/* Populate weather data */}
        <div className="pt-4 border-t border-gray-100">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-700">Historical weather data</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Pulls 3 years of monthly weather from NOAA for your station. Required for weather charts and season scoring.
                Requires <span className="font-medium">NOAA_CDO_TOKEN</span> env var.
              </p>
              {setupStatus && setupStatus.weatherMonthCount > 0 && !weatherResult && (
                <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" />
                  {setupStatus.weatherMonthCount} months loaded
                </p>
              )}
              {setupStatus && setupStatus.weatherMonthCount === 0 && !weatherIngesting && !weatherResult && (
                <p className="text-xs text-amber-600 mt-1">No data yet — click Populate to pull from NOAA.</p>
              )}
              {weatherResult && (
                <p className="text-xs text-green-600 mt-1">
                  Done — {weatherResult.monthsIngested} months ingested
                  {weatherResult.errors > 0 && `, ${weatherResult.errors} failed`}.
                </p>
              )}
            </div>
            <button
              onClick={handleIngestWeather}
              disabled={weatherIngesting || !(venue as any).noaa_station_id}
              className="flex-shrink-0 flex items-center gap-1.5 border border-gray-300 bg-white text-gray-700 px-3 py-1.5 rounded text-sm hover:bg-gray-50 transition-colors disabled:opacity-40"
            >
              {weatherIngesting ? (
                <><Loader2 size={13} className="animate-spin" /> Fetching…</>
              ) : setupStatus && setupStatus.weatherMonthCount > 0 ? (
                <><CloudDownload size={13} /> Re-populate</>
              ) : (
                <><CloudDownload size={13} /> Populate</>
              )}
            </button>
          </div>
          {!(venue as any).noaa_station_id && (
            <p className="text-xs text-amber-600 mt-2">Set a NOAA station ID above and save first.</p>
          )}
        </div>

        {/* Backfill client weather scores */}
        <div className="pt-4 border-t border-gray-100">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-700">Client weather scores</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Matches each client's event date to the monthly weather data and writes a difficulty score.
                Run this after importing clients or populating weather data above.
              </p>
              {setupStatus && setupStatus.clientsWithEventDate > 0 && !backfillWeatherResult && (
                <p className={`text-xs mt-1 flex items-center gap-1 ${
                  setupStatus.clientsWithWeatherScore === setupStatus.clientsWithEventDate
                    ? "text-green-600"
                    : "text-amber-600"
                }`}>
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                    setupStatus.clientsWithWeatherScore === setupStatus.clientsWithEventDate
                      ? "bg-green-500"
                      : "bg-amber-400"
                  }`} />
                  {setupStatus.clientsWithWeatherScore} of {setupStatus.clientsWithEventDate} clients scored
                  {setupStatus.clientsWithWeatherScore < setupStatus.clientsWithEventDate && " — click to score the rest"}
                </p>
              )}
              {backfillWeatherResult && (
                <p className="text-xs text-green-600 mt-1">
                  Done — {backfillWeatherResult.backfilled} clients scored
                  {backfillWeatherResult.skipped > 0 && `, ${backfillWeatherResult.skipped} skipped (no weather data for that month)`}.
                </p>
              )}
            </div>
            <button
              onClick={handleBackfillClientWeather}
              disabled={backfillingWeather || !(venue as any).noaa_station_id}
              className="flex-shrink-0 flex items-center gap-1.5 border border-gray-300 bg-white text-gray-700 px-3 py-1.5 rounded text-sm hover:bg-gray-50 transition-colors disabled:opacity-40"
            >
              {backfillingWeather ? (
                <><Loader2 size={13} className="animate-spin" /> Scoring…</>
              ) : (
                <><Check size={13} /> Score clients</>
              )}
            </button>
          </div>
        </div>

        {/* Populate FRED macro data */}
        <div className="pt-4 border-t border-gray-100">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-700">Economic signal data (FRED)</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Pulls 3 years of unemployment, savings rate, disposable income, and housing starts.
                Required for the Market Pulse economic section. Requires <span className="font-medium">FRED_API_KEY</span> env var.
              </p>
              {setupStatus && setupStatus.fredDataPoints > 0 && !fredResult && (
                <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" />
                  {setupStatus.fredDataPoints} data points loaded
                </p>
              )}
              {setupStatus && setupStatus.fredDataPoints === 0 && !fredIngesting && !fredResult && (
                <p className="text-xs text-amber-600 mt-1">No data yet — click Populate.</p>
              )}
              {fredResult && (
                <p className="text-xs text-green-600 mt-1">Done — {fredResult.ingested} data points ingested.</p>
              )}
            </div>
            <button
              onClick={handleFredBackfill}
              disabled={fredIngesting}
              className="flex-shrink-0 flex items-center gap-1.5 border border-gray-300 bg-white text-gray-700 px-3 py-1.5 rounded text-sm hover:bg-gray-50 transition-colors disabled:opacity-40"
            >
              {fredIngesting ? (
                <><Loader2 size={13} className="animate-spin" /> Fetching…</>
              ) : setupStatus && setupStatus.fredDataPoints > 0 ? (
                <><CloudDownload size={13} /> Re-populate</>
              ) : (
                <><CloudDownload size={13} /> Populate</>
              )}
            </button>
          </div>
        </div>

        {/* Refresh market pulse */}
        <div className="pt-4 border-t border-gray-100">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-700">Market Pulse score</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Recalculates the composite demand score from weather, FRED, and search trend data.
                Runs automatically each Monday; click to refresh now.
              </p>
              {pulseResult === true && (
                <p className="text-xs text-green-600 mt-1">Market Pulse refreshed.</p>
              )}
              {pulseResult === false && (
                <p className="text-xs text-red-600 mt-1">Refresh failed — check that weather + FRED data is populated first.</p>
              )}
            </div>
            <button
              onClick={handleRefreshPulse}
              disabled={pulsing}
              className="flex-shrink-0 flex items-center gap-1.5 border border-gray-300 bg-white text-gray-700 px-3 py-1.5 rounded text-sm hover:bg-gray-50 transition-colors disabled:opacity-40"
            >
              {pulsing ? (
                <><Loader2 size={13} className="animate-spin" /> Calculating…</>
              ) : (
                <><Check size={13} /> Refresh</>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Intelligence settings */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <h2 className="text-base font-semibold text-gray-900">Intelligence settings</h2>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Max events per month</label>
          <input
            type="number"
            min={1} max={100}
            value={form.maxEventsPerMonth}
            onChange={(e) => setForm(f => ({ ...f, maxEventsPerMonth: parseInt(e.target.value) || 1 }))}
            className="w-24 border border-gray-300 rounded px-3 py-2 text-sm"
          />
          <p className="text-xs text-gray-400 mt-1">
            How many weddings you can host per month. Used in Capacity & Yield to calculate occupancy %.
            If this is set to 4 and you have 7 bookings in September, you'll show 175% — which means you're overbooked.
            Set this to your real limit so the numbers make sense.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Competitor scan radius (miles)</label>
          <input
            type="number"
            min={5} max={100}
            value={form.competitorRadiusMiles}
            onChange={(e) => setForm(f => ({ ...f, competitorRadiusMiles: parseInt(e.target.value) }))}
            className="w-24 border border-gray-300 rounded px-3 py-2 text-sm"
          />
        </div>

        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            id="contributes"
            checked={form.contributesToBenchmark}
            onChange={(e) => setForm(f => ({ ...f, contributesToBenchmark: e.target.checked }))}
            className="mt-1"
          />
          <label htmlFor="contributes" className="text-sm text-gray-700">
            Contribute anonymised data to network benchmarks
            <p className="text-xs text-gray-400 mt-0.5">
              Helps venues like yours get better context from aggregate comparison data.
              Your individual records are never shared.
            </p>
          </label>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          Save settings
        </button>
        {saved && <span className="text-sm text-green-600">Saved</span>}
      </div>

      {/* ── TEAM ── */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Team</h2>
            <p className="text-xs text-gray-400 mt-0.5">Manage who has access to this venue&apos;s data.</p>
          </div>
          <Link
            href="/settings"
            onClick={(e) => {
              e.preventDefault();
              const email = window.prompt("Enter their email address:");
              if (email) {
                const role = window.prompt("Role? (venue_admin, coordinator, readonly)", "coordinator");
                if (role) {
                  trpc.useUtils().invalidate();
                  fetch("/api/invite/accept", { method: "POST" }); // placeholder
                }
              }
            }}
            className="flex items-center gap-1.5 border border-gray-300 bg-white text-gray-700 px-3 py-1.5 rounded text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            <Plus size={14} /> Invite
          </Link>
        </div>
        <p className="text-sm text-gray-400">
          Team management is available in{" "}
          <span className="text-gray-600 font-medium">Settings → Team</span> for venue owners.
          Use the invite button to add coordinators.
        </p>
      </div>

      {/* ── DATA EXPORT ── */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Data export</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Download all your venue data as JSON. Always available — no lock-in.
            </p>
          </div>
          <a
            href="/api/export"
            download
            className="flex items-center gap-1.5 border border-gray-300 bg-white text-gray-700 px-3 py-1.5 rounded text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            <CloudDownload size={14} /> Export all data
          </a>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="rounded-lg border border-red-200 p-6 space-y-4">
        <h2 className="text-base font-semibold text-red-700">Danger Zone</h2>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-gray-700">Delete all seed data</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Permanently removes all seeded clients and associated records (tours, reviews, channel spend, lost deals) for this venue.
              This cannot be undone.
            </p>
            {deleteSeedData.isSuccess && (
              <p className="text-xs text-green-600 mt-1">Seed data deleted.</p>
            )}
          </div>
          <button
            onClick={() => {
              if (window.confirm("This will permanently delete all 430 seed records. Continue?")) {
                deleteSeedData.mutate();
              }
            }}
            disabled={deleteSeedData.isPending}
            className="flex-shrink-0 flex items-center gap-1.5 border border-red-300 bg-white text-red-600 px-3 py-1.5 rounded text-sm font-medium hover:bg-red-50 transition-colors disabled:opacity-50"
          >
            {deleteSeedData.isPending ? (
              <><Loader2 size={13} className="animate-spin" /> Deleting…</>
            ) : (
              "Delete all seed data"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
