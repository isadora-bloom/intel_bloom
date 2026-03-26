"use client";

import { trpc } from "@/lib/trpc/client";
import { use } from "react";
import { format } from "date-fns";
import { useState } from "react";
import { ArrowLeft, Upload, Pencil, X, Check, Star } from "lucide-react";
import Link from "next/link";

type Tab = "overview" | "acquisition" | "planning" | "event" | "reputation";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "acquisition", label: "Acquisition" },
  { id: "planning", label: "Planning" },
  { id: "event", label: "Event" },
  { id: "reputation", label: "Reputation" },
];

export default function ClientRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.clients.getById.useQuery({ id });

  if (isLoading) {
    return <div className="p-8 text-gray-400">Loading client record...</div>;
  }

  if (!data?.client) {
    return <div className="p-8 text-red-500">Client not found</div>;
  }

  const { client, touchpoints, planningEvents, vendors, uploads, referralsGiven, referralsReceived, weatherForecast } = data;

  return (
    <div className="max-w-5xl">
      {/* Header */}
      <div className="mb-6">
        <Link href="/clients" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-3">
          <ArrowLeft size={14} />
          Clients
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">
              {client.name_primary}
              {client.name_partner && ` & ${client.name_partner}`}
            </h1>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-sm text-gray-500 capitalize">
                {(client.status as string).replace(/_/g, " ")}
              </span>
              {client.event_date && (
                <>
                  <span className="text-gray-300">·</span>
                  <span className="text-sm text-gray-500">
                    {format(new Date(client.event_date), "MMMM d, yyyy")}
                  </span>
                </>
              )}
              {client.revenue_cents && (
                <>
                  <span className="text-gray-300">·</span>
                  <span className="text-sm text-gray-700 font-medium">
                    ${(client.revenue_cents / 100).toLocaleString()}
                  </span>
                </>
              )}
            </div>
          </div>
          <Link
            href={`/clients/${id}/upload`}
            className="flex items-center gap-2 bg-blue-600 text-white text-sm px-3 py-2 rounded-md hover:bg-blue-700 transition-colors"
          >
            <Upload size={14} />
            Upload recording
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <div className="flex gap-0">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === "overview" && (
        <OverviewTab client={client} />
      )}
      {activeTab === "acquisition" && (
        <AcquisitionTab client={client} touchpoints={touchpoints} />
      )}
      {activeTab === "planning" && (
        <PlanningTab client={client} planningEvents={planningEvents} uploads={uploads} />
      )}
      {activeTab === "event" && (
        <div className="space-y-4">
          <EventTab client={client} vendors={vendors} />

          {/* Weather forecast for event date */}
          {weatherForecast && (
            <Section title="Event day weather forecast">
              <p className="text-sm text-gray-600">
                Forecast for {client.event_date ? format(new Date(client.event_date), "MMMM d, yyyy") : "event date"}
                <span className="text-xs text-gray-400 ml-2">
                  (fetched {format(new Date(weatherForecast.fetched_at), "MMM d")})
                </span>
              </p>
              {weatherForecast.forecast_data && (
                <div className="grid grid-cols-3 gap-3 mt-2 text-sm">
                  <div className="bg-blue-50 rounded p-2">
                    <p className="text-xs text-blue-500">Temperature</p>
                    <p className="font-medium text-blue-800">
                      {(weatherForecast.forecast_data as any)?.temp_high_f ?? "—"}°F high
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded p-2">
                    <p className="text-xs text-gray-500">Rain chance</p>
                    <p className="font-medium text-gray-800">
                      {(weatherForecast.forecast_data as any)?.precip_probability ?? "—"}%
                    </p>
                  </div>
                  <div className="bg-green-50 rounded p-2">
                    <p className="text-xs text-green-500">Conditions</p>
                    <p className="font-medium text-green-800">
                      {(weatherForecast.forecast_data as any)?.conditions ?? "—"}
                    </p>
                  </div>
                </div>
              )}
            </Section>
          )}

          {/* Referrals */}
          {((referralsGiven?.length ?? 0) > 0 || (referralsReceived?.length ?? 0) > 0) && (
            <Section title="Referrals">
              {(referralsGiven?.length ?? 0) > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                    Referred others ({referralsGiven?.length})
                  </p>
                  {referralsGiven?.map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between py-1.5 text-sm border-b border-gray-50">
                      <span className="text-gray-600">
                        {r.referred_client_id ? (
                          <Link href={`/clients/${r.referred_client_id}`} className="text-blue-600 hover:underline">
                            View referred client
                          </Link>
                        ) : "Pending match"}
                      </span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${r.converted ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                        {r.converted ? "Converted" : "Pending"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {(referralsReceived?.length ?? 0) > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                    Referred by
                  </p>
                  {referralsReceived?.map((r: any) => (
                    <div key={r.id} className="text-sm text-gray-600 py-1">
                      {r.referring_client_id ? (
                        <Link href={`/clients/${r.referring_client_id}`} className="text-blue-600 hover:underline">
                          View referrer
                        </Link>
                      ) : "Unknown referrer"}
                      <span className="text-xs text-gray-400 ml-2">via {r.source}</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          )}
        </div>
      )}
      {activeTab === "reputation" && (
        <ReputationTab client={client} onUpdate={() => utils.clients.getById.invalidate({ id })} />
      )}
    </div>
  );
}

function OverviewTab({ client }: { client: any }) {
  return (
    <div className="grid grid-cols-2 gap-6">
      <div className="space-y-4">
        <Section title="Contact">
          <Row label="Primary" value={client.name_primary} />
          <Row label="Partner" value={client.name_partner} />
          <Row label="Email" value={client.email_primary} />
          <Row label="Phone" value={client.phone_primary} />
        </Section>
        <Section title="Event">
          <Row label="Date" value={client.event_date ? format(new Date(client.event_date), "MMMM d, yyyy") : null} />
          <Row label="Package" value={client.package} />
          <Row label="Guest estimate" value={client.guest_count_initial?.toString()} />
          <Row label="Guest final" value={client.guest_count_final?.toString()} />
        </Section>
      </div>
      <div className="space-y-4">
        <Section title="Scores">
          <Row label="Complexity" value={client.complexity_score ? `${client.complexity_score}/100` : null} />
          <Row label="Day-of complexity" value={client.day_of_complexity ? `${client.day_of_complexity}/5` : null} />
          <Row label="Confidence" value={client.confidence_score ? `${client.confidence_score}%` : null} />
        </Section>
        <Section title="Finance">
          <Row label="Revenue" value={client.revenue_cents ? `$${(client.revenue_cents / 100).toLocaleString()}` : null} />
          <Row label="Acquisition cost" value={client.acquisition_cost_cents ? `$${(client.acquisition_cost_cents / 100).toLocaleString()}` : null} />
        </Section>
      </div>
    </div>
  );
}

function AcquisitionTab({ client, touchpoints }: { client: any; touchpoints: any[] }) {
  return (
    <div className="space-y-6">
      <Section title="Source attribution">
        <Row label="First touch" value={client.first_touch_platform} />
        <Row label="Self-reported" value={client.self_reported_source} />
        <Row
          label="Resolved source"
          value={client.resolved_source
            ? `${client.resolved_source}${client.resolved_source_confidence ? ` (${client.resolved_source_confidence}% confidence)` : ""}`
            : null}
        />
        <Row label="Referrer" value={client.referrer_name} />
      </Section>

      {client.competing_venues && client.competing_venues.length > 0 && (
        <Section title="Competing venues mentioned">
          <div className="flex flex-wrap gap-2">
            {client.competing_venues.map((v: string) => (
              <span key={v} className="text-xs bg-red-50 text-red-700 border border-red-200 px-2 py-1 rounded">
                {v}
              </span>
            ))}
          </div>
        </Section>
      )}

      {touchpoints.length > 0 && (
        <Section title="Source touchpoints">
          <div className="space-y-2">
            {touchpoints.map((tp: any) => (
              <div key={tp.id} className="flex items-center justify-between text-sm">
                <span className="text-gray-700 font-medium">{tp.platform}</span>
                <span className="text-gray-400">
                  {tp.touchpoint_date ? format(new Date(tp.touchpoint_date), "MMM d, yyyy") : "—"}
                </span>
                {tp.cost_cents && (
                  <span className="text-gray-500">${(tp.cost_cents / 100).toFixed(2)}</span>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function PlanningTab({ client, planningEvents, uploads }: { client: any; planningEvents: any[]; uploads: any[] }) {
  return (
    <div className="space-y-6">
      {/* Flags */}
      {client.stress_flags && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-amber-800 mb-2">Stress flags</h3>
          <pre className="text-xs text-amber-700">{JSON.stringify(client.stress_flags, null, 2)}</pre>
        </div>
      )}

      {/* Timeline */}
      {planningEvents.length > 0 && (
        <Section title="Planning timeline">
          <div className="space-y-3">
            {planningEvents.map((ev: any) => (
              <div key={ev.id} className="flex gap-3 text-sm">
                <span className="text-gray-400 text-xs w-28 flex-shrink-0">
                  {ev.event_date ? format(new Date(ev.event_date), "MMM d, h:mm a") : "—"}
                </span>
                <div>
                  <span className="font-medium text-gray-700">{ev.event_type.replace(/_/g, " ")}</span>
                  {ev.source && <span className="text-gray-400 text-xs ml-2">via {ev.source}</span>}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Uploads */}
      {uploads.length > 0 && (
        <Section title="Uploaded files">
          <div className="space-y-2">
            {uploads.map((up: any) => (
              <div key={up.id} className="flex items-center justify-between p-2 bg-gray-50 rounded text-sm">
                <span className="text-gray-700">{up.file_name}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  up.status === "complete" ? "bg-green-100 text-green-700"
                  : up.status === "review" ? "bg-amber-100 text-amber-700"
                  : "bg-gray-100 text-gray-600"
                }`}>
                  {up.status}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function EventTab({ client, vendors }: { client: any; vendors: any[] }) {
  return (
    <div className="space-y-6">
      <Section title="Event day">
        <Row label="Guest count (final)" value={client.guest_count_final?.toString()} />
        <Row label="Staffing hours" value={client.staffing_hours_actual?.toString()} />
        <Row label="Day-of complexity" value={client.day_of_complexity ? `${client.day_of_complexity}/5` : null} />
      </Section>

      {vendors.length > 0 && (
        <Section title="Vendors">
          <div className="flex flex-wrap gap-2">
            {vendors.map((v: any) => (
              <span key={v.id} className="text-sm bg-gray-100 text-gray-700 px-3 py-1 rounded-full">
                {v.name} · <span className="text-gray-500">{v.category}</span>
              </span>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

const REVIEW_PLATFORMS = ["Google", "The Knot", "WeddingWire", "Facebook", "Zola", "Other"];

function StarPicker({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(null)}
          onClick={() => onChange(n)}
          className="focus:outline-none"
        >
          <Star
            size={22}
            className={`transition-colors ${
              n <= (hover ?? value ?? 0)
                ? "fill-amber-400 text-amber-400"
                : "fill-gray-100 text-gray-300"
            }`}
          />
        </button>
      ))}
    </div>
  );
}

function ReputationTab({ client, onUpdate }: { client: any; onUpdate: () => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    reviewSubmitted: client.review_submitted ?? false,
    reviewPlatform: client.review_platform ?? "",
    reviewStarRating: client.review_star_rating ?? null as number | null,
    reviewText: client.review_text ?? "",
    referralsGenerated: client.referrals_generated ?? "" as number | "",
  });

  const update = trpc.clients.update.useMutation({
    onSuccess: () => { setEditing(false); onUpdate(); },
  });

  function handleSave() {
    update.mutate({
      id: client.id,
      reviewSubmitted: form.reviewSubmitted,
      reviewPlatform: form.reviewPlatform || undefined,
      reviewStarRating: form.reviewStarRating ?? undefined,
      reviewText: form.reviewText || undefined,
      referralsGenerated: typeof form.referralsGenerated === "number" ? form.referralsGenerated : undefined,
    });
  }

  function handleCancel() {
    setForm({
      reviewSubmitted: client.review_submitted ?? false,
      reviewPlatform: client.review_platform ?? "",
      reviewStarRating: client.review_star_rating ?? null,
      reviewText: client.review_text ?? "",
      referralsGenerated: client.referrals_generated ?? "",
    });
    setEditing(false);
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-700">Review</h3>
          {!editing ? (
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              <Pencil size={12} /> Edit
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={handleCancel}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
              >
                <X size={12} /> Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={update.isPending}
                className="flex items-center gap-1 text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 disabled:opacity-50"
              >
                <Check size={12} /> {update.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          )}
        </div>

        {editing ? (
          <div className="space-y-4">
            {/* Left review toggle */}
            <div className="flex items-center justify-between">
              <label className="text-sm text-gray-500">Left a review?</label>
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, reviewSubmitted: !f.reviewSubmitted }))}
                className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${
                  form.reviewSubmitted ? "bg-blue-600" : "bg-gray-200"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    form.reviewSubmitted ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {/* Platform */}
            <div className="flex items-center justify-between gap-4">
              <label className="text-sm text-gray-500 flex-shrink-0">Platform</label>
              <select
                value={form.reviewPlatform}
                onChange={(e) => setForm((f) => ({ ...f, reviewPlatform: e.target.value }))}
                className="border border-gray-300 rounded px-2 py-1 text-sm text-gray-700 w-44"
              >
                <option value="">— select —</option>
                {REVIEW_PLATFORMS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>

            {/* Star rating */}
            <div className="flex items-center justify-between">
              <label className="text-sm text-gray-500">Rating</label>
              <StarPicker
                value={form.reviewStarRating}
                onChange={(v) => setForm((f) => ({ ...f, reviewStarRating: v }))}
              />
            </div>

            {/* Review text */}
            <div>
              <label className="text-sm text-gray-500 block mb-1">Review text</label>
              <textarea
                value={form.reviewText}
                onChange={(e) => setForm((f) => ({ ...f, reviewText: e.target.value }))}
                placeholder="Paste the review text here…"
                rows={4}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm text-gray-900 placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Referrals */}
            <div className="flex items-center justify-between gap-4">
              <label className="text-sm text-gray-500 flex-shrink-0">Referrals generated</label>
              <input
                type="number"
                min={0}
                value={form.referralsGenerated}
                onChange={(e) => setForm((f) => ({ ...f, referralsGenerated: e.target.value === "" ? "" : Number(e.target.value) }))}
                className="border border-gray-300 rounded px-2 py-1 text-sm text-gray-700 w-20 text-right"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-0">
            {/* Read view */}
            {client.review_submitted === true && client.review_star_rating && (
              <div className="flex items-center gap-2 pb-3 mb-3 border-b border-gray-100">
                <div className="flex gap-0.5">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star
                      key={n}
                      size={18}
                      className={n <= client.review_star_rating ? "fill-amber-400 text-amber-400" : "fill-gray-100 text-gray-200"}
                    />
                  ))}
                </div>
                {client.review_platform && (
                  <span className="text-xs text-gray-400">on {client.review_platform}</span>
                )}
              </div>
            )}
            <Row label="Left review" value={client.review_submitted ? "Yes" : client.review_submitted === false ? "No" : null} />
            <Row label="Platform" value={client.review_platform} />
            <Row label="Referrals generated" value={client.referrals_generated?.toString()} />
            {!client.review_submitted && !client.review_star_rating && (
              <p className="text-sm text-gray-400 pt-1">No review logged yet. Click Edit to add one.</p>
            )}
          </div>
        )}
      </div>

      {/* Review text — read view */}
      {!editing && client.review_text && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Review text</h3>
          <blockquote className="text-sm text-gray-600 italic border-l-4 border-gray-200 pl-4">
            {client.review_text}
          </blockquote>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">{title}</h3>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between py-1.5 text-sm border-b border-gray-50 last:border-0">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 text-right max-w-xs">{value}</span>
    </div>
  );
}
