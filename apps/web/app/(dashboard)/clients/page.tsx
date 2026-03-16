"use client";

import { trpc } from "@/lib/trpc/client";
import { useState } from "react";
import { format } from "date-fns";
import { Users, Search } from "lucide-react";
import Link from "next/link";

const STATUS_COLORS: Record<string, string> = {
  inquiry: "bg-gray-100 text-gray-600",
  tour_booked: "bg-blue-100 text-blue-700",
  booked: "bg-indigo-100 text-indigo-700",
  planning: "bg-purple-100 text-purple-700",
  event_complete: "bg-green-100 text-green-700",
  archived: "bg-gray-100 text-gray-400",
};

export default function ClientsPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data, isLoading } = trpc.clients.list.useQuery({
    search: search || undefined,
    status: statusFilter !== "all" ? statusFilter as any : undefined,
    limit: 100,
    offset: 0,
  });

  return (
    <div className="max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Clients</h1>
          <p className="text-sm text-gray-500 mt-0.5">{data?.total ?? 0} records</p>
        </div>
      </div>

      {/* Search + filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border border-gray-300 rounded-md pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {["all", "inquiry", "tour_booked", "booked", "planning", "event_complete", "archived"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                statusFilter === s
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
              }`}
            >
              {s === "all" ? "All" : s.replace(/_/g, " ")}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Client</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Event date</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Source</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Revenue</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Review</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
            )}
            {!isLoading && (data?.clients ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center">
                  <Users size={24} className="mx-auto text-gray-300 mb-2" />
                  <p className="text-sm text-gray-400">No clients yet</p>
                </td>
              </tr>
            )}
            {(data?.clients ?? []).map((client: any) => (
              <tr key={client.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link href={`/clients/${client.id}`} className="font-medium text-gray-900 hover:text-blue-600">
                    {client.name_primary}
                  </Link>
                  {client.name_partner && (
                    <span className="text-gray-400"> & {client.name_partner}</span>
                  )}
                  {client.email_primary && (
                    <p className="text-xs text-gray-400">{client.email_primary}</p>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-500">
                  {client.event_date
                    ? format(new Date(client.event_date), "MMM d, yyyy")
                    : "TBD"}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[client.status] ?? "bg-gray-100 text-gray-600"}`}>
                    {client.status.replace(/_/g, " ")}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  {client.resolved_source ?? client.first_touch_platform ?? "—"}
                </td>
                <td className="px-4 py-3 text-gray-700">
                  {client.revenue_cents
                    ? `$${(client.revenue_cents / 100).toLocaleString()}`
                    : "—"}
                </td>
                <td className="px-4 py-3 text-gray-700">
                  {client.review_star_rating
                    ? `${client.review_star_rating}★`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
