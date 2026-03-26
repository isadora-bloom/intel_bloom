/**
 * AI Signal Extraction
 * CRITICAL: Extracted signals are DRAFT ONLY. They MUST NOT write to clients table.
 * Only human-confirmed signals propagate via confirmSignal() in the upload router.
 */

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

interface ExtractedSignal {
  type: string;
  value: string;
  confidence: number;
  quote: string;
  sensitivity: "low" | "medium" | "high";
}

async function readStoredFile(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from("bloom-uploads")
    .download(storagePath);

  if (error) throw error;
  return await data.text();
}

async function extractFromImage(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from("bloom-uploads")
    .download(storagePath);

  if (error) throw error;

  const buffer = Buffer.from(await data.arrayBuffer());
  const base64 = buffer.toString("base64");

  // Determine media type from path extension
  const ext = storagePath.split(".").pop()?.toLowerCase() ?? "";
  const mediaType =
    ext === "png" ? "image/png" :
    ext === "webp" ? "image/webp" :
    ext === "gif" ? "image/gif" :
    "image/jpeg";

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    system: `You are reading a screenshot or image from a wedding venue. Extract ALL visible text, numbers, data, and content — including reviews, chart values, table data, form fields, and any other information present. Output everything you can read as plain text, preserving structure where possible.`,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
        { type: "text", text: "Extract all text, numbers, and data visible in this image." },
      ],
    }],
  });

  return response.content[0].type === "text" ? response.content[0].text : "";
}

async function transcribeAudio(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from("bloom-uploads")
    .download(storagePath);

  if (error) throw error;

  // OpenAI Whisper requires a File object
  const buffer = Buffer.from(await data.arrayBuffer());
  const fileName = storagePath.split("/").pop() ?? "audio.mp3";

  const file = new File([buffer], fileName, { type: data.type });

  const transcription = await openai.audio.transcriptions.create({
    file,
    model: "whisper-1",
    language: "en",
  });

  return transcription.text;
}

export async function extractSignals(
  text: string,
  uploadType: string
): Promise<ExtractedSignal[]> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    system: `You are extracting client intelligence signals from a wedding venue document (type: ${uploadType}).

Extract ONLY what is explicitly stated. Do not infer, assume, or embellish.
Return a JSON array of signal objects. Each signal must have these exact fields:
- type: one of [event_logistics, budget_signal, emotional_tone, competing_venue, referral_detail, family_dynamics, vision_clarity, objection, vendor_preference, guest_count, event_date, package_tier, payment_status, dietary_requirement, vendor_confirmed, special_request, timeline_detail, contact_info, advertising_spend, invoice_total, revenue_item]
- value: the extracted value as a short string (under 50 words)
- confidence: integer 0-100 (how confident this extraction is)
- quote: brief direct quote supporting this extraction (under 30 words, exact words from the text)
- sensitivity: "low" | "medium" | "high" (high = family dynamics, stress indicators, personal conflicts)

Extract everything useful — dates, guest counts, budget figures, package choices, vendor names, special requests, dietary needs, payment details, contact info. For bank statements, invoices, or receipts: extract advertising_spend signals for any marketing platform charges (The Knot, WeddingWire, Google Ads, Facebook, Instagram, etc.), invoice_total for the overall amount, and revenue_item for income line items. Any document type is valid input.

Return ONLY the JSON array, no other text.`,
    messages: [
      {
        role: "user",
        content: `Extract intelligence signals from this ${uploadType}:\n\n${text.substring(0, 15000)}`,
      },
    ],
  });

  try {
    const rawText =
      response.content[0].type === "text" ? response.content[0].text : "[]";
    const jsonMatch = rawText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    return JSON.parse(jsonMatch[0]) as ExtractedSignal[];
  } catch {
    return [];
  }
}

export async function processUpload(uploadId: string) {
  const { data: upload, error } = await supabase
    .from("uploads")
    .select("*")
    .eq("id", uploadId)
    .single();

  if (error || !upload) {
    console.error("Upload not found:", uploadId);
    return;
  }

  // Update status to transcribing/extracting
  await supabase
    .from("uploads")
    .update({ status: upload.file_type === "audio" || upload.file_type === "video" ? "transcribing" : "extracting" })
    .eq("id", uploadId);

  let textContent = upload.transcript;

  const ext = (upload.storage_path ?? "").split(".").pop()?.toLowerCase() ?? "";
  const isImage = ["jpg", "jpeg", "png", "webp", "gif"].includes(ext);

  // Step 1: Convert to text depending on file type
  if (!textContent && (upload.file_type === "audio" || upload.file_type === "video")) {
    try {
      textContent = await transcribeAudio(upload.storage_path);
      await supabase
        .from("uploads")
        .update({ transcript: textContent, status: "extracting" })
        .eq("id", uploadId);
    } catch (err) {
      console.error("Transcription failed:", err);
      await supabase.from("uploads").update({ status: "failed" }).eq("id", uploadId);
      return;
    }
  } else if (!textContent && isImage) {
    try {
      await supabase.from("uploads").update({ status: "extracting" }).eq("id", uploadId);
      textContent = await extractFromImage(upload.storage_path);
    } catch (err) {
      console.error("Image extraction failed:", err);
      await supabase.from("uploads").update({ status: "failed" }).eq("id", uploadId);
      return;
    }
  } else if (!textContent && upload.storage_path) {
    try {
      textContent = await readStoredFile(upload.storage_path);
    } catch (err) {
      console.error("File read failed:", err);
      await supabase.from("uploads").update({ status: "failed" }).eq("id", uploadId);
      return;
    }
  }

  if (!textContent || textContent.length < 50) {
    await supabase
      .from("uploads")
      .update({ status: "review", extracted_signals: [] })
      .eq("id", uploadId);
    return;
  }

  // Step 2: Extract signals via Claude
  // CRITICAL: Save to extracted_signals ONLY — never to clients table
  const signals = await extractSignals(textContent, upload.upload_type ?? "document");

  await supabase
    .from("uploads")
    .update({
      extracted_signals: signals,
      status: "review",
    })
    .eq("id", uploadId);

  console.log(
    `Upload ${uploadId}: extracted ${signals.length} signals, awaiting human review`
  );
}
