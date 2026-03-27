"use client";

import { type DemoSession, DEMO_ROLE_DEFAULTS } from "@/lib/demo";
import { Phone, ArrowLeftRight } from "lucide-react";
import Link from "next/link";

interface DemoBannerProps {
  session: DemoSession;
}

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  coordinator: "Coordinator",
};

export default function DemoBanner({ session }: DemoBannerProps) {
  return (
    <div className="sticky top-0 z-50 flex items-center justify-between gap-3 bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-white text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <span className="hidden sm:inline opacity-80">
          You&apos;re exploring
        </span>
        <span className="font-medium truncate">
          Crestwood Hospitality Group&apos;s demo data
        </span>
        <span className="inline-flex items-center rounded-full bg-white/20 px-2 py-0.5 text-xs font-medium">
          {ROLE_LABELS[session.role] || session.role}
        </span>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <Link
          href="/demo"
          className="inline-flex items-center gap-1.5 rounded-md bg-white/15 hover:bg-white/25 px-3 py-1 text-xs font-medium transition-colors"
        >
          <ArrowLeftRight size={13} />
          Switch Role
        </Link>
        <a
          href="https://calendly.com/bloom-intelligence/demo"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md bg-white text-blue-700 hover:bg-blue-50 px-3 py-1 text-xs font-semibold transition-colors"
        >
          <Phone size={13} />
          Book a Call
        </a>
      </div>
    </div>
  );
}
