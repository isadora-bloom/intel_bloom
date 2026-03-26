"use client";

/**
 * Reusable skeleton loaders that match the layout of loaded content.
 * Brief: "Every data-dependent view shows a skeleton loader, not a spinner."
 */

export function CardSkeleton({ lines = 2 }: { lines?: number }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 animate-pulse">
      <div className="h-3 bg-gray-100 rounded w-24 mb-3" />
      <div className="h-7 bg-gray-100 rounded w-16 mb-2" />
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-2.5 bg-gray-100 rounded w-full mt-2" />
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden animate-pulse">
      {/* Header */}
      <div className="border-b border-gray-100 px-5 py-3 flex gap-6">
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="h-3 bg-gray-100 rounded flex-1" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="border-b border-gray-50 px-5 py-3 flex gap-6">
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className={`h-3 bg-gray-50 rounded flex-1 ${c === 0 ? "w-32" : ""}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton({ height = 260 }: { height?: number }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 animate-pulse">
      <div className="h-3 bg-gray-100 rounded w-32 mb-4" />
      <div className="rounded bg-gray-50" style={{ height }} />
    </div>
  );
}

export function StatCardRow({ count = 4 }: { count?: number }) {
  return (
    <div className={`grid grid-cols-2 sm:grid-cols-${Math.min(count, 4)} gap-3`}>
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} lines={1} />
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div className="h-6 bg-gray-100 rounded w-48 animate-pulse" />
      <div className="h-3 bg-gray-50 rounded w-72 animate-pulse" />
      <StatCardRow count={4} />
      <ChartSkeleton />
      <TableSkeleton />
    </div>
  );
}
