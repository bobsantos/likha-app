/**
 * ColumnMapper component — Step 2 of the sales upload wizard.
 *
 * Displays one row per detected column from the uploaded file.
 * The user assigns each column to a Likha field using a dropdown.
 * Pre-fills with suggested mappings from the API response.
 */

'use client'

import { useState } from 'react'
import { AlertCircle, CheckCircle, ArrowLeft, ArrowRight } from 'lucide-react'
import type { ColumnMapping, LikhaField, MappingSource } from '@/types'

export interface ColumnMapperProps {
  detectedColumns: string[]
  suggestedMapping: ColumnMapping
  mappingSource: MappingSource
  licenseeName: string
  onMappingConfirm: (result: { mapping: ColumnMapping; saveMapping: boolean }) => void
  onBack: () => void
}

const FIELD_OPTIONS: { value: LikhaField; label: string }[] = [
  { value: 'net_sales', label: 'Net Sales' },
  { value: 'gross_sales', label: 'Gross Sales' },
  { value: 'returns', label: 'Returns / Allowances' },
  { value: 'product_category', label: 'Product Category' },
  { value: 'licensee_reported_royalty', label: 'Licensee Reported Royalty' },
  { value: 'territory', label: 'Territory' },
  { value: 'ignore', label: 'Ignore this column' },
]

interface MappingRowProps {
  detectedColumn: string
  selectedField: LikhaField
  onChange: (field: LikhaField) => void
  isLastRow: boolean
}

function MappingRow({ detectedColumn, selectedField, onChange, isLastRow }: MappingRowProps) {
  return (
    <div
      className={`
        flex flex-col sm:grid sm:grid-cols-2 items-start sm:items-center
        px-4 py-3 gap-2 sm:gap-4
        ${!isLastRow ? 'border-b border-gray-100' : ''}
        ${selectedField === 'ignore' ? 'hover:bg-gray-50' : 'hover:bg-gray-50'}
      `}
    >
      {/* Detected column name */}
      <div className="flex items-center gap-2 min-w-0 w-full">
        <code className="text-sm text-gray-800 font-mono bg-gray-100 px-2 py-0.5 rounded truncate max-w-full">
          {detectedColumn}
        </code>
      </div>

      {/* Field dropdown */}
      <div className="w-full">
        <select
          value={selectedField}
          onChange={(e) => onChange(e.target.value as LikhaField)}
          className={`
            w-full px-3 py-2 text-sm border rounded-lg
            focus:ring-2 focus:ring-primary-500 focus:border-transparent
            ${selectedField === 'ignore'
              ? 'border-gray-200 bg-gray-50 text-gray-500'
              : 'border-gray-300 bg-white text-gray-900'
            }
          `}
          aria-label={`Map column "${detectedColumn}" to Likha field`}
        >
          {FIELD_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

export default function ColumnMapper({
  detectedColumns,
  suggestedMapping,
  mappingSource,
  licenseeName,
  onMappingConfirm,
  onBack,
}: ColumnMapperProps) {
  const [mappings, setMappings] = useState<ColumnMapping>(() => {
    // Initialize from suggested mapping; default to 'ignore' for any missing columns
    const initial: ColumnMapping = {}
    for (const col of detectedColumns) {
      initial[col] = suggestedMapping[col] ?? 'ignore'
    }
    return initial
  })
  const [saveMapping, setSaveMapping] = useState(true)

  const hasNetSalesMapped = Object.values(mappings).includes('net_sales')

  const handleMappingChange = (column: string, field: LikhaField) => {
    setMappings((prev) => ({ ...prev, [column]: field }))
  }

  const handleContinue = () => {
    onMappingConfirm({ mapping: mappings, saveMapping })
  }

  return (
    <div className="card">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Map Columns</h2>
        <p className="text-sm text-gray-600">
          We detected {detectedColumns.length} columns in your file. Tell us what each one
          represents.
        </p>
      </div>

      {/* Mapping source banner */}
      {mappingSource === 'saved' && (
        <div className="flex items-center gap-3 px-4 py-3 bg-primary-50 border border-primary-200 rounded-lg mb-6 text-sm text-primary-700">
          <CheckCircle className="w-4 h-4 flex-shrink-0 text-primary-600" />
          <span>
            We applied the saved column mapping from your last upload for {licenseeName}. Adjust if
            anything has changed.
          </span>
        </div>
      )}

      {mappingSource === 'suggested' && (
        <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg mb-6 text-sm text-blue-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>Columns matched by keyword — verify before confirming.</span>
        </div>
      )}

      {mappingSource === 'none' && (
        <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg mb-6 text-sm text-gray-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>No automatic suggestions — map each column below.</span>
        </div>
      )}

      {/* Required field notice */}
      {!hasNetSalesMapped && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg mb-4 text-sm text-amber-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          Net Sales must be mapped to continue.
        </div>
      )}

      {/* Mapping table */}
      <div className="border border-gray-200 rounded-lg overflow-hidden mb-6">
        {/* Table header */}
        <div className="hidden sm:grid grid-cols-2 bg-gray-50 border-b border-gray-200 px-4 py-2">
          <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
            Column in your file
          </span>
          <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
            Maps to
          </span>
        </div>

        {/* Mapping rows */}
        {detectedColumns.map((col, index) => (
          <MappingRow
            key={col}
            detectedColumn={col}
            selectedField={mappings[col] ?? 'ignore'}
            onChange={(field) => handleMappingChange(col, field)}
            isLastRow={index === detectedColumns.length - 1}
          />
        ))}
      </div>

      {/* Save mapping checkbox */}
      <label className="flex items-start gap-3 cursor-pointer mb-6">
        <input
          type="checkbox"
          checked={saveMapping}
          onChange={(e) => setSaveMapping(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary-600
                     focus:ring-primary-500 focus:ring-offset-0"
        />
        <div>
          <span className="text-sm font-medium text-gray-900">
            Save this mapping for future uploads
          </span>
          <p className="text-xs text-gray-500 mt-0.5">
            Next time you upload a report from {licenseeName}, these column assignments will be
            applied automatically.
          </p>
        </div>
      </label>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-4 border-t border-gray-100">
        <button onClick={onBack} className="btn-secondary flex items-center gap-2">
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <button
          onClick={handleContinue}
          disabled={!hasNetSalesMapped}
          className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Continue
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
