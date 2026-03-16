"use client";

import { trpc } from "@/lib/trpc/client";
import { Store } from "lucide-react";

const CATEGORIES = ["all", "photographer", "florist", "caterer", "planner", "band", "other"];

export default function VendorsPage() {
  const { data: vendors, isLoading } = trpc.vendors.list.useQuery({});

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Vendors</h1>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Vendor</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Category</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Appearances</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Avg review</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Referrals (12m)</th>
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
                  <p className="text-sm text-gray-400">No vendors yet. They'll be added automatically from client records.</p>
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
                  {v.avg_review_score ? `${v.avg_review_score}★` : "—"}
                </td>
                <td className="px-4 py-3 text-gray-600 text-right">{v.referrals_sent_12m}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
