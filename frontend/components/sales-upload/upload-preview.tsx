/**
 * UploadPreview component — Step 3 of the sales upload wizard.
 *
 * Shows the first few rows of parsed data re-labeled with mapped column headers,
 * aggregated totals, and the calculated royalty. If the period has a discrepancy
 * (licensee_reported_royalty vs royalty_calculated), it renders a discrepancy card.
 */

'use client'

import { AlertCircle, ArrowLeft, Loader2, CheckCircle } from 'lucide-react'
import type { SalesPeriod, UploadWarning } from '@/types'

export interface MappedHeader {
  originalColumn: string
  field: string
  label: string
}

export interface UploadPreviewProps {
  sampleRows: Record<string, string>[]
  mappedHeaders: MappedHeader[]
  totalRows: number
  salesPeriod: SalesPeriod
  uploadWarnings?: UploadWarning[]
  onConfirm: () => void
  onBack: () => void
  confirming: boolean
  confirmError: string | null
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

export default function UploadPreview({
  sampleRows,
  mappedHeaders,
  totalRows,
  salesPeriod,
  uploadWarnings = [],
  onConfirm,
  onBack,
  confirming,
  confirmError,
}: UploadPreviewProps) {
  const { net_sales, royalty_calculated, category_breakdown, licensee_reported_royalty, discrepancy_amount, has_discrepancy } = salesPeriod

  return (
    <div className="space-y-6">
      {/* Preview table card */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Preview</h2>
          <span className="text-sm text-gray-500">{totalRows} rows total</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                {mappedHeaders.map((header, i) => (
                  <th
                    key={`${header.field}-${i}`}
                    className="text-left py-2 px-3 text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap"
                  >
                    {header.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sampleRows.map((row, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  {mappedHeaders.map((header, j) => (
                    <td key={`${header.field}-${j}`} className="py-2 px-3 text-gray-900">
                      {row[header.originalColumn] ?? '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalRows > 5 && (
          <p className="mt-3 text-xs text-gray-500 text-center">
            Showing {sampleRows.length} of {totalRows} rows. All rows will be included.
          </p>
        )}
      </div>

      {/* Aggregated totals card */}
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-700 mb-4 uppercase tracking-wide">
          Aggregated Totals
        </h3>

        {/* Category breakdown — shown when category_breakdown exists */}
        {category_breakdown && Object.keys(category_breakdown).length > 0 && (
          <div className="mb-4 space-y-2">
            {Object.entries(category_breakdown).map(([cat, amount]) => (
              <div key={cat} className="flex justify-between text-sm">
                <span className="text-gray-600">{cat}</span>
                <span className="font-medium text-gray-900 tabular-nums">
                  {formatCurrency(amount)}
                </span>
              </div>
            ))}
            <div className="border-t border-gray-200 pt-2 flex justify-between text-sm font-semibold">
              <span className="text-gray-900">Total Net Sales</span>
              <span className="text-gray-900 tabular-nums">{formatCurrency(net_sales)}</span>
            </div>
          </div>
        )}

        {/* No category breakdown */}
        {(!category_breakdown || Object.keys(category_breakdown).length === 0) && (
          <div className="flex justify-between text-sm mb-4">
            <span className="text-gray-600">Total Net Sales</span>
            <span className="font-semibold text-gray-900 tabular-nums">
              {formatCurrency(net_sales)}
            </span>
          </div>
        )}
      </div>

      {/* Zero net sales warning — non-blocking, just a heads-up */}
      {net_sales === 0 && (
        <div
          className="flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg"
          role="alert"
          data-testid="zero-net-sales-warning"
        >
          <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-amber-700">
            Total net sales is $0.00 — are you sure this is correct?
          </p>
        </div>
      )}

      {/* Royalty calculation card */}
      <div className="card bg-primary-50 border border-primary-100">
        <h3 className="text-sm font-semibold text-primary-800 mb-3 uppercase tracking-wide">
          Royalty Calculation
        </h3>
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-primary-700">Net Sales</span>
            <span className="font-medium text-primary-900 tabular-nums">
              {formatCurrency(net_sales)}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-primary-700">System Calculated Royalty</span>
            <span className="text-2xl font-bold text-primary-700 tabular-nums">
              {formatCurrency(royalty_calculated)}
            </span>
          </div>

          {/* Discrepancy — shown when licensee_reported_royalty is present */}
          {licensee_reported_royalty !== null && licensee_reported_royalty !== undefined && (
            <>
              <div className="flex justify-between text-sm pt-2 border-t border-primary-200">
                <span className="text-primary-700">Licensee Reported</span>
                <span className="font-medium text-primary-900 tabular-nums">
                  {formatCurrency(licensee_reported_royalty)}
                </span>
              </div>
              {discrepancy_amount !== null && discrepancy_amount !== undefined && (
                Math.abs(discrepancy_amount) > 0.01 ? (
                  <div
                    className={`
                      flex items-start gap-2 px-3 py-2 rounded-lg text-sm mt-2
                      ${discrepancy_amount > 0
                        ? 'bg-amber-50 border border-amber-200 text-amber-800'
                        : 'bg-primary-100 border border-primary-200 text-primary-800'
                      }
                    `}
                  >
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>
                      {discrepancy_amount > 0
                        ? `Licensee under-reported by ${formatCurrency(discrepancy_amount)} — they may owe more.`
                        : `Licensee over-reported by ${formatCurrency(Math.abs(discrepancy_amount))}.`
                      }
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm mt-2 bg-green-50 border border-green-200 text-green-700">
                    <CheckCircle className="w-4 h-4 flex-shrink-0" />
                    <span>Reported royalty matches our calculation.</span>
                  </div>
                )
              )}
            </>
          )}
        </div>
      </div>

      {/* Upload warnings — non-blocking amber callout cards */}
      {uploadWarnings.length > 0 && (
        <div className="space-y-3">
          {uploadWarnings.map((warning, i) => (
            <div
              key={i}
              className="flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg"
            >
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800">{warning.message}</p>
            </div>
          ))}
        </div>
      )}

      {/* Error message */}
      {confirmError && (
        <div
          role="alert"
          className="flex items-start gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg animate-fade-in"
        >
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-red-900">Could not create sales period</p>
            <p className="text-sm text-red-700 mt-0.5">{confirmError}</p>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between pt-2">
        <button onClick={onBack} className="btn-secondary flex items-center gap-2">
          <ArrowLeft className="w-4 h-4" />
          Edit Mapping
        </button>
        <button
          onClick={onConfirm}
          disabled={confirming}
          className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {confirming ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Creating period...
            </>
          ) : (
            <>
              <CheckCircle className="w-4 h-4" />
              Confirm &amp; Create Period
            </>
          )}
        </button>
      </div>
    </div>
  )
}
