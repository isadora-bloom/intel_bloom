/**
 * Open-Meteo forecast fetcher
 * Free, no API key. Fetches forecasts for events within 14 days.
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function fetchEventForecast(
  lat: number,
  lng: number,
  eventDate: string // YYYY-MM-DD
) {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lng}` +
    `&daily=precipitation_probability_max,temperature_2m_max,temperature_2m_min,precipitation_sum` +
    `&start_date=${eventDate}&end_date=${eventDate}` +
    `&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=auto`;

  const response = await fetch(url);
  if (!response.ok) return null;

  const data = await response.json();
  return data.daily;
}

export async function checkUpcomingEventForecasts() {
  const today = new Date();
  const in10Days = new Date(today);
  in10Days.setDate(in10Days.getDate() + 10);
  const in14Days = new Date(today);
  in14Days.setDate(in14Days.getDate() + 14);

  // Get all venues with lat/lng
  const { data: venues } = await supabase
    .from("venues")
    .select("id, lat, lng")
    .not("lat", "is", null);

  for (const venue of venues ?? []) {
    // Get events 10-14 days out
    const { data: clients } = await supabase
      .from("clients")
      .select("id, event_date")
      .eq("venue_id", venue.id)
      .gte("event_date", in10Days.toISOString().split("T")[0])
      .lte("event_date", in14Days.toISOString().split("T")[0])
      .in("status", ["booked", "planning"]);

    for (const client of clients ?? []) {
      if (!client.event_date) continue;

      const forecast = await fetchEventForecast(
        Number(venue.lat),
        Number(venue.lng),
        client.event_date
      );

      if (!forecast) continue;

      const precipProb = forecast.precipitation_probability_max?.[0] ?? null;
      const tempHigh = forecast.temperature_2m_max?.[0] ?? null;
      const tempLow = forecast.temperature_2m_min?.[0] ?? null;

      // Store forecast
      await supabase.from("weather_forecasts").insert({
        venue_id: venue.id,
        client_id: client.id,
        forecast_date: client.event_date,
        pulled_at: new Date().toISOString(),
        precip_probability: precipProb ? Math.round(precipProb) : null,
        temp_high_f: tempHigh ? Math.round(tempHigh) : null,
        temp_low_f: tempLow ? Math.round(tempLow) : null,
        alert_triggered: precipProb !== null && precipProb > 50,
      });
    }
  }
}
