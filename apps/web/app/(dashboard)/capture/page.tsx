"use client";

import { useState, useCallback, useRef } from "react";
import { trpc } from "@/lib/trpc/client";
import type { ClassifyResult, CaptureRow, CaptureAnomaly } from "@/server/api/routers/capture";
import {
  Upload,
  FileText,
  Image,
  X,
  CheckCircle,
  AlertTriangle,
  AlertCircle,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Loader2,
  ScanLine,
  SkipForward,
  CheckCheck,
} from "lucide-react";

// ── TYPES ──────────────────────────────────────────────────────────────────────

interface FileEntry {
  id: string;
  file: File;
  status: "pending" | "processing" | "done" | "error";
  result?: ClassifyResult;
  errorMsg?: string;
  // row-level state
  skipped: Set<string>; // row ids to skip
  anomalyAnswers: Record<string, string>; // anomalyId -> answer
  expanded: Set<string>; // row ids with expanded fields
}

// ── HELPERS ────────────────────────────────────────────────────────────────────

function fileId() {
  return Math.random().toString(36).slice(2, 8);
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // strip data:mime;base64,
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function isImage(file: File) {
  return file.type.startsWith("image/");
}

function isCSV(file: File) {
  return file.type === "text/csv" || file.name.endsWith(".csv");
}

function severityIcon(severity: CaptureAnomaly["severity"]) {
  if (severity === "error") return <AlertCircle size={13} className="text-red-500 flex-shrink-0" />;
  if (severity === "warning") return <AlertTriangle size={13} className="text-amber-500 flex-shrink-0" />;
  return <HelpCircle size={13} className="text-blue-400 flex-shrink-0" />;
}

function statusBadge(fileType: string, confidence: string) {
  const colors =
    confidence === "high"
      ? "bg-green-50 text-green-700 border-green-200"
      : confidence === "medium"
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : "bg-gray-100 text-gray-500 border-gray-200";
  return (
    <span className={`text-xs border rounded-full px-2 py-0.5 ${colors}`}>{fileType}</span>
  );
}

// ── ANOMALY CARD ───────────────────────────────────────────────────────────────

function AnomalyCard({
  anomaly,
  answer,
  onAnswer,
}: {
  anomaly: CaptureAnomaly;
  answer?: string;
  onAnswer: (id: string, answer: string) => void;
}) {
  return (
    <div
      className={`rounded-md border px-3 py-2.5 text-xs flex gap-2 items-start ${
        anomaly.severity === "error"
          ? "bg-red-50 border-red-200"
          : anomaly.severity === "warning"
          ? "bg-amber-50 border-amber-200"
          : "bg-blue-50 border-blue-200"
      }`}
    >
      {severityIcon(anomaly.severity)}
      <div className="flex-1">
        <p className="text-gray-700 leading-snug">{anomaly.message}</p>
        {anomaly.suggestion && (
          <p className="text-gray-400 mt-0.5">{anomaly.suggestion}</p>
        )}
        {anomaly.requiresAnswer && (
          <div className="flex gap-1.5 mt-2">
            {["yes", "no", "skip"].map((opt) => (
              <button
                key={opt}
                onClick={() => onAnswer(anomaly.id, opt)}
                className={`px-2.5 py-0.5 rounded border text-xs capitalize transition-colors ${
                  answer === opt
                    ? "bg-gray-800 text-white border-gray-800"
                    : "bg-white text-gray-600 border-gray-300 hover:border-gray-500"
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── ROW CARD ──────────────────────────────────────────────────────────────────

function RowCard({
  row,
  skipped,
  anomalyAnswers,
  expanded,
  onToggleSkip,
  onAnswer,
  onToggleExpand,
}: {
  row: CaptureRow;
  skipped: boolean;
  anomalyAnswers: Record<string, string>;
  expanded: boolean;
  onToggleSkip: () => void;
  onAnswer: (anomalyId: string, answer: string) => void;
  onToggleExpand: () => void;
}) {
  const isMetric = row.type === "metric";
  const primaryName = isMetric
    ? (row.mapped.metric_name ?? "Metric")
    : (row.mapped.name_primary ?? row.mapped.vendor_name ?? "Unknown");
  const eventDate = row.mapped.event_date;
  const metricValue = row.mapped.metric_value;
  const metricPlatform = row.mapped.metric_platform;
  const metricPeriod = row.mapped.metric_period;
  const hasBlockers = row.anomalies.some(
    (a) => (a.severity === "error" || a.requiresAnswer) && !anomalyAnswers[a.id]
  );
  const shownFields = Object.entries(row.mapped).filter(
    ([k, v]) => v && !["raw_message", "review_text", "metric_breakdown", "metric_name", "metric_value", "metric_platform", "metric_period", "metric_comparison"].includes(k)
  );

  return (
    <div
      className={`rounded-lg border transition-all ${
        skipped
          ? "opacity-40 border-gray-200 bg-gray-50"
          : hasBlockers
          ? "border-amber-200 bg-white"
          : "border-gray-200 bg-white"
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{primaryName}</p>
          <p className="text-xs text-gray-400">
            <span className="capitalize">{row.type}</span>
            {isMetric && metricValue ? <span className="text-gray-700 font-medium"> · {metricValue}</span> : null}
            {isMetric && metricPlatform ? ` · ${metricPlatform}` : null}
            {isMetric && metricPeriod ? ` · ${metricPeriod}` : null}
            {!isMetric && eventDate ? ` · ${eventDate}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {row.anomalies.length > 0 && !skipped && (
            <span
              className={`text-xs px-2 py-0.5 rounded-full border ${
                hasBlockers
                  ? "bg-amber-50 text-amber-700 border-amber-200"
                  : "bg-green-50 text-green-700 border-green-200"
              }`}
            >
              {row.anomalies.length} {row.anomalies.length === 1 ? "flag" : "flags"}
            </span>
          )}
          <button
            onClick={onToggleExpand}
            className="text-gray-400 hover:text-gray-600"
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <button
            onClick={onToggleSkip}
            title={skipped ? "Include" : "Skip"}
            className={`text-xs px-2 py-1 rounded border transition-colors ${
              skipped
                ? "bg-gray-200 text-gray-500 border-gray-300 hover:bg-gray-300"
                : "bg-white text-gray-400 border-gray-200 hover:border-red-300 hover:text-red-500"
            }`}
          >
            {skipped ? "Include" : "Skip"}
          </button>
        </div>
      </div>

      {/* Expanded: fields + anomalies */}
      {expanded && !skipped && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-3">
          {/* Metric fields */}
          {isMetric && (
            <div className="space-y-1.5">
              {[
                ["Metric", row.mapped.metric_name],
                ["Value", row.mapped.metric_value],
                ["Platform", row.mapped.metric_platform],
                ["Period", row.mapped.metric_period],
                ["vs Prior", row.mapped.metric_comparison],
              ].filter(([, v]) => v).map(([label, val]) => (
                <div key={label} className="flex gap-3">
                  <p className="text-xs text-gray-400 w-16 flex-shrink-0">{label}</p>
                  <p className="text-xs text-gray-800">{val}</p>
                </div>
              ))}
              {row.mapped.metric_breakdown && (() => {
                try {
                  const pts = JSON.parse(row.mapped.metric_breakdown);
                  if (Array.isArray(pts)) {
                    return (
                      <div>
                        <p className="text-xs text-gray-400 mb-1">Breakdown</p>
                        <div className="flex flex-wrap gap-1.5">
                          {pts.map((pt: any, i: number) => (
                            <span key={i} className="text-xs bg-gray-100 rounded px-2 py-0.5">
                              {pt.label}: <span className="font-medium">{pt.value}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  }
                } catch {}
                return <p className="text-xs text-gray-600">{row.mapped.metric_breakdown}</p>;
              })()}
            </div>
          )}
          {/* Extracted fields (non-metric) */}
          {!isMetric && shownFields.length > 0 && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {shownFields.map(([key, val]) => (
                <div key={key}>
                  <p className="text-xs text-gray-400 capitalize">{key.replace(/_/g, " ")}</p>
                  <p className="text-xs text-gray-800 truncate">{val}</p>
                </div>
              ))}
            </div>
          )}
          {/* Long text fields */}
          {(row.mapped.raw_message || row.mapped.review_text) && (
            <div>
              <p className="text-xs text-gray-400 mb-1">
                {row.mapped.raw_message ? "Message" : "Review"}
              </p>
              <p className="text-xs text-gray-600 leading-relaxed line-clamp-4">
                {row.mapped.raw_message ?? row.mapped.review_text}
              </p>
            </div>
          )}
          {/* Anomalies */}
          {row.anomalies.length > 0 && (
            <div className="space-y-2">
              {row.anomalies.map((a) => (
                <AnomalyCard
                  key={a.id}
                  anomaly={a}
                  answer={anomalyAnswers[a.id]}
                  onAnswer={onAnswer}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── FILE RESULT SECTION ───────────────────────────────────────────────────────

function FileResultSection({
  entry,
  onToggleSkip,
  onAnswer,
  onToggleExpand,
  onRemove,
}: {
  entry: FileEntry;
  onToggleSkip: (fileId: string, rowId: string) => void;
  onAnswer: (fileId: string, rowId: string, anomalyId: string, answer: string) => void;
  onToggleExpand: (fileId: string, rowId: string) => void;
  onRemove: (fileId: string) => void;
}) {
  const result = entry.result;
  const isImg = isImage(entry.file);

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      {/* File header */}
      <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-100">
        <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400">
          {isImg ? <Image size={15} /> : <FileText size={15} />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{entry.file.name}</p>
          {entry.status === "processing" && (
            <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
              <Loader2 size={11} className="animate-spin" /> Analysing…
            </p>
          )}
          {entry.status === "done" && result && (
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {statusBadge(result.fileTypeLabel, result.confidence)}
              <p className="text-xs text-gray-500">{result.summary}</p>
            </div>
          )}
          {entry.status === "error" && (
            <p className="text-xs text-red-600 mt-0.5">{entry.errorMsg}</p>
          )}
        </div>
        <button
          onClick={() => onRemove(entry.id)}
          className="text-gray-300 hover:text-gray-500 flex-shrink-0"
        >
          <X size={14} />
        </button>
      </div>

      {/* Rows */}
      {entry.status === "done" && result && result.rows.length > 0 && (
        <div className="px-5 py-4 space-y-2">
          {result.rows.map((row) => (
            <RowCard
              key={row.id}
              row={row}
              skipped={entry.skipped.has(row.id)}
              anomalyAnswers={entry.anomalyAnswers}
              expanded={entry.expanded.has(row.id)}
              onToggleSkip={() => onToggleSkip(entry.id, row.id)}
              onAnswer={(aId, ans) => onAnswer(entry.id, row.id, aId, ans)}
              onToggleExpand={() => onToggleExpand(entry.id, row.id)}
            />
          ))}
        </div>
      )}

      {entry.status === "done" && result && result.rows.length === 0 && (
        <p className="px-5 py-4 text-sm text-gray-400">No records extracted from this file.</p>
      )}
    </div>
  );
}

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────

export default function CapturePage() {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ inserted: number; skipped: number; errors: string[] } | null>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const classifyImageMutation = trpc.capture.classifyImage.useMutation();
  const classifyCSVMutation = trpc.capture.classifyCSV.useMutation();
  const commitMutation = trpc.capture.commit.useMutation();

  // ── Process a dropped/selected file ────────────────────────────────────────
  const processFile = useCallback(
    async (file: File) => {
      if (!isImage(file) && !isCSV(file)) return;

      const id = fileId();
      const entry: FileEntry = {
        id,
        file,
        status: "processing",
        skipped: new Set(),
        anomalyAnswers: {},
        expanded: new Set(),
      };

      setFiles((prev) => [...prev, entry]);

      try {
        let result: ClassifyResult;

        if (isImage(file)) {
          const base64 = await readFileAsBase64(file);
          const mimeType = file.type as "image/png" | "image/jpeg" | "image/webp" | "image/gif";
          result = await classifyImageMutation.mutateAsync({ base64, mimeType });
        } else {
          const content = await readFileAsText(file);
          result = await classifyCSVMutation.mutateAsync({ content, fileName: file.name });
        }

        // Auto-expand rows that have anomalies requiring answers
        const autoExpanded = new Set<string>(
          result.rows
            .filter((r) => r.anomalies.some((a) => a.requiresAnswer))
            .map((r) => r.id)
        );

        setFiles((prev) =>
          prev.map((e) =>
            e.id === id ? { ...e, status: "done", result, expanded: autoExpanded } : e
          )
        );
      } catch (err: any) {
        setFiles((prev) =>
          prev.map((e) =>
            e.id === id
              ? { ...e, status: "error", errorMsg: err.message ?? "Classification failed" }
              : e
          )
        );
      }
    },
    [classifyImageMutation, classifyCSVMutation]
  );

  // ── Drag-and-drop ──────────────────────────────────────────────────────────
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const onDragLeave = () => setIsDragging(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    Array.from(e.dataTransfer.files).forEach(processFile);
  };
  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    Array.from(e.target.files ?? []).forEach(processFile);
    e.target.value = "";
  };

  // ── Row state mutations ────────────────────────────────────────────────────
  function toggleSkip(fileId: string, rowId: string) {
    setFiles((prev) =>
      prev.map((e) => {
        if (e.id !== fileId) return e;
        const skipped = new Set(e.skipped);
        if (skipped.has(rowId)) skipped.delete(rowId);
        else skipped.add(rowId);
        return { ...e, skipped };
      })
    );
  }

  function answerAnomaly(fileId: string, _rowId: string, anomalyId: string, answer: string) {
    setFiles((prev) =>
      prev.map((e) => {
        if (e.id !== fileId) return e;
        return { ...e, anomalyAnswers: { ...e.anomalyAnswers, [anomalyId]: answer } };
      })
    );
  }

  function toggleExpand(fileId: string, rowId: string) {
    setFiles((prev) =>
      prev.map((e) => {
        if (e.id !== fileId) return e;
        const expanded = new Set(e.expanded);
        if (expanded.has(rowId)) expanded.delete(rowId);
        else expanded.add(rowId);
        return { ...e, expanded };
      })
    );
  }

  function removeFile(fileId: string) {
    setFiles((prev) => prev.filter((e) => e.id !== fileId));
  }

  // ── Import ─────────────────────────────────────────────────────────────────
  const totalRows = files.flatMap((e) => e.result?.rows ?? []).length;
  const pendingRows = files.flatMap((e) =>
    (e.result?.rows ?? []).filter((r) => !e.skipped.has(r.id))
  ).length;
  const blockers = files.flatMap((e) =>
    (e.result?.rows ?? []).flatMap((r) =>
      r.anomalies.filter(
        (a) => (a.severity === "error" || a.requiresAnswer) && !e.anomalyAnswers[a.id]
      )
    )
  ).length;

  async function handleImport() {
    setImporting(true);
    setImportResult(null);

    const rows = files.flatMap((e) =>
      (e.result?.rows ?? []).map((row) => ({
        id: row.id,
        type: row.type as "client" | "inquiry" | "vendor" | "review" | "unknown",
        skip: e.skipped.has(row.id),
        mapped: row.mapped,
        anomalyAnswers: e.anomalyAnswers,
      }))
    );

    try {
      const result = await commitMutation.mutateAsync({ rows });
      setImportResult(result);
      // Clear successfully committed files
      setFiles([]);
    } catch (err: any) {
      setImportResult({ inserted: 0, skipped: 0, errors: [err.message ?? "Import failed"] });
    } finally {
      setImporting(false);
    }
  }

  const hasFiles = files.length > 0;
  const processingCount = files.filter((e) => e.status === "processing").length;

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
          <ScanLine size={22} className="text-gray-400" />
          Quick Capture
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Drop screenshots or CSVs. Bloom will figure out what they are and where the data goes.
        </p>
      </div>

      {/* Import success banner */}
      {importResult && (
        <div
          className={`rounded-lg border px-4 py-3 flex items-start gap-3 ${
            importResult.errors.length > 0
              ? "bg-red-50 border-red-200"
              : "bg-green-50 border-green-200"
          }`}
        >
          {importResult.errors.length === 0 ? (
            <CheckCircle size={16} className="text-green-500 flex-shrink-0 mt-0.5" />
          ) : (
            <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
          )}
          <div className="text-sm">
            <p className="font-medium text-gray-900">
              {importResult.inserted} record{importResult.inserted !== 1 ? "s" : ""} imported
              {importResult.skipped > 0 ? `, ${importResult.skipped} skipped` : ""}
            </p>
            {importResult.errors.map((e, i) => (
              <p key={i} className="text-red-600 mt-1">{e}</p>
            ))}
          </div>
          <button
            onClick={() => setImportResult(null)}
            className="ml-auto text-gray-400 hover:text-gray-600"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Drop zone */}
      <div
        ref={dropRef}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
          isDragging
            ? "border-blue-400 bg-blue-50"
            : "border-gray-300 bg-white hover:border-gray-400 hover:bg-gray-50"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.csv"
          multiple
          className="hidden"
          onChange={onFileInput}
        />
        <Upload size={28} className="mx-auto text-gray-300 mb-3" />
        <p className="text-sm font-medium text-gray-700">
          Drop files here or <span className="text-blue-600">browse</span>
        </p>
        <p className="text-xs text-gray-400 mt-1">
          Screenshots (PNG, JPG, WebP) · CSV exports · Multiple files at once
        </p>
        <p className="text-xs text-gray-400 mt-2">
          Works with: The Knot · HoneyBook · Instagram DMs · Email screenshots · Spreadsheets
        </p>
      </div>

      {/* Processing indicator */}
      {processingCount > 0 && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 size={14} className="animate-spin text-blue-500" />
          Analysing {processingCount} file{processingCount !== 1 ? "s" : ""}…
        </div>
      )}

      {/* File results */}
      {hasFiles && (
        <div className="space-y-4">
          {files.map((entry) => (
            <FileResultSection
              key={entry.id}
              entry={entry}
              onToggleSkip={toggleSkip}
              onAnswer={answerAnomaly}
              onToggleExpand={toggleExpand}
              onRemove={removeFile}
            />
          ))}
        </div>
      )}

      {/* Import bar */}
      {totalRows > 0 && processingCount === 0 && (
        <div className="sticky bottom-4 bg-white border border-gray-200 rounded-xl shadow-lg px-5 py-4 flex items-center gap-4">
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-900">
              {pendingRows} record{pendingRows !== 1 ? "s" : ""} ready to import
              {totalRows - pendingRows > 0 && (
                <span className="text-gray-400 font-normal"> · {totalRows - pendingRows} skipped</span>
              )}
            </p>
            {blockers > 0 && (
              <p className="text-xs text-amber-600 flex items-center gap-1 mt-0.5">
                <AlertTriangle size={11} />
                {blockers} question{blockers !== 1 ? "s" : ""} need{blockers === 1 ? "s" : ""} an answer before importing
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFiles([])}
              className="text-sm text-gray-400 hover:text-gray-600 px-3 py-1.5"
            >
              Clear all
            </button>
            <button
              onClick={handleImport}
              disabled={importing || pendingRows === 0 || blockers > 0}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {importing ? (
                <><Loader2 size={14} className="animate-spin" /> Importing…</>
              ) : (
                <><CheckCheck size={14} /> Import {pendingRows} record{pendingRows !== 1 ? "s" : ""}</>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
