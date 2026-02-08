/**
 * ContractCard component - Display contract summary
 */

import Link from 'next/link'
import { format } from 'date-fns'
import type { Contract, TieredRate, CategoryRate } from '@/types'

interface ContractCardProps {
  contract: Contract
}

export default function ContractCard({ contract }: ContractCardProps) {
  const formatRoyaltyRate = (rate: Contract['royalty_rate']): string => {
    if (typeof rate === 'number') {
      return `${(rate * 100).toFixed(0)}%`
    }

    if (typeof rate === 'object' && 'type' in rate) {
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

  return (
    <Link href={`/contracts/${contract.id}`}>
      <div className="bg-white rounded-lg shadow p-6 hover:shadow-md transition-shadow cursor-pointer">
        <div className="flex justify-between items-start mb-4">
          <h3 className="text-lg font-semibold text-gray-900">
            {contract.licensee_name}
          </h3>
          <span className="text-2xl font-bold text-blue-600">
            {formatRoyaltyRate(contract.royalty_rate)}
          </span>
        </div>

        <div className="space-y-2 text-sm text-gray-600">
          <div className="flex justify-between">
            <span>Contract Period:</span>
            <span className="text-gray-900">
              {formatDate(contract.contract_start)} - {formatDate(contract.contract_end)}
            </span>
          </div>

          {contract.territories && contract.territories.length > 0 && (
            <div className="flex justify-between">
              <span>Territories:</span>
              <span className="text-gray-900">{contract.territories.join(', ')}</span>
            </div>
          )}

          {contract.minimum_guarantee && (
            <div className="flex justify-between">
              <span>Minimum Guarantee:</span>
              <span className="text-gray-900 font-semibold">
                {formatCurrency(contract.minimum_guarantee)}
              </span>
            </div>
          )}

          <div className="flex justify-between">
            <span>Reporting:</span>
            <span className="text-gray-900 capitalize">
              {contract.reporting_frequency.replace('_', ' ')}
            </span>
          </div>
        </div>
      </div>
    </Link>
  )
}
