"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Inbox,
  Users,
  BarChart3,
  Globe,
  Store,
  Flag,
  Settings,
  GitMerge,
  LogOut,
  DownloadCloud,
  Menu,
  X,
  Star,
  CalendarCheck,
  CalendarDays,
  DollarSign,
  Megaphone,
  XCircle,
  LineChart,
  Share2,
  ScanLine,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { useState } from "react";
import NotificationBell from "./NotificationBell";
import VenueSwitcher from "./VenueSwitcher";

type NavItem = { href: string; label: string; icon: React.ElementType; badge?: boolean };
type NavGroup = { label: string | null; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    ],
  },
  {
    label: "Pipeline",
    items: [
      { href: "/inquiries", label: "Inquiry Log", icon: Inbox },
      { href: "/clients", label: "Pipeline", icon: Users },
      { href: "/tours", label: "Tours", icon: CalendarCheck },
      { href: "/lost-deals", label: "Lost Deals", icon: XCircle },
      { href: "/matching", label: "Dedup & Match", icon: GitMerge, badge: true },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { href: "/analytics", label: "Analytics", icon: BarChart3 },
      { href: "/reviews", label: "Reviews", icon: Star },
      { href: "/macro", label: "Market Pulse", icon: Globe },
      { href: "/annotations", label: "Data Flags", icon: Flag, badge: true },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/forecasts", label: "Revenue Forecast", icon: LineChart },
      { href: "/capacity", label: "Capacity & Yield", icon: CalendarDays },
      { href: "/spend", label: "Channel Spend", icon: DollarSign },
      { href: "/campaigns", label: "Campaigns", icon: Megaphone },
      { href: "/social", label: "Social Posts", icon: Share2 },
      { href: "/vendors", label: "Vendors", icon: Store },
    ],
  },
  {
    label: "Settings",
    items: [
      { href: "/capture", label: "Screenshot capture", icon: ScanLine },
      { href: "/import", label: "CSV import", icon: DownloadCloud },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

function NavLinks({
  pathname,
  matchingCount,
  anomalyCount,
  onNavigate,
}: {
  pathname: string;
  matchingCount: number;
  anomalyCount: number;
  onNavigate?: () => void;
}) {
  return (
    <div className="space-y-5">
      {NAV_GROUPS.map((group, gi) => (
        <div key={gi}>
          {group.label && (
            <p className="px-3 mb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-widest">
              {group.label}
            </p>
          )}
          <div>
            {group.items.map(({ href, label, icon: Icon, badge = false }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              const count = badge
                ? href === "/matching" ? matchingCount
                : href === "/annotations" ? anomalyCount
                : 0
                : 0;
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={onNavigate}
                  className={`flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm mb-0.5 transition-colors ${
                    active
                      ? "bg-blue-50 text-blue-700 font-medium"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 font-normal"
                  }`}
                >
                  <Icon size={15} className="flex-shrink-0" />
                  <span className="flex-1 truncate">{label}</span>
                  {count > 0 && (
                    <span className="text-xs bg-amber-100 text-amber-700 rounded-full px-1.5 py-0.5 font-medium min-w-[18px] text-center">
                      {count}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const [mobileOpen, setMobileOpen] = useState(false);

  const { data: matchingData } = trpc.matching.pendingCount.useQuery(undefined, {
    staleTime: 1000 * 60 * 2,
  });
  const matchingCount = matchingData?.count ?? 0;

  const { data: anomalyCountData } = trpc.anomalies.unacknowledgedCount.useQuery(undefined, {
    staleTime: 1000 * 60 * 2,
  });
  const anomalyCount = anomalyCountData ?? 0;

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <>
      {/* ── Mobile top bar ─────────────────────────────────────────────── */}
      <div className="lg:hidden fixed top-0 inset-x-0 z-30 flex items-center justify-between h-14 px-4 bg-white border-b border-gray-200">
        <span className="text-base font-semibold text-gray-900">Bloom</span>
        <div className="flex items-center gap-1">
          <NotificationBell />
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 rounded-md text-gray-500 hover:bg-gray-100 transition-colors"
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
        </div>
      </div>

      {/* ── Mobile drawer ──────────────────────────────────────────────── */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative flex flex-col w-64 max-w-[85vw] bg-white h-full shadow-xl">
            <div className="flex items-center justify-between h-14 px-5 border-b border-gray-200">
              <span className="text-base font-semibold text-gray-900">Bloom</span>
              <button
                onClick={() => setMobileOpen(false)}
                className="p-1.5 rounded-md text-gray-400 hover:bg-gray-100 transition-colors"
                aria-label="Close menu"
              >
                <X size={18} />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto py-4">
              <VenueSwitcher />
              <div className="px-3">
                <NavLinks
                  pathname={pathname}
                  matchingCount={matchingCount}
                  anomalyCount={anomalyCount}
                  onNavigate={() => setMobileOpen(false)}
                />
              </div>
            </nav>

            <div className="p-3 border-t border-gray-200">
              <button
                onClick={handleSignOut}
                className="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-gray-600 hover:bg-gray-100 w-full"
              >
                <LogOut size={15} />
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Desktop sidebar ────────────────────────────────────────────── */}
      <aside className="hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:w-56 bg-white border-r border-gray-100">
        <div className="flex items-center justify-between h-14 px-5 border-b border-gray-100">
          <span className="text-sm font-semibold text-gray-900 tracking-tight">Bloom Intelligence</span>
          <NotificationBell />
        </div>

        <nav className="flex-1 overflow-y-auto py-4">
          <VenueSwitcher />
          <div className="px-3">
            <NavLinks pathname={pathname} matchingCount={matchingCount} anomalyCount={anomalyCount} />
          </div>
        </nav>

        <div className="p-3 border-t border-gray-100">
          <button
            onClick={handleSignOut}
            className="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-700 w-full transition-colors"
          >
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
