"use client";

import { trpc } from "@/lib/trpc/client";
import { useState } from "react";
import { format } from "date-fns";
import { Star, RefreshCw, Loader2, ExternalLink, Link2, X, Check, Circle, Flag } from "lucide-react";
import Link from "next/link";

const PLATFORM_LABELS: Record<string, { label: string; color: string }> = {
  google:       { label: "Google",       color: "bg-blue-100 text-blue-700" },
  the_knot:     { label: "The Knot",     color: "bg-pink-100 text-pink-700" },
  wedding_wire: { label: "WeddingWire",  color: "bg-purple-100 text-purple-700" },
  zola:         { label: "Zola",         color: "bg-indigo-100 text-indigo-700" },
  facebook:     { label: "Facebook",     color: "bg-blue-100 text-blue-700" },
  manual:       { label: "Manual",       color: "bg-gray-100 text-gray-600" },
  other:        { label: "Other",        color: "bg-gray-100 text-gray-600" },
};

function StarRow({ rating }: { rating: number | null }) {
  if (!rating) return <span className="text-gray-300 text-xs">No rating</span>;
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={13}
          className={n <= rating ? "fill-amber-400 text-amber-400" : "fill-gray-100 text-gray-200"}
        />
      ))}
    </div>
  );
}

function SyncPanel() {
  const utils = trpc.useUtils();
  const syncGoogle = trpc.reviews.syncGoogle.useMutation({ onSuccess: () => utils.reviews.list.invalidate() });
  const syncKnot = trpc.reviews.syncKnot.useMutation({ onSuccess: () => utils.reviews.list.invalidate() });
  const analyze = trpc.reviews.analyzeLanguage.useMutation({
    onSuccess: (data) => {
      utils.reviews.list.invalidate();
      utils.reviews.listLanguagePhrases.invalidate();
      setAnalyzeResult(data);
    },
    onError: (err) => {
      setAnalyzeResult({ analyzed: 0, error: err.message });
    },
  });
  const [knotText, setKnotText] = useState("");
  const [googleResult, setGoogleResult] = useState<{ synced: number; matched: number } | null>(null);
  const [knotResult, setKnotResult] = useState<{ synced: number; matched: number } | null>(null);
  const [analyzeResult, setAnalyzeResult] = useState<{ analyzed: number; error?: string } | null>(null);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-5">
      <h2 className="text-sm font-semibold text-gray-700">Sync reviews</h2>

      {/* Google */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-900">Google</p>
          <p className="text-xs text-gray-400">Pulls your 5 most recent reviews via Google Places API</p>
          {googleResult && (
            <p className="text-xs text-green-700 mt-0.5">
              Synced {googleResult.synced} · {googleResult.matched} matched to clients
            </p>
          )}
        </div>
        <button
          onClick={() => syncGoogle.mutateAsync().then(setGoogleResult)}
          disabled={syncGoogle.isPending}
          className="flex items-center gap-1.5 bg-blue-600 text-white text-sm px-3 py-1.5 rounded font-medium hover:bg-blue-700 disabled:opacity-50 flex-shrink-0"
        >
          {syncGoogle.isPending ? <><Loader2 size={13} className="animate-spin" /> Syncing…</> : <><RefreshCw size={13} /> Sync Google</>}
        </button>
      </div>

      {/* The Knot */}
      <div className="space-y-2">
        <div>
          <p className="text-sm font-medium text-gray-900">The Knot</p>
          <p className="text-xs text-gray-400">
            The Knot blocks automated access. Instead: open your Knot profile → scroll through all reviews → select all text on the page (Ctrl+A) → copy → paste below.
          </p>
          {knotResult && (
            <p className="text-xs text-green-700 mt-0.5">
              Synced {knotResult.synced} · {knotResult.matched} matched to clients
            </p>
          )}
        </div>
        <textarea
          value={knotText}
          onChange={(e) => setKnotText(e.target.value)}
          placeholder="Paste the full page text from your Knot profile here…"
          rows={4}
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-400"
        />
        <button
          onClick={() => syncKnot.mutateAsync({ pastedText: knotText }).then(setKnotResult)}
          disabled={syncKnot.isPending || knotText.length < 50}
          className="flex items-center gap-1.5 bg-pink-600 text-white text-sm px-3 py-1.5 rounded font-medium hover:bg-pink-700 disabled:opacity-50"
        >
          {syncKnot.isPending ? <><Loader2 size={13} className="animate-spin" /> Extracting…</> : <><RefreshCw size={13} /> Extract reviews</>}
        </button>
      </div>

      {/* Analyze language */}
      <div className="flex items-center justify-between gap-4 pt-2 border-t border-gray-100">
        <div>
          <p className="text-sm font-medium text-gray-900">Analyze language</p>
          <p className="text-xs text-gray-400">Claude extracts standout phrases and themes from all unanalyzed reviews</p>
        </div>
        <button
          onClick={() => analyze.mutate()}
          disabled={analyze.isPending}
          className="flex items-center gap-1.5 border border-gray-300 bg-white text-gray-700 text-sm px-3 py-1.5 rounded font-medium hover:bg-gray-50 disabled:opacity-50 flex-shrink-0"
        >
          {analyze.isPending ? <><Loader2 size={13} className="animate-spin" /> Analyzing…</> : "Analyze language"}
        </button>
      </div>
      {analyzeResult && (
        <div className={`mt-2 text-xs px-3 py-2 rounded ${analyzeResult.error ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
          {analyzeResult.error
            ? `Error: ${analyzeResult.error}`
            : `Analyzed ${analyzeResult.analyzed} reviews. Check the Phrases tab below.`}
        </div>
      )}
    </div>
  );
}

function MatchModal({
  reviewId,
  onClose,
}: {
  reviewId: string;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const { data } = trpc.clients.list.useQuery({ search: search || undefined, limit: 20, offset: 0 });
  const match = trpc.reviews.matchToClient.useMutation({
    onSuccess: () => { utils.reviews.list.invalidate(); onClose(); },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 pb-3">
          <h2 className="text-base font-semibold text-gray-900">Match to client</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="px-5 pb-2">
          <input
            autoFocus
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="max-h-60 overflow-y-auto px-3 pb-4 space-y-0.5">
          {(data?.clients ?? []).map((c: any) => (
            <button
              key={c.id}
              onClick={() => match.mutate({ reviewId, clientId: c.id })}
              disabled={match.isPending}
              className="w-full text-left px-3 py-2 text-sm rounded hover:bg-gray-50 flex items-center justify-between"
            >
              <span className="font-medium text-gray-900">
                {c.name_primary}{c.name_partner ? ` & ${c.name_partner}` : ""}
              </span>
              {c.event_date && (
                <span className="text-xs text-gray-400">{format(new Date(c.event_date), "MMM d, yyyy")}</span>
              )}
            </button>
          ))}
        </div>
        <div className="px-5 pb-5">
          <button
            onClick={() => match.mutate({ reviewId, clientId: null })}
            disabled={match.isPending}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Clear match
          </button>
        </div>
      </div>
    </div>
  );
}

type ApprovalFilter = "all" | "pending" | "sage" | "marketing" | "concern";

const FILTER_TABS: { label: string; value: ApprovalFilter }[] = [
  { label: "All",                    value: "all" },
  { label: "Pending",                value: "pending" },
  { label: "Approved for Sage",      value: "sage" },
  { label: "Approved for Marketing", value: "marketing" },
  { label: "Flagged Concerns",       value: "concern" },
];

const EMPTY_MESSAGES: Record<ApprovalFilter, string> = {
  all:       "No phrases extracted yet — sync and analyze some reviews first",
  pending:   "No pending phrases",
  sage:      "No phrases approved for Sage yet",
  marketing: "No phrases approved for marketing yet",
  concern:   "No phrases flagged as concerns",
};

function LanguagePhrasesSection() {
  const utils = trpc.useUtils();
  const [filter, setFilter] = useState<ApprovalFilter>("all");

  const { data: phrases, isLoading } = trpc.reviews.listLanguagePhrases.useQuery({
    approvalFilter: filter,
  });

  const approvePhrase = trpc.reviews.approvePhrase.useMutation({
    onSuccess: () => utils.reviews.listLanguagePhrases.invalidate(),
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Review Language</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Phrases extracted from your reviews. Approve for Sage responses or marketing copy.
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setFilter(tab.value)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              filter === tab.value
                ? "bg-gray-800 text-white border-gray-800"
                : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-gray-100 rounded-lg h-36 animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && (phrases ?? []).length === 0 && (
        <div className="bg-white rounded-lg border border-gray-200 px-6 py-12 text-center">
          <p className="text-sm text-gray-400">{EMPTY_MESSAGES[filter]}</p>
        </div>
      )}

      {/* Phrase cards */}
      {!isLoading && (phrases ?? []).length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {(phrases ?? []).map((phrase: any) => (
            <div
              key={phrase.id}
              className="bg-white rounded-lg border border-gray-200 p-4 flex flex-col gap-3"
            >
              {/* Phrase text */}
              <p className="text-sm font-medium italic text-gray-800 leading-snug">
                &ldquo;{phrase.phrase}&rdquo;
              </p>

              {/* Theme + meta */}
              <div className="flex flex-wrap items-center gap-2">
                {phrase.theme && (
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                    {phrase.theme.replace(/_/g, " ")}
                  </span>
                )}
                <span className="text-xs text-gray-400">
                  Mentioned {phrase.frequency_count} {phrase.frequency_count === 1 ? "time" : "times"}
                </span>
                {phrase.avg_rating != null && (
                  <div className="flex gap-0.5 items-center">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Star
                        key={n}
                        size={11}
                        className={
                          n <= Math.round(phrase.avg_rating)
                            ? "fill-amber-400 text-amber-400"
                            : "fill-gray-100 text-gray-200"
                        }
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Toggle buttons */}
              <div className="flex items-center gap-2 mt-auto pt-1 border-t border-gray-100">
                {/* Sage */}
                <button
                  onClick={() =>
                    approvePhrase.mutate({
                      phraseId: phrase.id,
                      approvedForSage: !phrase.approved_for_sage,
                    })
                  }
                  disabled={approvePhrase.isPending}
                  title={phrase.approved_for_sage ? "Remove Sage approval" : "Approve for Sage"}
                  className={`flex items-center gap-1 text-xs px-2 py-1 rounded border transition-colors disabled:opacity-50 ${
                    phrase.approved_for_sage
                      ? "bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
                      : "bg-white text-gray-400 border-gray-200 hover:bg-gray-50 hover:text-gray-600"
                  }`}
                >
                  {phrase.approved_for_sage ? <Check size={11} /> : <Circle size={11} />}
                  Sage
                </button>

                {/* Marketing */}
                <button
                  onClick={() =>
                    approvePhrase.mutate({
                      phraseId: phrase.id,
                      approvedForMarketing: !phrase.approved_for_marketing,
                    })
                  }
                  disabled={approvePhrase.isPending}
                  title={phrase.approved_for_marketing ? "Remove marketing approval" : "Approve for marketing"}
                  className={`flex items-center gap-1 text-xs px-2 py-1 rounded border transition-colors disabled:opacity-50 ${
                    phrase.approved_for_marketing
                      ? "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
                      : "bg-white text-gray-400 border-gray-200 hover:bg-gray-50 hover:text-gray-600"
                  }`}
                >
                  {phrase.approved_for_marketing ? <Check size={11} /> : <Circle size={11} />}
                  Marketing
                </button>

                {/* Concern */}
                <button
                  onClick={() =>
                    approvePhrase.mutate({
                      phraseId: phrase.id,
                      flaggedAsConcern: !phrase.flagged_as_concern,
                    })
                  }
                  disabled={approvePhrase.isPending}
                  title={phrase.flagged_as_concern ? "Remove concern flag" : "Flag as concern"}
                  className={`flex items-center gap-1 text-xs px-2 py-1 rounded border transition-colors disabled:opacity-50 ml-auto ${
                    phrase.flagged_as_concern
                      ? "bg-red-50 text-red-600 border-red-200 hover:bg-red-100"
                      : "bg-white text-gray-400 border-gray-200 hover:bg-gray-50 hover:text-gray-600"
                  }`}
                >
                  <Flag size={11} />
                  {phrase.flagged_as_concern ? "Flagged" : "Flag"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const PAGE_SIZE = 50;

export default function ReviewsPage() {
  const [page, setPage] = useState(0);
  const [platformFilter, setPlatformFilter] = useState("all");
  const [matchFilter, setMatchFilter] = useState<"all" | "matched" | "unmatched">("all");
  const [matchingReviewId, setMatchingReviewId] = useState<string | null>(null);

  const { data, isLoading } = trpc.reviews.list.useQuery({
    platform: platformFilter !== "all" ? platformFilter : undefined,
    matchStatus: matchFilter,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const { data: summary } = trpc.reviews.summary.useQuery();

  const platforms = Object.keys(summary?.byPlatform ?? {});

  return (
    <div className="max-w-6xl space-y-6">
      {matchingReviewId && (
        <MatchModal reviewId={matchingReviewId} onClose={() => setMatchingReviewId(null)} />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Reviews</h1>
          {summary && (
            <p className="text-sm text-gray-500 mt-0.5">
              {summary.total} total
              {summary.avgRating !== null && ` · ${summary.avgRating.toFixed(1)}★ avg`}
              {summary.recentCount > 0 && ` · ${summary.recentCount} in the last year`}
            </p>
          )}
        </div>
      </div>

      {/* Sync panel */}
      <SyncPanel />

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        {["all", ...platforms].map((p) => (
          <button
            key={p}
            onClick={() => { setPlatformFilter(p); setPage(0); }}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              platformFilter === p
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
            }`}
          >
            {p === "all" ? "All platforms" : (PLATFORM_LABELS[p]?.label ?? p)}
            {p !== "all" && summary?.byPlatform[p] ? ` (${summary.byPlatform[p]})` : ""}
          </button>
        ))}
        <span className="text-gray-300">·</span>
        {(["all", "matched", "unmatched"] as const).map((m) => (
          <button
            key={m}
            onClick={() => { setMatchFilter(m); setPage(0); }}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              matchFilter === m
                ? "bg-gray-800 text-white border-gray-800"
                : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
            }`}
          >
            {m === "all" ? "All" : m === "matched" ? "Matched to client" : "Unmatched"}
          </button>
        ))}
      </div>

      {/* Reviews table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="px-4 py-12 text-center text-gray-400 text-sm">Loading reviews…</div>
        ) : (data?.reviews ?? []).length === 0 ? (
          <div className="px-4 py-16 text-center">
            <Star size={28} className="mx-auto text-gray-200 mb-3" />
            <p className="text-sm font-medium text-gray-500 mb-1">No reviews synced yet</p>
            <p className="text-xs text-gray-400">Use the Sync panel above to pull from Google or The Knot.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Reviewer</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Rating</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Review</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Platform</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Client</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(data?.reviews ?? []).map((r: any) => {
                const pb = PLATFORM_LABELS[r.platform] ?? { label: r.platform, color: "bg-gray-100 text-gray-600" };
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{r.reviewer_name ?? "Anonymous"}</p>
                      {r.wedding_date_mentioned && (
                        <p className="text-xs text-gray-400">{format(new Date(r.wedding_date_mentioned), "MMM d, yyyy")}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StarRow rating={r.rating} />
                    </td>
                    <td className="px-4 py-3 max-w-sm">
                      <p className="text-gray-700 text-xs line-clamp-3">{r.review_text}</p>
                      {r.themes?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {r.themes.slice(0, 3).map((t: string) => (
                            <span key={t} className="text-xs bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded">
                              {t.replace(/_/g, " ")}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${pb.color}`}>
                          {pb.label}
                        </span>
                        {r.platform_url && (
                          <a href={r.platform_url} target="_blank" rel="noopener noreferrer" className="text-gray-300 hover:text-gray-500">
                            <ExternalLink size={11} />
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {r.matched_client ? (
                        <div className="flex items-center gap-1">
                          <Link
                            href={`/clients/${r.matched_client.id}`}
                            className="text-blue-600 hover:underline text-xs font-medium"
                          >
                            {r.matched_client.name_primary}
                          </Link>
                          <button
                            onClick={() => setMatchingReviewId(r.id)}
                            className="text-gray-300 hover:text-gray-500"
                            title="Change match"
                          >
                            <Link2 size={11} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setMatchingReviewId(r.id)}
                          className="text-xs text-gray-400 hover:text-blue-600 transition-colors"
                        >
                          + Match
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {r.review_date ? format(new Date(r.review_date), "MMM d, yyyy") : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {(data?.total ?? 0) > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, data?.total ?? 0)} of {data?.total}</span>
          <div className="flex gap-2">
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40">← Prev</button>
            <button disabled={(page + 1) * PAGE_SIZE >= (data?.total ?? 0)} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40">Next →</button>
          </div>
        </div>
      )}

      {/* Review Language */}
      <LanguagePhrasesSection />
    </div>
  );
}
