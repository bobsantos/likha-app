/**
 * Inbox Review Page - View and action a single inbound report
 *
 * Supports three contract-match states:
 * 1. Auto-matched (high confidence) — green card + "Wrong match?" toggle
 * 2. Suggestions (medium confidence) — amber header + clickable suggestion cards
 * 3. No match — amber header + searchable select of all active contracts
 *
 * Contract Match card layout:
 *   Zone A — Match status banner (confidence-driven, existing)
 *   Zone B — Contract details grid (agreement ref, period, rate, frequency)
 *   Zone C — Attachment preview (metadata definition list + sample data table)
 */

'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import {
  ArrowLeft,
  AlertCircle,
  Mail,
  FileSpreadsheet,
  Calendar,
  CheckCircle,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Info,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import {
  getInboundReports,
  getContracts,
  confirmReport,
  rejectReport,
  isUnauthorizedError,
} from '@/lib/api'
import type { InboundReport, Contract, TieredRate, CategoryRate } from '@/types'

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

function formatDate(dateString: string): string {
  try {
    return format(new Date(dateString), 'MMM d, yyyy h:mm a')
  } catch {
    return 'N/A'
  }
}

function formatShortDate(isoDate: string): string {
  try {
    return format(new Date(isoDate + 'T00:00:00'), 'MMM d, yyyy')
  } catch {
    return isoDate
  }
}

/**
 * Produces a one-line royalty rate summary for the contract match panel.
 * - Flat number (e.g. 0.08) → "8% flat"
 * - TieredRate → "Tiered (N tiers)"
 * - CategoryRate (typed) → "Cat1 X% / Cat2 Y% / ..." (up to 3, then "...")
 * - Plain dict (backend shape) → same as CategoryRate
 */
function formatRoyaltyRateSummary(rate: Contract['royalty_rate']): string {
  if (rate === null || rate === undefined) return 'N/A'

  if (typeof rate === 'number') {
    return `${(rate * 100).toFixed(0)}% flat`
  }

  if (typeof rate === 'string') {
    if (/^\d+(\.\d+)?$/.test(rate)) {
      return `${rate}% flat`
    }
    return rate
  }

  if (typeof rate === 'object') {
    // Typed TieredRate
    if ('type' in rate && (rate as TieredRate).type === 'tiered') {
      const tiered = rate as TieredRate
      return `Tiered (${tiered.tiers.length} tiers)`
    }

    // Typed CategoryRate
    if ('type' in rate && (rate as CategoryRate).type === 'category') {
      const catRate = rate as CategoryRate
      const entries = Object.entries(catRate.rates)
      const lines = entries.slice(0, 3).map(([cat, r]) => `${cat} ${(r * 100).toFixed(0)}%`)
      if (entries.length > 3) lines.push('...')
      return lines.join(' / ')
    }

    // Plain dict from backend: { "Apparel": "10%", "Footwear": "8%" }
    const isPlainDict =
      !Array.isArray(rate) &&
      !('type' in (rate as object))

    if (isPlainDict) {
      const plainDict = rate as Record<string, string>
      const entries = Object.entries(plainDict)
      const lines = entries.slice(0, 3).map(([cat, r]) => `${cat} ${r}`)
      if (entries.length > 3) lines.push('...')
      return lines.join(' / ')
    }
  }

  return 'N/A'
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: InboundReport['status'] }) {
  if (status === 'pending') {
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium bg-amber-100 text-amber-700">
        Pending Review
      </span>
    )
  }
  if (status === 'confirmed' || status === 'processed') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium bg-green-100 text-green-700">
        <CheckCircle className="w-3.5 h-3.5" />
        {status === 'processed' ? 'Processed' : 'Confirmed'}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-600">
      <XCircle className="w-3.5 h-3.5" />
      Rejected
    </span>
  )
}

// ---------------------------------------------------------------------------
// Confidence pill
// ---------------------------------------------------------------------------

/**
 * A pill that conveys how confident the auto-match is.
 * score >= 80 → green, 50-79 → amber, <50 → gray
 */
