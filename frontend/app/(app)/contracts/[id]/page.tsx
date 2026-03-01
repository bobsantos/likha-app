/**
 * Contract Detail Page - View contract details and sales periods
 */

'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import {
  ArrowLeft,
  Calendar,
  MapPin,
  Banknote,
  BarChart3,
  FileText,
  ExternalLink,
  AlertCircle,
  Upload,
  TrendingDown,
  TrendingUp,
  Download,
  Mail,
  Hash,
  CheckCircle2,
  ClipboardList,
  Copy,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { getContract, getSalesPeriods, getSalesReportDownloadUrl, getContractTotals, downloadReportTemplate, isUnauthorizedError } from '@/lib/api'
import { resolveUrl } from '@/lib/url-utils'
import { copyToClipboard } from '@/lib/clipboard'
import ContractDetailSkeleton from '@/components/skeletons/ContractDetailSkeleton'
import type { Contract, SalesPeriod, TieredRate, CategoryRate, ContractTotals } from '@/types'

// ---------------------------------------------------------------------------
// DiscrepancyCell — inline presentational component, no state, no API calls
// ---------------------------------------------------------------------------

function formatCurrencyStandalone(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

function DiscrepancyCell({
  amount,
  percentage,
}: {
  amount: number
  percentage: number | null
}) {
  const isExact = Math.abs(amount) <= 0.01
  const isUnder = amount > 0.01

  if (isExact) {
    return (
      <div className="flex flex-col items-end gap-1">
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
          Match
        </span>
        <span className="text-xs text-green-600 tabular-nums">$0.00</span>
      </div>
    )
  }

  if (isUnder) {
    return (
      <div className="flex flex-col items-end gap-1">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
          <TrendingDown className="w-3 h-3" />
          Under-reported
        </span>
        <span className="text-xs font-medium text-red-600 tabular-nums">
          +{formatCurrencyStandalone(amount)}
          {percentage !== null && (
            <span className="text-red-400 ml-1">({percentage.toFixed(1)}%)</span>
          )}
        </span>
      </div>
    )
  }

  // Over-reported
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
        <TrendingUp className="w-3 h-3" />
        Over-reported
      </span>
      <span className="text-xs font-medium text-amber-600 tabular-nums">
        {formatCurrencyStandalone(amount)}
        {percentage !== null && (
          <span className="text-amber-400 ml-1">({percentage.toFixed(1)}%)</span>
        )}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------

export default function ContractDetailPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const contractId = params.id as string

  const [contract, setContract] = useState<Contract | null>(null)
  const [salesPeriods, setSalesPeriods] = useState<SalesPeriod[]>([])
  const [contractTotals, setContractTotals] = useState<ContractTotals | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [downloadingPeriodId, setDownloadingPeriodId] = useState<string | null>(null)
  const [downloadingTemplate, setDownloadingTemplate] = useState(false)

  // Scroll to hash anchor after data loads (e.g., #sales-periods from upload wizard link)
  useEffect(() => {
    if (!loading && window.location.hash) {
      const el = document.querySelector(window.location.hash)
      el?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [loading])

  const fetchData = async () => {
    setLoading(true)
    setError(null)

    try {
      const [contractData, salesData, totalsData] = await Promise.all([
        getContract(contractId),
        getSalesPeriods(contractId),
        getContractTotals(contractId).catch(() => null),
      ])

      setContract(contractData)
      setSalesPeriods(salesData)
      setContractTotals(totalsData)
      setLoading(false)
    } catch (err) {
      if (isUnauthorizedError(err)) {
        router.push('/login')
        // Keep loading=true so no error panel flashes before navigation
        return
      }
      setError("We couldn't load this contract. Please try again.")
      setLoading(false)
    }
  }

  const handleDownloadSourceFile = async (periodId: string) => {
    if (downloadingPeriodId) return
    try {
      setDownloadingPeriodId(periodId)
      const rawUrl = await getSalesReportDownloadUrl(contractId, periodId)
      window.open(resolveUrl(rawUrl), '_blank', 'noopener,noreferrer')
    } catch {
      toast.error('Could not download file. Please try again.')
    } finally {
      setDownloadingPeriodId(null)
    }
  }

  const handleDownloadTemplate = async () => {
    if (downloadingTemplate) return
    setDownloadingTemplate(true)
    try {
      await downloadReportTemplate(contractId)
    } catch {
      toast.error('Template download failed. Please try again.')
    } finally {
      setDownloadingTemplate(false)
    }
  }

  const handleCopyAgreementNumber = async (agreementNumber: string) => {
    const success = await copyToClipboard(agreementNumber)
    if (success) {
      toast.success('Copied to clipboard')
    } else {
      toast.error('Could not copy — select the text manually')
    }
  }

  const handleCopyInstructions = async (agreementNumber: string) => {
    const message = `Please include the following reference in your royalty report emails:\nAgreement Reference: ${agreementNumber}`
    const success = await copyToClipboard(message)
    if (success) {
      toast.success('Copied to clipboard')
    } else {
      toast.error('Could not copy — select the text manually')
    }
  }

  const handleCopySuccessCallout = async (agreementNumber: string) => {
    const message = `Please include the following reference in your royalty report emails:\nAgreement Reference: ${agreementNumber}`
    const success = await copyToClipboard(message)
    if (success) {
      toast.success('Copied to clipboard')
    } else {
      toast.error('Could not copy — select the text manually')
    }
  }

  useEffect(() => {
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractId])

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A'
    try {
      return format(new Date(dateString), 'MMM d, yyyy')
    } catch {
      return 'N/A'
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

  // Returns true if `value` is a plain dict of category->rate strings from the backend.
  // e.g. { "Apparel": "10%", "Accessories": "12%", "Footwear": "8%" }
  const isPlainCategoryDict = (value: unknown): value is Record<string, string> => {
    return (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !('type' in (value as object))
    )
  }

  // Parse a rate value like "10%", "10", or 0.1 into a plain percentage number (10).
  const parseRateToPercent = (raw: string | number): number | null => {
    if (typeof raw === 'number') {
      return raw <= 1 ? raw * 100 : raw
    }
    const match = raw.match(/(\d+(\.\d+)?)/)
    return match ? parseFloat(match[1]) : null
  }

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
          const rates = tierRate.tiers.map((t) => t.rate * 100)
          const min = Math.min(...rates)
          const max = Math.max(...rates)
          return `${min.toFixed(0)}-${max.toFixed(0)}% (Tiered)`
        }

        if (rate.type === 'category') {
          const catRate = rate as CategoryRate
          const percents = Object.values(catRate.rates).map((r) => r * 100)
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

  if (loading) {
    return <ContractDetailSkeleton />
  }

  if (error || !contract) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Link
          href="/contracts"
          className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Contracts
        </Link>

        <div className="card border border-red-200 bg-red-50">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-red-900">Error loading contract</h3>
              <p className="text-sm text-red-700 mt-1">{error || 'Contract not found'}</p>
              <button
                onClick={fetchData}
                className="mt-3 text-sm font-medium text-red-600 hover:text-red-700 underline"
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const isJustConfirmed = searchParams.get('success') === 'period_created'

  const totalRoyalties = contractTotals?.total_royalties ?? 0
  const royaltiesByYear = contractTotals?.by_year ?? []

  const totalUnderReported = salesPeriods
    .filter((p) => (Number(p.discrepancy_amount) ?? 0) > 0.01)
    .reduce((sum, p) => sum + Number(p.discrepancy_amount ?? 0), 0)

  const underReportedCount = salesPeriods.filter(
    (p) => (p.discrepancy_amount ?? 0) > 0.01,
  ).length

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-600 mb-6">
        <Link href="/dashboard" className="hover:text-gray-900">
          Dashboard
        </Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">
          {contract.licensee_name ?? contract.filename ?? 'Untitled Draft'}
        </span>
      </div>

      {/* Draft Review Banner */}
      {contract.status === 'draft' && (
        <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg mb-6 animate-fade-in">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-900">This contract is a draft</p>
            <p className="text-sm text-amber-700 mt-0.5">
              Review and confirm the extracted terms to activate this contract.
            </p>
          </div>
          <Link
            href={`/contracts/upload?draft=${contract.id}`}
            className="btn-primary text-sm whitespace-nowrap"
          >
            Complete review
          </Link>
        </div>
      )}

      {/* Post-confirmation callout */}
      {isJustConfirmed && contract.agreement_number && (
        <div
          className="flex items-start gap-3 px-4 py-3 bg-green-50 border border-green-200 rounded-lg mb-6 animate-fade-in"
          data-testid="success-callout"
        >
          <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-green-900">Contract confirmed</p>
            <p className="text-sm text-green-700 mt-0.5">
              Your agreement reference is{' '}
              <span className="font-mono font-semibold">{contract.agreement_number}</span>
              {' '}— share this with your licensee so their reports can be auto-matched.
            </p>
          </div>
          <button
            onClick={() => handleCopySuccessCallout(contract.agreement_number!)}
            aria-label="Copy agreement reference instructions"
            className="flex items-center gap-1.5 text-sm font-medium text-green-700 hover:text-green-900 transition-colors flex-shrink-0"
            data-testid="success-callout-copy-button"
          >
            <Copy className="w-4 h-4" />Copy
          </button>
        </div>
      )}

      {/* Header */}
      <div className="card mb-6 animate-fade-in">
        <div
          data-testid="contract-detail-header"
          className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4"
        >
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              {contract.licensee_name ?? contract.filename ?? 'Untitled Draft'}
            </h1>
            <div className="flex items-center gap-3 flex-wrap">
              {contract.status === 'draft' ? (
                <span className="badge-warning">Draft</span>
              ) : (
                <span className="badge-success">Active</span>
              )}
              {contract.agreement_number && (
                <>
                  <button
                    onClick={() => handleCopyAgreementNumber(contract.agreement_number!)}
                    aria-label={`Copy agreement number ${contract.agreement_number}`}
                    title="Click to copy agreement number"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-gray-100 hover:bg-gray-200 transition-colors text-sm font-mono text-gray-700"
                    data-testid="agreement-number-badge"
                  >
                    <Hash className="w-3.5 h-3.5 text-gray-400" aria-hidden="true" />
                    {contract.agreement_number}
                  </button>
                  <button
                    onClick={() => handleCopyInstructions(contract.agreement_number!)}
                    aria-label="Copy instructions for licensee"
                    title="Copy instructions for licensee"
                    className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
                    data-testid="copy-instructions-button"
                  >
                    <ClipboardList className="w-4 h-4" aria-hidden="true" />
                    <span
                      data-testid="copy-instructions-text"
                      className="hidden sm:inline"
                    >
                      Copy instructions for licensee
                    </span>
                  </button>
                </>
              )}
            </div>
          </div>
          <div
            data-testid="contract-action-buttons"
            className="flex flex-wrap gap-2"
          >
            {contract.status === 'active' && (
              <button
                onClick={handleDownloadTemplate}
                disabled={downloadingTemplate}
                aria-label="Download template"
                className="btn-secondary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download className="w-4 h-4" aria-hidden="true" />
                Download Template
              </button>
            )}
            {contract.pdf_url && (
              <a
                href={resolveUrl(contract.pdf_url)}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary flex items-center gap-2"
              >
                <ExternalLink className="w-4 h-4" aria-hidden="true" />
                View PDF
              </a>
            )}
            <Link href="/contracts" className="btn-secondary flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              Back
            </Link>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Contract Terms Section */}
        <div className="lg:col-span-2">
          <div className="card animate-fade-in">
            <h2 className="text-xl font-semibold text-gray-900 mb-6 flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Contract Terms
            </h2>

            <div className="space-y-4">
              {(contract.extracted_terms?.licensor_name as string | null | undefined) && (
                <div className="flex items-start gap-3">
                  <BarChart3 className="w-5 h-5 text-gray-400 mt-0.5" />
                  <div>
                    <p className="text-sm text-gray-600">Licensor</p>
                    <p className="font-medium text-gray-900">{contract.extracted_terms?.licensor_name as string}</p>
                  </div>
                </div>
              )}

              {contract.licensee_email && (
                <div className="flex items-start gap-3">
                  <Mail className="w-5 h-5 text-gray-400 mt-0.5" />
                  <div>
                    <p className="text-sm text-gray-600">Licensee Email</p>
                    <p className="font-medium text-gray-900">{contract.licensee_email}</p>
                  </div>
                </div>
              )}

              {contract.royalty_base && (
                <div className="flex items-start gap-3">
                  <Banknote className="w-5 h-5 text-gray-400 mt-0.5" />
                  <div>
                    <p className="text-sm text-gray-600">Royalty Base</p>
                    <p className="font-medium text-gray-900 capitalize">
                      {contract.royalty_base.replace('_', ' ')}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex items-start gap-3">
                <BarChart3 className="w-5 h-5 text-gray-400 mt-0.5" />
                <div>
                  <p className="text-sm text-gray-600">Royalty Rate</p>
                  <p className="font-medium text-gray-900">
                    {formatRoyaltyRate(contract.royalty_rate)}
                  </p>
                  {/* Full per-category breakdown — shown when the backend returns a plain dict */}
                  {contract.royalty_rate !== null && isPlainCategoryDict(contract.royalty_rate) && (
                    <table className="mt-2 text-sm border-collapse">
                      <tbody>
                        {Object.entries(contract.royalty_rate as Record<string, string>).map(
                          ([category, rate]) => (
                            <tr key={category}>
                              <td className="pr-4 py-0.5 text-gray-600">{category}</td>
                              <td className="py-0.5 font-medium text-gray-900 tabular-nums">
                                {rate}
                              </td>
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  )}
                  {/* Full per-category breakdown — shown for the typed CategoryRate shape */}
                  {contract.royalty_rate !== null &&
                    typeof contract.royalty_rate === 'object' &&
                    'type' in (contract.royalty_rate as object) &&
                    (contract.royalty_rate as CategoryRate).type === 'category' && (
                      <table className="mt-2 text-sm border-collapse">
                        <tbody>
                          {Object.entries((contract.royalty_rate as CategoryRate).rates).map(
                            ([category, rate]) => (
                              <tr key={category}>
                                <td className="pr-4 py-0.5 text-gray-600">{category}</td>
                                <td className="py-0.5 font-medium text-gray-900 tabular-nums">
                                  {(rate * 100).toFixed(0)}%
                                </td>
                              </tr>
                            ),
                          )}
                        </tbody>
                      </table>
                    )}
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Calendar className="w-5 h-5 text-gray-400 mt-0.5" />
                <div>
                  <p className="text-sm text-gray-600">Contract Period</p>
                  <p className="font-medium text-gray-900">
                    {formatDate(contract.contract_start_date)} - {formatDate(contract.contract_end_date)}
                  </p>
                </div>
              </div>

              {contract.territories && contract.territories.length > 0 && (
                <div className="flex items-start gap-3">
                  <MapPin className="w-5 h-5 text-gray-400 mt-0.5" />
                  <div>
                    <p className="text-sm text-gray-600">Territories</p>
                    <p className="font-medium text-gray-900">{contract.territories.join(', ')}</p>
                  </div>
                </div>
              )}

              {contract.product_categories && contract.product_categories.length > 0 && (
                <div className="flex items-start gap-3">
                  <BarChart3 className="w-5 h-5 text-gray-400 mt-0.5" />
                  <div>
                    <p className="text-sm text-gray-600">Product Categories</p>
                    <p className="font-medium text-gray-900">
                      {contract.product_categories.join(', ')}
                    </p>
                  </div>
                </div>
              )}

              {contract.minimum_guarantee !== null && (
                <div className="flex items-start gap-3">
                  <Banknote className="w-5 h-5 text-gray-400 mt-0.5" />
                  <div>
                    <p className="text-sm text-gray-600">Minimum Guarantee</p>
                    <p className="font-medium text-gray-900">
                      {formatCurrency(contract.minimum_guarantee)}
                      {contract.minimum_guarantee_period && (
                        <span className="text-sm text-gray-600 ml-2 capitalize">
                          ({contract.minimum_guarantee_period})
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              )}

              {contract.advance_payment !== null && (
                <div className="flex items-start gap-3">
                  <Banknote className="w-5 h-5 text-gray-400 mt-0.5" />
                  <div>
                    <p className="text-sm text-gray-600">Advance Payment</p>
                    <p className="font-medium text-gray-900">
                      {formatCurrency(contract.advance_payment)}
                    </p>
                  </div>
                </div>
              )}

              {contract.reporting_frequency && (
                <div className="flex items-start gap-3">
                  <Calendar className="w-5 h-5 text-gray-400 mt-0.5" />
                  <div>
                    <p className="text-sm text-gray-600">Reporting Frequency</p>
                    <p className="font-medium text-gray-900 capitalize">
                      {contract.reporting_frequency.replace('_', ' ')}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Summary Stats */}
        <div className="space-y-6">
          <div className="card animate-fade-in">
            <h3 className="text-sm font-medium text-gray-600 mb-1">Total Royalties</h3>
            <p className="text-3xl font-bold text-gray-900 tabular-nums">{formatCurrency(totalRoyalties)}</p>
            <div className="mt-2 space-y-0.5">
              {royaltiesByYear.map(({ year, royalties }) => (
                <p key={year} className="text-xs text-gray-500 tabular-nums">
                  {year}: {formatCurrency(royalties)}
                </p>
              ))}
            </div>
          </div>

          <div className="card animate-fade-in">
            <h3 className="text-sm font-medium text-gray-600 mb-1">Sales Periods</h3>
            <p className="text-3xl font-bold text-gray-900">{salesPeriods.length}</p>
          </div>

          {totalUnderReported > 0 && (
            <div className="card animate-fade-in border border-red-200 bg-red-50">
              <h3 className="text-sm font-medium text-red-700 mb-1">Open Discrepancies</h3>
              <p className="text-3xl font-bold text-red-700 tabular-nums">
                {formatCurrency(totalUnderReported)}
              </p>
              <p className="text-xs text-red-500 mt-1">
                Across {underReportedCount} period{underReportedCount !== 1 ? 's' : ''}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Sales Periods Section */}
      <div id="sales-periods" className="card mt-6 animate-fade-in">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              Sales Periods
            </h2>
            {underReportedCount > 0 && (
              <p className="text-sm text-red-600 mt-0.5 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" />
                {underReportedCount} period{underReportedCount !== 1 ? 's have' : ' has'} under-reported royalties
              </p>
            )}
          </div>
          {contract.status === 'active' && (
            <Link
              href={`/sales/upload?contract_id=${contract.id}`}
              className="btn-primary flex items-center gap-2 text-sm"
            >
              <Upload className="w-4 h-4" />
              Upload Report
            </Link>
          )}
        </div>

        {salesPeriods.length === 0 ? (
          <div className="text-center py-12 bg-gray-50 rounded-lg">
            <Upload className="w-12 h-12 text-gray-400 mx-auto mb-3" />
            <h3 className="text-lg font-medium text-gray-900 mb-1">No sales periods yet</h3>
            <p className="text-sm text-gray-600 mb-4">
              Upload a licensee sales report to calculate and verify royalties automatically.
            </p>
            {contract.status === 'active' && (
              <Link
                href={`/sales/upload?contract_id=${contract.id}`}
                className="btn-primary inline-flex items-center gap-2"
              >
                <Upload className="w-4 h-4" />
                Upload Your First Report
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table
              className="w-full"
              aria-label="Sales periods"
            >
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-900">
                    Period
                  </th>
                  <th
                    data-testid="col-net-sales"
                    className="hidden sm:table-cell text-right py-3 px-4 text-sm font-semibold text-gray-900"
                  >
                    Net Sales
                  </th>
                  <th
                    data-testid="col-reported-royalty"
                    className="hidden sm:table-cell text-right py-3 px-4 text-sm font-semibold text-gray-900"
                  >
                    Reported Royalty
                  </th>
                  <th className="text-right py-3 px-4 text-sm font-semibold text-gray-900">
                    Calculated Royalty
                  </th>
                  <th
                    data-testid="col-discrepancy"
                    className="hidden md:table-cell text-right py-3 px-4 text-sm font-semibold text-gray-900"
                  >
                    Discrepancy
                  </th>
                  <th className="py-3 px-4 w-10" aria-label="Source file" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {salesPeriods.map((period) => {
                  const hasReported = period.licensee_reported_royalty != null
                  const discrepancy = period.discrepancy_amount ?? null
                  const discrepancyPct =
                    hasReported && period.royalty_calculated > 0 && discrepancy !== null
                      ? (Math.abs(discrepancy) / period.royalty_calculated) * 100
                      : null

                  const rowBorderClass =
                    (period.discrepancy_amount ?? 0) > 0.01
                      ? 'border-l-2 border-l-red-400'
                      : (period.discrepancy_amount ?? 0) < -0.01
                        ? 'border-l-2 border-l-amber-400'
                        : 'border-l-2 border-l-transparent'

                  return (
                    <tr key={period.id} className={`hover:bg-gray-50 ${rowBorderClass}`}>
                      <td className="py-3 px-4 min-w-[10rem]">
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-gray-400 flex-shrink-0" aria-hidden="true" />
                          <span className="text-sm text-gray-900 whitespace-nowrap">
                            {formatDate(period.period_start)} - {formatDate(period.period_end)}
                          </span>
                        </div>
                      </td>
                      <td className="hidden sm:table-cell py-3 px-4 text-right font-medium text-gray-900 tabular-nums">
                        {formatCurrency(period.net_sales)}
                      </td>
                      <td className="hidden sm:table-cell py-3 px-4 text-right tabular-nums">
                        {hasReported
                          ? (
                            <span className="font-medium text-gray-900">
                              {formatCurrency(period.licensee_reported_royalty!)}
                            </span>
                          )
                          : <span className="text-gray-400 text-sm">—</span>
                        }
                      </td>
                      <td className="py-3 px-4 text-right font-semibold text-primary-600 tabular-nums">
                        {formatCurrency(period.royalty_calculated)}
                      </td>
                      <td className="hidden md:table-cell py-3 px-4 text-right">
                        {hasReported && discrepancy !== null
                          ? <DiscrepancyCell amount={discrepancy} percentage={discrepancyPct} />
                          : <span className="text-gray-400 text-sm">—</span>
                        }
                      </td>
                      <td className="py-3 px-4 w-10">
                        {period.source_file_path && (
                          <button
                            onClick={() => handleDownloadSourceFile(period.id)}
                            disabled={downloadingPeriodId === period.id}
                            aria-label="Download source report"
                            title="Download source file"
                            className="text-gray-400 hover:text-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            <Download className="w-4 h-4" aria-hidden="true" />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  )
}
