/**
 * ContractCard component - Display contract summary
 */

import Link from 'next/link'
import { format } from 'date-fns'
import { Calendar, MapPin, DollarSign, BarChart3, ArrowRight } from 'lucide-react'
import type { Contract, TieredRate, CategoryRate } from '@/types'

interface ContractCardProps {
  contract: Contract
}

// Returns true if `value` is a plain dict of category->rate strings (the shape
// the backend stores when per-category rates are extracted from the contract PDF).
// e.g. { "Apparel": "10%", "Accessories": "12%", "Footwear": "8%" }
function isPlainCategoryDict(value: unknown): value is Record<string, string> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !('type' in (value as object))
  )
}

// Parse a rate value like "10%", "10", or 0.1 into a plain percentage number (10).
function parseRateToPercent(raw: string | number): number | null {
  if (typeof raw === 'number') {
    // Stored as a decimal fraction (0.10) — convert to percent
    return raw <= 1 ? raw * 100 : raw
  }
  const match = raw.match(/(\d+(\.\d+)?)/)
  return match ? parseFloat(match[1]) : null
}

export default function ContractCard({ contract }: ContractCardProps) {
  const formatRoyaltyRate = (rate: Contract['royalty_rate']): string => {
    if (typeof rate === 'string') {
      // Bare number string (e.g. "8", "10.5") — append "%" defensively
      if (/^\d+(\.\d+)?$/.test(rate)) {
        return `${rate}%`
      }
      return rate
    }

    if (typeof rate === 'number') {
      return `${(rate * 100).toFixed(0)}%`
    }

    if (rate !== null && typeof rate === 'object') {
      // Plain dict from the backend: { "Apparel": "10%", "Footwear": "8%" }
      if (isPlainCategoryDict(rate)) {
        const percents = Object.values(rate)
          .map(parseRateToPercent)
          .filter((n): n is number => n !== null)
        if (percents.length === 0) return 'Per Category'
        const min = Math.min(...percents)
        const max = Math.max(...percents)
        if (min === max) return `${min.toFixed(0)}% (Per Category)`
        return `${min.toFixed(0)}-${max.toFixed(0)}% (Per Category)`
      }

      if ('type' in rate) {
        if (rate.type === 'tiered') {
          const tierRate = rate as TieredRate
          const rates = tierRate.tiers.map(t => t.rate * 100)
          const min = Math.min(...rates)
          const max = Math.max(...rates)
          return `${min.toFixed(0)}-${max.toFixed(0)}%`
        }

        if (rate.type === 'category') {
          const catRate = rate as CategoryRate
          const percents = Object.values(catRate.rates).map(r => r * 100)
          if (percents.length === 0) return 'Per Category'
          const min = Math.min(...percents)
          const max = Math.max(...percents)
          if (min === max) return `${min.toFixed(0)}% (Per Category)`
          return `${min.toFixed(0)}-${max.toFixed(0)}% (Per Category)`
        }
      }
    }

    return 'N/A'
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A'
    try {
      return format(new Date(dateString), 'MMM d, yyyy')
    } catch {
      return 'N/A'
    }
  }

  const formatCurrency = (amount: number | null) => {
    if (amount === null) return null
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount)
  }

  const isDraft = contract.status === 'draft'
  const href = isDraft
    ? `/contracts/upload?draft=${contract.id}`
    : `/contracts/${contract.id}`

  return (
    <Link href={href}>
      <div className="card-interactive">
        <div className="flex justify-between items-start mb-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-lg font-semibold text-gray-900">
                {contract.licensee_name ?? (contract.extracted_terms as any)?.licensee_name ?? contract.filename ?? 'Untitled Draft'}
              </h3>
              {isDraft ? (
                <span className="badge-warning">Draft</span>
              ) : (
                <span className="badge-success">Active</span>
              )}
            </div>
            {isDraft && (
              <p className="text-xs text-gray-500">
                Uploaded on {formatDate(contract.created_at)}
              </p>
            )}
          </div>
        </div>

        {!isDraft && (
          <div className="space-y-3 text-sm text-gray-600">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <div className="flex justify-between w-full">
                <span>Royalty Rate:</span>
                <span className="text-gray-900 font-medium">
                  {contract.royalty_rate !== null
                    ? (() => {
                        const rateStr = formatRoyaltyRate(contract.royalty_rate)
                        const isPerCategory = isPlainCategoryDict(contract.royalty_rate) ||
                          (contract.royalty_rate !== null &&
                            typeof contract.royalty_rate === 'object' &&
                            'type' in (contract.royalty_rate as object) &&
                            (contract.royalty_rate as { type: string }).type === 'category')
                        const baseSuffix = !isPerCategory && contract.royalty_base
                          ? ` of ${contract.royalty_base === 'net_sales' ? 'Net Sales' : 'Gross Sales'}`
                          : ''
                        return `${rateStr}${baseSuffix}`
                      })()
                    : 'N/A'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <div className="flex justify-between w-full">
                <span>Contract Period:</span>
                <span className="text-gray-900 font-medium">
                  {formatDate(contract.contract_start_date)} - {formatDate(contract.contract_end_date)}
                </span>
              </div>
            </div>

            {contract.territories && contract.territories.length > 0 && (
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <div className="flex justify-between w-full">
                  <span>Territories:</span>
                  <span className="text-gray-900 font-medium">{contract.territories.join(', ')}</span>
                </div>
              </div>
            )}

            {contract.minimum_guarantee && (
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <div className="flex justify-between w-full">
                  <span>Minimum Guarantee:</span>
                  <span className="text-gray-900 font-semibold">
                    {formatCurrency(contract.minimum_guarantee)}
                  </span>
                </div>
              </div>
            )}

            {contract.reporting_frequency && (
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <div className="flex justify-between w-full">
                  <span>Reporting:</span>
                  <span className="text-gray-900 font-medium capitalize">
                    {contract.reporting_frequency.replace('_', ' ')}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between text-sm text-primary-600 font-medium">
          {isDraft ? (
            <span>Resume review</span>
          ) : (
            <span>View details</span>
          )}
          <ArrowRight className="w-4 h-4" />
        </div>
      </div>
    </Link>
  )
}
