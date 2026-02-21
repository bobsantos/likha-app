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

export default function ContractCard({ contract }: ContractCardProps) {
  const formatRoyaltyRate = (rate: Contract['royalty_rate']): string => {
    if (typeof rate === 'string') {
      return rate
    }

    if (typeof rate === 'number') {
      return `${(rate * 100).toFixed(0)}%`
    }

    if (rate !== null && typeof rate === 'object' && 'type' in rate) {
      if (rate.type === 'tiered') {
        const tierRate = rate as TieredRate
        const rates = tierRate.tiers.map(t => t.rate * 100)
        const min = Math.min(...rates)
        const max = Math.max(...rates)
        return `${min.toFixed(0)}-${max.toFixed(0)}%`
      }

      if (rate.type === 'category') {
        return 'Category Rates'
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
                    ? `${formatRoyaltyRate(contract.royalty_rate)}${contract.royalty_base ? ` of ${contract.royalty_base === 'net_sales' ? 'Net Sales' : 'Gross Sales'}` : ''}`
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
