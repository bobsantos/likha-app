/**
 * Contract Upload Page - Multi-step upload and extraction flow
 */

'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Upload, FileText, Loader2, CheckCircle2, ArrowLeft, AlertCircle } from 'lucide-react'
import { uploadContract, createContract } from '@/lib/api'
import type { ExtractedTerms, ExtractionResponse } from '@/types'

type Step = 'upload' | 'extracting' | 'review' | 'saving'

export default function UploadContractPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
      setFile(null)
      return
    }

    setError(null)
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

      const response: ExtractionResponse = await uploadContract(file)
      setExtractedTerms(response.extracted_terms)

      // Initialize form data with extracted terms
      setFormData({
        licensee_name: response.extracted_terms.licensee_name || '',
        licensor_name: response.extracted_terms.licensor_name || '',
        contract_start: response.extracted_terms.contract_start || '',
        contract_end: response.extracted_terms.contract_end || '',
        royalty_rate: response.extracted_terms.royalty_rate
          ? typeof response.extracted_terms.royalty_rate === 'string'
            ? response.extracted_terms.royalty_rate
            : JSON.stringify(response.extracted_terms.royalty_rate)
          : '',
        royalty_base: response.extracted_terms.royalty_base || 'net_sales',
        territories: response.extracted_terms.territories
          ? response.extracted_terms.territories.join(', ')
          : '',
        reporting_frequency: response.extracted_terms.reporting_frequency || 'quarterly',
        minimum_guarantee: response.extracted_terms.minimum_guarantee || '',
        advance_payment: response.extracted_terms.advance_payment || '',
      })

      setStep('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to extract contract terms')
      setStep('upload')
    }
  }

  // Save contract
  const handleSaveContract = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      setStep('saving')
      setError(null)

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
      setError(err instanceof Error ? err.message : 'Failed to save contract')
      setStep('review')
    }
  }

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev: any) => ({ ...prev, [field]: value }))
  }

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

      {/* Error Display */}
      {error && (
        <div className="card border border-red-200 bg-red-50 mb-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="text-sm font-semibold text-red-900">Error</h3>
              <p className="text-sm text-red-700 mt-1">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Step 1: Upload */}
      {step === 'upload' && (
        <div className="card animate-fade-in">
          <div
            className={`relative border-2 border-dashed rounded-xl p-12 text-center transition-colors ${
              dragActive
                ? 'border-primary-500 bg-primary-50'
                : 'border-gray-300 hover:border-gray-400'
            }`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <input
              type="file"
              accept=".pdf"
              onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />

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
                <>
                  <Upload className="w-16 h-16 text-gray-400 mb-4" />
                  <p className="text-lg font-medium text-gray-900 mb-2">
                    Drop your PDF here or click to browse
                  </p>
                  <p className="text-sm text-gray-500">PDF files only, max 10MB</p>
                </>
              )}
            </div>
          </div>
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
