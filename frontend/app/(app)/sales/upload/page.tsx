/**
 * Sales Upload Wizard Page
 *
 * A 4-step wizard for uploading a licensee sales spreadsheet,
 * mapping columns, previewing data, and creating a sales period.
 *
 * Route: /sales/upload?contract_id=[id]
 */

'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Upload, FileText, Check, AlertCircle, Loader2, ExternalLink } from 'lucide-react'
import toast from 'react-hot-toast'
import { ApiError, getContract, getContracts, getSavedMapping, uploadSalesReport, confirmSalesUpload, checkPeriodOverlap, parseFromStorage, linkSalesPeriodToReport } from '@/lib/api'
import ColumnMapper from '@/components/sales-upload/column-mapper'
import CategoryMapper from '@/components/sales-upload/category-mapper'
import UploadPreview, { type MappedHeader } from '@/components/sales-upload/upload-preview'
import type { Contract, UploadPreviewResponse, SalesPeriod, ColumnMapping, CategoryMapping, UploadWarning, OverlapRecord, FrequencyWarning } from '@/types'

type WizardStep = 'upload' | 'map-columns' | 'map-categories' | 'preview'

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB

const ALLOWED_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
  'text/csv',
  'application/csv',
]
const ALLOWED_EXTENSIONS = ['.xlsx', '.xls', '.csv']

function validateSpreadsheetFile(file: File): string | null {
  const ext = '.' + (file.name.split('.').pop()?.toLowerCase() ?? '')
  if (!ALLOWED_TYPES.includes(file.type) && !ALLOWED_EXTENSIONS.includes(ext)) {
    return 'Please upload an Excel (.xlsx, .xls) or CSV file'
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return 'File size must be less than 10MB'
  }
  return null
}

// --- Step Indicator ---

// Map wizard steps to numeric step values for indicator display
const STEP_ORDER: WizardStep[] = ['upload', 'map-columns', 'map-categories', 'preview']

// Visual steps (3 bubbles). Step 2.5 shows as a sub-label under step 2.
const VISUAL_STEPS = [
  { number: 1, label: 'Upload File', step: 'upload' as WizardStep },
  { number: 2, label: 'Map Columns', step: 'map-columns' as WizardStep },
  { number: 3, label: 'Preview Data', step: 'preview' as WizardStep },
]

function stepToVisualNumber(step: WizardStep): number {
  if (step === 'upload') return 1
  if (step === 'map-columns') return 2
  if (step === 'map-categories') return 2
  return 3
}

