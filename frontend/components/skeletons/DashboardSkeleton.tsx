/**
 * DashboardSkeleton — mirrors the dashboard layout while data loads.
 *
 * Prevents layout shift by matching the exact card structure of the
 * real dashboard: 2 summary cards + 3 contract cards in a grid.
 */

export default function DashboardSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading dashboard"
      className="px-4 py-6 sm:px-0"
    >
      {/* Summary cards row — 2 columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {Array.from({ length: 2 }).map((_, i) => (
          <div
            key={i}
            data-testid="summary-card-skeleton"
            className="bg-white rounded-xl shadow-card p-6"
          >
            {/* Label line */}
            <div className="skeleton h-3.5 w-28 rounded-md mb-3" />
            {/* Big number */}
            <div className="skeleton h-9 w-40 rounded-md mb-2" />
            {/* Subtext */}
            <div className="skeleton h-3 w-20 rounded-md" />
          </div>
        ))}
      </div>

      {/* Contract card grid — 3 columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            data-testid="contract-card-skeleton"
            className="bg-white rounded-xl shadow-card p-6"
          >
            {/* Title */}
            <div className="skeleton h-5 w-3/4 rounded-md mb-3" />
            {/* Badge */}
            <div className="skeleton h-4 w-16 rounded-full mb-4" />
            {/* Detail lines */}
            <div className="space-y-2 mb-4">
              <div className="skeleton h-3.5 w-full rounded-md" />
              <div className="skeleton h-3.5 w-5/6 rounded-md" />
              <div className="skeleton h-3.5 w-4/6 rounded-md" />
            </div>
            {/* Footer */}
            <div className="skeleton h-4 w-24 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  )
}
