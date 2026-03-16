import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { uploadId } = await request.json();
  if (!uploadId) {
    return NextResponse.json({ error: "uploadId required" }, { status: 400 });
  }

  // Verify user has access to this upload's venue
  const { data: upload } = await supabase
    .from("uploads")
    .select("id, venue_id")
    .eq("id", uploadId)
    .single();

  if (!upload) {
    return NextResponse.json({ error: "Upload not found" }, { status: 404 });
  }

  // Process asynchronously — don't block the response
  processUploadAsync(uploadId);

  return NextResponse.json({ success: true });
}

async function processUploadAsync(uploadId: string) {
  try {
    const { processUpload } = await import("@bloom/extraction/extract");
    await processUpload(uploadId);
  } catch (err) {
    console.error("Upload processing failed:", uploadId, err);

    const { createServiceClient } = await import("@/lib/supabase/server");
    const supabase = createServiceClient();
    await supabase
      .from("uploads")
      .update({ status: "failed" })
      .eq("id", uploadId);
  }
}
