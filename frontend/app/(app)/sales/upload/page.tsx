/**
 * Sales Upload Wizard Page
 *
 * A 4-step wizard for uploading a licensee sales spreadsheet,
 * mapping columns, previewing data, and creating a sales period.
 *
 * Route: /sales/upload?contract_id=[id]
 */

'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Upload, FileText, Check, AlertCircle, Loader2 } from 'lucide-react'
import { getContract, getSavedMapping, uploadSalesReport, confirmSalesUpload } from '@/lib/api'
import ColumnMapper from '@/components/sales-upload/column-mapper'
import UploadPreview, { type MappedHeader } from '@/components/sales-upload/upload-preview'
import type { Contract, UploadPreviewResponse, SalesPeriod, ColumnMapping, UploadWarning } from '@/types'

type WizardStep = 1 | 2 | 3

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

const STEPS = [
  { number: 1, label: 'Upload File' },
  { number: 2, label: 'Map Columns' },
  { number: 3, label: 'Preview Data' },
]

function StepIndicator({ currentStep }: { currentStep: WizardStep }) {
  return (
    <nav aria-label="Upload progress" className="mb-8">
      <ol className="flex items-center">
        {STEPS.map((s, i) => (
          <li key={s.number} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div
                className={`
                  w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold
                  ${s.number < currentStep
                    ? 'bg-primary-600 text-white'
                    : s.number === currentStep
                    ? 'bg-primary-600 text-white ring-2 ring-primary-200 ring-offset-2'
                    : 'bg-gray-200 text-gray-500'
                  }
                `}
                aria-label={
                  s.number < currentStep
                    ? `Step ${s.number}: ${s.label} — completed`
                    : `Step ${s.number}: ${s.label}`
                }
              >
                {s.number < currentStep ? <Check className="w-4 h-4" /> : s.number}
              </div>
              <span
                className={`
                  mt-1.5 text-xs font-medium hidden sm:block
                  ${s.number === currentStep ? 'text-primary-600' : 'text-gray-500'}
                `}
              >
                {s.label}
              </span>
            </div>

            {i < STEPS.length - 1 && (
              <div
                className={`
                  flex-1 h-0.5 mx-2 mb-5
                  ${s.number < currentStep ? 'bg-primary-600' : 'bg-gray-200'}
                `}
              />
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}

// --- Step 1: File Upload ---

interface StepUploadProps {
  onUploadSuccess: (preview: UploadPreviewResponse) => void
  contractId: string
  periodStart: string
  periodEnd: string
  setPeriodStart: (v: string) => void
  setPeriodEnd: (v: string) => void
}

function StepUpload({
  onUploadSuccess,
  contractId,
  periodStart,
  periodEnd,
  setPeriodStart,
  setPeriodEnd,
}: StepUploadProps) {
  const [file, setFile] = useState<File | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

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
              id="period_start"
              type="date"
              required
              className="input"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
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
              onChange={(e) => setPeriodEnd(e.target.value)}
            />
          </div>
        </div>
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
        className={`
          relative border-2 border-dashed rounded-xl p-8 sm:p-12 text-center transition-colors duration-300
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
                  disabled={uploading || !periodStart || !periodEnd}
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

  const [step, setStep] = useState<WizardStep>(1)
  const [contract, setContract] = useState<Contract | null>(null)
  const [loadingContract, setLoadingContract] = useState(true)

  // Wizard state across steps
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [uploadPreview, setUploadPreview] = useState<UploadPreviewResponse | null>(null)
  const [confirmedMapping, setConfirmedMapping] = useState<ColumnMapping | null>(null)
  const [saveMapping, setSaveMapping] = useState(true)
  const [salesPeriod, setSalesPeriod] = useState<SalesPeriod | null>(null)
  const [uploadWarnings, setUploadWarnings] = useState<UploadWarning[]>([])
  const [confirming, setConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)

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

  const handleUploadSuccess = (preview: UploadPreviewResponse) => {
    setUploadPreview(preview)
    setStep(2)
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

    if (!uploadPreview) return

    setConfirming(true)
    setConfirmError(null)
    try {
      const response = await confirmSalesUpload(contractId, {
        upload_id: uploadPreview.upload_id,
        column_mapping: mapping,
        period_start: uploadPreview.period_start,
        period_end: uploadPreview.period_end,
        save_mapping: save,
      })
      setSalesPeriod(response)
      setUploadWarnings(response.upload_warnings ?? [])
      setStep(3)
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : 'Failed to create sales period')
    } finally {
      setConfirming(false)
    }
  }

  const handleConfirmFinal = () => {
    // Sales period was already created in step 2->3 transition
    // Just redirect
    router.push(`/contracts/${contractId}?success=period_created`)
  }

  const handlePreviewConfirm = async () => {
    if (salesPeriod) {
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
        period_start: uploadPreview.period_start,
        period_end: uploadPreview.period_end,
        save_mapping: saveMapping,
      })
      setSalesPeriod(period)
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
    <div className={`mx-auto px-4 sm:px-6 lg:px-8 py-8 ${step === 2 ? 'max-w-4xl' : 'max-w-3xl'}`}>
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
      <p className="text-gray-600 mb-8">
        Upload a spreadsheet from {contractName} to calculate and verify royalties.
      </p>

      {/* Step indicator */}
      <StepIndicator currentStep={step} />

      {/* Step content */}
      <div className="mt-8">
        {step === 1 && (
          <StepUpload
            onUploadSuccess={handleUploadSuccess}
            contractId={contractId}
            periodStart={periodStart}
            periodEnd={periodEnd}
            setPeriodStart={setPeriodStart}
            setPeriodEnd={setPeriodEnd}
          />
        )}

        {step === 2 && uploadPreview && (
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
            <ColumnMapper
              detectedColumns={uploadPreview.detected_columns}
              suggestedMapping={uploadPreview.suggested_mapping}
              mappingSource={uploadPreview.mapping_source}
              licenseeName={contract?.licensee_name ?? contractName}
              sampleRows={uploadPreview.sample_rows}
              totalRows={uploadPreview.total_rows}
              onMappingConfirm={handleMappingConfirm}
              onBack={() => setStep(1)}
            />
          </div>
        )}

        {step === 3 && salesPeriod && uploadPreview && (
          <UploadPreview
            sampleRows={uploadPreview.sample_rows}
            mappedHeaders={mappedHeaders}
            totalRows={uploadPreview.total_rows}
            salesPeriod={salesPeriod}
            uploadWarnings={uploadWarnings}
            onConfirm={handlePreviewConfirm}
            onBack={() => setStep(2)}
            confirming={confirming}
            confirmError={confirmError}
          />
        )}
      </div>
    </div>
  )
}
