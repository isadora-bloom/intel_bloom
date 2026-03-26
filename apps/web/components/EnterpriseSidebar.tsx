"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid,
  Map,
  Building2,
  Users,
  ArrowLeft,
  Menu,
  X,
  LogOut,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

type NavItem = { href: string; label: string; icon: React.ElementType };
type NavGroup = { label: string | null; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { href: "/portfolio", label: "Portfolio", icon: LayoutGrid },
    ],
  },
  {
    label: "Analytics",
    items: [
      { href: "/company", label: "Company Dashboard", icon: Building2 },
      { href: "/regions", label: "Regions", icon: Map },
      { href: "/team", label: "Team Performance", icon: Users },
    ],
  },
];

function NavLinks({
  pathname,
  onNavigate,
}: {
  pathname: string;
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
            {group.items.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
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
                </Link>
              );
            })}
          </div>
        </div>
      ))}

      {/* Back to venue — always at bottom of nav */}
      <div>
        <p className="px-3 mb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-widest">
          Venue
        </p>
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm mb-0.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors"
        >
          <ArrowLeft size={15} className="flex-shrink-0" />
          <span className="flex-1 truncate">Back to Venue</span>
        </Link>
      </div>
    </div>
  );
}

export default function EnterpriseSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <>
      {/* ── Mobile top bar ─────────────────────────────────────────────── */}
      <div className="lg:hidden fixed top-0 inset-x-0 z-30 flex items-center justify-between h-14 px-4 bg-white border-b border-gray-200">
        <span className="text-base font-semibold text-gray-900">Bloom Enterprise</span>
        <button
          onClick={() => setMobileOpen(true)}
          className="p-2 rounded-md text-gray-500 hover:bg-gray-100 transition-colors"
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
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
              <span className="text-base font-semibold text-gray-900">Bloom Enterprise</span>
              <button
                onClick={() => setMobileOpen(false)}
                className="p-1.5 rounded-md text-gray-400 hover:bg-gray-100 transition-colors"
                aria-label="Close menu"
              >
                <X size={18} />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto py-4 px-3">
              <NavLinks
                pathname={pathname}
                onNavigate={() => setMobileOpen(false)}
              />
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
        <div className="flex items-center h-14 px-5 border-b border-gray-100">
          <span className="text-sm font-semibold text-gray-900 tracking-tight">
            Bloom Enterprise
          </span>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3">
          <NavLinks pathname={pathname} />
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
