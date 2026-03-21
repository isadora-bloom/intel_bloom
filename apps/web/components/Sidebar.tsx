"use client";

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
  ScanLine,
  DownloadCloud,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/capture", label: "Quick Capture", icon: ScanLine },
  { href: "/inquiries", label: "Inquiries", icon: Inbox },
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/matching", label: "Matching", icon: GitMerge, badge: true },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/macro", label: "Market Pulse", icon: Globe },
  { href: "/vendors", label: "Vendors", icon: Store },
  { href: "/annotations", label: "Annotations", icon: Flag },
  { href: "/import", label: "Import", icon: DownloadCloud },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const { data: matchingCount } = trpc.matching.pendingCount.useQuery(undefined, {
    staleTime: 1000 * 60 * 2,
  });

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:w-64 bg-white border-r border-gray-200">
        <div className="flex items-center h-16 px-6 border-b border-gray-200">
          <span className="text-lg font-semibold text-gray-900">Bloom Intelligence</span>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3">
          {NAV_ITEMS.map(({ href, label, icon: Icon, badge }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            const count = badge ? (matchingCount?.count ?? 0) : 0;
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium mb-0.5 transition-colors ${
                  active
                    ? "bg-blue-50 text-blue-700"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                <Icon size={16} />
                <span className="flex-1">{label}</span>
                {count > 0 && (
                  <span className="text-xs bg-amber-100 text-amber-700 rounded-full px-1.5 py-0.5 font-medium min-w-[18px] text-center">
                    {count}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-gray-200">
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-gray-600 hover:bg-gray-100 w-full"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
