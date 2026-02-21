/**
 * Contract Upload Page - Multi-step upload and extraction flow
 */

'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import {
  Upload,
  FileText,
  Loader2,
  CheckCircle2,
  ArrowLeft,
  AlertCircle,
  RefreshCw,
  FolderOpen,
  ExternalLink,
} from 'lucide-react'
import { uploadContract, confirmDraft, getContract, ApiError } from '@/lib/api'
import type { ExtractedTerms, ExtractionResponse, DuplicateContractInfo } from '@/types'

type Step = 'upload' | 'extracting' | 'review' | 'saving'
type ErrorType = 'validation' | 'upload' | 'extraction' | 'save' | 'auth' | 'duplicate' | 'incomplete_draft' | null

interface ErrorInfo {
  type: ErrorType
  title: string
  message: string
  duplicateInfo?: DuplicateContractInfo
}

const DRAFT_STORAGE_KEY = 'upload_draft'

function classifyError(error: unknown): ErrorInfo {
  if (error instanceof ApiError && error.status === 401) {
    return {
      type: 'auth',
      title: 'Your session has expired',
      message: 'Please sign in again to continue.',
    }
  }

  // Handle 409 Conflict — duplicate filename or incomplete draft
  if (error instanceof ApiError && error.status === 409) {
    const data = error.data as any
    const detail = data?.detail
    const code = detail?.code
    const existingContract: DuplicateContractInfo | undefined = detail?.existing_contract

    if (code === 'DUPLICATE_FILENAME') {
      return {
        type: 'duplicate',
        title: 'A contract with this filename already exists',
        message: detail?.message ?? 'A contract with this filename already exists.',
        duplicateInfo: existingContract,
      }
    }

    if (code === 'INCOMPLETE_DRAFT') {
      return {
        type: 'incomplete_draft',
        title: 'You have an unfinished upload for this file',
        message: detail?.message ?? 'You have an incomplete upload for this file.',
        duplicateInfo: existingContract,
      }
    }
  }

  const msg = error instanceof Error ? error.message.toLowerCase() : ''

  if (msg.includes('storage') || msg.includes('upload')) {
    return {
      type: 'upload',
      title: 'Upload failed',
      message: "We couldn't store your file. Check your connection and try again.",
    }
  }

  if (msg.includes('extract') || msg.includes('parse')) {
    return {
      type: 'extraction',
      title: 'Could not read contract',
      message: "The AI couldn't extract terms from this PDF. The file may be scanned or image-based.",
    }
  }

  return {
    type: 'upload',
    title: 'Something went wrong',
    message: 'We hit an unexpected error. Please try again.',
  }
}

function formatDate(dateString: string) {
  try {
    return format(new Date(dateString), 'MMM d, yyyy')
  } catch {
    return dateString
  }
}

