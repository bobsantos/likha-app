/**
 * Sales Entry Page - Enter a new sales period for a contract
 */

'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import {
  ArrowLeft,
  DollarSign,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Loader2,
  BarChart3,
  Plus,
} from 'lucide-react'
import { getContracts, createSalesPeriod } from '@/lib/api'
import type { Contract, SalesPeriod, CategoryRate } from '@/types'

// ─── helpers ────────────────────────────────────────────────────────────────

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

function isCategoryRateContract(contract: Contract): boolean {
  return (
    typeof contract.royalty_rate === 'object' &&
    contract.royalty_rate !== null &&
    'type' in contract.royalty_rate &&
    (contract.royalty_rate as any).type === 'category'
  )
}

function getCategoryNames(contract: Contract): string[] {
  if (!isCategoryRateContract(contract)) return []
  const rate = contract.royalty_rate as CategoryRate
  return Object.keys(rate.rates)
}

// ─── component ───────────────────────────────────────────────────────────────

type PageState = 'form' | 'saving' | 'success'

export default function SalesNewPage() {
  const searchParams = useSearchParams()

  const [contracts, setContracts] = useState<Contract[]>([])
  const [loadingContracts, setLoadingContracts] = useState(true)
  const [contractsError, setContractsError] = useState<string | null>(null)

  const [selectedContractId, setSelectedContractId] = useState('')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [netSales, setNetSales] = useState('')
  const [categorySales, setCategorySales] = useState<Record<string, string>>({})

  const [pageState, setPageState] = useState<PageState>('form')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedPeriod, setSavedPeriod] = useState<SalesPeriod | null>(null)

  // Fetch active contracts on mount
  useEffect(() => {
    setLoadingContracts(true)
    getContracts()
      .then((data: Contract[]) => {
        const active = data.filter((c) => c.status === 'active')
        setContracts(active)

        // Pre-select from query param if present
        const preselect = searchParams.get('contract_id')
        if (preselect && active.some((c) => c.id === preselect)) {
          setSelectedContractId(preselect)
        }
      })
      .catch(() => {
        setContractsError('Failed to load contracts. Please try again.')
      })
      .finally(() => {
        setLoadingContracts(false)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectedContract = contracts.find((c) => c.id === selectedContractId) ?? null
  const categoryNames = selectedContract ? getCategoryNames(selectedContract) : []
  const showCategoryBreakdown = categoryNames.length > 0

  const handleContractChange = (id: string) => {
    setSelectedContractId(id)
    setCategorySales({})
  }

  const handleCategoryChange = (category: string, value: string) => {
    setCategorySales((prev) => ({ ...prev, [category]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!selectedContractId || !periodStart || !periodEnd || !netSales) return

    try {
      setPageState('saving')
      setSaveError(null)

      const payload: Record<string, unknown> = {
        contract_id: selectedContractId,
        period_start: periodStart,
        period_end: periodEnd,
        net_sales: parseFloat(netSales),
      }

      if (showCategoryBreakdown && Object.keys(categorySales).length > 0) {
        const categoryData: Record<string, number> = {}
        for (const [cat, val] of Object.entries(categorySales)) {
          if (val) categoryData[cat] = parseFloat(val)
        }
        if (Object.keys(categoryData).length > 0) {
          payload.category_sales = categoryData
        }
      }

      const result = await createSalesPeriod(payload)
      setSavedPeriod(result)
      setPageState('success')
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save sales period')
      setPageState('form')
    }
  }

  const handleReset = () => {
    setPeriodStart('')
    setPeriodEnd('')
    setNetSales('')
    setCategorySales({})
    setSavedPeriod(null)
    setSaveError(null)
    setPageState('form')
  }

  // ─── loading ────────────────────────────────────────────────────────────────

  if (loadingContracts) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="skeleton h-6 w-32 mb-6" />
        <div className="skeleton h-10 w-64 mb-8" />
        <div className="skeleton h-64" />
      </div>
    )
  }

  // ─── error loading contracts ─────────────────────────────────────────────

  if (contractsError) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Dashboard
        </Link>
        <div className="card border border-red-200 bg-red-50">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="text-sm font-semibold text-red-900">Error loading contracts</h3>
              <p className="text-sm text-red-700 mt-1">{contractsError}</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ─── success state ───────────────────────────────────────────────────────

  if (pageState === 'success' && savedPeriod) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Dashboard
        </Link>

        <div className="card animate-fade-in">
          <div className="text-center py-4">
            <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-1">Sales period saved</h2>
            <p className="text-gray-600 mb-6">
              Your sales data has been recorded and the royalty has been calculated.
            </p>

            {/* Royalty Result */}
            <div className="bg-primary-50 border border-primary-200 rounded-xl p-6 mb-6 text-left">
              <div className="flex items-center gap-2 mb-4">
                <DollarSign className="w-5 h-5 text-primary-600" />
                <h3 className="text-sm font-semibold text-primary-900 uppercase tracking-wide">
                  Royalty Calculated
                </h3>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-primary-700 mb-1">Net Sales</p>
                  <p className="text-lg font-semibold text-gray-900">
                    {formatCurrency(savedPeriod.net_sales)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-primary-700 mb-1">Calculated Royalty</p>
                  <p className="text-2xl font-bold text-primary-600">
                    {formatCurrency(savedPeriod.calculated_royalty)}
                  </p>
                </div>
              </div>

              {savedPeriod.minimum_applied && (
                <p className="text-xs text-primary-700 mt-3 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Minimum guarantee applied
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3 justify-center">
              <Link
                href={`/contracts/${selectedContractId}`}
                className="btn-secondary inline-flex items-center gap-2"
              >
                <BarChart3 className="w-4 h-4" />
                View Contract
              </Link>
              <button
                onClick={handleReset}
                className="btn-primary flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Enter Another Period
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ─── form ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Breadcrumb / back link */}
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Dashboard
      </Link>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Enter Sales Period</h1>
        <p className="mt-2 text-gray-600">
          Record sales for a reporting period and calculate the royalty owed.
        </p>
      </div>

      {/* No active contracts */}
      {contracts.length === 0 ? (
        <div className="card text-center py-12">
          <BarChart3 className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No active contracts</h3>
          <p className="text-gray-600 mb-6">
            You need at least one active contract before you can record sales.
          </p>
          <Link href="/contracts/upload" className="btn-primary">
            Upload a Contract
          </Link>
        </div>
      ) : (
        <div className="card animate-fade-in">
          {/* Inline save error */}
          {saveError && (
            <div className="flex items-start gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg mb-6">
              <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-red-700">{saveError}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Contract selector */}
            <div>
              <label
                htmlFor="contract-select"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Contract *
              </label>
              <select
                id="contract-select"
                value={selectedContractId}
                onChange={(e) => handleContractChange(e.target.value)}
                required
                className="input"
              >
                <option value="">Select a contract...</option>
                {contracts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.licensee_name ?? c.filename ?? c.id}
                  </option>
                ))}
              </select>
            </div>

            {/* Period dates */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="period-start"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  <span className="flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    Period Start *
                  </span>
                </label>
                <input
                  id="period-start"
                  type="date"
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                  required
                  className="input"
                />
              </div>

              <div>
                <label
                  htmlFor="period-end"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  <span className="flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    Period End *
                  </span>
                </label>
                <input
                  id="period-end"
                  type="date"
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                  required
                  className="input"
                />
              </div>
            </div>

            {/* Net sales */}
            <div>
              <label
                htmlFor="net-sales"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                <span className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4" />
                  Net Sales Amount *
                </span>
              </label>
              <input
                id="net-sales"
                type="number"
                value={netSales}
                onChange={(e) => setNetSales(e.target.value)}
                required
                min="0"
                step="0.01"
                placeholder="0.00"
                className="input"
              />
            </div>

            {/* Category breakdown (conditional) */}
            {showCategoryBreakdown && (
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4" />
                  Category Breakdown
                </h3>
                <p className="text-xs text-gray-600 mb-4">
                  This contract uses category-specific royalty rates. Enter the net sales for each
                  category (optional).
                </p>
                <div className="space-y-3">
                  {categoryNames.map((category) => (
                    <div key={category}>
                      <label
                        htmlFor={`category-${category}`}
                        className="block text-sm font-medium text-gray-700 mb-1"
                      >
                        {category}
                      </label>
                      <input
                        id={`category-${category}`}
                        type="number"
                        value={categorySales[category] ?? ''}
                        onChange={(e) => handleCategoryChange(category, e.target.value)}
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        className="input"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-4 border-t">
              <Link href="/dashboard" className="btn-secondary">
                Cancel
              </Link>
              <button
                type="submit"
                disabled={pageState === 'saving'}
                className="btn-primary flex items-center gap-2"
              >
                {pageState === 'saving' ? (
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
      )}
    </div>
  )
}
