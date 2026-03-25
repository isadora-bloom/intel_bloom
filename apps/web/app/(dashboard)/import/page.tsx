"use client";

import { trpc } from "@/lib/trpc/client";
import { useState, useCallback, useRef } from "react";
import { UploadCloud, FileText, CheckCircle2, AlertCircle, ChevronDown, ArrowRight, ExternalLink, Loader2 } from "lucide-react";
import Link from "next/link";
import { parse } from "csv-parse/browser/esm/sync";

// ── Types ────────────────────────────────────────────────────────────────────

interface ParsedRow {
  [key: string]: string;
}

interface ColumnMapping {
  name: string;
  partner: string;
  email: string;
  phone: string;
  event_date: string;
  revenue: string;
  source: string;
  status: string;
  guest_count: string;
  package: string;
  inquiry_date: string;
}

const FIELD_LABELS: Record<keyof ColumnMapping, string> = {
  name:         "Primary contact name",
  partner:      "Partner name",
  email:        "Email",
  phone:        "Phone",
  event_date:   "Wedding / event date",
  revenue:      "Revenue / invoice total",
  source:       "How they found you",
  status:       "Status",
  guest_count:  "Guest count",
  package:      "Package / service",
  inquiry_date: "Inquiry / created date",
};

const HONEYBOOK_HINTS: Partial<Record<keyof ColumnMapping, string>> = {
  name:         "HoneyBook: \"Client Name\"",
  event_date:   "HoneyBook: \"Project Date\"",
  revenue:      "HoneyBook: \"Invoice Total\"",
  status:       "HoneyBook: \"Stage\"",
  inquiry_date: "HoneyBook: \"Created Date\"",
  package:      "HoneyBook: \"Package\"",
};

// Fields shown in the compact first column vs expanded second column
const PRIMARY_FIELDS: (keyof ColumnMapping)[] = ["name", "email", "event_date", "revenue", "source", "status"];
const SECONDARY_FIELDS: (keyof ColumnMapping)[] = ["partner", "phone", "guest_count", "package", "inquiry_date"];

// ── Helpers ──────────────────────────────────────────────────────────────────

function autoDetectMapping(headers: string[]): ColumnMapping {
  const lower = headers.map((h) => h.toLowerCase().trim());

  function find(candidates: string[]): string {
    for (const c of candidates) {
      const idx = lower.findIndex((h) => h.includes(c));
      if (idx >= 0) return headers[idx];
    }
    return "__none__";
  }

  return {
    name:         find(["client name", "contact name", "name", "couple"]),
    partner:      find(["partner", "secondary contact", "spouse"]),
    email:        find(["email", "e-mail"]),
    phone:        find(["phone", "mobile", "cell"]),
    event_date:   find(["project date", "event date", "wedding date", "date of event", "date"]),
    revenue:      find(["invoice total", "contract total", "revenue", "total", "amount", "price"]),
    source:       find(["lead source", "source", "referral", "how did you hear", "how did they find"]),
    status:       find(["stage", "status", "pipeline stage"]),
    guest_count:  find(["guest count", "guests", "guest #", "number of guests", "headcount"]),
    package:      find(["package", "service", "product"]),
    inquiry_date: find(["created date", "created at", "inquiry date", "lead date", "submitted"]),
  };
}

function parseCurrencyToCents(val: string): number | undefined {
  if (!val) return undefined;
  const cleaned = val.replace(/[$,\s]/g, "");
  const num = parseFloat(cleaned);
  if (isNaN(num)) return undefined;
  return Math.round(num * 100);
}

function parseEventDate(val: string): string | undefined {
  if (!val) return undefined;
  const trimmed = val.trim();

  // Excel serial number (e.g. 45923, 46291) — 5-digit numbers in range 40000–60000
  const serial = Number(trimmed);
  if (!isNaN(serial) && serial > 40000 && serial < 70000) {
    const d = new Date((serial - 25569) * 86400 * 1000);
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  }

  // "August 21st", "October 3rd", etc. — convert to parseable
  const monthWord = trimmed.replace(/(\d+)(st|nd|rd|th)/i, "$1");
  const d = new Date(monthWord);
  if (!isNaN(d.getTime()) && d.getFullYear() > 2000) return d.toISOString().split("T")[0];

  return undefined;
}