function StepIndicator({
  currentStep,
  step1Skipped = false,
}: {
  currentStep: WizardStep
  step1Skipped?: boolean
}) {
  const currentVisual = stepToVisualNumber(currentStep)
  return (
    <nav aria-label="Upload progress" className="mb-8">
      <ol className="flex items-center">
        {VISUAL_STEPS.map((s, i) => {
          // When step 1 was skipped via inbox auto-parse, always show it as completed
          const isCompleted = s.number < currentVisual || (step1Skipped && s.number === 1)
          const isCurrent = s.number === currentVisual && !(step1Skipped && s.number === 1)
          return (
            <li key={s.number} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center">
                <div
                  className={`
                    w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold
                    ${isCompleted
                      ? 'bg-primary-600 text-white'
                      : isCurrent
                      ? 'bg-primary-600 text-white ring-2 ring-primary-200 ring-offset-2'
                      : 'bg-gray-200 text-gray-500'
                    }
                  `}
                  aria-label={
                    isCompleted
                      ? `Step ${s.number}: ${s.label} — completed`
                      : `Step ${s.number}: ${s.label}`
                  }
                >
                  {isCompleted ? <Check className="w-4 h-4" /> : s.number}
                </div>
                <span
                  className={`
                    mt-1.5 text-xs font-medium hidden sm:block
                    ${isCurrent ? 'text-primary-600' : 'text-gray-500'}
                  `}
                >
                  {s.label}
                </span>
                {/* Sub-label shown only during Step 2.5 (map-categories) */}
                {s.number === 2 && currentStep === 'map-categories' && (
                  <span className="mt-0.5 text-xs text-primary-500 hidden sm:block">
                    Resolve Categories
                  </span>
                )}
              </div>

              {i < VISUAL_STEPS.length - 1 && (
                <div
                  className={`
                    flex-1 h-0.5 mx-2 mb-5
                    ${isCompleted ? 'bg-primary-600' : 'bg-gray-200'}
                  `}
                />
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

// --- Step 1: File Upload ---

type PeriodCheckState = 'idle' | 'loading' | 'overlap' | 'clear'

/** Format an ISO date string as "Jan 1, 2025" */
function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Format a number as USD currency */
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
}

/** Format an ISO datetime as a relative date description ("3 days ago", "Apr 15") */
function formatRelativeDate(iso: string): string {
  const then = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - then.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return 'today'
  if (diffDays === 1) return 'yesterday'
  if (diffDays < 30) return `${diffDays} days ago`
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

interface StepUploadProps {
  onUploadSuccess: (preview: UploadPreviewResponse) => void
  contractId: string
  periodStart: string
  periodEnd: string
  setPeriodStart: (v: string) => void
  setPeriodEnd: (v: string) => void
  overrideIntent: boolean
  setOverrideIntent: (v: boolean) => void
  contractStartDate?: string | null
  contractEndDate?: string | null
  isInboxSource?: boolean
}

function StepUpload({
  onUploadSuccess,
  contractId,
  periodStart,
  periodEnd,
  setPeriodStart,
  setPeriodEnd,
  overrideIntent,
  setOverrideIntent,
  contractStartDate,
  contractEndDate,
  isInboxSource,
}: StepUploadProps) {
  const [file, setFile] = useState<File | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // Period overlap check state
  const [periodCheckState, setPeriodCheckState] = useState<PeriodCheckState>('idle')
  const [overlappingRecords, setOverlappingRecords] = useState<OverlapRecord[]>([])
  const periodStartRef = useRef<HTMLInputElement>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Gap 3: contract date range and frequency mismatch state
  const [isOutOfRange, setIsOutOfRange] = useState(false)
  const [acknowledgedOutOfRange, setAcknowledgedOutOfRange] = useState(false)
  const [hasFrequencyWarning, setHasFrequencyWarning] = useState(false)
  const [acknowledgedFrequency, setAcknowledgedFrequency] = useState(false)
  const [frequencyWarning, setFrequencyWarning] = useState<FrequencyWarning | null>(null)
  const [suggestedEndDate, setSuggestedEndDate] = useState<string | null>(null)
  const [displayedContractStart, setDisplayedContractStart] = useState<string | null>(null)
  const [displayedContractEnd, setDisplayedContractEnd] = useState<string | null>(null)

  // Derived: blocks the drop zone when any warning is unacknowledged
  const hasOverlap = periodCheckState === 'overlap'
  const anyWarningPending =
    (isOutOfRange && !acknowledgedOutOfRange) ||
    (hasFrequencyWarning && !acknowledgedFrequency) ||
    (hasOverlap && !overrideIntent)

  // Keep backward-compatible alias
  const overlapPending = anyWarningPending

  // Run period-check whenever both dates are filled and end >= start
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    if (!periodStart || !periodEnd || periodEnd < periodStart) {
      setPeriodCheckState('idle')
      setOverlappingRecords([])
      setIsOutOfRange(false)
      setAcknowledgedOutOfRange(false)
      setHasFrequencyWarning(false)
      setAcknowledgedFrequency(false)
      setFrequencyWarning(null)
      setSuggestedEndDate(null)
      setDisplayedContractStart(null)
      setDisplayedContractEnd(null)
      return
    }

    // Reset acknowledgments whenever dates change and a new check fires
    setAcknowledgedOutOfRange(false)
    setAcknowledgedFrequency(false)

    debounceTimerRef.current = setTimeout(async () => {
      setPeriodCheckState('loading')
      try {
        const result = await checkPeriodOverlap(contractId, periodStart, periodEnd)

        // Gap 2: overlap check
        if (result.has_overlap) {
          setOverlappingRecords(result.overlapping_periods)
          setPeriodCheckState('overlap')
        } else {
          setOverlappingRecords([])
          setPeriodCheckState('clear')
        }

        // Gap 3: contract date range check
        setIsOutOfRange(result.out_of_range ?? false)
        setDisplayedContractStart(result.contract_start_date ?? null)
        setDisplayedContractEnd(result.contract_end_date ?? null)

        // Gap 3: frequency mismatch check
        const fw = result.frequency_warning ?? null
        setFrequencyWarning(fw)
        setHasFrequencyWarning(fw !== null)
        setSuggestedEndDate(result.suggested_end_date ?? null)
      } catch {
        // Silently swallow errors — the confirm-time 409 is the safety net
        setPeriodCheckState('idle')
      }
    }, 400)

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [periodStart, periodEnd, contractId])

  const handleFileSelect = useCallback((selected: File | null) => {
    if (!selected) return
    const err = validateSpreadsheetFile(selected)
    if (err) {
      setValidationError(err)
      setFile(null)
      return
    }
    setValidationError(null)
    setUploadError(null)
    setFile(selected)
  }, [])

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDragActive(false)
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleFileSelect(e.dataTransfer.files[0])
      }
    },
    [handleFileSelect]
  )

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFileSelect(e.target.files?.[0] ?? null)
    },
    [handleFileSelect]
  )

  const handleUploadClick = async () => {
    if (!file || !periodStart || !periodEnd) return

    // Validate date ordering
    if (periodEnd <= periodStart) {
      setUploadError('Period end date must be after the start date.')
      return
    }

    setUploading(true)
    setUploadError(null)
    try {
      const preview = await uploadSalesReport(contractId, file, periodStart, periodEnd)
      onUploadSuccess(preview)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to upload file')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Period date fields */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Reporting Period</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="period_start" className="block text-sm font-medium text-gray-700 mb-2">
              Period Start <span className="text-red-500">*</span>
            </label>
            <input
              ref={periodStartRef}
              id="period_start"
              type="date"
              required
              className="input"
              value={periodStart}
              min={contractStartDate ?? undefined}
              max={contractEndDate ?? undefined}
              onChange={(e) => setPeriodStart(e.target.value)}
              aria-describedby={isInboxSource ? 'inbox-provenance-hint' : undefined}
            />
          </div>
          <div>
            <label htmlFor="period_end" className="block text-sm font-medium text-gray-700 mb-2">
              Period End <span className="text-red-500">*</span>
            </label>
            <input
              id="period_end"
              type="date"
              required
              className="input"
              value={periodEnd}
              min={contractStartDate ?? undefined}
              max={contractEndDate ?? undefined}
              onChange={(e) => setPeriodEnd(e.target.value)}
              aria-describedby={isInboxSource ? 'inbox-provenance-hint' : undefined}
            />
          </div>
        </div>

        {/* Inbox provenance hint */}
        {isInboxSource && (
          <p id="inbox-provenance-hint" className="mt-2 text-xs text-blue-600">
            Detected from email attachment — verify before continuing.
          </p>
        )}

        {/* Loading indicator while period check is in-flight */}
        {periodCheckState === 'loading' && (
          <div className="flex items-center gap-2 mt-3 text-sm text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
            <span>Checking for existing records…</span>
          </div>
        )}

        {/* Gap 3a: Contract date range warning card */}
        {isOutOfRange && !acknowledgedOutOfRange && (
          <div
            role="alert"
            className="mt-4 bg-amber-50 border border-amber-200 rounded-lg overflow-hidden"
          >
            <div className="flex items-start gap-3 px-4 py-3 border-b border-amber-200">
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-900">
                  Reporting period falls outside contract dates
                </p>
                <p className="text-sm text-amber-700 mt-0.5">
                  This contract runs{' '}
                  {displayedContractStart ? formatDate(displayedContractStart) : '—'}
                  {' '}–{' '}
                  {displayedContractEnd ? formatDate(displayedContractEnd) : '—'}.
                  {' '}Your entered period extends beyond this range.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 px-4 py-3 bg-amber-100/60 border-t border-amber-200">
              <button
                onClick={() => setAcknowledgedOutOfRange(true)}
                className="btn-primary text-sm"
              >
                Continue anyway
              </button>
              <button
                onClick={() => {
                  setPeriodStart('')
                  setPeriodEnd('')
                  periodStartRef.current?.focus()
                }}
                className="btn-secondary text-sm"
              >
                Change dates
              </button>
            </div>
          </div>
        )}

        {/* Gap 3b: Frequency mismatch warning card */}
        {hasFrequencyWarning && !acknowledgedFrequency && frequencyWarning && (
          <div
            role="alert"
            className="mt-4 bg-amber-50 border border-amber-200 rounded-lg overflow-hidden"
          >
            <div className="flex items-start gap-3 px-4 py-3 border-b border-amber-200">
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-900">
                  This contract requires {frequencyWarning.expected_frequency} reporting,
                  but your period spans about {frequencyWarning.entered_days} days.
                </p>
                <p className="text-sm text-amber-700 mt-0.5">
                  {frequencyWarning.message}
                </p>
                {suggestedEndDate && (
                  <p className="text-sm text-amber-700 mt-2">
                    Did you mean {periodStart ? formatDate(periodStart) : '—'}
                    {' '}–{' '}
                    {formatDate(suggestedEndDate)}?{' '}
                    <button
                      onClick={() => setPeriodEnd(suggestedEndDate)}
                      className="underline underline-offset-2 font-medium text-amber-900 hover:text-amber-700"
                    >
                      Use these dates
                    </button>
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3 px-4 py-3 bg-amber-100/60 border-t border-amber-200">
              <button
                onClick={() => setAcknowledgedFrequency(true)}
                className="btn-primary text-sm"
              >
                Continue anyway
              </button>
              <button
                onClick={() => {
                  setPeriodStart('')
                  setPeriodEnd('')
                  periodStartRef.current?.focus()
                }}
                className="btn-secondary text-sm"
              >
                Change dates
              </button>
            </div>
          </div>
        )}

        {/* Amber overlap warning card */}
        {periodCheckState === 'overlap' && !overrideIntent && (
          <div
            role="alert"
            className="mt-4 bg-amber-50 border border-amber-200 rounded-lg overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-start gap-3 px-4 py-3 border-b border-amber-200">
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-900">
                  {overlappingRecords.length === 1
                    ? 'A sales record already exists for this period.'
                    : `${overlappingRecords.length} existing records overlap this period.`}
                </p>
                <p className="text-sm text-amber-700 mt-0.5">
                  Uploading will replace{' '}
                  {overlappingRecords.length === 1 ? 'it' : 'them'}.
                  {' '}Review {overlappingRecords.length === 1 ? 'the record' : 'the records'} below before continuing.
                </p>
              </div>
            </div>

            {/* Overlap preview rows */}
            <div className="px-4 py-3 space-y-0">
              {overlappingRecords.slice(0, 3).map((record) => (
                <div
                  key={record.id}
                  className="flex items-center justify-between text-sm py-2 border-b border-amber-100 last:border-0"
                >
                  <span className="text-amber-900 font-medium tabular-nums">
                    {formatDate(record.period_start)} – {formatDate(record.period_end)}
                  </span>
                  <div className="flex items-center gap-4 text-amber-800">
                    <span className="tabular-nums font-medium">
                      {formatCurrency(record.net_sales)} net sales
                    </span>
                    <span className="text-amber-600 text-xs whitespace-nowrap">
                      uploaded {formatRelativeDate(record.created_at)}
                    </span>
                  </div>
                </div>
              ))}
              {overlappingRecords.length > 3 && (
                <p className="text-xs text-amber-600 pt-2">
                  + {overlappingRecords.length - 3} more record
                  {overlappingRecords.length - 3 > 1 ? 's' : ''} will also be replaced.
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 px-4 py-3 bg-amber-100/60 border-t border-amber-200">
              <button
                onClick={() => setOverrideIntent(true)}
                className="btn-primary text-sm"
              >
                Replace existing record{overlappingRecords.length > 1 ? 's' : ''}
              </button>
              <button
                onClick={() => {
                  setPeriodStart('')
                  setPeriodEnd('')
                  setPeriodCheckState('idle')
                  setOverlappingRecords([])
                  periodStartRef.current?.focus()
                }}
                className="btn-secondary text-sm"
              >
                Change reporting period
              </button>
              <a
                href={`/contracts/${contractId}#sales-periods`}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto flex items-center gap-1 text-sm text-amber-700 hover:text-amber-900 underline underline-offset-2"
              >
                View existing report
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Upload error banner */}
      {uploadError && (
        <div
          role="alert"
          className="flex items-start gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg animate-fade-in"
        >
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-red-900">Could not parse this file</p>
            <p className="text-sm text-red-700 mt-0.5">{uploadError}</p>
          </div>
        </div>
      )}

      {/* Drag-and-drop file zone */}
      <div
        data-testid="drop-zone"
        className={`
          relative border-2 border-dashed rounded-xl p-8 sm:p-12 text-center transition-colors duration-300
          ${overlapPending ? 'pointer-events-none opacity-50' : ''}
          ${dragActive
            ? 'border-primary-500 bg-primary-50'
            : validationError
            ? 'border-red-300 bg-red-50'
            : 'border-gray-300 hover:border-gray-400'
          }
        `}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <div className="flex flex-col items-center">
          {validationError ? (
            <>
              <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-4">
                <Upload className="w-8 h-8 text-red-400" />
              </div>
              <p className="text-base font-medium text-red-700 mb-2">{validationError}</p>
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleInputChange}
                  className="hidden"
                  data-testid="spreadsheet-file-input"
                />
                <span className="btn-secondary text-sm">Choose a different file</span>
              </label>
            </>
          ) : file ? (
            <>
              <FileText className="w-16 h-16 text-primary-600 mb-4" />
              <p className="text-lg font-medium text-gray-900 mb-1">{file.name}</p>
              <p className="text-sm text-gray-500 mb-6">
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
              <div className="flex items-center gap-3 justify-center">
                <button
                  onClick={handleUploadClick}
                  disabled={uploading || !periodStart || !periodEnd || overlapPending}
                  className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {uploading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" /> Upload &amp; Parse
                    </>
                  )}
                </button>
                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleInputChange}
                    className="hidden"
                  />
                  <span className="btn-secondary text-sm">Change file</span>
                </label>
              </div>
              {(!periodStart || !periodEnd) && (
                <p className="mt-3 text-xs text-amber-600">
                  Enter the reporting period dates above before uploading.
                </p>
              )}
            </>
          ) : (
            <label className="cursor-pointer w-full flex flex-col items-center">
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleInputChange}
                className="hidden"
                data-testid="spreadsheet-file-input"
              />
              <Upload className="w-16 h-16 text-gray-400 mb-4" />
              <p className="text-lg font-medium text-gray-900 mb-2">
                Drop your spreadsheet here or click to browse
              </p>
              <p className="text-sm text-gray-500">Excel (.xlsx, .xls) or CSV — max 10MB</p>
            </label>
          )}
        </div>
      </div>
    </div>
  )
}

// --- Main Wizard Page ---

export default function SalesUploadPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const contractId = searchParams.get('contract_id') ?? ''

  // Inbox integration params
  const reportId = searchParams.get('report_id')
  const inboxPeriodStart = searchParams.get('period_start')
  const inboxPeriodEnd = searchParams.get('period_end')
  const source = searchParams.get('source')
  const storagePath = searchParams.get('storage_path')
  const senderEmail = searchParams.get('sender_email')
  const isInboxSource = source === 'inbox'
  const shouldAutoParse = isInboxSource && !!storagePath

  const [step, setStep] = useState<WizardStep>('upload')
  const [contract, setContract] = useState<Contract | null>(null)
  const [loadingContract, setLoadingContract] = useState(true)

  // Auto-parse state for inbox flow
  type AutoParseState = 'idle' | 'loading' | 'success' | 'error'
  const [autoParseState, setAutoParseState] = useState<AutoParseState>(
    shouldAutoParse ? 'loading' : 'idle'
  )
  const [autoParseError, setAutoParseError] = useState<string | null>(null)

  // Wizard state across steps
  // Pre-fill period dates from inbox params when source=inbox
  const [periodStart, setPeriodStartRaw] = useState(isInboxSource && inboxPeriodStart ? inboxPeriodStart : '')
  const [periodEnd, setPeriodEndRaw] = useState(isInboxSource && inboxPeriodEnd ? inboxPeriodEnd : '')
  const [overrideIntent, setOverrideIntentRaw] = useState(false)
  const [uploadPreview, setUploadPreview] = useState<UploadPreviewResponse | null>(null)
  const [confirmedMapping, setConfirmedMapping] = useState<ColumnMapping | null>(null)
  const [saveMapping, setSaveMapping] = useState(true)
  const [salesPeriod, setSalesPeriod] = useState<SalesPeriod | null>(null)
  const [uploadWarnings, setUploadWarnings] = useState<UploadWarning[]>([])
  const [confirming, setConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [duplicatePeriodError, setDuplicatePeriodError] = useState(false)
  const [lastCategoryMapping, setLastCategoryMapping] = useState<CategoryMapping | undefined>(undefined)
  const [siblingContracts, setSiblingContracts] = useState<Contract[]>([])
  const [showMultiContractPrompt, setShowMultiContractPrompt] = useState(false)

  // Reset overrideIntent whenever the user changes either date field
  const setPeriodStart = useCallback((v: string) => {
    setPeriodStartRaw(v)
    setOverrideIntentRaw(false)
  }, [])

  const setPeriodEnd = useCallback((v: string) => {
    setPeriodEndRaw(v)
    setOverrideIntentRaw(false)
  }, [])

  const setOverrideIntent = useCallback((v: boolean) => {
    setOverrideIntentRaw(v)
  }, [])

  useEffect(() => {
    if (!contractId) return

    const fetchData = async () => {
      try {
        const [contractData] = await Promise.all([
          getContract(contractId),
          getSavedMapping(contractId),
        ])
        setContract(contractData)
      } catch {
        // Non-fatal — page still renders
      } finally {
        setLoadingContract(false)
      }
    }
    fetchData()
  }, [contractId])

  // Auto-parse effect: when source=inbox and storage_path is present,
  // skip the upload step and parse the attachment directly from storage.
  useEffect(() => {
    if (!shouldAutoParse || !storagePath || !contractId) return

    const runAutoParse = async () => {
      setAutoParseState('loading')
      try {
        const preview = await parseFromStorage(
          storagePath,
          contractId,
          inboxPeriodStart ?? undefined,
          inboxPeriodEnd ?? undefined
        )
        setUploadPreview(preview)
        setAutoParseState('success')
        setStep('map-columns')
      } catch {
        setAutoParseState('error')
        setAutoParseError(
          'Could not parse the attachment. Please upload the file manually.'
        )
      }
    }

    runAutoParse()
    // storagePath and contractId are derived from searchParams and stable for the
    // lifetime of this page render — intentionally omit from deps to run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleUploadSuccess = (preview: UploadPreviewResponse) => {
    setUploadPreview(preview)
    setStep('map-columns')
  }

  /**
   * Shared confirm logic — called either after column mapping (flat-rate contracts)
   * or after category mapping (category-rate contracts).
   * Pass `overrideDuplicate: true` to replace an existing record for the same period.
   * When called without an explicit override, the current `overrideIntent` state is used.
   */
  const doConfirm = async (
    mapping: ColumnMapping,
    save: boolean,
    categoryMapping?: CategoryMapping,
    overrideDuplicate?: boolean
  ) => {
    if (!uploadPreview) return

    // Use the explicit override argument if provided, otherwise fall back to parent state
    const shouldOverride = overrideDuplicate ?? overrideIntent

    setConfirming(true)
    setConfirmError(null)
    setDuplicatePeriodError(false)
    try {
      // Prefer the wizard's periodStart/periodEnd state (which the user can edit
      // in Step 1 or which are pre-filled from inbox query params) over the
      // dates echoed back in uploadPreview.  uploadPreview.period_start can be
      // an empty string when parseFromStorage was called without period dates
      // (e.g. inbox auto-parse when the attachment had no detectable period).
      const effectivePeriodStart = periodStart || uploadPreview.period_start
      const effectivePeriodEnd = periodEnd || uploadPreview.period_end

      const response = await confirmSalesUpload(contractId, {
        upload_id: uploadPreview.upload_id,
        column_mapping: mapping,
        period_start: effectivePeriodStart,
        period_end: effectivePeriodEnd,
        save_mapping: save,
        ...(categoryMapping ? { category_mapping: categoryMapping } : {}),
        ...(shouldOverride ? { override_duplicate: true } : {}),
      })
      setSalesPeriod(response)
      setUploadWarnings(response.upload_warnings ?? [])
      setStep('preview')

      // Link sales period back to inbound report (best-effort, don't block user)
      if (isInboxSource && reportId && response.id) {
        linkSalesPeriodToReport(reportId, response.id).catch((err) => {
          console.warn('Failed to link sales period to inbound report:', err)
        })
      }

      // Check for multi-contract licensee (for "Process for another?" prompt)
      if (isInboxSource && contract?.licensee_name) {
        try {
          const allContracts = await getContracts()
          const siblings = allContracts.filter(
            (c: Contract) => c.status === 'active' && c.licensee_name === contract.licensee_name && c.id !== contractId
          )
          setSiblingContracts(siblings)
        } catch {
          // Non-fatal
        }
      }
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        typeof err.data === 'object' &&
        err.data !== null &&
        (err.data as Record<string, unknown>).error_code === 'duplicate_period'
      ) {
        setDuplicatePeriodError(true)
      } else {
        setConfirmError(err instanceof Error ? err.message : 'Failed to create sales period')
      }
    } finally {
      setConfirming(false)
    }
  }

  const handleMappingConfirm = async ({
    mapping,
    saveMapping: save,
  }: {
    mapping: ColumnMapping
    saveMapping: boolean
  }) => {
    setConfirmedMapping(mapping)
    setSaveMapping(save)
    setLastCategoryMapping(undefined)

    if (!uploadPreview) return

    // Check if category resolution is required
    if (uploadPreview.category_resolution?.required) {
      // Advance to Step 2.5 — category mapper
      setStep('map-categories')
      return
    }

    // No category resolution needed — confirm immediately
    await doConfirm(mapping, save)
  }

  const handleCategoryMappingConfirm = async ({
    categoryMapping,
    saveAliases,
  }: {
    categoryMapping: CategoryMapping
    saveAliases: boolean
  }) => {
    if (!confirmedMapping) return
    setLastCategoryMapping(categoryMapping)
    await doConfirm(confirmedMapping, saveAliases, categoryMapping)
  }

  const handleConfirmFinal = () => {
    // Sales period was already created in step 2->3 (or 2.5->3) transition
    // Just redirect
    toast.success('Sales period saved')
    router.push(`/contracts/${contractId}?success=period_created`)
  }

  const handlePreviewConfirm = async () => {
    if (salesPeriod) {
      // If multi-contract prompt is available, show it instead of immediately redirecting
      if (isInboxSource && siblingContracts.length > 0) {
        setShowMultiContractPrompt(true)
        return
      }
      handleConfirmFinal()
      return
    }
    // Fallback: re-submit if needed
    if (!confirmedMapping || !uploadPreview) return
    setConfirming(true)
    setConfirmError(null)
    try {
      const period = await confirmSalesUpload(contractId, {
        upload_id: uploadPreview.upload_id,
        column_mapping: confirmedMapping,
        period_start: periodStart || uploadPreview.period_start,
        period_end: periodEnd || uploadPreview.period_end,
        save_mapping: saveMapping,
      })
      setSalesPeriod(period)
      toast.success('Sales period saved')
      router.push(`/contracts/${contractId}?success=period_created`)
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : 'Failed to create sales period')
    } finally {
      setConfirming(false)
    }
  }

  // Build mapped headers for preview table
  const mappedHeaders: MappedHeader[] = uploadPreview
    ? uploadPreview.detected_columns
        .filter((col) => {
          const field = (confirmedMapping ?? uploadPreview.suggested_mapping)[col]
          return field && field !== 'ignore'
        })
        .map((col) => {
          const field = (confirmedMapping ?? uploadPreview.suggested_mapping)[col] ?? 'ignore'
          const FIELD_LABELS: Record<string, string> = {
            net_sales: 'Net Sales',
            gross_sales: 'Gross Sales',
            returns: 'Returns / Allowances',
            product_category: 'Product Category',
            licensee_reported_royalty: 'Licensee Reported Royalty',
            territory: 'Territory',
            report_period: 'Report Period',
            licensee_name: 'Licensee Name',
            royalty_rate: 'Royalty Rate',
            metadata: 'Additional Data',
          }
          return {
            originalColumn: col,
            field,
            label: FIELD_LABELS[field] ?? col,
          }
        })
    : []

  const contractName = contract?.licensee_name ?? contract?.filename ?? 'Contract'

  if (loadingContract) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="skeleton h-8 w-48 mb-6" />
        <div className="skeleton h-64" />
      </div>
    )
  }

  return (
    <div className={`mx-auto px-4 sm:px-6 lg:px-8 py-8 ${step === 'map-columns' || step === 'map-categories' ? 'max-w-4xl' : 'max-w-3xl'}`}>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-600 mb-6">
        <Link href="/dashboard" className="hover:text-gray-900">
          Dashboard
        </Link>
        <span>/</span>
        <Link href={`/contracts/${contractId}`} className="hover:text-gray-900">
          {contractName}
        </Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">Upload Report</span>
      </div>

      {/* Page title */}
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Upload Sales Report</h1>
      {isInboxSource ? (
        <p className="text-gray-600 mb-8">
          Processing emailed report from{' '}
          {senderEmail ? (
            <span className="font-medium">{senderEmail}</span>
          ) : (
            contractName
          )}
          .
        </p>
      ) : (
        <p className="text-gray-600 mb-8">
          Upload a spreadsheet from {contractName} to calculate and verify royalties.
        </p>
      )}

      {/* Step indicator */}
      <StepIndicator
        currentStep={step}
        step1Skipped={autoParseState === 'success'}
      />

      {/* Auto-parse loading state */}
      {autoParseState === 'loading' && (
        <div className="mt-8 flex flex-col items-center justify-center py-16 gap-4">
          <Loader2 className="w-10 h-10 text-primary-600 animate-spin" />
          <p className="text-gray-600 text-base font-medium">Parsing attachment...</p>
        </div>
      )}

      {/* Step content */}
      <div className="mt-8">
        {step === 'upload' && autoParseState !== 'loading' && (
          <>
            {/* Auto-parse failure banner */}
            {autoParseState === 'error' && autoParseError && (
              <div
                role="alert"
                className="flex items-start gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg mb-6 animate-fade-in"
              >
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-red-900">Could not parse the attachment.</p>
                  <p className="text-sm text-red-700 mt-0.5">Please upload the file manually.</p>
                </div>
              </div>
            )}
            <StepUpload
              onUploadSuccess={handleUploadSuccess}
              contractId={contractId}
              periodStart={periodStart}
              periodEnd={periodEnd}
              setPeriodStart={setPeriodStart}
              setPeriodEnd={setPeriodEnd}
              overrideIntent={overrideIntent}
              setOverrideIntent={setOverrideIntent}
              contractStartDate={contract?.contract_start_date}
              contractEndDate={contract?.contract_end_date}
              isInboxSource={isInboxSource}
            />
          </>
        )}

        {step === 'map-columns' && uploadPreview && (
          <div className="space-y-4">
            {duplicatePeriodError && (
              <div
                role="alert"
                className="flex items-start gap-3 px-4 py-4 bg-amber-50 border border-amber-300 rounded-lg animate-fade-in"
              >
                <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-amber-900">
                    A sales record already exists for this contract and period.
                  </p>
                  <p className="text-sm text-amber-700 mt-0.5">
                    You can replace the existing record or go back to change the reporting period.
                  </p>
                  <div className="flex items-center gap-3 mt-3">
                    <button
                      onClick={() => {
                        if (confirmedMapping) {
                          doConfirm(confirmedMapping, saveMapping, lastCategoryMapping, true)
                        }
                      }}
                      disabled={confirming}
                      className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Replace existing record
                    </button>
                    <button
                      onClick={() => {
                        setDuplicatePeriodError(false)
                        setStep('upload')
                      }}
                      className="btn-secondary text-sm"
                    >
                      Go back
                    </button>
                  </div>
                </div>
              </div>
            )}
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
            <ColumnMapper
              detectedColumns={uploadPreview.detected_columns}
              suggestedMapping={uploadPreview.suggested_mapping}
              mappingSource={uploadPreview.mapping_source}
              mappingSources={uploadPreview.mapping_sources}
              licenseeName={contract?.licensee_name ?? contractName}
              sampleRows={uploadPreview.sample_rows}
              totalRows={uploadPreview.total_rows}
              onMappingConfirm={handleMappingConfirm}
              onBack={() => setStep('upload')}
            />
          </div>
        )}

        {step === 'map-categories' && uploadPreview?.category_resolution && (
          <div className="space-y-4">
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
            <CategoryMapper
              reportCategories={uploadPreview.category_resolution.report_categories}
              contractCategories={uploadPreview.category_resolution.contract_categories.map((name) => {
                // Extract rate from CategoryRate type if available on the contract
                const contractRateObj = contract?.royalty_rate
                const rate =
                  contractRateObj &&
                  typeof contractRateObj === 'object' &&
                  'type' in contractRateObj &&
                  contractRateObj.type === 'category'
                    ? (contractRateObj.rates as Record<string, number>)[name] ?? 0
                    : 0
                return { name, rate }
              })}
              suggestedMapping={uploadPreview.category_resolution.suggested_category_mapping}
              mappingSources={uploadPreview.category_resolution.category_mapping_sources}
              licenseeName={contract?.licensee_name ?? contractName}
              onConfirm={handleCategoryMappingConfirm}
              onBack={() => setStep('map-columns')}
            />
          </div>
        )}

        {step === 'preview' && salesPeriod && uploadPreview && (
          <>
            <UploadPreview
              sampleRows={uploadPreview.sample_rows}
              mappedHeaders={mappedHeaders}
              totalRows={uploadPreview.total_rows}
              salesPeriod={salesPeriod}
              uploadWarnings={uploadWarnings}
              onConfirm={handlePreviewConfirm}
              onBack={() => setStep('map-columns')}
              confirming={confirming}
              confirmError={confirmError}
            />

            {/* "Process for another contract?" prompt for multi-contract licensees */}
            {isInboxSource && siblingContracts.length > 0 && (
              <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm font-medium text-blue-900 mb-3">
                  Process for another contract?
                </p>
                <p className="text-xs text-blue-700 mb-3">
                  {contract?.licensee_name} has other active contracts. Click to process this report for another contract.
                </p>
                <div className="flex flex-wrap gap-2">
                  {siblingContracts.map((sc) => {
                    const params = new URLSearchParams({
                      contract_id: sc.id,
                      source: 'inbox',
                      ...(reportId ? { report_id: reportId } : {}),
                      ...(storagePath ? { storage_path: storagePath } : {}),
                      ...(periodStart ? { period_start: periodStart } : {}),
                      ...(periodEnd ? { period_end: periodEnd } : {}),
                      ...(senderEmail ? { sender_email: senderEmail } : {}),
                    })
                    return (
                      <button
                        key={sc.id}
                        onClick={() => router.push(`/sales/upload?${params.toString()}`)}
                        className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium bg-white border border-blue-300 text-blue-700 hover:bg-blue-100 transition-colors"
                      >
                        {sc.licensee_name ?? 'Untitled'}
                      </button>
                    )
                  })}
                </div>
                {showMultiContractPrompt && (
                  <div className="mt-4 pt-4 border-t border-blue-200">
                    <p className="text-sm text-blue-800 mb-3">
                      Or continue to the contract page for the current report.
                    </p>
                    <button
                      onClick={handleConfirmFinal}
                      className="btn-primary text-sm"
                    >
                      Continue to contract page
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
