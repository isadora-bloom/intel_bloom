"use client";

import { trpc } from "@/lib/trpc/client";
import { use } from "react";
import { format } from "date-fns";
import { useState } from "react";
import { ArrowLeft, Upload } from "lucide-react";
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

  const { data, isLoading } = trpc.clients.getById.useQuery({ id });

  if (isLoading) {
    return <div className="p-8 text-gray-400">Loading client record...</div>;
  }

  if (!data?.client) {
    return <div className="p-8 text-red-500">Client not found</div>;
  }

  const { client, touchpoints, planningEvents, vendors, uploads } = data;

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
        <EventTab client={client} vendors={vendors} />
      )}
      {activeTab === "reputation" && (
        <ReputationTab client={client} />
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
          <Row label="Weather difficulty" value={client.weather_difficulty_score ? `${client.weather_difficulty_score}/10` : null} />
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
        <Row label="Weather score" value={client.weather_difficulty_score ? `${client.weather_difficulty_score}/10` : null} />
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

function ReputationTab({ client }: { client: any }) {
  return (
    <div className="space-y-6">
      <Section title="Review">
        <Row label="Left review" value={client.review_left ? "Yes" : client.review_left === false ? "No" : null} />
        <Row label="Platform" value={client.review_platform} />
        <Row label="Rating" value={client.review_star_rating ? `${client.review_star_rating} / 5` : null} />
        <Row label="Weather-adjusted" value={client.review_adjusted_score ? `${client.review_adjusted_score} / 5` : null} />
        <Row label="Review date" value={client.review_date ? format(new Date(client.review_date), "MMM d, yyyy") : null} />
      </Section>

      {client.review_text && (
        <Section title="Review text">
          <blockquote className="text-sm text-gray-600 italic border-l-4 border-gray-200 pl-4">
            {client.review_text}
          </blockquote>
        </Section>
      )}

      <Section title="Referrals">
        <Row label="Referrals generated" value={client.referrals_generated?.toString()} />
      </Section>
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
