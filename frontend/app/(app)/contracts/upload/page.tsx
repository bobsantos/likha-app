/**
 * Contract Upload Page - Multi-step upload and extraction flow
 */

'use client'

import { useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Upload, FileText, Loader2, CheckCircle2, ArrowLeft, AlertCircle, RefreshCw, FolderOpen } from 'lucide-react'
import { uploadContract, createContract, ApiError } from '@/lib/api'
import type { ExtractedTerms, ExtractionResponse } from '@/types'

type Step = 'upload' | 'extracting' | 'review' | 'saving'
type ErrorType = 'validation' | 'upload' | 'extraction' | 'save' | 'auth' | null

interface ErrorInfo {
  type: ErrorType
  title: string
  message: string
}

function classifyError(error: unknown): ErrorInfo {
  if (error instanceof ApiError && error.status === 401) {
    return {
      type: 'auth',
      title: 'Your session has expired',
      message: 'Please sign in again to continue.',
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

export default function UploadContractPage() {
  const router = useRouter()
  const retryFileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorType, setErrorType] = useState<ErrorType>(null)
  const [extractedTerms, setExtractedTerms] = useState<ExtractedTerms | null>(null)
  const [formData, setFormData] = useState<any>({})

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
      setFile(null)
      return
    }

    setError(null)
    setErrorType(null)
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

      const response: ExtractionResponse = await uploadContract(file)
      setExtractedTerms(response.extracted_terms)

      // Initialize form data with backend-normalized values
      const fv = response.form_values
      setFormData({
        licensee_name: fv.licensee_name || '',
        licensor_name: fv.licensor_name || '',
        contract_start: fv.contract_start_date || '',
        contract_end: fv.contract_end_date || '',
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
      })

      setStep('review')
    } catch (err) {
      const info = classifyError(err)

      if (info.type === 'auth') {
        router.push('/login')
        return
      }

      setError(info.message)
      setErrorType(info.type)
      setStep('upload')
      // Keep file in state so user can retry
    }
  }

  // Save contract
  const handleSaveContract = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      setStep('saving')
      setError(null)
      setErrorType(null)

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

      const contractData = {
        licensee_name: formData.licensee_name,
        licensor_name: formData.licensor_name || null,
        contract_start: formData.contract_start || null,
        contract_end: formData.contract_end || null,
        royalty_rate: royaltyRate,
        royalty_base: formData.royalty_base,
        territories: formData.territories
          ? formData.territories.split(',').map((t: string) => t.trim()).filter(Boolean)
          : [],
        reporting_frequency: formData.reporting_frequency,
        minimum_guarantee: formData.minimum_guarantee ? parseFloat(formData.minimum_guarantee) : null,
        advance_payment: formData.advance_payment ? parseFloat(formData.advance_payment) : null,
      }

      const contract = await createContract(contractData)
      router.push(`/contracts/${contract.id}`)
    } catch (err) {
      setError('Your extracted terms are still here — nothing was lost. Please try saving again.')
      setErrorType('save')
      setStep('review')
    }
  }

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev: any) => ({ ...prev, [field]: value }))
  }

  // Derive friendly title for current error
  const errorTitle = (() => {
    if (!error) return ''
    if (errorType === 'save') return 'Contract could not be saved'
    if (errorType === 'extraction') return 'Could not read contract'
    if (errorType === 'validation') return 'Invalid file'
    return 'Upload failed'
  })()

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

      {/* Step 1: Upload */}
      {step === 'upload' && (
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
      {step === 'extracting' && (
        <div className="card text-center py-12 animate-fade-in">
          <Loader2 className="w-16 h-16 text-primary-600 animate-spin mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            Extracting contract terms...
          </h2>
          <p className="text-gray-600">This may take a moment</p>
        </div>
      )}

      {/* Step 3: Review */}
      {step === 'review' && (
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
                  value={formData.contract_start}
                  onChange={(e) => handleInputChange('contract_start', e.target.value)}
                  className="input"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Contract End Date
                </label>
                <input
                  type="date"
                  value={formData.contract_end}
                  onChange={(e) => handleInputChange('contract_end', e.target.value)}
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
                  setStep('upload')
                  setFile(null)
                  setExtractedTerms(null)
                  setFormData({})
                  setError(null)
                  setErrorType(null)
                }}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button type="submit" className="btn-primary">
                Save Contract
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Step 4: Saving */}
      {step === 'saving' && (
        <div className="card text-center py-12 animate-fade-in">
          <Loader2 className="w-16 h-16 text-primary-600 animate-spin mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Saving contract...</h2>
          <p className="text-gray-600">Please wait</p>
        </div>
      )}
    </div>
  )
}
