"use client";

import { trpc } from "@/lib/trpc/client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";

export default function AnalyticsPage() {
  const { data: sourceROI } = trpc.analytics.sourceROI.useQuery({});
  const { data: revenue } = trpc.analytics.revenueOverTime.useQuery({ years: 3 });
  const { data: timelines } = trpc.analytics.timelineBenchmarks.useQuery();

  return (
    <div className="max-w-6xl space-y-8">
      <h1 className="text-2xl font-semibold text-gray-900">Analytics</h1>

      {/* Source ROI */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Source ROI</h2>
        {sourceROI && sourceROI.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500 uppercase border-b border-gray-200">
                <tr>
                  <th className="text-left py-2 pr-4">Source</th>
                  <th className="text-right py-2 pr-4">Inquiries</th>
                  <th className="text-right py-2 pr-4">Booked</th>
                  <th className="text-right py-2 pr-4">Conv. rate</th>
                  <th className="text-right py-2 pr-4">Avg revenue</th>
                  <th className="text-right py-2 pr-4">Complexity</th>
                  <th className="text-right py-2">Review rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {sourceROI.map((row: any) => (
                  <tr key={row.source} className="hover:bg-gray-50">
                    <td className="py-2.5 pr-4 font-medium text-gray-900">{row.source}</td>
                    <td className="text-right py-2.5 pr-4 text-gray-600">{row.inquiryCount}</td>
                    <td className="text-right py-2.5 pr-4 text-gray-600">{row.bookedCount}</td>
                    <td className="text-right py-2.5 pr-4 text-gray-600">
                      {(row.conversionRate * 100).toFixed(0)}%
                    </td>
                    <td className="text-right py-2.5 pr-4 text-gray-600">
                      {row.avgRevenue ? `$${(row.avgRevenue / 100).toLocaleString()}` : "—"}
                    </td>
                    <td className="text-right py-2.5 pr-4 text-gray-600">
                      {row.avgComplexityScore ?? "—"}
                    </td>
                    <td className="text-right py-2.5 text-gray-600">
                      {(row.reviewRate * 100).toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-400">No source data yet. Sync your HoneyBook account in Settings.</p>
        )}
      </div>

      {/* Revenue over time */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Revenue over time</h2>
        {revenue && revenue.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={revenue}>
              <XAxis dataKey="period" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => `$${(v / 100000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: any) => `$${(v / 100).toLocaleString()}`} />
              <Bar dataKey="totalRevenue" fill="#3b82f6" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-sm text-gray-400">No revenue data yet.</p>
        )}
      </div>

      {/* Timeline benchmarks */}
      {timelines && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Tour → Booking timeline</h2>
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "Fastest 25%", value: timelines.tourToBookingDays.p25 },
              { label: "Median", value: timelines.tourToBookingDays.p50 },
              { label: "Slowest 25%", value: timelines.tourToBookingDays.p75 },
              { label: "Average", value: timelines.tourToBookingDays.mean },
            ].map(({ label, value }) => (
              <div key={label} className="bg-gray-50 rounded p-3 text-center">
                <div className="text-xl font-semibold text-gray-900">{value ?? "—"}</div>
                <div className="text-xs text-gray-500 mt-0.5">{label}</div>
                <div className="text-xs text-gray-400">days</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-3">n={timelines.tourToBookingDays.sampleSize} bookings</p>
        </div>
      )}
    </div>
  );
}
