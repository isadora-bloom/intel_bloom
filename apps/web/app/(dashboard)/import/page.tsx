"use client";

import { trpc } from "@/lib/trpc/client";
import { useState, useCallback, useRef } from "react";
import { UploadCloud, FileText, CheckCircle2, AlertCircle, ChevronDown, ArrowRight, ExternalLink } from "lucide-react";
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
  const d = new Date(val);
  if (isNaN(d.getTime())) return undefined;
  return d.toISOString().split("T")[0];
}

function parseGuestCount(val: string): number | undefined {
  if (!val) return undefined;
  const n = parseInt(val.replace(/[^0-9]/g, ""), 10);
  return isNaN(n) ? undefined : n;
}

function mapHbStatus(raw: string): "inquiry" | "tour_booked" | "booked" | "planning" | "event_complete" | "archived" {
  const s = raw.toLowerCase().trim();
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
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; updated: number; created: number } | null>(null);
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const upsertMutation = trpc.clients.upsertFromImport.useMutation();
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

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, []);

  function updateMapping(field: keyof ColumnMapping, value: string) {
    setMapping((prev) => ({ ...prev, [field]: value }));
  }

  async function handleImport() {
    if (!rows.length) return;
    setImporting(true);
    setProgress({ done: 0, total: rows.length, created: 0, updated: 0 });

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const namePrimary = mapping.name !== "__none__" ? row[mapping.name]?.trim() : undefined;
      if (!namePrimary) { skipped++; setProgress({ done: i + 1, total: rows.length, created, updated }); continue; }

      const rawStatus = mapping.status !== "__none__" ? row[mapping.status]?.trim() : "";
      const statusMapped = rawStatus ? mapHbStatus(rawStatus) : "inquiry";

      const payload = {
        namePrimary,
        namePartner:      mapping.partner      !== "__none__" ? row[mapping.partner]?.trim()      || undefined : undefined,
        emailPrimary:     mapping.email        !== "__none__" ? row[mapping.email]?.trim()        || undefined : undefined,
        phonePrimary:     mapping.phone        !== "__none__" ? row[mapping.phone]?.trim()        || undefined : undefined,
        eventDate:        mapping.event_date   !== "__none__" ? parseEventDate(row[mapping.event_date])        : undefined,
        revenueCents:     mapping.revenue      !== "__none__" ? parseCurrencyToCents(row[mapping.revenue])     : undefined,
        selfReportedSource: mapping.source     !== "__none__" ? row[mapping.source]?.trim()       || undefined : undefined,
        guestCountInitial:  mapping.guest_count !== "__none__" ? parseGuestCount(row[mapping.guest_count])     : undefined,
        package:          mapping.package      !== "__none__" ? row[mapping.package]?.trim()      || undefined : undefined,
        inquiryDate:      mapping.inquiry_date !== "__none__" ? parseEventDate(row[mapping.inquiry_date])      : undefined,
        status:           statusMapped,
      };

      try {
        const res = await upsertMutation.mutateAsync(payload);
        if (res.action === "created") created++; else updated++;
      } catch {
        skipped++;
      }

      setProgress({ done: i + 1, total: rows.length, created, updated });
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
          <h2 className="text-sm font-semibold text-gray-900 mb-1">2. Map your columns</h2>
          <p className="text-xs text-gray-500 mb-5">
            Auto-detected from your column names. Adjust if needed.
          </p>

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
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">3. Import</h2>

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
                Import {rows.length} record{rows.length !== 1 ? "s" : ""}
              </button>
              <p className="text-xs text-gray-400">
                Existing clients matched by email (or name if no email) will be updated, not duplicated.
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
          <Link
            href="/clients"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            View your clients <ArrowRight size={14} />
          </Link>
        </div>
      )}
    </div>
  );
}
