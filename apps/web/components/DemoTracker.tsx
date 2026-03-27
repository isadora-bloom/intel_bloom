"use client";

import { useEffect, useRef, useCallback } from "react";
import { usePathname } from "next/navigation";
import { DEMO_COOKIE, parseDemoCookie } from "@/lib/demo";

/**
 * DemoTracker — invisible component that tracks demo user engagement.
 *
 * Captures: page views with duration & scroll depth, feature clicks,
 * chart hovers, CTA clicks. Batches events and flushes every 5 seconds
 * or on page navigation.
 *
 * Mount this inside the dashboard layout when demo mode is active.
 * It reads the demo cookie directly — no props needed.
 */

interface PendingEvent {
  type: string;
  page?: string;
  venueSlug?: string;
  durationMs?: number;
  scrollPct?: number;
  feature?: string;
  detail?: string;
  elementId?: string;
  elementText?: string;
  vw?: number;
  vh?: number;
  mobile?: boolean;
}

const FLUSH_INTERVAL_MS = 5000;
const MAX_BATCH_SIZE = 30;

function getDemoCookie() {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((c) => c.startsWith(DEMO_COOKIE + "="));
  if (!match) return null;
  try {
    return parseDemoCookie(decodeURIComponent(match.split("=").slice(1).join("=")));
  } catch {
    return null;
  }
}

export default function DemoTracker() {
  const pathname = usePathname();
  const queue = useRef<PendingEvent[]>([]);
  const pageEnteredAt = useRef<number>(Date.now());
  const maxScrollPct = useRef<number>(0);
  const lastPathname = useRef<string>(pathname);

  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  // ── Flush events to API ─────────────────────────────────────────────
  const flush = useCallback(async () => {
    if (queue.current.length === 0) return;
    const session = getDemoCookie();
    if (!session) return;

    const batch = queue.current.splice(0, MAX_BATCH_SIZE);
    try {
      await fetch("/api/demo/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: batch }),
        keepalive: true,
      });
    } catch {
      // Put back on failure — will retry next flush
      queue.current.unshift(...batch);
    }
  }, []);

  // ── Track page view (on pathname change) ────────────────────────────
  useEffect(() => {
    // Emit page_view for previous page with duration
    if (lastPathname.current !== pathname) {
      const duration = Date.now() - pageEnteredAt.current;
      queue.current.push({
        type: "page_view",
        page: lastPathname.current,
        durationMs: duration,
        scrollPct: maxScrollPct.current,
        vw: window.innerWidth,
        vh: window.innerHeight,
        mobile: isMobile,
      });
      flush();
    }

    // Reset for new page
    lastPathname.current = pathname;
    pageEnteredAt.current = Date.now();
    maxScrollPct.current = 0;
  }, [pathname, flush, isMobile]);

  // ── Scroll depth tracking ───────────────────────────────────────────
  useEffect(() => {
    function onScroll() {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (docHeight > 0) {
        const pct = Math.round((scrollTop / docHeight) * 100);
        if (pct > maxScrollPct.current) maxScrollPct.current = pct;
      }
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // ── Click tracking (event delegation) ───────────────────────────────
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target) return;

      // Find the nearest trackable element
      const el = target.closest<HTMLElement>(
        "[data-demo-feature], [data-demo-cta], button, a"
      );
      if (!el) return;

      const featureName = el.getAttribute("data-demo-feature");
      const ctaName = el.getAttribute("data-demo-cta");

      if (featureName) {
        queue.current.push({
          type: "feature_click",
          page: pathname,
          feature: featureName,
          detail: el.getAttribute("data-demo-detail") || undefined,
          elementText: el.textContent?.slice(0, 100) || undefined,
          mobile: isMobile,
        });
      } else if (ctaName) {
        queue.current.push({
          type: "cta_click",
          page: pathname,
          feature: ctaName,
          elementId: el.id || undefined,
          elementText: el.textContent?.slice(0, 100) || undefined,
          mobile: isMobile,
        });
      }
    }

    document.addEventListener("click", onClick, { passive: true });
    return () => document.removeEventListener("click", onClick);
  }, [pathname, isMobile]);

  // ── Periodic flush ──────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(flush, FLUSH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [flush]);

  // ── Flush on page unload ────────────────────────────────────────────
  useEffect(() => {
    function onBeforeUnload() {
      // Emit final page_view
      const duration = Date.now() - pageEnteredAt.current;
      queue.current.push({
        type: "page_view",
        page: pathname,
        durationMs: duration,
        scrollPct: maxScrollPct.current,
        mobile: isMobile,
      });

      // Use sendBeacon for reliable delivery
      const session = getDemoCookie();
      if (session && queue.current.length > 0) {
        const body = JSON.stringify({ events: queue.current });
        navigator.sendBeacon("/api/demo/events", body);
        queue.current = [];
      }
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [pathname, isMobile]);

  // Invisible — no UI rendered
  return null;
}
