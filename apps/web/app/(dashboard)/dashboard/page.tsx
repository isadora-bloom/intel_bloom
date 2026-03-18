"use client";

import { trpc } from "@/lib/trpc/client";
import { useState, useRef, useEffect } from "react";
import { type BriefingInsight } from "@/server/api/routers/insights";
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
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{greeting}</h1>
        <p className="text-sm text-gray-500 mt-0.5">Here&apos;s what your data is telling you today.</p>
      </div>
      <AskInsight />

      {isLoading && (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-white border border-gray-200 rounded-lg p-5 animate-pulse">
              <div className="h-4 bg-gray-100 rounded w-3/4 mb-3" />
              <div className="h-3 bg-gray-100 rounded w-full mb-2" />
              <div className="h-3 bg-gray-100 rounded w-2/3" />
            </div>
          ))}
        </div>
      )}

      {!isLoading && insights && (
        <div className="space-y-8">
          {(["past", "present", "future", "recommendation"] as const).map((tf) => {
            const section = insights.filter(i => i.timeframe === tf && i.dataAvailable);
            if (!section.length) return null;
            const meta = SECTION_META[tf];
            const Icon = meta.icon;
            return (
              <div key={tf}>
                <div className="flex items-center gap-2 mb-3">
                  <Icon size={14} className="text-gray-400" />
                  <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{meta.label}</h2>
                  <span className="text-xs text-gray-300">— {meta.description}</span>
                </div>
                <div className="space-y-3">
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
  );
}
