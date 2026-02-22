/**
 * ContractUpload component - Drag-and-drop file upload zone for PDF contracts.
 *
 * Handles:
 * - Drag-and-drop file selection
 * - File picker (click to browse)
 * - PDF-only validation
 * - Max size validation (10 MB)
 * - Selected file display with upload trigger
 */

'use client'

import { useState, useCallback } from 'react'
import { Upload, FileText } from 'lucide-react'

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB

export interface ContractUploadProps {
  /** Called with the validated file when the user clicks "Upload & Extract". */
  onUpload: (file: File) => void
  /** When true, the upload button is disabled (e.g. an upload is in progress). */
  disabled?: boolean
}

/** Validates a file for PDF type and size constraints. Returns an error string or null. */
export function validateFile(file: File): string | null {
  if (file.type !== 'application/pdf') {
    return 'Please upload a PDF file'
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return 'File size must be less than 10MB'
  }
  return null
}

export default function ContractUpload({ onUpload, disabled = false }: ContractUploadProps) {
  const [file, setFile] = useState<File | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  const handleFileSelect = useCallback((selected: File | null) => {
    if (!selected) return

    const error = validateFile(selected)
    if (error) {
      setValidationError(error)
      setFile(null)
      return
    }

    setValidationError(null)
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

  const handleUploadClick = () => {
    if (file) {
      onUpload(file)
    }
  }

  return (
    <div
      data-testid="contract-upload"
      className={`relative border-2 border-dashed rounded-xl p-12 text-center transition-colors duration-300 ${
        dragActive
          ? 'border-primary-500 bg-primary-50'
          : validationError
          ? 'border-red-300 bg-red-50'
          : 'border-gray-300 hover:border-gray-400'
      }`}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
    >
      <div className="flex flex-col items-center">
        {validationError ? (
          /* Validation error state */
          <>
            <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-4">
              <Upload className="w-8 h-8 text-red-400" />
            </div>
            <p className="text-base font-medium text-red-700 mb-2">{validationError}</p>
            <label className="cursor-pointer">
              <input
                type="file"
                accept=".pdf"
                onChange={handleInputChange}
                className="hidden"
                data-testid="file-input"
              />
              <span className="btn-secondary text-sm">Choose a different file</span>
            </label>
          </>
        ) : file ? (
          /* File selected — ready to upload */
          <>
            <FileText className="w-16 h-16 text-primary-600 mb-4" />
            <p className="text-lg font-medium text-gray-900 mb-1">{file.name}</p>
            <p className="text-sm text-gray-500 mb-6">
              {(file.size / 1024 / 1024).toFixed(2)} MB
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={handleUploadClick}
                disabled={disabled}
                className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Upload className="w-5 h-5" />
                Upload &amp; Extract
              </button>
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept=".pdf"
                  onChange={handleInputChange}
                  className="hidden"
                  data-testid="file-input-change"
                />
                <span className="btn-secondary text-sm">Change file</span>
              </label>
            </div>
          </>
        ) : (
          /* Default empty state */
          <label className="cursor-pointer w-full flex flex-col items-center">
            <input
              type="file"
              accept=".pdf"
              onChange={handleInputChange}
              className="hidden"
              data-testid="file-input"
            />
            <Upload className="w-16 h-16 text-gray-400 mb-4" />
            <p className="text-lg font-medium text-gray-900 mb-2">
              Drop your PDF here or click to browse
            </p>
            <p className="text-sm text-gray-500">PDF files only, max 10MB</p>
          </label>
        )}
      </div>
    </div>
  )
}
