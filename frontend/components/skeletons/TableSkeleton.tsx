/**
 * TableSkeleton — placeholder table while data is loading.
 *
 * Props:
 *   rows  — number of data rows to render (default: 4)
 *   cols  — number of columns per row (default: 5)
 *
 * Rows fade out slightly with each row to give a natural trailing effect.
 */

const CYCLING_WIDTHS = ['w-32', 'w-24', 'w-24', 'w-24', 'w-16']

interface TableSkeletonProps {
  rows?: number
  cols?: number
}

export default function TableSkeleton({ rows = 4, cols = 5 }: TableSkeletonProps) {
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr
            className="border-b border-gray-200"
            data-testid="table-skeleton-header"
          >
            {Array.from({ length: cols }).map((_, col) => (
              <th key={col} className="py-3 px-4">
                <div className={`skeleton h-3.5 ${CYCLING_WIDTHS[col % CYCLING_WIDTHS.length]} rounded-md`} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {Array.from({ length: rows }).map((_, row) => (
            <tr
              key={row}
              data-testid="table-skeleton-row"
              style={{ opacity: 1 - row * 0.12 }}
            >
              {Array.from({ length: cols }).map((_, col) => (
                <td key={col} className="py-3 px-4" data-testid="table-skeleton-cell">
                  <div
                    className={`skeleton h-3.5 ${CYCLING_WIDTHS[col % CYCLING_WIDTHS.length]} rounded-md`}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
