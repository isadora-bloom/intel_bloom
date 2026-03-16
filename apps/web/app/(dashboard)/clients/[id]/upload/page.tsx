"use client";

import { useState, use } from "react";
import { trpc } from "@/lib/trpc/client";
import { createClient } from "@/lib/supabase/client";
import { ArrowLeft, Upload, Check, X, AlertTriangle } from "lucide-react";
import Link from "next/link";

const UPLOAD_TYPES = [
  { value: "tour_recording", label: "Tour recording" },
  { value: "meeting_recording", label: "Meeting recording" },
  { value: "tour_notes", label: "Tour notes" },
  { value: "email_thread", label: "Email thread" },
  { value: "other", label: "Other" },
];

const SENSITIVE_TYPES = ["family_dynamics", "stress_indicator"];

export default function UploadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = use(params);
  const [file, setFile] = useState<File | null>(null);
  const [uploadType, setUploadType] = useState("tour_recording");
  const [uploading, setUploading] = useState(false);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: upload, refetch } = trpc.uploads.getById.useQuery(
    { id: uploadId! },
    { enabled: !!uploadId, refetchInterval: (query) => (query.state.data as any)?.status === "review" ? false : 3000 }
  );

  const createUpload = trpc.uploads.create.useMutation();
  const confirmSignal = trpc.uploads.confirmSignal.useMutation({ onSuccess: () => refetch() });
  const supabase = createClient();

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setError(null);

    try {
      // 1. Upload to Supabase Storage
      const ext = file.name.split(".").pop();
      const path = `uploads/${clientId}/${Date.now()}.${ext}`;

      const { error: storageErr } = await supabase.storage
        .from("bloom-uploads")
        .upload(path, file);

      if (storageErr) throw storageErr;

      // 2. Detect file type
      const fileType = file.type.startsWith("audio")
        ? "audio"
        : file.type.startsWith("video")
        ? "video"
        : file.type === "application/pdf"
        ? "pdf"
        : "text";

      // 3. Create upload record + trigger processing
      const result = await createUpload.mutateAsync({
        clientId,
        fileName: file.name,
        fileType: fileType as any,
        fileSizeBytes: file.size,
        storagePath: path,
        uploadType: uploadType as any,
      });

      setUploadId(result.id);
    } catch (err: any) {
      setError(err.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  const extractedSignals = (upload?.extracted_signals as any[]) ?? [];
  const confirmedSignals = new Set(
    ((upload?.confirmed_signals as any[]) ?? []).map((_: any, i: number) => i)
  );

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <Link href={`/clients/${clientId}`} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-3">
          <ArrowLeft size={14} />
          Back to client
        </Link>
        <h1 className="text-2xl font-semibold text-gray-900">Upload recording</h1>
      </div>

      {!uploadId && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
          {/* Upload type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Upload type</label>
            <select
              value={uploadType}
              onChange={(e) => setUploadType(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {UPLOAD_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Drop zone */}
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              file ? "border-blue-400 bg-blue-50" : "border-gray-300 hover:border-gray-400"
            }`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const dropped = e.dataTransfer.files[0];
              if (dropped) setFile(dropped);
            }}
          >
            <Upload size={24} className="mx-auto text-gray-400 mb-2" />
            {file ? (
              <div>
                <p className="text-sm font-medium text-gray-900">{file.name}</p>
                <p className="text-xs text-gray-500">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
              </div>
            ) : (
              <div>
                <p className="text-sm text-gray-500">Drop a file here, or</p>
                <label className="cursor-pointer text-sm text-blue-600 hover:underline">
                  browse to select
                  <input
                    type="file"
                    className="hidden"
                    accept="audio/*,video/*,.pdf,.txt,.docx"
                    onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])}
                  />
                </label>
                <p className="text-xs text-gray-400 mt-1">Audio, video, PDF, or text files</p>
              </div>
            )}
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</p>
          )}

          <button
            onClick={handleUpload}
            disabled={!file || uploading}
            className="w-full bg-blue-600 text-white rounded-md py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {uploading ? "Uploading..." : "Upload and process"}
          </button>
        </div>
      )}

      {/* Processing status */}
      {upload && upload.status !== "review" && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3" />
          <p className="text-gray-700 font-medium capitalize">{upload.status}...</p>
          {upload.status === "transcribing" && (
            <p className="text-sm text-gray-400 mt-1">Converting audio to text</p>
          )}
          {upload.status === "extracting" && (
            <p className="text-sm text-gray-400 mt-1">Extracting intelligence signals</p>
          )}
        </div>
      )}

      {/* Signal review */}
      {upload?.status === "review" && extractedSignals.length > 0 && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h2 className="font-semibold text-gray-900 mb-1">Review extracted signals</h2>
            <p className="text-sm text-gray-500">
              Confirm signals to apply them to the client record. Dismiss anything that was incorrectly extracted.
            </p>
          </div>

          {extractedSignals.map((signal: any, i: number) => {
            const isSensitive = SENSITIVE_TYPES.includes(signal.type);
            const isConfirmed = confirmedSignals.has(i);

            return (
              <div
                key={i}
                className={`bg-white rounded-lg border p-4 ${
                  isSensitive ? "border-amber-300" : "border-gray-200"
                }`}
              >
                {isSensitive && (
                  <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 rounded px-2 py-1 mb-3 w-fit">
                    <AlertTriangle size={12} />
                    Sensitive — family/stress data. Auto-deleted after 12 months.
                  </div>
                )}

                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-gray-500 uppercase bg-gray-100 px-2 py-0.5 rounded">
                        {signal.type.replace(/_/g, " ")}
                      </span>
                      <span className="text-xs text-gray-400">{signal.confidence}% confidence</span>
                    </div>
                    <p className="text-sm font-medium text-gray-900 mb-1">{signal.value}</p>
                    {signal.quote && (
                      <p className="text-xs text-gray-500 italic">"{signal.quote}"</p>
                    )}
                  </div>
                </div>

                {!isConfirmed && (
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => confirmSignal.mutate({ uploadId: upload.id, signalIndex: i, confirmed: true })}
                      className="flex items-center gap-1.5 text-xs text-green-700 bg-green-50 border border-green-200 px-3 py-1.5 rounded hover:bg-green-100 transition-colors"
                    >
                      <Check size={12} />
                      Confirm
                    </button>
                    <button
                      onClick={() => confirmSignal.mutate({ uploadId: upload.id, signalIndex: i, confirmed: false })}
                      className="flex items-center gap-1.5 text-xs text-gray-600 bg-gray-50 border border-gray-200 px-3 py-1.5 rounded hover:bg-gray-100 transition-colors"
                    >
                      <X size={12} />
                      Dismiss
                    </button>
                  </div>
                )}

                {isConfirmed && (
                  <div className="flex items-center gap-1.5 mt-3 text-xs text-green-600">
                    <Check size={12} />
                    Confirmed and applied
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {upload?.status === "review" && extractedSignals.length === 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 text-center">
          <p className="text-sm text-gray-500">No signals were extracted from this file.</p>
        </div>
      )}
    </div>
  );
}
