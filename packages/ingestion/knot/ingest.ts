/**
 * The Knot Ingestion
 * Two paths: CSV export parser + Gmail notification reconstruction
 */

import { createClient } from "@supabase/supabase-js";
import { parse as parseCSV } from "csv-parse/sync";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function parseDate(str: string): string | null {
  if (!str) return null;
  try {
    return new Date(str).toISOString().split("T")[0];
  } catch {
    return null;
  }
}

export async function parseKnotCsvExport(venueId: string, csvContent: string) {
  const records = parseCSV(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  let created = 0;
  let skipped = 0;

  for (const record of records as any[]) {
    const externalId = record["Inquiry ID"] ?? record["ID"];
    if (!externalId) continue;

    const receivedAt = parseDate(record["Date"] ?? record["Received"]);
    const receivedDate = receivedAt ? new Date(receivedAt) : null;

    const { error } = await supabase.from("inquiries").upsert(
      {
        venue_id: venueId,
        platform: "knot",
        external_id: externalId,
        raw_message: record["Message"] ?? null,
        name_extracted: record["Name"] ?? null,
        email_extracted: record["Email"] ?? null,
        event_date_extracted: parseDate(record["Event Date"] ?? record["Wedding Date"]),
        received_at: receivedAt,
        day_of_week: receivedDate ? receivedDate.getDay() : null,
        hour_of_day: receivedDate ? receivedDate.getHours() : null,
        self_reported_source: "knot",
      },
      { onConflict: "venue_id,external_id" }
    );

    if (error) {
      console.warn(`Skipped ${externalId}:`, error.message);
      skipped++;
    } else {
      created++;
    }
  }

  return { created, skipped, total: records.length };
}

/**
 * Parse a Knot notification email body to extract inquiry details.
 * The Knot email format varies — this handles common patterns.
 */
export function parseKnotNotificationEmail(emailBody: string) {
  const nameMatch = emailBody.match(/(?:Name|From):\s*([^\n\r]+)/i);
  const emailMatch = emailBody.match(/(?:Email):\s*([^\s\n\r]+@[^\s\n\r]+)/i);
  const dateMatch = emailBody.match(/(?:Wedding|Event)\s*Date:\s*([^\n\r]+)/i);
  const messageMatch = emailBody.match(/(?:Message|Note):\s*([\s\S]+?)(?:\n\n|$)/i);

  if (!nameMatch) return null;

  return {
    name: nameMatch[1].trim(),
    email: emailMatch?.[1].trim(),
    eventDate: dateMatch ? parseDate(dateMatch[1].trim()) : null,
    message: messageMatch?.[1].trim(),
  };
}