function parseGuestCount(val: string): number | undefined {
  if (!val) return undefined;
  // Range like "51-100", "51 - 100", "176–200" (en/em dash) → take midpoint
  const rangeMatch = val.match(/(\d+)\s*[-–—]\s*(\d+)/);
  if (rangeMatch) {
    const lo = parseInt(rangeMatch[1], 10);
    const hi = parseInt(rangeMatch[2], 10);
    return Math.round((lo + hi) / 2);
  }
  // "about 80", "~75"
  const approx = val.match(/\d+/);
  return approx ? parseInt(approx[0], 10) : undefined;
}

function mapHbStatus(raw: string): "inquiry" | "tour_booked" | "booked" | "planning" | "event_complete" | "archived" {
  const s = raw.toLowerCase().trim();
  // Boolean tour-booked columns (Yes/No/TRUE/FALSE)
  if (s === "yes" || s === "true") return "tour_booked";
  if (s === "no" || s === "false") return "archived";
  // Named statuses
  if (s.includes("lead") || s.includes("inquiry") || s.includes("new")) return "inquiry";
  if (s.includes("tour")) return "tour_booked";
  if (s.includes("active") || s.includes("book") || s.includes("contract")) return "booked";
  if (s.includes("plan")) return "planning";
  if (s.includes("complet") || s.includes("done") || s.includes("past")) return "event_complete";
  if (s.includes("archive") || s.includes("cancel") || s.includes("lost")) return "archived";
  return "inquiry";
}

// ── Column mapping select ────────────────────────────────────────────────────

