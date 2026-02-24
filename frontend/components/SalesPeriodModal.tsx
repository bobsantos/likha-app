/**
 * SalesPeriodModal - Modal for entering sales period data
 */

'use client'

import { useState, useEffect } from 'react'
import { X, Banknote, Calendar, Loader2 } from 'lucide-react'
import { createSalesPeriod } from '@/lib/api'
import type { Contract, TieredRate, CategoryRate } from '@/types'

interface SalesPeriodModalProps {
  contract: Contract
  isOpen: boolean
  onClose: () => void
  onSaved: () => void
}

export default function SalesPeriodModal({
  contract,
  isOpen,
  onClose,
  onSaved,
}: SalesPeriodModalProps) {
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [netSales, setNetSales] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [calculatedRoyalty, setCalculatedRoyalty] = useState<number | null>(null)

  // Calculate royalty preview
  useEffect(() => {
    if (!netSales || parseFloat(netSales) <= 0) {
      setCalculatedRoyalty(null)
      return
    }

    const sales = parseFloat(netSales)
    const rate = contract.royalty_rate

    if (typeof rate === 'number') {
      setCalculatedRoyalty(sales * rate)
    } else if (typeof rate === 'object' && 'type' in rate) {
      if (rate.type === 'tiered') {
        const tierRate = rate as TieredRate
        let royalty = 0

        for (const tier of tierRate.tiers) {
          const tierMin = tier.min
          const tierMax = tier.max || Infinity

          if (sales >= tierMin) {
            const applicableAmount = Math.min(sales, tierMax) - tierMin
            royalty += applicableAmount * tier.rate
          }
        }

        setCalculatedRoyalty(royalty)
      } else if (rate.type === 'category') {
        // For category rates, we can't calculate without category breakdown
        setCalculatedRoyalty(null)
      }
    }
  }, [netSales, contract.royalty_rate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!periodStart || !periodEnd || !netSales) {
      setError('Please fill in all required fields')
      return
    }

    try {
      setLoading(true)
      setError(null)

      await createSalesPeriod({
        contract_id: contract.id,
        period_start: periodStart,
        period_end: periodEnd,
        net_sales: parseFloat(netSales),
      })

      // Reset form
      setPeriodStart('')
      setPeriodEnd('')
      setNetSales('')
      setCalculatedRoyalty(null)

      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save sales period')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    if (!loading) {
      setPeriodStart('')
      setPeriodEnd('')
      setNetSales('')
      setError(null)
      setCalculatedRoyalty(null)
      onClose()
    }
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  }

  const isCategoryRate =
    typeof contract.royalty_rate === 'object' &&
    'type' in contract.royalty_rate &&
    contract.royalty_rate.type === 'category'

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6 animate-slide-up">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-900">Enter Sales Period</h2>
            <button
              onClick={handleClose}
              disabled={loading}
              className="text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  Period Start Date *
                </div>
              </label>
              <input
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                required
                disabled={loading}
                className="input"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  Period End Date *
                </div>
              </label>
              <input
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                required
                disabled={loading}
                className="input"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <div className="flex items-center gap-2">
                  <Banknote className="w-4 h-4" />
                  Net Sales Amount *
                </div>
              </label>
              <input
                type="number"
                value={netSales}
                onChange={(e) => setNetSales(e.target.value)}
                required
                disabled={loading}
                min="0"
                step="0.01"
                placeholder="0.00"
                className="input"
              />
            </div>

            {/* Royalty Preview */}
            {calculatedRoyalty !== null && (
              <div className="bg-primary-50 border border-primary-200 rounded-lg p-4">
                <p className="text-sm text-primary-900 font-medium mb-1">
                  Estimated Royalty
                </p>
                <p className="text-2xl font-bold text-primary-600">
                  {formatCurrency(calculatedRoyalty)}
                </p>
                <p className="text-xs text-primary-700 mt-1">
                  Final amount may vary based on minimum guarantee and other terms
                </p>
              </div>
            )}

            {isCategoryRate && netSales && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <p className="text-sm text-amber-900">
                  This contract uses category-specific rates. The royalty will be calculated based on the category breakdown.
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-4 border-t">
              <button
                type="button"
                onClick={handleClose}
                disabled={loading}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="btn-primary flex-1 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
