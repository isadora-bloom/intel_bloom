"use client";

import { trpc } from "@/lib/trpc/client";
import { TrendingUp, TrendingDown, Users, Clock, UserCheck, Swords, Calendar, Share2, Sun } from "lucide-react";

function fmt$(cents: number | null | undefined): string {
  if (!cents) return "—";
  const d = cents / 100;
  if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`;
  if (d >= 1_000) return `$${Math.round(d / 1_000)}k`;
  return `$${Math.round(d)}`;
}

function pct(rate: number | null | undefined): string {
  if (rate == null) return "—";
  return `${Math.round(rate * 100)}%`;
}

function InsightChip({ icon: Icon, label, value, color }: {
  icon: React.ElementType;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2 bg-white rounded-lg border border-gray-100 px-3 py-2">
      <Icon size={13} className={color} />
      <div className="min-w-0">
        <p className="text-[10px] text-gray-400 uppercase tracking-wide leading-none mb-0.5">{label}</p>
        <p className="text-sm font-medium text-gray-800 truncate">{value}</p>
      </div>
    </div>
  );
}

export default function CrossIntelligence() {
  const { data, isLoading } = trpc.analytics.getCrossIntelligence.useQuery(undefined, {
    staleTime: 1000 * 60 * 10,
  });

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse">
        <div className="h-3 bg-gray-100 rounded w-40 mb-4" />
        <div className="grid grid-cols-2 gap-3">
          {[...Array(6)].map((_, i) => <div key={i} className="h-14 bg-gray-50 rounded" />)}
        </div>
      </div>
    );
  }

  if (!data || data.clientCount < 5) return null;

  const insights: Array<{ icon: React.ElementType; label: string; value: string; color: string }> = [];

  // Response time → conversion
  if (data.responseConversion.length >= 2) {
    const fast = data.responseConversion[0];
    const slow = data.responseConversion[data.responseConversion.length - 1];
    if (fast && slow && fast.conversionRate > slow.conversionRate) {
      insights.push({
        icon: Clock,
        label: "Speed to lead",
        value: `${fast.label}: ${pct(fast.conversionRate)} book vs ${slow.label}: ${pct(slow.conversionRate)}`,
        color: "text-blue-500",
      });
    }
  }

  // Coordinator performance
  if (data.coordinatorPerformance.length >= 1) {
    const top = data.coordinatorPerformance[0];
    insights.push({
      icon: UserCheck,
      label: "Top coordinator",
      value: `${top.name}: ${pct(top.conversionRate)} conversion${top.avgResponseMinutes ? ` · ${top.avgResponseMinutes}min avg response` : ""}`,
      color: "text-emerald-500",
    });
  }

  // Referral LTV
  if (data.referralLTV.referredCount >= 3 && data.referralLTV.referredAvgRevenue && data.referralLTV.nonReferredAvgRevenue) {
    const diff = Math.round(((data.referralLTV.referredAvgRevenue - data.referralLTV.nonReferredAvgRevenue) / data.referralLTV.nonReferredAvgRevenue) * 100);
    if (diff > 0) {
      insights.push({
        icon: Users,
        label: "Referral value",
        value: `Referred couples spend ${diff}% more (${fmt$(data.referralLTV.referredAvgRevenue)} vs ${fmt$(data.referralLTV.nonReferredAvgRevenue)})`,
        color: "text-violet-500",
      });
    }
  }

  // Competitor win/loss
  if (data.competitorWinLoss.competitors.length >= 1) {
    const top = data.competitorWinLoss.competitors[0];
    const baselinePct = Math.round(data.competitorWinLoss.baselineConversion * 100);
    const winPct = Math.round(top.winRate * 100);
    insights.push({
      icon: Swords,
      label: `vs ${top.name}`,
      value: `You win ${winPct}% when they're in the mix (baseline: ${baselinePct}%)`,
      color: winPct >= baselinePct ? "text-green-500" : "text-red-500",
    });
  }

  // Booking horizon by season
  if (data.bookingHorizonBySeason.length >= 3) {
    const longest = [...data.bookingHorizonBySeason].sort((a, b) => b.medianDays - a.medianDays)[0];
    const shortest = [...data.bookingHorizonBySeason].sort((a, b) => a.medianDays - b.medianDays)[0];
    insights.push({
      icon: Calendar,
      label: "Booking lead time",
      value: `${longest.month} couples inquire ${longest.medianMonths}mo ahead · ${shortest.month}: ${shortest.medianMonths}mo`,
      color: "text-amber-500",
    });
  }

  // Social → inquiry uplift
  if (data.socialInquiryUplift && data.socialInquiryUplift.highSaveAvgUplift) {
    insights.push({
      icon: Share2,
      label: "Social impact",
      value: `Posts with 50+ saves → ${data.socialInquiryUplift.highSaveAvgUplift}x inquiry uplift (${data.socialInquiryUplift.highSaveCount} posts)`,
      color: "text-pink-500",
    });
  }

  // Day-of-week pattern
  if (data.timeOfDayPatterns.length > 0) {
    const withData = data.timeOfDayPatterns.filter(d => d.inquiries > 0 && d.avgResponseMinutes != null);
    if (withData.length >= 3) {
      const slowest = [...withData].sort((a, b) => (b.avgResponseMinutes ?? 0) - (a.avgResponseMinutes ?? 0))[0];
      if (slowest && (slowest.avgResponseMinutes ?? 0) > 60) {
        insights.push({
          icon: Sun,
          label: "Response gap",
          value: `${slowest.day} inquiries wait ${Math.round((slowest.avgResponseMinutes ?? 0) / 60)}hrs for response${slowest.conversionRate != null ? ` (${pct(slowest.conversionRate)} convert)` : ""}`,
          color: "text-orange-500",
        });
      }
    }
  }

  if (insights.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp size={14} className="text-indigo-500" />
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Cross-data intelligence
        </h2>
      </div>
      <div className="grid grid-cols-1 gap-2">
        {insights.map((insight, i) => (
          <InsightChip key={i} {...insight} />
        ))}
      </div>
      <p className="text-[10px] text-gray-300 mt-3">
        Based on {data.clientCount} clients · {data.bookedCount} booked
      </p>
    </div>
  );
}
