"use client";

import { trpc } from "@/lib/trpc/client";
import { useState } from "react";
import { Flag, Plus, AlertCircle, User } from "lucide-react";
import { format } from "date-fns";

const ANNOTATION_TYPES = [
  { value: "closed", label: "Venue was closed" },
  { value: "property_event", label: "Property event (private use)" },
  { value: "platform_technical", label: "Platform technical issue" },
  { value: "staffing_change", label: "Staffing change" },
  { value: "business_decision", label: "Business decision" },
  { value: "external_event", label: "External event (weather, etc.)" },
  { value: "seasonal_pause", label: "Seasonal pause" },
  { value: "unknown", label: "Unknown reason" },
  { value: "no_reason", label: "No specific reason" },
];

export default function AnnotationsPage() {
  const [tab, setTab] = useState<"flagged" | "all" | "new">("flagged");
  const [respondingTo, setRespondingTo] = useState<string | null>(null);
  const [responseForm, setResponseForm] = useState({
    annotationType: "unknown",
    notes: "",
    excludeFromPatterns: false,
  });
  const [newForm, setNewForm] = useState({
    periodStart: "",
    periodEnd: "",
    annotationType: "business_decision",
    notes: "",
    excludeFromPatterns: false,
  });

  const { data: flagged, refetch: refetchFlagged } = trpc.annotations.list.useQuery({ source: "system_detected" });
  const { data: all, refetch: refetchAll } = trpc.annotations.list.useQuery({ source: "all" });

  const respond = trpc.annotations.respond.useMutation({
    onSuccess: () => { refetchFlagged(); refetchAll(); setRespondingTo(null); }
  });
  const create = trpc.annotations.create.useMutation({
    onSuccess: () => { refetchAll(); setTab("all"); }
  });

  const systemFlags = (flagged ?? []).filter((a: any) => a.annotation_type === "unknown" || a.source === "system_detected");

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Annotations</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Contextual flags that protect data integrity in your pattern analysis
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6 flex gap-0">
        {[
          { id: "flagged", label: `System flags${systemFlags.length > 0 ? ` (${systemFlags.length})` : ""}` },
          { id: "all", label: "All annotations" },
          { id: "new", label: "+ New annotation" },
        ].map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id as any)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === id
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* System flags */}
      {tab === "flagged" && (
        <div className="space-y-4">
          {systemFlags.length === 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
              <Flag size={24} className="mx-auto text-gray-300 mb-2" />
              <p className="text-sm text-gray-400">No flags awaiting your input</p>
            </div>
          )}

          {systemFlags.map((ann: any) => (
            <div key={ann.id} className="bg-white rounded-lg border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-start gap-3 mb-3">
                <AlertCircle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-amber-800">{ann.notes}</p>
                  <p className="text-xs text-amber-600 mt-1">
                    {format(new Date(ann.period_start), "MMM d")} – {format(new Date(ann.period_end), "MMM d, yyyy")}
                    {ann.detected_signal && ` · Signal: ${ann.detected_signal}`}
                  </p>
                </div>
              </div>

              {respondingTo === ann.id ? (
                <div className="bg-white rounded border border-gray-200 p-4 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">What happened?</label>
                    <select
                      value={responseForm.annotationType}
                      onChange={(e) => setResponseForm(f => ({ ...f, annotationType: e.target.value }))}
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                    >
                      {ANNOTATION_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Notes (optional)</label>
                    <textarea
                      value={responseForm.notes}
                      onChange={(e) => setResponseForm(f => ({ ...f, notes: e.target.value }))}
                      rows={2}
                      placeholder="Any context that would help explain this period..."
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm resize-none"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id={`exclude-${ann.id}`}
                      checked={responseForm.excludeFromPatterns}
                      onChange={(e) => setResponseForm(f => ({ ...f, excludeFromPatterns: e.target.checked }))}
                    />
                    <label htmlFor={`exclude-${ann.id}`} className="text-xs text-gray-600">
                      Exclude this period from pattern calculations
                    </label>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => respond.mutate({ id: ann.id, annotationType: responseForm.annotationType as any, notes: responseForm.notes, excludeFromPatterns: responseForm.excludeFromPatterns })}
                      className="bg-blue-600 text-white text-xs px-3 py-1.5 rounded hover:bg-blue-700"
                    >
                      Save context
                    </button>
                    <button
                      onClick={() => setRespondingTo(null)}
                      className="text-gray-500 text-xs px-3 py-1.5 rounded hover:bg-gray-100"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setRespondingTo(ann.id)}
                  className="text-xs text-amber-800 border border-amber-300 bg-white px-3 py-1.5 rounded hover:bg-amber-100 transition-colors"
                >
                  Add context
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* All annotations */}
      {tab === "all" && (
        <div className="space-y-3">
          {(all ?? []).length === 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
              <p className="text-sm text-gray-400">No annotations yet</p>
            </div>
          )}
          {(all ?? []).map((ann: any) => (
            <div key={ann.id} className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  {ann.source === "system_detected"
                    ? <AlertCircle size={14} className="text-amber-500" />
                    : <User size={14} className="text-blue-500" />}
                  <span className="text-sm font-medium text-gray-700">
                    {ANNOTATION_TYPES.find(t => t.value === ann.annotation_type)?.label ?? ann.annotation_type}
                  </span>
                </div>
                <span className="text-xs text-gray-400">
                  {format(new Date(ann.period_start), "MMM d")} – {format(new Date(ann.period_end), "MMM d, yyyy")}
                </span>
              </div>
              {ann.notes && <p className="text-sm text-gray-500">{ann.notes}</p>}
              {ann.exclude_from_patterns && (
                <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded mt-1 inline-block">
                  Excluded from patterns
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* New annotation form */}
      {tab === "new" && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
          <h2 className="font-semibold text-gray-900">Add proactive annotation</h2>
          <p className="text-sm text-gray-500">
            Use this to flag periods where something unusual happened that might affect your data.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Period start</label>
              <input
                type="date"
                value={newForm.periodStart}
                onChange={(e) => setNewForm(f => ({ ...f, periodStart: e.target.value }))}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Period end</label>
              <input
                type="date"
                value={newForm.periodEnd}
                onChange={(e) => setNewForm(f => ({ ...f, periodEnd: e.target.value }))}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Category</label>
            <select
              value={newForm.annotationType}
              onChange={(e) => setNewForm(f => ({ ...f, annotationType: e.target.value }))}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            >
              {ANNOTATION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              value={newForm.notes}
              onChange={(e) => setNewForm(f => ({ ...f, notes: e.target.value }))}
              rows={3}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm resize-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="exclude-new"
              checked={newForm.excludeFromPatterns}
              onChange={(e) => setNewForm(f => ({ ...f, excludeFromPatterns: e.target.checked }))}
            />
            <label htmlFor="exclude-new" className="text-sm text-gray-600">
              Exclude this period from pattern calculations
            </label>
          </div>

          <button
            onClick={() => create.mutate({
              periodStart: newForm.periodStart,
              periodEnd: newForm.periodEnd,
              annotationType: newForm.annotationType as any,
              notes: newForm.notes,
              excludeFromPatterns: newForm.excludeFromPatterns,
            })}
            disabled={!newForm.periodStart || !newForm.periodEnd}
            className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            Save annotation
          </button>
        </div>
      )}
    </div>
  );
}
