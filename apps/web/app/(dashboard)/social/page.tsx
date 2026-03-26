"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Instagram, Facebook, Plus, ExternalLink, TrendingUp, Eye, Bookmark, MousePointerClick } from "lucide-react";

const PLATFORM_ICONS: Record<string, React.ElementType> = {
  instagram: Instagram,
  facebook: Facebook,
};

const PLATFORM_COLORS: Record<string, string> = {
  instagram: "text-pink-500",
  facebook: "text-blue-600",
  pinterest: "text-red-500",
  tiktok: "text-gray-900",
  youtube: "text-red-600",
};

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export default function SocialPage() {
  const { data: posts, isLoading } = trpc.social.getPosts.useQuery({});
  const { data: summary } = trpc.social.getVenueCorrelationSummary.useQuery();
  const [showAdd, setShowAdd] = useState(false);

  const postList = posts ?? [];

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Social Posts</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Track post performance and see which content drives real inquiries.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-1.5 border border-gray-300 bg-white text-gray-700 px-3 py-1.5 rounded text-sm font-medium hover:bg-gray-50 transition-colors"
        >
          <Plus size={14} /> Log post
        </button>
      </div>

      {/* Correlation summary */}
      {summary && summary.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-800 mb-3">Content → inquiry correlation</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500 uppercase border-b border-gray-100">
                <tr>
                  <th className="text-left py-2 pr-4">Platform / Type</th>
                  <th className="text-right py-2 pr-4">Avg reach</th>
                  <th className="text-right py-2 pr-4">Posts with signal</th>
                  <th className="text-right py-2">Avg inquiry uplift</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {summary.map((row: any, i: number) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="py-2 pr-4 text-gray-800 font-medium capitalize">
                      {row.platform} · {row.postType}
                    </td>
                    <td className="text-right py-2 pr-4 text-gray-600">{fmt(row.avgReach)}</td>
                    <td className="text-right py-2 pr-4 text-gray-600">{row.postsWithSignal}</td>
                    <td className="text-right py-2 text-gray-600">
                      {row.avgUpliftMultiplier > 1 ? (
                        <span className="text-green-600 font-medium">
                          {row.avgUpliftMultiplier.toFixed(1)}x
                        </span>
                      ) : (
                        <span className="text-gray-400">No signal</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400 mt-3">
            "Inquiry uplift" compares the number of inquiries in the 14 days after a post vs your baseline.
            A multiplier above 1.0 means more inquiries than usual arrived after that post.
          </p>
        </div>
      )}

      {/* Post list */}
      {isLoading ? (
        <div className="space-y-3 animate-pulse">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white rounded-lg border border-gray-200 p-5">
              <div className="h-4 bg-gray-100 rounded w-48 mb-3" />
              <div className="h-3 bg-gray-50 rounded w-full" />
            </div>
          ))}
        </div>
      ) : postList.length === 0 ? (
        <div className="bg-white rounded-lg border border-dashed border-gray-200 p-12 text-center">
          <Instagram size={32} className="mx-auto mb-3 text-gray-300" />
          <h3 className="text-sm font-semibold text-gray-700 mb-1">No posts tracked yet</h3>
          <p className="text-sm text-gray-400 max-w-md mx-auto">
            Log your social media posts to see which content actually drives inquiries.
            We&apos;ll correlate post timing with inquiry spikes.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {postList.map((post: any) => {
            const Icon = PLATFORM_ICONS[post.platform] ?? Instagram;
            const color = PLATFORM_COLORS[post.platform] ?? "text-gray-500";
            return (
              <div key={post.id} className="bg-white rounded-lg border border-gray-200 p-5">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <Icon size={16} className={color} />
                    <span className="text-sm font-medium text-gray-800 capitalize">
                      {post.platform} · {post.post_type}
                    </span>
                    <span className="text-xs text-gray-400">
                      {new Date(post.posted_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                    {post.is_viral && (
                      <span className="text-[10px] bg-pink-100 text-pink-700 px-1.5 py-0.5 rounded-full font-medium">
                        Viral
                      </span>
                    )}
                  </div>
                  {post.post_url && (
                    <a href={post.post_url} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-gray-600">
                      <ExternalLink size={14} />
                    </a>
                  )}
                </div>

                {post.caption && (
                  <p className="text-sm text-gray-600 mb-3 line-clamp-2">{post.caption}</p>
                )}

                <div className="grid grid-cols-4 sm:grid-cols-6 gap-3 text-xs">
                  <div className="flex items-center gap-1.5">
                    <Eye size={12} className="text-gray-400" />
                    <div>
                      <p className="text-gray-400">Reach</p>
                      <p className="font-medium text-gray-700">{fmt(post.reach)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Bookmark size={12} className="text-gray-400" />
                    <div>
                      <p className="text-gray-400">Saves</p>
                      <p className="font-medium text-gray-700">{fmt(post.saves)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <MousePointerClick size={12} className="text-gray-400" />
                    <div>
                      <p className="text-gray-400">Clicks</p>
                      <p className="font-medium text-gray-700">{fmt(post.website_clicks)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <TrendingUp size={12} className="text-gray-400" />
                    <div>
                      <p className="text-gray-400">Eng. rate</p>
                      <p className="font-medium text-gray-700">
                        {post.engagement_rate ? `${Number(post.engagement_rate).toFixed(1)}%` : "—"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
