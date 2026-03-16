"use client";

import { trpc } from "@/lib/trpc/client";
import { useState } from "react";

export default function SettingsPage() {
  const { data: venue, refetch } = trpc.venues.getCurrent.useQuery();
  const update = trpc.venues.update.useMutation({ onSuccess: () => refetch() });
  const [saved, setSaved] = useState(false);

  const [form, setForm] = useState({
    honeybookApiKey: "",
    googlePlaceId: "",
    knotVenueId: "",
    competitorRadiusMiles: 30,
    contributesToBenchmark: true,
  });

  function handleSave() {
    update.mutate({
      honeybookApiKey: form.honeybookApiKey || undefined,
      googlePlaceId: form.googlePlaceId || undefined,
      knotVenueId: form.knotVenueId || undefined,
      competitorRadiusMiles: form.competitorRadiusMiles,
      contributesToBenchmark: form.contributesToBenchmark,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  if (!venue) return <div className="text-sm text-gray-400 p-8">Loading...</div>;

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

      {/* Integrations */}
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
