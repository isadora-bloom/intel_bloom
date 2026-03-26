"use client";

import { trpc } from "@/lib/trpc/client";
import { useState, useRef, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { type BriefingInsight } from "@/server/api/routers/insights";
import SetupChecklist from "@/components/SetupChecklist";
import HoldAlertsWidget from "@/components/HoldAlertsWidget";
import AnomalyAlerts from "@/components/AnomalyAlerts";
import CrossIntelligence from "@/components/CrossIntelligence";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Cloud,
  BarChart3,
  Search,
  Globe,
  Send,
  Loader2,
  Lightbulb,
  ChevronDown,
  ChevronUp,
  Activity,
  History,
  Radio,
  Telescope,
  Sparkles,
  X,
  Users,
  Star,
  DollarSign,
  Mail,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";

const SENTIMENT_STYLES: Record<
  BriefingInsight["sentiment"],
  { border: string; bg: string; badge: string; iconColor: string }
> = {
  positive: { border: "border-green-200", bg: "bg-green-50", badge: "bg-green-100 text-green-700", iconColor: "text-green-500" },
  neutral: { border: "border-gray-200", bg: "bg-white", badge: "bg-gray-100 text-gray-500", iconColor: "text-gray-300" },
  caution: { border: "border-amber-200", bg: "bg-amber-50", badge: "bg-amber-100 text-amber-700", iconColor: "text-amber-500" },
  negative: { border: "border-red-200", bg: "bg-red-50", badge: "bg-red-100 text-red-700", iconColor: "text-red-500" },
};

const TYPE_ICONS: Record<string, React.ElementType> = {
  source_performance: BarChart3,
  weather_explainer: Cloud,
  seasonal_pricing: TrendingDown,
  leading_indicator: Search,
  macro_context: Globe,
  platform_activity: Activity,
  recommendation: Lightbulb,
};

const SECTION_META: Record<string, { label: string; icon: React.ElementType; description: string }> = {
  past:           { label: "What happened",   icon: History,   description: "Patterns from your historical data" },
  present:        { label: "What's happening now", icon: Radio, description: "Current signals and conditions" },
  future:         { label: "What to expect",  icon: Telescope, description: "Leading indicators pointing ahead" },
  recommendation: { label: "Recommendations", icon: Sparkles,  description: "Specific actions based on the signals above" },
};

const SENTIMENT_TREND_ICONS: Record<string, React.ElementType> = {
  positive: TrendingUp,
  neutral: Minus,
  caution: TrendingDown,
  negative: TrendingDown,
};

const EXAMPLE_QUESTIONS = [
  "Why are my inquiries down this month?",
  "What does my best customer look like?",
  "Which source gives me the best value?",
  "Should I lower my June prices?",
  "Is the whole industry slow right now or just me?",
];

// Funnel stage config — maps analytics.stagePipeline stageCounts keys to display labels
const FUNNEL_STAGES = [
  { key: "inquiries",   label: "Inquiries",   color: "bg-violet-400" },
  { key: "tourBooked",  label: "Tour booked", color: "bg-sky-400" },
  { key: "toured",      label: "Toured",      color: "bg-blue-400" },
  { key: "held",        label: "On hold",     color: "bg-amber-400" },
  { key: "contracted",  label: "Contracted",  color: "bg-emerald-400" },
  { key: "completed",   label: "Completed",   color: "bg-gray-300" },
] as const;

function formatRevenue(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000) return `$${Math.round(dollars / 1_000)}k`;
  return `$${Math.round(dollars)}`;
}

function StatCardSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse">
      <div className="flex items-start justify-between mb-3">
        <div className="h-3 bg-gray-100 rounded w-24" />
        <div className="w-8 h-8 bg-gray-100 rounded-lg" />
      </div>
      <div className="h-8 bg-gray-100 rounded w-16 mt-2" />
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  iconBg,
  iconColor,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${iconBg}`}>
          <Icon size={15} className={iconColor} />
        </div>
      </div>
      <p className="text-3xl font-bold text-gray-900 leading-none">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1.5">{sub}</p>}
    </div>
  );
}

function FunnelBar({ stageCounts }: { stageCounts: Record<string, number> }) {
  const total = FUNNEL_STAGES.reduce((sum, s) => sum + (stageCounts[s.key] ?? 0), 0);

  if (total === 0) {
    return (
      <div className="bg-gray-50 border border-dashed border-gray-200 rounded-xl p-6 text-center">
        <p className="text-sm text-gray-400">Import clients to see your pipeline</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Current pipeline</h2>
        <span className="text-xs text-gray-400">{total} total</span>
      </div>

      {/* Stacked bar */}
      <div className="flex rounded-full overflow-hidden h-2.5 mb-4 gap-0.5">
        {FUNNEL_STAGES.map((stage) => {
          const count = stageCounts[stage.key] ?? 0;
          if (count === 0) return null;
          const pct = (count / total) * 100;
          return (
            <div
              key={stage.key}
              className={`${stage.color} h-full rounded-full`}
              style={{ width: `${pct}%`, minWidth: count > 0 ? "4px" : "0" }}
              title={`${stage.label}: ${count}`}
            />
          );
        })}
      </div>

      {/* Stage chips */}
      <div className="flex flex-wrap gap-2">
        {FUNNEL_STAGES.map((stage, i) => {
          const count = stageCounts[stage.key] ?? 0;
          return (
            <div key={stage.key} className="flex items-center gap-1.5 text-xs text-gray-600">
              <span className={`inline-block w-2 h-2 rounded-full ${stage.color}`} />
              <span className="font-medium">{count}</span>
              <span className="text-gray-400">{stage.label}</span>
              {i < FUNNEL_STAGES.length - 1 && (
                <ArrowRight size={10} className="text-gray-300 ml-0.5" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HealthScoreWidget() {
  const { data, isLoading } = trpc.analytics.getHealthScore.useQuery(undefined, {
    staleTime: 1000 * 60 * 5,
  });

  if (isLoading) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-5 animate-pulse">
        <div className="h-3 bg-gray-100 rounded w-32 mb-4" />
        <div className="flex gap-4">
          <div className="h-16 w-16 bg-gray-100 rounded-full" />
          <div className="flex-1 space-y-2 pt-2">
            {[...Array(3)].map((_, i) => <div key={i} className="h-2.5 bg-gray-100 rounded" />)}
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const gradeColor =
    data.grade === "A" ? "text-green-600" :
    data.grade === "B" ? "text-blue-600" :
    data.grade === "C" ? "text-amber-600" : "text-red-500";

  const ringColor =
    data.grade === "A" ? "stroke-green-500" :
    data.grade === "B" ? "stroke-blue-500" :
    data.grade === "C" ? "stroke-amber-500" : "stroke-red-400";

  const circumference = 2 * Math.PI * 24;
  const filled = (data.total / 100) * circumference;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <ShieldCheck size={14} className="text-gray-400" />
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Venue health score</h2>
      </div>
      <div className="flex items-center gap-5">
        {/* Ring */}
        <div className="relative flex-shrink-0 w-14 h-14">
          <svg viewBox="0 0 56 56" className="-rotate-90 w-14 h-14">
            <circle cx="28" cy="28" r="24" fill="none" className="stroke-gray-100" strokeWidth="5" />
            <circle
              cx="28" cy="28" r="24" fill="none"
              className={ringColor}
              strokeWidth="5"
              strokeDasharray={`${filled} ${circumference}`}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-xl font-bold leading-none ${gradeColor}`}>{data.grade}</span>
            <span className="text-[10px] text-gray-400 leading-none mt-0.5">{data.total}/100</span>
          </div>
        </div>
        {/* Dimensions */}
        <div className="flex-1 space-y-1.5">
          {data.dimensions.map((d) => (
            <div key={d.label} className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-24 flex-shrink-0">{d.label}</span>
              <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                <div
                  className="h-full bg-blue-400 rounded-full transition-all"
                  style={{ width: `${(d.score / d.max) * 100}%` }}
                />
              </div>
              <span className="text-xs text-gray-400 w-8 text-right flex-shrink-0">{d.score}/{d.max}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function InsightCard({ insight }: { insight: BriefingInsight }) {
  const [expanded, setExpanded] = useState(false);
  const styles = SENTIMENT_STYLES[insight.sentiment];
  const TrendIcon = SENTIMENT_TREND_ICONS[insight.sentiment] || Minus;
  const TypeIcon = TYPE_ICONS[insight.type] || BarChart3;
  const hasTruncatableBody = insight.body.length > 200;
  const displayBody = !hasTruncatableBody || expanded ? insight.body : insight.body.slice(0, 200) + "...";

  return (
    <div className={`rounded-lg border ${styles.border} ${styles.bg} p-5 transition-all`} style={{ opacity: insight.dataAvailable ? 1 : 0.6 }}>
      <div className="flex items-start gap-3 mb-3">
        <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${styles.badge}`}>
          <TypeIcon size={14} />
        </div>
        <p className="flex-1 text-sm font-semibold text-gray-900 leading-snug">{insight.headline}</p>
        <TrendIcon size={15} className={`${styles.iconColor} flex-shrink-0 mt-0.5`} />
      </div>
      <div className="ml-10">
        <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">{displayBody}</p>
        {hasTruncatableBody && (
          <button onClick={() => setExpanded(!expanded)} className="mt-1 text-xs text-gray-400 hover:text-gray-600 flex items-center gap-0.5">
            {expanded ? <><ChevronUp size={12} /> Less</> : <><ChevronDown size={12} /> More</>}
          </button>
        )}
        {insight.action && (
          <div className="mt-3 text-xs text-amber-800 bg-amber-100 border border-amber-200 rounded px-3 py-2 inline-block">{insight.action}</div>
        )}
        {insight.supporting.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {insight.supporting.map((s) => (
              <span key={s.label} className="text-xs bg-white border border-gray-200 rounded-full px-2.5 py-1 text-gray-600">
                <span className="text-gray-400">{s.label}:</span> {s.value}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AskInsight() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const askMutation = trpc.insights.ask.useMutation({
    onSuccess: (data) => { setAnswer(data.answer); setLoading(false); },
    onError: (err) => {
      const msg = err.message.includes("API") || err.message.includes("api_key")
        ? "AI key not configured - add ANTHROPIC_API_KEY to your environment."
        : err.message;
      setError(msg);
      setLoading(false);
    },
  });

  function handleSubmit(q?: string) {
    const text = (q ?? question).trim();
    if (!text) return;
    setAnswer(null); setError(null); setLoading(true); setQuestion(text);
    askMutation.mutate({ question: text });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  }

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = inputRef.current.scrollHeight + "px";
    }
  }, [question]);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <Lightbulb size={15} className="text-amber-500" />
        <span className="text-sm font-semibold text-gray-900">Ask about your business</span>
      </div>
      <div className="relative">
        <textarea
          ref={inputRef} value={question} onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Why are my June bookings down? Which source gives me the best value? Is the industry slow right now?"
          rows={2}
          className="w-full border border-gray-300 rounded-lg pl-4 pr-12 py-3 text-sm text-gray-900 placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <button
          onClick={() => handleSubmit()} disabled={!question.trim() || loading}
          className="absolute right-3 bottom-3 w-7 h-7 rounded-md bg-blue-600 flex items-center justify-center text-white disabled:opacity-40 hover:bg-blue-700 transition-colors"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
        </button>
      </div>
      {!answer && !loading && (
        <div className="flex flex-wrap gap-2 mt-3">
          {EXAMPLE_QUESTIONS.map((q) => (
            <button key={q} onClick={() => handleSubmit(q)}
              className="text-xs border border-gray-200 text-gray-500 hover:text-gray-800 hover:border-gray-400 px-2.5 py-1 rounded-full transition-colors">
              {q}
            </button>
          ))}
        </div>
      )}
      {loading && (
        <div className="mt-4 flex items-center gap-2 text-sm text-gray-500">
          <Loader2 size={14} className="animate-spin text-blue-500" /> Thinking...
        </div>
      )}
      {answer && !loading && (
        <div className="mt-4 border-t border-gray-100 pt-4">
          <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide">Bloom Intelligence</p>
          <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-line">{answer}</p>
          <button onClick={() => { setAnswer(null); setQuestion(""); inputRef.current?.focus(); }}
            className="mt-3 text-xs text-gray-400 hover:text-gray-600">
            Ask another question
          </button>
        </div>
      )}
      {error && <p className="mt-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
    </div>
  );
}

export default function DashboardPage() {
  const { data: insights, isLoading } = trpc.insights.getBriefing.useQuery(undefined, { staleTime: 1000 * 60 * 5 });
  const { data: venue } = trpc.venues.getCurrent.useQuery();
  const { data: clientsData, isLoading: clientsLoading } = trpc.clients.list.useQuery(
    { limit: 100, offset: 0 },
    { staleTime: 1000 * 60 * 2 }
  );
  const { data: pipelineData, isLoading: pipelineLoading } = trpc.analytics.stagePipeline.useQuery(
    undefined,
    { staleTime: 1000 * 60 * 2 }
  );

  // This-month inquiries: use dateFrom = first day of current month
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const { data: monthInquiriesData, isLoading: inquiriesLoading } = trpc.inquiries.list.useQuery(
    { dateFrom: monthStart.toISOString(), limit: 1, offset: 0 },
    { staleTime: 1000 * 60 * 2 }
  );

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const searchParams = useSearchParams();
  const [upgradedBannerVisible, setUpgradedBannerVisible] = useState(
    () => searchParams.get("upgraded") === "1"
  );

  // Compute stats from clients list
  const clients = clientsData?.clients ?? [];
  const activeClients = clients.filter((c) =>
    ["held", "contracted"].includes(c.status as string)
  ).length;

  const reviewedClients = clients.filter(
    (c) => typeof (c as any).review_star_rating === "number"
  );
  const avgReview =
    reviewedClients.length > 0
      ? reviewedClients.reduce((sum, c) => sum + ((c as any).review_star_rating as number), 0) /
        reviewedClients.length
      : null;

  const bookedRevenueCents = clients
    .filter((c) => ["held", "contracted"].includes(c.status as string))
    .reduce((sum, c) => sum + (((c as any).revenue_cents as number | null) ?? 0), 0);

  const thisMonthInquiries = monthInquiriesData?.total ?? 0;

  const statsLoading = clientsLoading || inquiriesLoading;

  return (
    <div className="max-w-7xl space-y-6">
      {upgradedBannerVisible && (
        <div className="flex items-center justify-between gap-3 bg-green-50 border border-green-200 text-green-800 text-sm font-medium rounded-xl px-4 py-3">
          <span>Welcome to Bloom Intelligence! Your subscription is active.</span>
          <button
            onClick={() => setUpgradedBannerVisible(false)}
            className="flex-shrink-0 text-green-600 hover:text-green-800 transition-colors"
            aria-label="Dismiss"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">
          {greeting}{venue?.name ? `, ${venue.name}` : ""}
        </h1>
        <p className="text-sm text-gray-400 mt-0.5">{today}</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {statsLoading ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          <>
            <StatCard
              label="Active clients"
              value={String(activeClients)}
              sub="held + contracted"
              icon={Users}
              iconBg="bg-blue-50"
              iconColor="text-blue-500"
            />
            <StatCard
              label="This month"
              value={String(thisMonthInquiries)}
              sub={thisMonthInquiries === 0 ? "Connect Gmail to track" : "inquiries received"}
              icon={Mail}
              iconBg="bg-violet-50"
              iconColor="text-violet-500"
            />
            <StatCard
              label="Avg review"
              value={avgReview !== null ? `${avgReview.toFixed(1)}★` : "—"}
              sub={reviewedClients.length > 0 ? `${reviewedClients.length} reviews` : "No reviews yet"}
              icon={Star}
              iconBg="bg-amber-50"
              iconColor="text-amber-500"
            />
            <StatCard
              label="Revenue booked"
              value={bookedRevenueCents > 0 ? formatRevenue(bookedRevenueCents) : "—"}
              sub="held + contracted clients"
              icon={DollarSign}
              iconBg="bg-emerald-50"
              iconColor="text-emerald-500"
            />
          </>
        )}
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6 items-start">

        {/* ── LEFT: Intelligence ── */}
        <div className="space-y-5 min-w-0">
          {/* Ask about your business */}
          <AskInsight />

          {/* Briefing insights */}
          {isLoading && (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="bg-white border border-gray-200 rounded-lg p-5 animate-pulse">
                  <div className="h-4 bg-gray-100 rounded w-3/4 mb-3" />
                  <div className="h-3 bg-gray-100 rounded w-full mb-2" />
                  <div className="h-3 bg-gray-100 rounded w-2/3" />
                </div>
              ))}
            </div>
          )}

          {!isLoading && insights && insights.length === 0 && (
        <div className="border border-dashed border-gray-200 rounded-xl p-10">
          <div className="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <Sparkles size={18} className="text-blue-500" />
          </div>
          <h3 className="text-sm font-semibold text-gray-900 mb-2 text-center">Intelligence is warming up</h3>
          <p className="text-sm text-gray-500 max-w-sm mx-auto mb-6 text-center">
            Bloom needs data to generate insights. Complete the steps below to unlock your briefing.
          </p>
          <div className="max-w-sm mx-auto space-y-2 mb-6">
            {[
              { step: "1", label: "Import your client history", href: "/import", detail: "HoneyBook CSV or spreadsheet export" },
              { step: "2", label: "Connect Gmail", href: "/settings", detail: "Auto-extract source attribution" },
              { step: "3", label: "Calibrate your location signals", href: "/settings", detail: "NOAA weather station + Google Trends metro" },
            ].map(({ step, label, href, detail }) => (
              <a key={step} href={href} className="flex items-start gap-3 p-3 rounded-lg border border-gray-100 bg-white hover:border-blue-200 hover:bg-blue-50/30 transition-colors group">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-gray-100 group-hover:bg-blue-100 text-gray-500 group-hover:text-blue-600 text-xs font-bold flex items-center justify-center mt-0.5">{step}</span>
                <div>
                  <p className="text-sm font-medium text-gray-800 group-hover:text-blue-700">{label}</p>
                  <p className="text-xs text-gray-400">{detail}</p>
                </div>
              </a>
            ))}
          </div>
          <div className="text-center">
            <a href="/analytics" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
              View analytics without AI briefing →
            </a>
          </div>
        </div>
          )}

          {!isLoading && insights && insights.length > 0 && (
            <div className="space-y-7">
              {(["past", "present", "future", "recommendation"] as const).map((tf) => {
                const section = insights.filter(i => i.timeframe === tf && i.dataAvailable);
                if (!section.length) return null;
                const meta = SECTION_META[tf];
                const Icon = meta.icon;
                return (
                  <div key={tf}>
                    <div className="flex items-center gap-2 mb-3">
                      <Icon size={13} className="text-gray-400" />
                      <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{meta.label}</h2>
                    </div>
                    <div className="space-y-2.5">
                      {section.map((insight) => (
                        <InsightCard key={insight.id} insight={insight} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── RIGHT: Pipeline + Health ── */}
        <div className="space-y-4">
          {/* Anomaly alerts */}
          <AnomalyAlerts />

          {/* Pipeline funnel */}
          {pipelineLoading ? (
            <div className="bg-white border border-gray-200 rounded-xl p-5 animate-pulse">
              <div className="h-3 bg-gray-100 rounded w-32 mb-4" />
              <div className="h-2 bg-gray-100 rounded-full mb-4" />
              <div className="space-y-1.5">
                {[...Array(5)].map((_, i) => <div key={i} className="h-2.5 bg-gray-100 rounded w-full" />)}
              </div>
            </div>
          ) : (
            <FunnelBar stageCounts={pipelineData?.stageCounts ?? {}} />
          )}

          {/* Cross-data intelligence */}
          <CrossIntelligence />

          {/* Health score */}
          <HealthScoreWidget />

          {/* Hold alerts */}
          <HoldAlertsWidget />

          {/* Setup checklist */}
          {venue && <SetupChecklist venueId={venue.id} />}
        </div>

      </div>
    </div>
  );
}