export default function UploadContractPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const retryFileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorType, setErrorType] = useState<ErrorType>(null)
  const [errorTitle, setErrorTitle] = useState<string>('')
  const [duplicateInfo, setDuplicateInfo] = useState<DuplicateContractInfo | null>(null)
  const [extractedTerms, setExtractedTerms] = useState<ExtractedTerms | null>(null)
  const [formData, setFormData] = useState<any>({})
  const [draftContractId, setDraftContractId] = useState<string | null>(null)
  const [hasSavedDraft, setHasSavedDraft] = useState(false)
  const [savedDraftData, setSavedDraftData] = useState<{ draftContractId: string; formData: any } | null>(null)
  const [loadingDraft, setLoadingDraft] = useState(false)

  // Load a draft contract by ID and populate the review form.
  // Used both by the ?draft= query param effect and by the "Resume review" button
  // when a 409 INCOMPLETE_DRAFT is returned (same-page flow — no navigation needed).
  const loadDraft = useCallback((draftId: string): Promise<void> => {
    setLoadingDraft(true)

    return getContract(draftId)
      .then((contract: any) => {
        // The backend runs normalize_extracted_terms for draft contracts and returns
        // the result as form_values — use it directly, just like the fresh-upload path.
        const fv = contract.form_values

        const populated = {
          licensee_name: fv?.licensee_name || '',
          licensor_name: fv?.licensor_name || '',
          contract_start_date: fv?.contract_start_date || '',
          contract_end_date: fv?.contract_end_date || '',
          royalty_rate: typeof fv?.royalty_rate === 'number'
            ? String(fv.royalty_rate)
            : typeof fv?.royalty_rate === 'object' && fv?.royalty_rate !== null
              ? JSON.stringify(fv.royalty_rate)
              : fv?.royalty_rate || '',
          royalty_base: fv?.royalty_base || 'net_sales',
          territories: Array.isArray(fv?.territories)
            ? fv.territories.join(', ')
            : '',
          reporting_frequency: fv?.reporting_frequency || 'quarterly',
          minimum_guarantee: fv?.minimum_guarantee != null ? String(fv.minimum_guarantee) : '',
          advance_payment: fv?.advance_payment != null ? String(fv.advance_payment) : '',
        }

        setDraftContractId(draftId)
        setFormData(populated)
        setLoadingDraft(false)
        setStep('review')
      })
      .catch(() => {
        setLoadingDraft(false)
        setError('Could not load draft. Please try uploading again.')
        setErrorType('upload')
        setErrorTitle('Could not load draft')
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // On mount: if ?draft=<id> is in the URL, fetch that draft and populate the review form.
  // Note: loadDraft is also called directly by the "Resume review" button when a 409
  // INCOMPLETE_DRAFT is returned, avoiding a same-page navigation that would not
  // re-trigger this effect.
  useEffect(() => {
    const draftId = searchParams.get('draft')
    if (!draftId) return

    loadDraft(draftId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // On mount: check sessionStorage for a saved draft
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(DRAFT_STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (parsed?.draftContractId) {
          setSavedDraftData(parsed)
          setHasSavedDraft(true)
        }
      }
    } catch {
      // Ignore parse errors
    }
  }, [])

  // Persist draft to sessionStorage whenever we enter review step
  const saveDraftToStorage = useCallback((id: string, data: any) => {
    try {
      sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ draftContractId: id, formData: data }))
    } catch {
      // sessionStorage may not be available
    }
  }, [])

  // Clear draft from sessionStorage
  const clearDraftFromStorage = useCallback(() => {
    try {
      sessionStorage.removeItem(DRAFT_STORAGE_KEY)
    } catch {
      // Ignore
    }
  }, [])

  // File validation
  const validateFile = (file: File): string | null => {
    if (file.type !== 'application/pdf') {
      return 'Please upload a PDF file'
    }
    if (file.size > 10 * 1024 * 1024) {
      return 'File size must be less than 10MB'
    }
    return null
  }

  // Handle file selection
  const handleFileChange = (selectedFile: File | null) => {
    if (!selectedFile) return

    const validationError = validateFile(selectedFile)
    if (validationError) {
      setError(validationError)
      setErrorType('validation')
      setErrorTitle('Invalid file')
      setFile(null)
      return
    }

    setError(null)
    setErrorType(null)
    setErrorTitle('')
    setDuplicateInfo(null)
    setFile(selectedFile)
  }

  // Handle drag and drop
  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Upload and extract
  const handleUpload = async () => {
    if (!file) return

    try {
      setStep('extracting')
      setError(null)
      setErrorType(null)
      setErrorTitle('')
      setDuplicateInfo(null)

      const response: ExtractionResponse = await uploadContract(file)
      setExtractedTerms(response.extracted_terms)
      setDraftContractId(response.contract_id ?? null)

      // Initialize form data with backend-normalized values
      const fv = response.form_values
      const newFormData = {
        licensee_name: fv.licensee_name || '',
        licensor_name: fv.licensor_name || '',
        // Use the same date key names as the backend ContractConfirm model expects.
        contract_start_date: fv.contract_start_date || '',
        contract_end_date: fv.contract_end_date || '',
        royalty_rate: typeof fv.royalty_rate === 'number'
          ? String(fv.royalty_rate)
          : typeof fv.royalty_rate === 'object'
            ? JSON.stringify(fv.royalty_rate)
            : fv.royalty_rate || '',
        royalty_base: fv.royalty_base || 'net_sales',
        territories: fv.territories
          ? fv.territories.join(', ')
          : '',
        reporting_frequency: fv.reporting_frequency || 'quarterly',
        minimum_guarantee: fv.minimum_guarantee != null ? String(fv.minimum_guarantee) : '',
        advance_payment: fv.advance_payment != null ? String(fv.advance_payment) : '',
      }
      setFormData(newFormData)

      // Persist to sessionStorage when entering review step
      if (response.contract_id) {
        saveDraftToStorage(response.contract_id, newFormData)
      }

      setStep('review')
    } catch (err) {
      const info = classifyError(err)

      if (info.type === 'auth') {
        router.push('/login')
        return
      }

      setError(info.message)
      setErrorType(info.type)
      setErrorTitle(info.title)
      if (info.duplicateInfo) {
        setDuplicateInfo(info.duplicateInfo)
      }
      setStep('upload')
      // Keep file in state so user can retry
    }
  }

  // Restore saved draft from sessionStorage
  const handleRestoreDraft = () => {
    if (!savedDraftData) return
    setDraftContractId(savedDraftData.draftContractId)
    setFormData(savedDraftData.formData)
    setHasSavedDraft(false)
    setSavedDraftData(null)
    setStep('review')
  }

  // Dismiss the restore banner without restoring
  const handleDismissRestore = () => {
    clearDraftFromStorage()
    setHasSavedDraft(false)
    setSavedDraftData(null)
  }

  // Save contract
  const handleSaveContract = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      setStep('saving')
      setError(null)
      setErrorType(null)
      setErrorTitle('')

      // Parse royalty rate from percentage string to decimal
      let royaltyRate: number | object
      try {
        const rateValue = formData.royalty_rate.trim()
        if (rateValue.includes('%')) {
          royaltyRate = parseFloat(rateValue.replace('%', '')) / 100
        } else if (rateValue.startsWith('{') || rateValue.startsWith('[')) {
          royaltyRate = JSON.parse(rateValue)
        } else {
          royaltyRate = parseFloat(rateValue) / 100
        }
      } catch {
        royaltyRate = 0
      }

      if (!draftContractId) {
        setError('Missing draft ID — please try uploading again.')
        setErrorType('save')
        setErrorTitle('Contract could not be saved')
        setStep('review')
        return
      }

      const contractData = {
        licensee_name: formData.licensee_name,
        // contract_start_date / contract_end_date match the backend ContractConfirm field names.
        // The old names (contract_start / contract_end) were incorrect and would be silently
        // ignored by the backend, leaving dates unset on the saved contract.
        contract_start_date: formData.contract_start_date || null,
        contract_end_date: formData.contract_end_date || null,
        royalty_rate: royaltyRate,
        royalty_base: formData.royalty_base,
        territories: formData.territories
          ? formData.territories.split(',').map((t: string) => t.trim()).filter(Boolean)
          : [],
        reporting_frequency: formData.reporting_frequency,
        minimum_guarantee: formData.minimum_guarantee ? parseFloat(formData.minimum_guarantee) : null,
        advance_payment: formData.advance_payment ? parseFloat(formData.advance_payment) : null,
      }

      const contract = await confirmDraft(draftContractId, contractData)
      clearDraftFromStorage()
      router.push(`/contracts/${contract.id}`)
    } catch (err) {
      setError('Your extracted terms are still here — nothing was lost. Please try saving again.')
      setErrorType('save')
      setErrorTitle('Contract could not be saved')
      setStep('review')
    }
  }

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev: any) => {
      const next = { ...prev, [field]: value }
      // Keep sessionStorage in sync during review
      if (draftContractId) {
        saveDraftToStorage(draftContractId, next)
      }
      return next
    })
  }

  // Whether the dropzone should show error state
  const showDropzoneError = step === 'upload' && error !== null && errorType !== 'save'

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Back Link */}
      <Link
        href="/contracts"
        className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Contracts
      </Link>

      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Upload Contract</h1>
        <p className="mt-2 text-gray-600">Upload a PDF contract to extract licensing terms</p>
      </div>

      {/* Loading Draft (from ?draft= query param) */}
      {loadingDraft && (
        <div className="card text-center py-12 animate-fade-in">
          <Loader2 className="w-16 h-16 text-primary-600 animate-spin mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Loading draft...</h2>
          <p className="text-gray-600">Please wait</p>
        </div>
      )}

      {/* Restore Draft Banner */}
      {!loadingDraft && hasSavedDraft && step === 'upload' && (
        <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg mb-6 animate-fade-in">
          <FileText className="w-5 h-5 text-blue-600 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-blue-900">Resume your previous upload</p>
            <p className="text-sm text-blue-700 mt-0.5">
              You have an unfinished review session. Would you like to pick up where you left off?
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleRestoreDraft}
              className="btn-primary text-sm"
            >
              Resume
            </button>
            <button
              onClick={handleDismissRestore}
              className="btn-secondary text-sm"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Step 1: Upload */}
      {!loadingDraft && step === 'upload' && (
        <div className="card animate-fade-in">
          {showDropzoneError ? (
            /* Error state dropzone */
            <div
              className="border-2 border-red-300 rounded-xl p-12 text-center transition-colors duration-300 bg-red-50"
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
            >
              <div className="flex flex-col items-center animate-slide-up">
                {/* 409 Duplicate Filename UI */}
                {errorType === 'duplicate' && duplicateInfo ? (
                  <>
                    <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mb-4">
                      <AlertCircle className="w-8 h-8 text-amber-500" />
                    </div>
                    <p className="text-base font-semibold text-gray-900 mb-2">{errorTitle}</p>
                    <p className="text-sm text-gray-500 mb-2">
                      Uploaded on {formatDate(duplicateInfo.created_at)}
                    </p>
                    <code className="text-xs bg-gray-100 px-2 py-1 rounded font-mono text-gray-700 mb-6">
                      {duplicateInfo.filename}
                    </code>
                    <div className="flex items-center gap-3 flex-wrap justify-center">
                      <Link
                        href={`/contracts/${duplicateInfo.id}`}
                        className="btn-primary flex items-center gap-2"
                      >
                        <ExternalLink className="w-4 h-4" />
                        View existing contract
                      </Link>
                      <label className="cursor-pointer">
                        <input
                          type="file"
                          accept=".pdf"
                          onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
                          className="hidden"
                        />
                        <span className="btn-secondary flex items-center gap-2">
                          <FolderOpen className="w-4 h-4" />
                          Choose a different file
                        </span>
                      </label>
                    </div>
                  </>
                ) : errorType === 'incomplete_draft' && duplicateInfo ? (
                  /* 409 Incomplete Draft UI */
                  <>
                    <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mb-4">
                      <AlertCircle className="w-8 h-8 text-amber-500" />
                    </div>
                    <p className="text-base font-semibold text-gray-900 mb-2">{errorTitle}</p>
                    <p className="text-sm text-gray-500 mb-6 text-center max-w-xs">{error}</p>
                    <div className="flex items-center gap-3 flex-wrap justify-center">
                      {/* Use a button (not a Link) so we load the draft without navigating away.
                          A Link to the same page won't re-mount the component, so the useEffect
                          that reads ?draft= would not re-run. */}
                      <button
                        type="button"
                        onClick={() => loadDraft(duplicateInfo.id)}
                        className="btn-primary flex items-center gap-2"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        Resume review
                      </button>
                      <label className="cursor-pointer">
                        <input
                          type="file"
                          accept=".pdf"
                          onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
                          className="hidden"
                        />
                        <span className="btn-secondary flex items-center gap-2">
                          <FolderOpen className="w-4 h-4" />
                          Choose a different file
                        </span>
                      </label>
                    </div>
                  </>
                ) : (
                  /* Generic error UI */
                  <>
                    <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-4">
                      <AlertCircle className="w-8 h-8 text-red-500" />
                    </div>
                    <p className="text-base font-semibold text-gray-900 mb-1">{errorTitle}</p>
                    <p className="text-sm text-gray-500 mb-6 text-center max-w-xs">{error}</p>

                    {file && (
                      <p className="text-xs text-gray-400 mb-6 flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5" />
                        {file.name} &middot; {(file.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    )}

                    {errorType === 'validation' ? (
                      /* Validation errors: only offer file chooser, no retry */
                      <label className="cursor-pointer">
                        <input
                          type="file"
                          accept=".pdf"
                          onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
                          className="hidden"
                        />
                        <span className="btn-primary flex items-center gap-2">
                          <FolderOpen className="w-4 h-4" />
                          Choose a file
                        </span>
                      </label>
                    ) : (
                      /* Upload/extraction errors: offer retry + choose different file */
                      <div className="flex items-center gap-3">
                        <button
                          onClick={handleUpload}
                          className="btn-primary flex items-center gap-2"
                        >
                          <RefreshCw className="w-4 h-4" />
                          Try again
                        </button>
                        <label className="cursor-pointer">
                          <input
                            ref={retryFileInputRef}
                            type="file"
                            accept=".pdf"
                            onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
                            className="hidden"
                          />
                          <span className="btn-secondary flex items-center gap-2">
                            <FolderOpen className="w-4 h-4" />
                            Choose different file
                          </span>
                        </label>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ) : (
            /* Normal dropzone */
            <div
              className={`relative border-2 border-dashed rounded-xl p-12 text-center transition-colors duration-300 ${
                dragActive
                  ? 'border-primary-500 bg-primary-50'
                  : 'border-gray-300 hover:border-gray-400'
              }`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
            >
              <div className="flex flex-col items-center">
                {file ? (
                  <>
                    <FileText className="w-16 h-16 text-primary-600 mb-4" />
                    <p className="text-lg font-medium text-gray-900 mb-2">{file.name}</p>
                    <p className="text-sm text-gray-500 mb-6">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                    <button
                      onClick={handleUpload}
                      className="btn-primary flex items-center gap-2"
                    >
                      <Upload className="w-5 h-5" />
                      Upload & Extract
                    </button>
                  </>
                ) : (
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept=".pdf"
                      onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
                      className="hidden"
                    />
                    <Upload className="w-16 h-16 text-gray-400 mb-4 mx-auto" />
                    <p className="text-lg font-medium text-gray-900 mb-2">
                      Drop your PDF here or click to browse
                    </p>
                    <p className="text-sm text-gray-500">PDF files only, max 10MB</p>
                  </label>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 2: Extracting */}
      {!loadingDraft && step === 'extracting' && (
        <div className="card text-center py-12 animate-fade-in">
          <Loader2 className="w-16 h-16 text-primary-600 animate-spin mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            Extracting contract terms...
          </h2>
          <p className="text-gray-600">This may take a moment</p>
        </div>
      )}

      {/* Step 3: Review */}
      {!loadingDraft && step === 'review' && (
        <div className="card animate-fade-in">
          <div className="flex items-center gap-2 mb-6">
            <CheckCircle2 className="w-6 h-6 text-green-600" />
            <h2 className="text-xl font-semibold text-gray-900">Review Extracted Terms</h2>
          </div>

          {/* Inline save error */}
          {errorType === 'save' && error && (
            <div className="flex items-start gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg mb-6 animate-slide-up">
              <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-red-800">{errorTitle}</p>
                <p className="text-sm text-red-600 mt-0.5">{error}</p>
              </div>
            </div>
          )}

          <form onSubmit={handleSaveContract} className="space-y-6">
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Licensee Name *
                </label>
                <input
                  type="text"
                  value={formData.licensee_name}
                  onChange={(e) => handleInputChange('licensee_name', e.target.value)}
                  required
                  className="input"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Licensor Name
                </label>
                <input
                  type="text"
                  value={formData.licensor_name}
                  onChange={(e) => handleInputChange('licensor_name', e.target.value)}
                  className="input"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Contract Start Date
                </label>
                <input
                  type="date"
                  value={formData.contract_start_date}
                  onChange={(e) => handleInputChange('contract_start_date', e.target.value)}
                  className="input"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Contract End Date
                </label>
                <input
                  type="date"
                  value={formData.contract_end_date}
                  onChange={(e) => handleInputChange('contract_end_date', e.target.value)}
                  className="input"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Royalty Rate (%) *
                </label>
                <input
                  type="text"
                  value={formData.royalty_rate}
                  onChange={(e) => handleInputChange('royalty_rate', e.target.value)}
                  required
                  placeholder="e.g., 10 or 10%"
                  className="input"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Royalty Base *
                </label>
                <select
                  value={formData.royalty_base}
                  onChange={(e) => handleInputChange('royalty_base', e.target.value)}
                  required
                  className="input"
                >
                  <option value="net_sales">Net Sales</option>
                  <option value="gross_sales">Gross Sales</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Reporting Frequency *
                </label>
                <select
                  value={formData.reporting_frequency}
                  onChange={(e) => handleInputChange('reporting_frequency', e.target.value)}
                  required
                  className="input"
                >
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="semi_annually">Semi-Annually</option>
                  <option value="annually">Annually</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Territories
                </label>
                <input
                  type="text"
                  value={formData.territories}
                  onChange={(e) => handleInputChange('territories', e.target.value)}
                  placeholder="e.g., USA, Canada, UK"
                  className="input"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Minimum Guarantee ($)
                </label>
                <input
                  type="number"
                  value={formData.minimum_guarantee}
                  onChange={(e) => handleInputChange('minimum_guarantee', e.target.value)}
                  placeholder="0"
                  min="0"
                  step="0.01"
                  className="input"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Advance Payment ($)
                </label>
                <input
                  type="number"
                  value={formData.advance_payment}
                  onChange={(e) => handleInputChange('advance_payment', e.target.value)}
                  placeholder="0"
                  min="0"
                  step="0.01"
                  className="input"
                />
              </div>
            </div>

            <div className="flex gap-4 justify-end pt-4 border-t">
              <button
                type="button"
                onClick={() => {
                  clearDraftFromStorage()
                  setStep('upload')
                  setFile(null)
                  setExtractedTerms(null)
                  setFormData({})
                  setDraftContractId(null)
                  setError(null)
                  setErrorType(null)
                  setErrorTitle('')
                }}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button type="submit" className="btn-primary">
                Confirm and Save
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Step 4: Saving */}
      {!loadingDraft && step === 'saving' && (
        <div className="card text-center py-12 animate-fade-in">
          <Loader2 className="w-16 h-16 text-primary-600 animate-spin mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Saving contract...</h2>
          <p className="text-gray-600">Please wait</p>
        </div>
      )}
    </div>
  )
}
