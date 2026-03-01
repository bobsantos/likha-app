/**
 * ContractDetailSkeleton — mirrors the contract detail page layout while loading.
 *
 * Structure matches the real page:
 *   breadcrumb → header card → lg:grid-cols-3 (terms | sidebar) → sales table
 */

import TableSkeleton from './TableSkeleton'

export default function ContractDetailSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading contract"
      className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8"
    >
      {/* Breadcrumb */}
      <div
        data-testid="breadcrumb-skeleton"
        className="flex items-center gap-2 mb-6"
      >
        <div className="skeleton h-3.5 w-20 rounded-md" />
        <div className="skeleton h-3.5 w-2 rounded-md" />
        <div className="skeleton h-3.5 w-32 rounded-md" />
      </div>

      {/* Header card */}
      <div
        data-testid="header-skeleton"
        className="bg-white rounded-xl shadow-card p-6 mb-6"
      >
        <div className="flex items-start justify-between">
          <div className="space-y-3 flex-1">
            {/* Contract name */}
            <div className="skeleton h-8 w-64 rounded-md" />
            {/* Badges row */}
            <div className="flex items-center gap-3">
              <div className="skeleton h-5 w-16 rounded-full" />
              <div className="skeleton h-5 w-24 rounded-md" />
            </div>
          </div>
          {/* Action buttons */}
          <div className="flex gap-3">
            <div className="skeleton h-9 w-28 rounded-lg" />
            <div className="skeleton h-9 w-24 rounded-lg" />
          </div>
        </div>
      </div>

      {/* Main grid */}
      <div className="grid gap-6 lg:grid-cols-3 mb-6">
        {/* Terms card — spans 2 columns */}
        <div className="lg:col-span-2 bg-white rounded-xl shadow-card p-6">
          {/* Section title */}
          <div className="skeleton h-6 w-40 rounded-md mb-6" />
          {/* Icon + text rows */}
          <div className="space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="skeleton h-5 w-5 rounded-md flex-shrink-0" />
                <div className="space-y-1.5 flex-1">
                  <div className="skeleton h-3 w-24 rounded-md" />
                  <div className="skeleton h-4 w-40 rounded-md" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Sidebar — 2 stat cards */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-card p-6">
            <div className="skeleton h-3.5 w-28 rounded-md mb-2" />
            <div className="skeleton h-9 w-36 rounded-md" />
          </div>
          <div className="bg-white rounded-xl shadow-card p-6">
            <div className="skeleton h-3.5 w-24 rounded-md mb-2" />
            <div className="skeleton h-9 w-16 rounded-md" />
          </div>
        </div>
      </div>

      {/* Sales table card */}
      <div
        data-testid="table-skeleton-container"
        className="bg-white rounded-xl shadow-card p-6"
      >
        <div className="skeleton h-6 w-36 rounded-md mb-6" />
        <TableSkeleton rows={4} cols={5} />
      </div>
    </div>
  )
}
