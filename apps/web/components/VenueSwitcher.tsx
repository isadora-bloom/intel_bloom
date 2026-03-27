"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { ChevronDown, MapPin } from "lucide-react";

export default function VenueSwitcher() {
  const [open, setOpen] = useState(false);
  const { data: venues, isLoading } = trpc.venues.listUserVenues.useQuery(undefined, {
    staleTime: 1000 * 60 * 5,
  });
  const { data: currentVenue } = trpc.venues.getCurrent.useQuery(undefined, {
    staleTime: 1000 * 60 * 5,
  });

  // Don't render if loading, no data, or user only has one venue
  if (isLoading || !venues || venues.length < 2 || !currentVenue) return null;

  function handleSwitch(venueId: string) {
    setOpen(false);
    if (venueId === currentVenue?.id) return;
    // Set cookie and reload
    document.cookie = `bloom_venue=${venueId};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;
    window.location.reload();
  }

  return (
    <div className="relative px-3 mb-3">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-left text-sm bg-gray-50 hover:bg-gray-100 border border-gray-200 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <p className="font-medium text-gray-900 truncate text-xs">{currentVenue.name}</p>
          {(currentVenue.city || currentVenue.state) && (
            <p className="text-[10px] text-gray-400 truncate">
              {[currentVenue.city, currentVenue.state].filter(Boolean).join(", ")}
            </p>
          )}
        </div>
        <ChevronDown size={14} className={`text-gray-400 flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-3 right-3 top-full mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 max-h-64 overflow-y-auto">
            {venues.map((venue) => (
              <button
                key={venue.id}
                onClick={() => handleSwitch(venue.id)}
                className={`w-full flex items-start gap-2.5 px-3 py-2 text-left hover:bg-gray-50 transition-colors ${
                  venue.id === currentVenue.id ? "bg-blue-50" : ""
                }`}
              >
                <MapPin size={13} className={`mt-0.5 flex-shrink-0 ${venue.id === currentVenue.id ? "text-blue-600" : "text-gray-300"}`} />
                <div className="min-w-0">
                  <p className={`text-xs truncate ${venue.id === currentVenue.id ? "font-semibold text-blue-700" : "font-medium text-gray-800"}`}>
                    {venue.name}
                  </p>
                  {(venue.city || venue.state) && (
                    <p className="text-[10px] text-gray-400 truncate">
                      {[venue.city, venue.state].filter(Boolean).join(", ")}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