function ConfidencePill({ score, label }: { score: number; label?: string }) {
  let cls: string
  let text: string

  if (score >= 80) {
    cls = 'bg-green-100 text-green-700'
    text = label ?? 'Strong match'
  } else if (score >= 50) {
    cls = 'bg-amber-100 text-amber-700'
    text = label ?? 'Possible match'
  } else {
    cls = 'bg-gray-100 text-gray-500'
    text = label ?? 'Weak match'
  }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {text}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Zone B — Contract details grid
// ---------------------------------------------------------------------------

interface ContractDetailsGridProps {
  contract: Contract
}

/**
 * A compact two-column key/value grid showing key contract facts:
 * agreement ref, contract period, royalty rate summary, reporting frequency,
 * and optional product categories / territory.
 */
function ContractDetailsGrid({ contract }: ContractDetailsGridProps) {
  const periodStart = contract.contract_start_date
    ? formatShortDate(contract.contract_start_date)
    : 'N/A'
  const periodEnd = contract.contract_end_date
    ? formatShortDate(contract.contract_end_date)
    : 'N/A'

  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3"
      aria-live="polite"
    >
      {/* Agreement Ref */}
      <div>
        <p className="text-xs text-gray-500">Agreement Ref</p>
        {contract.agreement_number ? (
          <p className="text-sm font-mono font-medium text-gray-900">
            {contract.agreement_number}
          </p>
        ) : (
          <p className="text-sm text-gray-400">None</p>
        )}
      </div>

      {/* Contract Period */}
      <div>
        <p className="text-xs text-gray-500">Contract Period</p>
        <p className="text-sm font-medium text-gray-900">
          {periodStart} &ndash; {periodEnd}
        </p>
      </div>

      {/* Royalty Rate */}
      <div>
        <p className="text-xs text-gray-500">Royalty Rate</p>
        <p className="text-sm font-medium text-gray-900">
          {formatRoyaltyRateSummary(contract.royalty_rate)}
        </p>
      </div>

      {/* Reporting Frequency */}
      {contract.reporting_frequency && (
        <div>
          <p className="text-xs text-gray-500">Reporting Frequency</p>
          <p className="text-sm font-medium text-gray-900 capitalize">
            {contract.reporting_frequency.replace('_', ' ')}
          </p>
        </div>
      )}

      {/* Optional: Product Categories */}
      {contract.product_categories && contract.product_categories.length > 0 && (
        <div>
          <p className="text-xs text-gray-500">Categories</p>
          <p className="text-sm font-medium text-gray-900">
            {contract.product_categories.join(', ')}
          </p>
        </div>
      )}

      {/* Optional: Territory */}
      {contract.territories && contract.territories.length > 0 && (
        <div>
          <p className="text-xs text-gray-500">Territory</p>
          <p className="text-sm font-medium text-gray-900">
            {contract.territories.join(', ')}
          </p>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Zone C — Attachment preview
// ---------------------------------------------------------------------------

interface AttachmentPreviewZoneProps {
  metadataRows: InboundReport['attachment_metadata_rows']
  sampleRows: InboundReport['attachment_sample_rows']
}

/**
 * Zone C: Shows parsed attachment content to help the licensor identify
 * which contract the report belongs to.
 *
 * - Metadata rows: definition list (key/value pairs from the file header block)
 * - Sample data rows: scrollable table (first 2 rows, capped cells)
 * - Both sections hidden gracefully when null
 * - Sample data table hidden on very small screens (< sm:)
 */
function AttachmentPreviewZone({ metadataRows, sampleRows }: AttachmentPreviewZoneProps) {
  const hasMetadata = metadataRows && metadataRows.length > 0
  const hasSampleRows = sampleRows && sampleRows.rows.length > 0

  if (!hasMetadata && !hasSampleRows) return null

  const displayedRows = sampleRows ? sampleRows.rows.slice(0, 2) : []
  const totalRows = sampleRows ? sampleRows.rows.length : 0

  return (
    <div className="pt-4 border-t border-gray-100">
      <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">
        Attachment Preview
      </p>

      {/* Metadata rows — definition list */}
      {hasMetadata && (
        <dl className="space-y-1.5 mb-4">
          {metadataRows.map(({ key, value }) => (
            <div key={key} className="flex gap-3 text-sm">
              <dt className="w-36 flex-shrink-0 text-gray-500">{key}</dt>
              <dd className="font-medium text-gray-900 truncate">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {/* Sample data rows — scrollable table */}
      {hasSampleRows && sampleRows && (
        <>
          <div className="overflow-x-auto rounded border border-gray-200 hidden sm:block">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  {sampleRows.headers.map((col) => (
                    <th
                      key={col}
                      scope="col"
                      className="px-3 py-2 text-left font-semibold text-gray-500 whitespace-nowrap"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {displayedRows.map((row, rowIdx) => (
                  <tr key={rowIdx} className="bg-white">
                    {row.map((cell, cellIdx) => (
                      <td
                        key={cellIdx}
                        title={cell}
                        className="px-3 py-2 text-gray-700 max-w-[8rem] truncate tabular-nums"
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {totalRows > 2 && (
              <p className="px-3 py-1.5 text-xs text-gray-400 bg-gray-50 border-t border-gray-100">
                {displayedRows.length} of {totalRows} rows shown
              </p>
            )}
          </div>
          {/* Mobile fallback — table hidden, show note */}
          <p className="text-xs text-gray-400 sm:hidden mt-1">
            Open the attachment to view data rows.
          </p>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Suggestion card
// ---------------------------------------------------------------------------

interface SuggestionCardProps {
  contract: Contract
  isSelected: boolean
  onSelect: () => void
  onHighlight: () => void
  buttonRef?: React.Ref<HTMLButtonElement>
}

/**
 * Confidence score is approximated from match_confidence for display purposes.
 * When the backend returns per-candidate scores they can be threaded in.
 * For now: medium = 65 (amber pill), high = 90 (green pill).
 */
function SuggestionCard({ contract, isSelected, onSelect, onHighlight, buttonRef }: SuggestionCardProps) {
  // Medium confidence candidates: show amber pill (score 65)
  const score = 65

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={() => { onSelect(); onHighlight() }}
      onMouseEnter={onHighlight}
      onFocus={onHighlight}
      aria-pressed={isSelected}
      className={`
        w-full text-left px-4 py-3 rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2
        ${isSelected
          ? 'border-2 border-blue-500 bg-blue-50'
          : 'border border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
        }
      `}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-gray-900 text-sm">
          {contract.licensee_name ?? contract.filename ?? 'Untitled'}
        </span>
        <div className="flex items-center gap-2 flex-shrink-0">
          <ConfidencePill score={score} />
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
            licensee name
          </span>
        </div>
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Contract match section (the three states)
// ---------------------------------------------------------------------------

interface ContractMatchSectionProps {
  report: InboundReport
  contracts: Contract[]
  selectedContractId: string
  setSelectedContractId: (id: string) => void
  isSettled: boolean
}

function ContractMatchSection({
  report,
  contracts,
  selectedContractId,
  setSelectedContractId,
  isSettled,
}: ContractMatchSectionProps) {
  const [showWrongMatch, setShowWrongMatch] = useState(false)
  // For high-confidence: whether the Zone B/C collapsible is expanded
  const [detailsExpanded, setDetailsExpanded] = useState(false)
  // For medium-confidence: track which contract card is highlighted (hover/focus)
  const [highlightedContractId, setHighlightedContractId] = useState<string | null>(null)

  const fallbackRef = useRef<HTMLSelectElement>(null)
  const firstSuggestionRef = useRef<HTMLButtonElement>(null)

  // Determine candidate contracts when there are candidate_contract_ids
  const candidateContracts =
    report.candidate_contract_ids && report.candidate_contract_ids.length > 0
      ? contracts.filter((c) => report.candidate_contract_ids!.includes(c.id))
      : []

  // Find the contract object to display in Zone B
  const displayContractId = highlightedContractId ?? selectedContractId
  const displayContract = contracts.find((c) => c.id === displayContractId) ?? null

  // ---- State 1: Auto-matched (high confidence) ----
  if (report.match_confidence === 'high' && report.contract_name && !showWrongMatch) {
    return (
      <div className="space-y-3">
        {/* Zone A — Auto-match banner */}
        <div
          data-testid="auto-match-card"
          className="flex items-center justify-between gap-3 p-3 bg-green-50 border border-green-200 rounded-lg"
        >
          <div className="flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
            <div>
              <p className="text-sm text-green-700 font-medium">Auto-matched contract</p>
              <p className="text-green-900 font-semibold">{report.contract_name}</p>
            </div>
          </div>
          <ConfidencePill score={90} label="Strong match" />
        </div>

        {!isSettled && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                setShowWrongMatch(true)
                setSelectedContractId('')
                // Focus the first interactive element in the fallback state
                setTimeout(() => {
                  if (candidateContracts.length > 0) {
                    firstSuggestionRef.current?.focus()
                  } else {
                    fallbackRef.current?.focus()
                  }
                }, 0)
              }}
              className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 underline underline-offset-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 rounded"
            >
              Not the right contract? Change it
            </button>
          </div>
        )}

        {/* Zone B — Collapsible contract details (collapsed by default for high confidence) */}
        {displayContract && (
          <div>
            <button
              type="button"
              aria-expanded={detailsExpanded}
              onClick={() => setDetailsExpanded((prev) => !prev)}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 rounded"
            >
              {detailsExpanded ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
              {detailsExpanded ? 'Hide details' : 'View details'}
            </button>

            {detailsExpanded && (
              <div className="mt-3 pt-4 border-t border-gray-100">
                <ContractDetailsGrid contract={displayContract} />
              </div>
            )}
          </div>
        )}

        {/* Zone C — Attachment preview always visible when data is present */}
        <AttachmentPreviewZone
          metadataRows={report.attachment_metadata_rows}
          sampleRows={report.attachment_sample_rows}
        />
      </div>
    )
  }

  // ---- State 2: Suggestions (medium confidence) ----
  if (
    report.match_confidence === 'medium' &&
    candidateContracts.length > 0 &&
    !showWrongMatch
  ) {
    // The contract to show in Zone B for suggestions is: hovered/focused card ?? selected card
    const suggestionDisplayContract =
      contracts.find((c) => c.id === (highlightedContractId ?? selectedContractId)) ?? null

    return (
      <div className="space-y-3">
        {/* Attachment preview above cards for medium confidence (as PM recommends) */}
        {(report.attachment_metadata_rows || report.attachment_sample_rows) && (
          <AttachmentPreviewZone
            metadataRows={report.attachment_metadata_rows}
            sampleRows={report.attachment_sample_rows}
          />
        )}

        {/* Zone A — Amber banner */}
        <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-800">Suggested match</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Select the correct contract below.
            </p>
          </div>
        </div>

        {/* Suggestion cards */}
        <div className="space-y-2">
          {candidateContracts.map((contract, idx) => (
            <SuggestionCard
              key={contract.id}
              contract={contract}
              isSelected={selectedContractId === contract.id}
              onSelect={() => setSelectedContractId(contract.id)}
              onHighlight={() => setHighlightedContractId(contract.id)}
              buttonRef={idx === 0 ? firstSuggestionRef : undefined}
            />
          ))}
        </div>

        {/* Zone B — Contract details, expanded, updates as user selects/hovers suggestion cards */}
        {suggestionDisplayContract && (
          <div className="pt-4 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">
              Contract Details
            </p>
            <ContractDetailsGrid contract={suggestionDisplayContract} />
          </div>
        )}
      </div>
    )
  }

  // ---- State 3: No match (or "Wrong match?" opened) ----
  return (
    <div className="space-y-3">
      {/* Attachment preview shown immediately — helps user identify the correct contract */}
      {(report.attachment_metadata_rows || report.attachment_sample_rows) && (
        <AttachmentPreviewZone
          metadataRows={report.attachment_metadata_rows}
          sampleRows={report.attachment_sample_rows}
        />
      )}

      <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
        <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
        <p className="text-sm text-amber-700">
          No contract matched automatically. Select a contract below.
        </p>
      </div>
      <div>
        <label htmlFor="contract-select" className="block text-sm font-medium text-gray-700 mb-1">
          Select Contract
        </label>
        <div className="relative">
          <select
            ref={fallbackRef}
            id="contract-select"
            value={selectedContractId}
            onChange={(e) => setSelectedContractId(e.target.value)}
            disabled={isSettled}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-8 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:opacity-50 disabled:cursor-not-allowed appearance-none"
          >
            <option value="">-- Select a contract --</option>
            {contracts.map((contract) => (
              <option key={contract.id} value={contract.id}>
                {contract.licensee_name ?? contract.filename ?? 'Untitled'}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        </div>
      </div>

      {/* Zone B — Contract details appear after user selects from dropdown */}
      {displayContract && (
        <div className="pt-4 border-t border-gray-100">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">
            Contract Details
          </p>
          <ContractDetailsGrid contract={displayContract} />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Attachment preview strip
// ---------------------------------------------------------------------------

function AttachmentPreviewStrip({ filename }: { filename: string | null }) {
  if (!filename) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
        <FileSpreadsheet className="w-4 h-4 text-gray-400 flex-shrink-0" />
        <span className="text-sm text-gray-500 italic">No attachment</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
      <FileSpreadsheet className="w-4 h-4 text-gray-500 flex-shrink-0" />
      <span className="text-sm font-medium text-gray-900 truncate">{filename}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Detected period row
// ---------------------------------------------------------------------------

interface DetectedPeriodRowProps {
  periodStart: string | null
  periodEnd: string | null
}

function DetectedPeriodRow({ periodStart, periodEnd }: DetectedPeriodRowProps) {
  if (!periodStart || !periodEnd) return null

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 bg-blue-50 border border-blue-200 rounded-lg">
      <Calendar className="w-4 h-4 text-blue-500 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-blue-900">Detected period: </span>
        <span className="text-sm text-blue-800">
          {formatShortDate(periodStart)} – {formatShortDate(periodEnd)}
        </span>
      </div>
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-600 flex-shrink-0">
        from attachment
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Multi-contract callout
// ---------------------------------------------------------------------------

interface MultiContractCalloutProps {
  licenseeContracts: Contract[]
  licenseeName: string | null
}

function MultiContractCallout({ licenseeContracts, licenseeName }: MultiContractCalloutProps) {
  if (licenseeContracts.length <= 1) return null

  return (
    <div role="status" className="flex items-start gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg">
      <Info className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
      <p className="text-sm text-blue-800">
        <span className="font-semibold">{licenseeName ?? 'This licensee'}</span> has{' '}
        {licenseeContracts.length} active contracts. If this report covers multiple
        product lines, you may need to process it once per contract.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function InboxReviewPage() {
  const params = useParams()
  const router = useRouter()
  const reportId = params.id as string

  const [report, setReport] = useState<InboundReport | null>(null)
  const [contracts, setContracts] = useState<Contract[]>([])
  const [selectedContractId, setSelectedContractId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirmingWizard, setConfirmingWizard] = useState(false)
  const [confirmingOnly, setConfirmingOnly] = useState(false)
  const [rejecting, setRejecting] = useState(false)

  const fetchData = async () => {
    setLoading(true)
    setError(null)

    try {
      const [reports, contractList] = await Promise.all([
        getInboundReports(),
        getContracts().catch(() => [] as Contract[]),
      ])

      const found = reports.find((r) => r.id === reportId)
      if (!found) {
        setError('Report not found.')
        setLoading(false)
        return
      }

      setReport(found)
      const activeContracts = contractList.filter((c) => c.status === 'active')
      setContracts(activeContracts)

      // Pre-select the auto-matched contract if present
      if (found.contract_id) {
        setSelectedContractId(found.contract_id)
      }

      setLoading(false)
    } catch (err) {
      if (isUnauthorizedError(err)) {
        router.push('/login')
        return
      }
      setError('Failed to load report. Please try again.')
      console.error('Error fetching report:', err)
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId])

  const handleConfirmWizard = async () => {
    if (!report || confirmingWizard) return
    setActionError(null)
    setConfirmingWizard(true)
    try {
      const contractId = selectedContractId || undefined
      const result = await confirmReport(report.id, contractId, true)
      if (result.redirect_url) {
        // Append storage_path so the wizard can skip the upload step and
        // parse the attachment directly from storage.
        let destination = result.redirect_url
        if (report.attachment_path) {
          const separator = destination.includes('?') ? '&' : '?'
          destination += `${separator}storage_path=${encodeURIComponent(report.attachment_path)}`
        }
        if (report.sender_email) {
          destination += `&sender_email=${encodeURIComponent(report.sender_email)}`
        }
        router.push(destination)
      } else {
        router.push('/inbox')
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to confirm report.')
      setConfirmingWizard(false)
    }
  }

  const handleConfirmOnly = async () => {
    if (!report || confirmingOnly) return
    setActionError(null)
    setConfirmingOnly(true)
    try {
      const contractId = selectedContractId || undefined
      await confirmReport(report.id, contractId, false)
      router.push(`/inbox?confirmed=${report.id}`)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to confirm report.')
      setConfirmingOnly(false)
    }
  }

  const handleReject = async () => {
    if (!report || rejecting) return
    setActionError(null)
    setRejecting(true)
    try {
      await rejectReport(report.id)
      router.push('/inbox')
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to reject report.')
      setRejecting(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="skeleton h-6 w-32 mb-6" />
        <div className="skeleton h-64" />
        <p className="text-center text-gray-600 mt-6">Loading report...</p>
      </div>
    )
  }

  if (error || !report) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Link
          href="/inbox"
          aria-label="Back to Inbox"
          className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Inbox
        </Link>
        <div className="card border border-red-200 bg-red-50">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-red-900">Error loading report</h3>
              <p className="text-sm text-red-700 mt-1">{error || 'Report not found'}</p>
              <button
                onClick={fetchData}
                className="mt-3 text-sm font-medium text-red-600 hover:text-red-700 underline inline-flex items-center gap-1"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Try again
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const isSettled = report.status !== 'pending'
  const isActing = confirmingWizard || confirmingOnly || rejecting

  // Determine whether the confirm buttons should be enabled
  // A contract must be selected (either auto-matched or user-chosen)
  const hasContractSelected = !!selectedContractId

  // Determine licensee name for multi-contract callout
  const matchedContract = contracts.find((c) => c.id === selectedContractId)
  const licenseeName = matchedContract?.licensee_name ?? report.contract_name
  const licenseeContracts = licenseeName
    ? contracts.filter((c) => c.licensee_name === licenseeName)
    : []

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Breadcrumb */}
      <Link
        href="/inbox"
        aria-label="Back to Inbox"
        className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Inbox
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Review Report</h1>
          <p className="text-sm text-gray-600 mt-1">
            Confirm or reject this inbound royalty report
          </p>
        </div>
        <StatusBadge status={report.status} />
      </div>

      {/* Report Details Card */}
      <div className="card mb-4">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Report Details</h2>

        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <Mail className="w-5 h-5 text-gray-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm text-gray-600">Sender</p>
              <p className="font-medium text-gray-900">{report.sender_email}</p>
            </div>
          </div>

          {report.subject && (
            <div className="flex items-start gap-3">
              <Mail className="w-5 h-5 text-gray-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm text-gray-600">Subject</p>
                <p className="font-medium text-gray-900">{report.subject}</p>
              </div>
            </div>
          )}

          <div className="flex items-start gap-3">
            <Calendar className="w-5 h-5 text-gray-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm text-gray-600">Received</p>
              <p className="font-medium text-gray-900">{formatDate(report.received_at)}</p>
            </div>
          </div>

          {/* Attachment preview strip */}
          <AttachmentPreviewStrip filename={report.attachment_filename} />

          {/* Detected period row (shown only when present) */}
          <DetectedPeriodRow
            periodStart={report.suggested_period_start}
            periodEnd={report.suggested_period_end}
          />
        </div>
      </div>

      {/* Contract Matching Card */}
      <div className="card mb-4">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Contract Match</h2>

        <ContractMatchSection
          report={report}
          contracts={contracts}
          selectedContractId={selectedContractId}
          setSelectedContractId={setSelectedContractId}
          isSettled={isSettled}
        />
      </div>

      {/* Multi-contract callout */}
      {licenseeContracts.length > 1 && (
        <div className="mb-4">
          <MultiContractCallout
            licenseeContracts={licenseeContracts}
            licenseeName={licenseeName}
          />
        </div>
      )}

      {/* Action Error */}
      {actionError && (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg mb-4">
          <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-700">{actionError}</p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Primary: Confirm & Open Upload Wizard */}
        <div className="flex flex-col gap-1">
          <button
            onClick={handleConfirmWizard}
            disabled={isSettled || isActing || !hasContractSelected || !report.attachment_filename}
            aria-busy={confirmingWizard}
            className="btn-primary inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <CheckCircle className="w-4 h-4" />
            {confirmingWizard ? 'Opening wizard...' : 'Confirm & Open Upload Wizard'}
          </button>
          {!report.attachment_filename && hasContractSelected && !isSettled && (
            <p className="text-xs text-gray-500">No attachment available — use Confirm Only instead.</p>
          )}
        </div>

        {/* Secondary: Confirm Only */}
        <button
          onClick={handleConfirmOnly}
          disabled={isSettled || isActing || !hasContractSelected}
          aria-busy={confirmingOnly}
          className="btn-secondary inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <CheckCircle className="w-4 h-4" />
          {confirmingOnly ? 'Confirming...' : 'Confirm Only'}
        </button>

        {/* Destructive: Reject — separated on mobile */}
        <div className="border-t border-gray-200 pt-3 sm:border-t-0 sm:pt-0 sm:ml-auto">
          <button
            onClick={handleReject}
            disabled={isSettled || isActing}
            aria-busy={rejecting}
            className="btn-secondary inline-flex items-center gap-2 text-red-600 hover:text-red-700 border-red-200 hover:border-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <XCircle className="w-4 h-4" />
            {rejecting ? 'Rejecting...' : 'Reject Report'}
          </button>
        </div>
      </div>

      {isSettled && (
        <p className="mt-3 text-sm text-gray-500">
          This report has already been {report.status}. No further actions are available.
        </p>
      )}
    </div>
  )
}
