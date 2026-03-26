"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import {
  AlertTriangle,
  AlertCircle,
  Info,
  X,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Check,
} from "lucide-react";

const SEVERITY_STYLES = {
  critical: {
    border: "border-red-300",
    bg: "bg-red-50",
    icon: AlertCircle,
    iconColor: "text-red-500",
    badge: "bg-red-100 text-red-700",
    label: "Critical",
  },
  warning: {
    border: "border-amber-300",
    bg: "bg-amber-50",
    icon: AlertTriangle,
    iconColor: "text-amber-500",
    badge: "bg-amber-100 text-amber-700",
    label: "Warning",
  },
  info: {
    border: "border-blue-200",
    bg: "bg-white",
    icon: Info,
    iconColor: "text-blue-400",
    badge: "bg-blue-50 text-blue-600",
    label: "Info",
  },
} as const;

const CATEGORY_OPTIONS = [
  "market_conditions",
  "staffing",
  "pricing_change",
  "competitor_activity",
  "platform_issue",
  "website_change",
  "campaign_effect",
  "seasonal",
  "personal_circumstances",
  "data_quality",
  "other",
];

function formatMetric(metric: string): string {
  return metric.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function AnomalyCard({ anomaly, onUpdate }: { anomaly: any; onUpdate: () => void }) {
  const [showAnnotate, setShowAnnotate] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState("");
  const [category, setCategory] = useState("other");
  const [excludeFromPatterns, setExcludeFromPatterns] = useState(false);

  const styles = SEVERITY_STYLES[anomaly.severity as keyof typeof SEVERITY_STYLES] ?? SEVERITY_STYLES.info;
  const Icon = styles.icon;

  const dismiss = trpc.anomalies.dismiss.useMutation({ onSuccess: onUpdate });
  const acknowledge = trpc.anomalies.acknowledge.useMutation({ onSuccess: onUpdate });
  const annotate = trpc.anomalies.annotate.useMutation({
    onSuccess: () => {
      setShowAnnotate(false);
      setNote("");
      onUpdate();
    },
  });

  const causes: string[] = anomaly.ai_possible_causes ?? [];
  const direction = anomaly.direction === "up" ? "+" : "";
  const changePct = `${direction}${Math.round(anomaly.magnitude_pct)}%`;

  return (
    <div className={`rounded-lg border ${styles.border} ${styles.bg} p-4 transition-all`}>
      <div className="flex items-start gap-3">
        <Icon size={18} className={`${styles.iconColor} flex-shrink-0 mt-0.5`} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${styles.badge}`}>
              {styles.label}
            </span>
            <span className="text-xs text-gray-400">
              {formatMetric(anomaly.metric)}
            </span>
          </div>

          <p className="text-sm font-medium text-gray-900 mb-1">
            {formatMetric(anomaly.metric)} {anomaly.direction === "up" ? "up" : "down"}{" "}
            <span className={anomaly.direction === "up" ? "text-green-600" : "text-red-600"}>
              {changePct}
            </span>
          </p>

          <p className="text-xs text-gray-500">
            Current: {anomaly.current_value} | Baseline: {anomaly.baseline_value}
            {anomaly.period_current && (
              <span className="text-gray-400 ml-1">({anomaly.period_current})</span>
            )}
          </p>

          {/* AI recommendation */}
          {anomaly.ai_recommendation && (
            <p className="text-xs text-gray-600 mt-2 bg-white/60 rounded px-2 py-1.5 border border-gray-100">
              {anomaly.ai_recommendation}
            </p>
          )}

          {/* Expandable AI causes */}
          {causes.length > 0 && (
            <div className="mt-2">
              <button
                onClick={() => setExpanded(!expanded)}
                className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-0.5"
              >
                {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                {expanded ? "Hide" : "Possible"} causes ({causes.length})
              </button>
              {expanded && (
                <ul className="mt-1.5 space-y-1">
                  {causes.map((cause, i) => (
                    <li key={i} className="text-xs text-gray-600 flex gap-1.5">
                      <span className="text-gray-400 flex-shrink-0">{i + 1}.</span>
                      {cause}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Action buttons */}
          {!showAnnotate && (
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => setShowAnnotate(true)}
                className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded border border-gray-200 hover:border-gray-400 bg-white transition-colors"
              >
                <MessageSquare size={11} /> I know why
              </button>
              <button
                onClick={() => acknowledge.mutate({ id: anomaly.id })}
                disabled={acknowledge.isPending}
                className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 px-2 py-1 rounded border border-gray-100 hover:border-gray-300 transition-colors"
              >
                <Check size={11} /> Noted
              </button>
              <button
                onClick={() => dismiss.mutate({ id: anomaly.id })}
                disabled={dismiss.isPending}
                className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 px-2 py-1 rounded border border-gray-100 hover:border-gray-300 transition-colors"
              >
                <X size={11} /> Dismiss
              </button>
            </div>
          )}

          {/* Annotation form */}
          {showAnnotate && (
            <div className="mt-3 bg-white rounded-lg border border-gray-200 p-3 space-y-3">
              <p className="text-xs font-medium text-gray-700">What happened?</p>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 text-gray-700"
              >
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase())}
                  </option>
                ))}
              </select>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Our Knot listing was paused for 10 days while we updated photos..."
                className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 text-gray-700 resize-none"
                rows={2}
              />
              <label className="flex items-center gap-2 text-xs text-gray-500">
                <input
                  type="checkbox"
                  checked={excludeFromPatterns}
                  onChange={(e) => setExcludeFromPatterns(e.target.checked)}
                  className="rounded border-gray-300"
                />
                Exclude this period from benchmark calculations
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() =>
                    annotate.mutate({
                      anomalyId: anomaly.id,
                      note,
                      category,
                      excludeFromPatterns,
                    })
                  }
                  disabled={!note.trim() || annotate.isPending}
                  className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 disabled:opacity-40 transition-colors"
                >
                  Save note
                </button>
                <button
                  onClick={() => setShowAnnotate(false)}
                  className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AnomalyAlerts() {
  const { data: anomalies, isLoading, refetch } = trpc.anomalies.getRecent.useQuery(
    { limit: 5 },
    { staleTime: 1000 * 60 * 5 }
  );

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="bg-white border border-gray-200 rounded-lg p-4 animate-pulse">
            <div className="h-3 bg-gray-100 rounded w-3/4 mb-2" />
            <div className="h-2.5 bg-gray-100 rounded w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  if (!anomalies || anomalies.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-1">
        <AlertTriangle size={13} className="text-amber-500" />
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Anomalies detected
        </h2>
        <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">
          {anomalies.length}
        </span>
      </div>
      {anomalies.map((a: any) => (
        <AnomalyCard key={a.id} anomaly={a} onUpdate={() => refetch()} />
      ))}
    </div>
  );
}
