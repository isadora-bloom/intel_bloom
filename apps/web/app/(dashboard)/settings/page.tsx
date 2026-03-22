"use client";

import { trpc } from "@/lib/trpc/client";
import { useState, useEffect } from "react";
import { Mail, Check, AlertCircle, Loader2, Link2, X } from "lucide-react";
import { useSearchParams } from "next/navigation";

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
  const { data: venue, refetch } = trpc.venues.getCurrent.useQuery();
  const { data: emailConn, refetch: refetchEmail } = trpc.email.getConnection.useQuery();
  const update = trpc.venues.update.useMutation({ onSuccess: () => refetch() });
  const disconnect = trpc.email.disconnect.useMutation({ onSuccess: () => refetchEmail() });
  const scan = trpc.email.scan.useMutation();

  const searchParams = useSearchParams();
  const [saved, setSaved] = useState(false);
  const [scanResult, setScanResult] = useState<any>(null);

  const [form, setForm] = useState({
    honeybookApiKey: "",
    googlePlaceId: "",
    knotVenueId: "",
    competitorRadiusMiles: 30,
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
      honeybookApiKey: "",           // keep password fields blank for security
      googlePlaceId: v.google_place_id ?? "",
      knotVenueId: v.knot_venue_id ?? "",
      competitorRadiusMiles: v.competitor_radius_miles ?? 30,
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
      honeybookApiKey: form.honeybookApiKey || undefined,
      googlePlaceId: form.googlePlaceId || undefined,
      knotVenueId: form.knotVenueId || undefined,
      competitorRadiusMiles: form.competitorRadiusMiles,
      contributesToBenchmark: form.contributesToBenchmark,
      googleTrendsMetro: form.googleTrendsMetro || undefined,
      noaaStationId: form.noaaStationId || undefined,
      fedDistrict: form.fedDistrict ? parseInt(form.fedDistrict) : undefined,
      trendsCustomTerms: form.trendsCustomTerms.filter(t => t.trim() !== ""),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  async function handleScan() {
    const result = await scan.mutateAsync({ maxEmails: 200, daysBack: 730 });
    setScanResult(result);
    refetchEmail();
  }

  if (!venue) return <div className="text-sm text-gray-400 p-8">Loading...</div>;

  const connectGmailUrl = `/api/auth/google?venue_id=${venue.id}`;
  const emailError = searchParams.get("email_error") === "1";

  // Intelligence profile helpers
  const venueProfile = (venue as any).venue_profile ?? {};
  const funnelConfig = (venue as any).funnel_config ?? {};

  function profileValue(key: string): string | null {
    const field = venueProfile[key];
    if (!field) return null;
    return field.value ?? null;
  }

  function profileSource(key: string): string | null {
    const field = venueProfile[key];
    if (!field) return null;
    return field.source ?? null;
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
      </div>

      {/* ── INTELLIGENCE PROFILE ── */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="mb-4">
          <h2 className="text-base font-semibold text-gray-900">Intelligence profile</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            What Bloom knows about your venue economics and funnel. Badges show where each value came from.
          </p>
        </div>

        {/* Economics fields */}
        <div className="mb-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Economics</p>
          <div className="space-y-0">
            <ProfileRow
              label="Average package value"
              value={profileValue("avg_package_value_bucket")}
              source={profileSource("avg_package_value_bucket")}
            />
            <ProfileRow
              label="Monthly advertising spend"
              value={profileValue("monthly_ad_spend_bucket")}
              source={profileSource("monthly_ad_spend_bucket")}
            />
            <ProfileRow
              label="Tours until one booking"
              value={profileValue("typical_tours_per_booking_bucket")}
              source={profileSource("typical_tours_per_booking_bucket")}
            />
          </div>
        </div>

        {/* Funnel config fields */}
        <div className="mb-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Funnel configuration</p>
          <div className="space-y-3 py-2">
            <div className="flex items-start justify-between gap-4">
              <span className="text-sm text-gray-500 flex-shrink-0 w-52 pt-0.5">Where couples find you</span>
              <div className="flex-1">
                <TagPills values={funnelConfig.awareness_channels} />
              </div>
            </div>
            <div className="flex items-start justify-between gap-4">
              <span className="text-sm text-gray-500 flex-shrink-0 w-52 pt-0.5">How they first reach out</span>
              <div className="flex-1">
                <TagPills values={funnelConfig.first_touch_methods} />
              </div>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-gray-500 flex-shrink-0 w-52">Tour scheduling</span>
              <span className={`text-sm font-medium flex-1 ${funnelConfig.tour_method ? "text-gray-900" : "text-gray-300"}`}>
                {funnelConfig.tour_method ?? "Not set"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-gray-500 flex-shrink-0 w-52">Contract tool</span>
              <span className={`text-sm font-medium flex-1 ${funnelConfig.contract_method ? "text-gray-900" : "text-gray-300"}`}>
                {funnelConfig.contract_method ?? "Not set"}
              </span>
            </div>
          </div>
        </div>

        <div className="pt-2 border-t border-gray-100">
          <a
            href="/dashboard"
            className="text-sm text-blue-600 hover:text-blue-800 transition-colors"
          >
            Update these in your setup checklist on the dashboard →
          </a>
        </div>
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

            <button
              onClick={handleScan}
              disabled={scan.isPending}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {scan.isPending ? (
                <><Loader2 size={14} className="animate-spin" /> Scanning inbox…</>
              ) : (
                <><Mail size={14} /> Scan inbox</>
              )}
            </button>

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

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">HoneyBook API key</label>
          <input
            type="password"
            placeholder={(venue as any).honeybook_api_key ? "••••••••" : "Not connected"}
            value={form.honeybookApiKey}
            onChange={(e) => setForm(f => ({ ...f, honeybookApiKey: e.target.value }))}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Google Place ID</label>
          <input
            type="text"
            placeholder={(venue as any).google_place_id ?? "e.g. ChIJ..."}
            value={form.googlePlaceId}
            onChange={(e) => setForm(f => ({ ...f, googlePlaceId: e.target.value }))}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
          />
          <p className="text-xs text-gray-400 mt-1">Used for review monitoring and competitor scanning</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">The Knot venue ID</label>
          <input
            type="text"
            placeholder={(venue as any).knot_venue_id ?? "Your Knot venue slug"}
            value={form.knotVenueId}
            onChange={(e) => setForm(f => ({ ...f, knotVenueId: e.target.value }))}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
          />
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
            placeholder={(venue as any).noaa_station_id ?? "e.g. GHCND:USW00013741"}
            value={form.noaaStationId}
            onChange={(e) => setForm(f => ({ ...f, noaaStationId: e.target.value }))}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
          />
          <p className="text-xs text-gray-400 mt-1">
            Nearest weather station. For Rapidan VA: try <span className="font-medium">GHCND:USW00013741</span> (Culpeper)
            or <span className="font-medium">GHCND:USW00013721</span> (Dulles).
            Find yours at <span className="font-medium">ncdc.noaa.gov/cdo-web/datatools/findstation</span>
          </p>
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
      </div>

      {/* Intelligence settings */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <h2 className="text-base font-semibold text-gray-900">Intelligence settings</h2>

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
    </div>
  );
}