function ColumnSelect({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-700">{label}</label>
      {hint && <p className="text-[11px] text-gray-400">{hint}</p>}
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 pr-8 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        >
          <option value="__none__">— skip —</option>
          {options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
        <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function ImportPage() {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({
    name: "__none__", partner: "__none__", email: "__none__", phone: "__none__",
    event_date: "__none__", revenue: "__none__", source: "__none__", status: "__none__",
    guest_count: "__none__", package: "__none__", inquiry_date: "__none__",
  });
  const [showSecondary, setShowSecondary] = useState(false);
  const [mergeCouplePairs, setMergeCouplePairs] = useState(true);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; updated: number; created: number } | null>(null);
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Directory activity import state ───────────────────────────────────────
  const [knotDragOver, setKnotDragOver] = useState(false);
  const [knotFileName, setKnotFileName] = useState<string | null>(null);
  const [knotFileText, setKnotFileText] = useState<string | null>(null);
  const [knotPlatform, setKnotPlatform] = useState<"the_knot" | "wedding_wire">("the_knot");
  const [knotPreview, setKnotPreview] = useState<{
    summary: { totalProfileViews: number; totalProfileSaves: number; totalWebsiteClickthroughs: number; totalInquiries: number; namedProfileViews: number; namedProfileSaves: number; namedWebsiteClickthroughs: number; namedInquiries: number; totalAnonymous: number; matchableRecords: number };
    sampleRecords: Array<{ date: string; name: string; signalType: string; platform: string }>;
    totalRecords: number;
    namedRecords: number;
  } | null>(null);
  const [knotResult, setKnotResult] = useState<{ inserted: number; skipped: number; totalNamedRecords: number } | null>(null);

  const previewKnotImport = trpc.touchpoints.previewKnotImport.useMutation({
    onSuccess: (data) => setKnotPreview(data),
  });
  const importKnotActivity = trpc.touchpoints.importKnotActivity.useMutation({
    onSuccess: (data) => setKnotResult(data),
  });

  const upsertMutation = trpc.clients.upsertFromImport.useMutation();
  const aiMapMutation = trpc.insights.mapCsvColumns.useMutation();
  const [aiNotes, setAiNotes] = useState<string | null>(null);
  const utils = trpc.useUtils();

  function handleFile(file: File) {
    if (!file.name.endsWith(".csv")) { alert("Please upload a CSV file."); return; }
    setFileName(file.name);
    setResult(null);
    setProgress(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      try {
        const parsed: ParsedRow[] = parse(text, { columns: true, skip_empty_lines: true, trim: true });
        if (parsed.length === 0) return;
        const h = Object.keys(parsed[0]);
        setHeaders(h);
        setRows(parsed);
        const detected = autoDetectMapping(h);
        setMapping(detected);
        // Show secondary fields if any were auto-detected
        if (SECONDARY_FIELDS.some((f) => detected[f] !== "__none__")) setShowSecondary(true);
      } catch {
        alert("Could not parse CSV. Please check the file format.");
      }
    };
    reader.readAsText(file);
  }

  async function handleAiMap() {
    if (!headers.length || !rows.length) return;
    setAiNotes(null);
    const sampleRows = rows.slice(0, 6).map((r) => headers.map((h) => r[h] ?? ""));
    const result = await aiMapMutation.mutateAsync({ headers, sampleRows });
    // Apply mapping — only override fields that are currently __none__ or where AI found something
    const m = result.mapping;
    setMapping((prev) => {
      const next = { ...prev };
      for (const [field, col] of Object.entries(m)) {
        if (col && headers.includes(col)) {
          next[field as keyof ColumnMapping] = col;
        }
      }
      return next;
    });
    const notes = [result.notes, result.statusDerivation].filter(Boolean).join(" • ");
    if (notes) setAiNotes(notes);
    setShowSecondary(true);
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, []);

  // ── Knot/WW directory import handlers ────────────────────────────────────
  function handleKnotFile(file: File) {
    if (!file.name.endsWith(".csv") && !file.name.endsWith(".txt")) {
      alert("Please upload a .csv or .txt file.");
      return;
    }
    setKnotFileName(file.name);
    setKnotPreview(null);
    setKnotResult(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setKnotFileText(text);
      previewKnotImport.mutate({ csvText: text });
    };
    reader.readAsText(file);
  }

  const onKnotDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setKnotDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleKnotFile(file);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [knotPlatform]);

  function updateMapping(field: keyof ColumnMapping, value: string) {
    setMapping((prev) => ({ ...prev, [field]: value }));
  }

  function buildRecords(): Array<Parameters<typeof upsertMutation.mutateAsync>[0]> {
    const get = (row: ParsedRow, field: keyof ColumnMapping) =>
      mapping[field] !== "__none__" ? row[mapping[field]]?.trim() || undefined : undefined;

    if (mergeCouplePairs && mapping.event_date !== "__none__") {
      // Group rows by event date — pairs on the same date = one couple
      const byDate = new Map<string, ParsedRow[]>();
      const noDate: ParsedRow[] = [];

      for (const row of rows) {
        const dateKey = parseEventDate(row[mapping.event_date] ?? "");
        if (dateKey) {
          if (!byDate.has(dateKey)) byDate.set(dateKey, []);
          byDate.get(dateKey)!.push(row);
        } else {
          noDate.push(row);
        }
      }

      const records: Array<Parameters<typeof upsertMutation.mutateAsync>[0]> = [];

      for (const [dateKey, group] of byDate) {
        const primary = group[0];
        const partner = group.length === 2 ? group[1] : undefined;

        const rawStatus = get(primary, "status") ?? "";
        records.push({
          namePrimary:        get(primary, "name") ?? "Unknown",
          namePartner:        partner ? get(partner, "name") : get(primary, "partner"),
          emailPrimary:       get(primary, "email"),
          emailPartner:       partner ? get(partner, "email") : undefined,
          phonePrimary:       get(primary, "phone"),
          eventDate:          dateKey,
          revenueCents:       parseCurrencyToCents(primary[mapping.revenue] ?? ""),
          selfReportedSource: get(primary, "source"),
          guestCountInitial:  parseGuestCount(primary[mapping.guest_count] ?? ""),
          package:            get(primary, "package"),
          inquiryDate:        parseEventDate(primary[mapping.inquiry_date] ?? ""),
          status:             rawStatus ? mapHbStatus(rawStatus) : "inquiry",
        });

        // 3+ rows on same date: import extras individually
        for (let i = 2; i < group.length; i++) {
          const row = group[i];
          const rs = get(row, "status") ?? "";
          records.push({
            namePrimary:        get(row, "name") ?? "Unknown",
            emailPrimary:       get(row, "email"),
            phonePrimary:       get(row, "phone"),
            eventDate:          dateKey,
            revenueCents:       parseCurrencyToCents(row[mapping.revenue] ?? ""),
            selfReportedSource: get(row, "source"),
            guestCountInitial:  parseGuestCount(row[mapping.guest_count] ?? ""),
            package:            get(row, "package"),
            inquiryDate:        parseEventDate(row[mapping.inquiry_date] ?? ""),
            status:             rs ? mapHbStatus(rs) : "inquiry",
          });
        }
      }

      // Rows with no event date — import individually
      for (const row of noDate) {
        const rs = get(row, "status") ?? "";
        const name = get(row, "name");
        if (!name) continue;
        records.push({
          namePrimary:        name,
          namePartner:        get(row, "partner"),
          emailPrimary:       get(row, "email"),
          phonePrimary:       get(row, "phone"),
          revenueCents:       parseCurrencyToCents(row[mapping.revenue] ?? ""),
          selfReportedSource: get(row, "source"),
          guestCountInitial:  parseGuestCount(row[mapping.guest_count] ?? ""),
          package:            get(row, "package"),
          inquiryDate:        parseEventDate(row[mapping.inquiry_date] ?? ""),
          status:             rs ? mapHbStatus(rs) : "inquiry",
        });
      }

      return records;
    }

    // No couple merging — one record per row
    return rows
      .map((row) => {
        const name = get(row, "name");
        if (!name) return null;
        const rs = get(row, "status") ?? "";
        return {
          namePrimary:        name,
          namePartner:        get(row, "partner"),
          emailPrimary:       get(row, "email"),
          phonePrimary:       get(row, "phone"),
          eventDate:          parseEventDate(row[mapping.event_date] ?? ""),
          revenueCents:       parseCurrencyToCents(row[mapping.revenue] ?? ""),
          selfReportedSource: get(row, "source"),
          guestCountInitial:  parseGuestCount(row[mapping.guest_count] ?? ""),
          package:            get(row, "package"),
          inquiryDate:        parseEventDate(row[mapping.inquiry_date] ?? ""),
          status:             rs ? mapHbStatus(rs) : "inquiry",
        } as Parameters<typeof upsertMutation.mutateAsync>[0];
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
  }

  async function handleImport() {
    if (!rows.length) return;
    setImporting(true);

    const records = buildRecords();
    setProgress({ done: 0, total: records.length, created: 0, updated: 0 });

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (let i = 0; i < records.length; i++) {
      try {
        const res = await upsertMutation.mutateAsync(records[i]);
        if (res.action === "created") created++; else updated++;
      } catch {
        skipped++;
      }
      setProgress({ done: i + 1, total: records.length, created, updated });
    }

    setResult({ created, updated, skipped });
    setImporting(false);
    utils.clients.list.invalidate();
  }

  const previewRows = rows.slice(0, 3);

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Import client history</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Upload a CSV export from HoneyBook or any other spreadsheet. Re-importing the same file is safe — existing clients are updated, not duplicated.
        </p>
      </div>

      {/* HoneyBook export instructions */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800 space-y-1">
        <p className="font-medium">Exporting from HoneyBook</p>
        <p className="text-blue-700 text-xs">
          Go to <span className="font-medium">Reports → Projects report → Export CSV</span>.
          This exports all your projects with client name, email, project date, stage, invoice total, and lead source.
          All columns are auto-detected on upload.
        </p>
        <a
          href="https://intercom.help/honeybook/en/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline mt-1"
        >
          HoneyBook help centre <ExternalLink size={11} />
        </a>
      </div>

      {/* Section 1 — Upload */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">1. Upload your file</h2>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
            dragOver ? "border-blue-400 bg-blue-50"
            : fileName ? "border-green-300 bg-green-50"
            : "border-gray-200 hover:border-gray-400 hover:bg-gray-50"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
          {fileName ? (
            <div className="flex flex-col items-center gap-2">
              <FileText size={28} className="text-green-500" />
              <p className="text-sm font-medium text-gray-900">{fileName}</p>
              <p className="text-xs text-gray-500">{rows.length} rows detected — click to replace</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <UploadCloud size={28} className="text-gray-300" />
              <p className="text-sm font-medium text-gray-700">Drag & drop your CSV here</p>
              <p className="text-xs text-gray-400">or click to browse — CSV only</p>
            </div>
          )}
        </div>
      </div>

      {/* Section 2 — Column mapping */}
      {rows.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-900 mb-1">2. Map your columns</h2>
              <p className="text-xs text-gray-500">
                Auto-detected from your column names. Adjust if needed — or let AI figure it out.
              </p>
            </div>
            <button
              onClick={handleAiMap}
              disabled={aiMapMutation.isPending}
              className="flex-shrink-0 flex items-center gap-1.5 text-sm bg-violet-600 text-white px-3 py-1.5 rounded font-medium hover:bg-violet-700 transition-colors disabled:opacity-50"
            >
              {aiMapMutation.isPending ? (
                <><Loader2 size={13} className="animate-spin" /> Mapping…</>
              ) : (
                "✦ AI Map"
              )}
            </button>
          </div>

          {aiNotes && (
            <div className="text-xs text-violet-800 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2 mb-4">
              {aiNotes}
            </div>
          )}

          {/* Primary fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            {PRIMARY_FIELDS.map((field) => (
              <ColumnSelect
                key={field}
                label={FIELD_LABELS[field]}
                hint={HONEYBOOK_HINTS[field]}
                value={mapping[field]}
                options={headers}
                onChange={(v) => updateMapping(field, v)}
              />
            ))}
          </div>

          {/* Secondary fields toggle */}
          <button
            onClick={() => setShowSecondary((v) => !v)}
            className="text-xs text-blue-600 hover:underline mb-4"
          >
            {showSecondary ? "Hide" : "Show"} additional fields (partner, phone, guest count, package)
          </button>

          {showSecondary && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              {SECONDARY_FIELDS.map((field) => (
                <ColumnSelect
                  key={field}
                  label={FIELD_LABELS[field]}
                  hint={HONEYBOOK_HINTS[field]}
                  value={mapping[field]}
                  options={headers}
                  onChange={(v) => updateMapping(field, v)}
                />
              ))}
            </div>
          )}

          {/* Preview table */}
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Preview (first 3 rows)</p>
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="text-xs w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    {headers.map((h) => (
                      <th key={h} className="text-left px-3 py-2 font-medium text-gray-500 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {previewRows.map((row, i) => (
                    <tr key={i}>
                      {headers.map((h) => (
                        <td key={h} className="px-3 py-1.5 text-gray-700 whitespace-nowrap max-w-[160px] truncate">
                          {row[h] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Section 3 — Import */}
      {rows.length > 0 && !result && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-900">3. Import</h2>

          {/* Couple pairing toggle */}
          {mapping.event_date !== "__none__" && (() => {
            // Count how many dates have exactly 2 rows
            const dateCounts = new Map<string, number>();
            for (const row of rows) {
              const d = parseEventDate(row[mapping.event_date] ?? "");
              if (d) dateCounts.set(d, (dateCounts.get(d) ?? 0) + 1);
            }
            const pairCount = [...dateCounts.values()].filter(n => n === 2).length;
            if (pairCount === 0) return null;
            const recordCount = buildRecords().length;
            return (
              <div className="flex items-start gap-3 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
                <input
                  type="checkbox"
                  id="mergeCouple"
                  checked={mergeCouplePairs}
                  onChange={(e) => setMergeCouplePairs(e.target.checked)}
                  className="mt-0.5"
                />
                <label htmlFor="mergeCouple" className="text-sm text-amber-800 cursor-pointer">
                  <span className="font-medium">Merge couple pairs</span> — {pairCount} date{pairCount !== 1 ? "s" : ""} have exactly 2 rows.
                  Merging combines them into one client record (primary + partner) so revenue isn't doubled.
                  {mergeCouplePairs && (
                    <span className="block text-xs text-amber-600 mt-0.5">
                      {rows.length} rows → {recordCount} client records after merging.
                    </span>
                  )}
                </label>
              </div>
            );
          })()}

          {progress ? (
            <div className="space-y-3">
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all"
                  style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                />
              </div>
              <p className="text-sm text-gray-600">
                {progress.done} of {progress.total} — {progress.created} new, {progress.updated} updated
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <button
                onClick={handleImport}
                disabled={importing}
                className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                Import {buildRecords().length} client record{buildRecords().length !== 1 ? "s" : ""}
              </button>
              <p className="text-xs text-gray-400">
                Matched by email or event date first — existing records are updated, not duplicated.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <div className="flex items-start gap-3 mb-4">
            <CheckCircle2 size={20} className="text-green-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-gray-900">Import complete</p>
              <p className="text-sm text-gray-600 mt-0.5">
                {result.created} new client{result.created !== 1 ? "s" : ""} created
                {result.updated > 0 && `, ${result.updated} updated`}.
                {result.skipped > 0 && (
                  <span className="text-gray-400"> {result.skipped} skipped (missing name).</span>
                )}
              </p>
            </div>
          </div>
          {result.skipped > 0 && (
            <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
              <AlertCircle size={13} />
              Skipped rows were missing a client name or had an error.
            </div>
          )}
          <div className="flex flex-wrap items-center gap-4">
            <Link
              href="/clients"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              View your clients <ArrowRight size={14} />
            </Link>
            <Link
              href="/settings#calibration"
              className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
            >
              Score weather data in Settings →
            </Link>
          </div>
        </div>
      )}

      {/* ── DIRECTORY ACTIVITY (Knot / WW) ── */}
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Directory activity</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Import profile views, saves, and website clicks from The Knot or WeddingWire.
            This lets Bloom match pre-inquiry engagement to your actual bookings — and hold platforms accountable for real cost-per-booking.
          </p>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 space-y-1">
          <p className="font-medium">No official API — yet</p>
          <p className="text-amber-700 text-xs">
            The Knot and WeddingWire don't provide official data APIs. Export your Storefront Activity report manually
            and import it here. Every import builds the dataset that makes the case for demanding API access.
            You can import as many months as you have — duplicates are automatically skipped.
          </p>
        </div>

        {/* Platform toggle */}
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600 font-medium">Platform:</span>
          {(["the_knot", "wedding_wire"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setKnotPlatform(p)}
              className={`text-sm px-3 py-1.5 rounded border transition-colors ${
                knotPlatform === p
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
              }`}
            >
              {p === "the_knot" ? "The Knot" : "WeddingWire"}
            </button>
          ))}
        </div>

        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setKnotDragOver(true); }}
          onDragLeave={() => setKnotDragOver(false)}
          onDrop={onKnotDrop}
          onClick={() => document.getElementById("knot-file-input")?.click()}
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
            knotDragOver ? "border-blue-400 bg-blue-50" : "border-gray-300 hover:border-gray-400"
          }`}
        >
          <UploadCloud size={24} className="mx-auto text-gray-400 mb-2" />
          {knotFileName ? (
            <p className="text-sm font-medium text-gray-700">{knotFileName}</p>
          ) : (
            <>
              <p className="text-sm text-gray-600">Drop your Storefront Activity export here</p>
              <p className="text-xs text-gray-400 mt-1">Accepts .csv or .txt</p>
            </>
          )}
        </div>
        <input
          id="knot-file-input"
          type="file"
          accept=".csv,.txt"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleKnotFile(f); e.target.value = ""; }}
        />

        {/* Preview */}
        {previewKnotImport.isPending && (
          <p className="text-sm text-gray-400">Parsing file…</p>
        )}
        {knotPreview && (
          <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
            <p className="text-sm font-semibold text-gray-800">Preview</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="bg-gray-50 rounded p-3">
                <p className="text-gray-500">Total records</p>
                <p className="text-xl font-bold text-gray-900 mt-0.5">{knotPreview.totalRecords}</p>
              </div>
              <div className="bg-gray-50 rounded p-3">
                <p className="text-gray-500">Named (matchable)</p>
                <p className="text-xl font-bold text-gray-900 mt-0.5">{knotPreview.namedRecords}</p>
              </div>
              <div className="bg-gray-50 rounded p-3">
                <p className="text-gray-500">Profile views</p>
                <p className="text-xl font-bold text-gray-900 mt-0.5">{knotPreview.summary.totalProfileViews}</p>
              </div>
              <div className="bg-gray-50 rounded p-3">
                <p className="text-gray-500">Saves / clicks</p>
                <p className="text-xl font-bold text-gray-900 mt-0.5">{(knotPreview.summary.totalProfileSaves ?? 0) + (knotPreview.summary.totalWebsiteClickthroughs ?? 0)}</p>
              </div>
            </div>
            {knotPreview.sampleRecords.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">Sample names</p>
                <div className="flex flex-wrap gap-1">
                  {knotPreview.sampleRecords.map((r, i) => (
                    <span key={i} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full border border-blue-100">
                      {r.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <button
              onClick={() => knotFileText && importKnotActivity.mutate({ csvText: knotFileText, platform: knotPlatform })}
              disabled={importKnotActivity.isPending || !knotFileText}
              className="flex items-center gap-2 bg-blue-600 text-white px-5 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {importKnotActivity.isPending ? "Importing…" : `Import ${knotPreview.namedRecords} signals`}
            </button>
          </div>
        )}

        {/* Result */}
        {knotResult && (
          <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
            <CheckCircle2 size={16} />
            <span>
              Imported <strong>{knotResult.inserted}</strong> new signal{knotResult.inserted !== 1 ? "s" : ""}.{" "}
              {knotResult.skipped > 0 && <>{knotResult.skipped} already existed and were skipped.</>}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
