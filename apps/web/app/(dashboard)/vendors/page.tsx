"use client";

import { trpc } from "@/lib/trpc/client";
import { Store, ArrowUpRight, Users, Star } from "lucide-react";

const CATEGORIES = ["all", "photographer", "florist", "caterer", "planner", "band", "dj", "officiant", "other"];

export default function VendorsPage() {
  const { data: vendors, isLoading } = trpc.vendors.list.useQuery({});

  const topReferrers = (vendors ?? [])
    .filter((v: any) => v.referrals_sent_12m > 0)
    .sort((a: any, b: any) => b.referrals_sent_12m - a.referrals_sent_12m)
    .slice(0, 3);

  const topAppearances = (vendors ?? [])
    .sort((a: any, b: any) => b.appearances_count - a.appearances_count)
    .slice(0, 3);

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Vendors</h1>
        <p className="text-sm text-gray-500 mt-1">
          Vendors who appear most at your events are your best referral partners.
          Track which photographers, florists, and planners send you new business
          — then invest your relationship-building where it pays off.
        </p>
      </div>

      {/* Callout cards if there's data */}
      {(vendors ?? []).length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          {/* Top referrers */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <ArrowUpRight size={15} className="text-green-600" />
              <p className="text-sm font-semibold text-gray-700">Top referrers (last 12 mo)</p>
            </div>
            {topReferrers.length > 0 ? (
              <div className="space-y-2">
                {topReferrers.map((v: any) => (
                  <div key={v.id} className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium text-gray-900">{v.name}</span>
                      <span className="text-xs text-gray-400 ml-1.5 capitalize">{v.category ?? "vendor"}</span>
                    </div>
                    <span className="text-sm font-semibold text-green-700">{v.referrals_sent_12m} leads</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400">
                No referral data yet. Add a &ldquo;referred by vendor&rdquo; source to client records to track this.
              </p>
            )}
          </div>

          {/* Most frequent */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Users size={15} className="text-blue-600" />
              <p className="text-sm font-semibold text-gray-700">Most frequent at events</p>
            </div>
            {topAppearances.length > 0 ? (
              <div className="space-y-2">
                {topAppearances.map((v: any) => (
                  <div key={v.id} className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium text-gray-900">{v.name}</span>
                      <span className="text-xs text-gray-400 ml-1.5 capitalize">{v.category ?? "vendor"}</span>
                    </div>
                    <span className="text-sm text-gray-600">{v.appearances_count} events</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400">No appearance data yet.</p>
            )}
          </div>
        </div>
      )}

      {/* Full vendor table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Vendor</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Category</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase" title="Number of your weddings they've worked">Events</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase" title="Average star rating from your couples who worked with them">Client review</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase" title="Inquiries they referred to you in the last 12 months">Referrals (12m)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
            )}
            {!isLoading && (vendors ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center">
                  <Store size={24} className="mx-auto text-gray-300 mb-2" />
                  <p className="text-sm text-gray-400 mb-1">No vendors yet</p>
                  <p className="text-xs text-gray-400 max-w-sm mx-auto">
                    Vendors are added automatically when you link them to client records.
                    Open a client profile and add a vendor to that wedding to see them appear here.
                  </p>
                </td>
              </tr>
            )}
            {(vendors ?? []).map((v: any) => (
              <tr key={v.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{v.name}</div>
                  {v.website && (
                    <a href={v.website} target="_blank" rel="noopener noreferrer"
                       className="text-xs text-blue-600 hover:underline">{v.website}</a>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-500 capitalize">{v.category ?? "—"}</td>
                <td className="px-4 py-3 text-gray-600 text-right">{v.appearances_count}</td>
                <td className="px-4 py-3 text-gray-600 text-right">
                  {v.avg_review_score ? (
                    <span className="flex items-center justify-end gap-1">
                      <Star size={12} className="text-amber-400 fill-amber-400" />
                      {v.avg_review_score}
                    </span>
                  ) : "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  {v.referrals_sent_12m > 0 ? (
                    <span className="font-medium text-green-700">{v.referrals_sent_12m}</span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(vendors ?? []).length > 0 && (
        <p className="text-xs text-gray-400">
          Vendor frequency is tracked from client records. Referral count comes from clients where the source was attributed to a vendor recommendation.
        </p>
      )}
    </div>
  );
}
