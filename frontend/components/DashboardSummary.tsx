/**
 * DashboardSummary component - Display high-level metrics
 */

import { FileText, DollarSign } from 'lucide-react'

interface DashboardSummaryProps {
  totalContracts: number
  ytdRoyalties: number
}

export default function DashboardSummary({
  totalContracts,
  ytdRoyalties,
}: DashboardSummaryProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
      <div className="card group">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600 mb-1">Active Contracts</p>
            <p className="text-3xl font-bold text-gray-900">{totalContracts}</p>
            <p className="text-xs text-gray-500 mt-1">Currently active agreements</p>
          </div>
          <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center">
            <FileText className="w-6 h-6 text-primary-600 group-hover:scale-110 transition-transform" />
          </div>
        </div>
      </div>

      <div className="card group">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600 mb-1">YTD Royalties</p>
            <p className="text-3xl font-bold text-gray-900">
              {formatCurrency(ytdRoyalties)}
            </p>
            <p className="text-xs text-gray-500 mt-1">Total earnings this year</p>
          </div>
          <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
            <DollarSign className="w-6 h-6 text-green-600 group-hover:scale-110 transition-transform" />
          </div>
        </div>
      </div>
    </div>
  )
}
