"use client";

import { useState, useRef, useEffect } from "react";
import { Bell } from "lucide-react";
import { trpc } from "@/lib/trpc/client";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  time: string;
  read: boolean;
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Aggregate notifications from multiple sources
  const { data: anomalies } = trpc.anomalies.getRecent.useQuery(
    { limit: 5 },
    { staleTime: 1000 * 60 * 3 }
  );
  const { data: matchCount } = trpc.matching.pendingCount.useQuery(undefined, {
    staleTime: 1000 * 60 * 3,
  });
  const { data: alerts } = trpc.inquiries.getAlerts.useQuery(undefined, {
    staleTime: 1000 * 60 * 3,
  });

  // Build notification list
  const notifications: Notification[] = [];

  for (const a of anomalies ?? []) {
    if (a.status !== "new") continue;
    notifications.push({
      id: `anomaly-${a.id}`,
      type: "anomaly",
      title: `${(a.metric as string).replace(/_/g, " ")} ${a.direction === "up" ? "increased" : "decreased"} ${Math.abs(a.magnitude_pct as number).toFixed(0)}%`,
      body: (a.ai_recommendation as string) ?? "Review this change in the Data Flags page.",
      time: new Date(a.detected_at as string).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      read: false,
    });
  }

  if ((matchCount?.count ?? 0) > 0) {
    notifications.push({
      id: "matching",
      type: "matching",
      title: `${matchCount?.count} matches need review`,
      body: "Identity resolution found potential duplicates.",
      time: "Now",
      read: false,
    });
  }

  for (const alert of (alerts ?? []).slice(0, 3)) {
    notifications.push({
      id: `alert-${alert.id}`,
      type: "response_alert",
      title: `Slow response: ${alert.actual_minutes ?? "?"}min`,
      body: `Response exceeded ${alert.threshold_minutes ?? 30}min threshold.`,
      time: new Date(alert.created_at as string).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      read: alert.resolved as boolean,
    });
  }

  const unreadCount = notifications.filter(n => !n.read).length;

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
        aria-label="Notifications"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-lg border border-gray-200 z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-900">Notifications</span>
            {unreadCount > 0 && (
              <span className="text-xs text-gray-400">{unreadCount} unread</span>
            )}
          </div>

          {notifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              All caught up
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
              {notifications.map((n) => (
                <div
                  key={n.id}
                  className={`px-4 py-3 hover:bg-gray-50 transition-colors ${!n.read ? "bg-blue-50/30" : ""}`}
                >
                  <div className="flex justify-between items-start mb-0.5">
                    <p className="text-sm font-medium text-gray-800 leading-snug">{n.title}</p>
                    <span className="text-[10px] text-gray-400 flex-shrink-0 ml-2">{n.time}</span>
                  </div>
                  <p className="text-xs text-gray-500 leading-relaxed">{n.body}</p>
                </div>
              ))}
            </div>
          )}

          <div className="px-4 py-2 border-t border-gray-100 text-center">
            <a href="/annotations" className="text-xs text-blue-600 hover:text-blue-800">
              View all activity
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
