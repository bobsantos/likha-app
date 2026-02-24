/**
 * ColumnMapper component — Step 2 of the sales upload wizard.
 *
 * Displays one row per detected column from the uploaded file.
 * The user assigns each column to a Likha field using a dropdown.
 * Pre-fills with suggested mappings from the API response.
 */

'use client'

import { useState } from 'react'
import { AlertCircle, CheckCircle, ArrowLeft, ArrowRight, Info } from 'lucide-react'
import type { ColumnMapping, LikhaField, MappingSource } from '@/types'

export interface ColumnMapperProps {
  detectedColumns: string[]
  suggestedMapping: ColumnMapping
  mappingSource: MappingSource
  mappingSources?: Record<string, 'keyword' | 'ai' | 'none'>
  licenseeName: string
  sampleRows: Record<string, string>[]
  totalRows: number
  onMappingConfirm: (result: { mapping: ColumnMapping; saveMapping: boolean }) => void
  onBack: () => void
}

const FIELD_OPTIONS: { value: LikhaField; label: string; group: string }[] = [
  // --- Royalty calculation fields ---
  { value: 'net_sales',                 label: 'Net Sales',                  group: 'Royalty Fields' },
  { value: 'gross_sales',               label: 'Gross Sales',                group: 'Royalty Fields' },
  { value: 'returns',                   label: 'Returns / Allowances',       group: 'Royalty Fields' },
  { value: 'product_category',          label: 'Product Category',           group: 'Royalty Fields' },
  { value: 'licensee_reported_royalty', label: 'Licensee Reported Royalty',  group: 'Royalty Fields' },
  { value: 'territory',                 label: 'Territory',                  group: 'Royalty Fields' },
  { value: 'report_period',             label: 'Report Period',              group: 'Royalty Fields' },
  { value: 'licensee_name',             label: 'Licensee Name',              group: 'Royalty Fields' },
  { value: 'royalty_rate',              label: 'Royalty Rate',               group: 'Royalty Fields' },
  // --- Capture without calculation ---
  { value: 'metadata',                  label: 'Keep as additional data',    group: 'Other' },
  // --- Discard ---
  { value: 'ignore',                    label: 'Ignore this column',         group: 'Other' },
]

// Fields that can only be mapped to one column at a time
const UNIQUE_FIELDS: LikhaField[] = [
  'net_sales', 'gross_sales', 'returns',
  'product_category', 'licensee_reported_royalty', 'territory',
  'report_period', 'licensee_name', 'royalty_rate',
]

const MAX_PREVIEW_ROWS = 5

interface MappingRowProps {
  detectedColumn: string
  selectedField: LikhaField
  onChange: (field: LikhaField) => void
  isLastRow: boolean
  onHover: (column: string | null) => void
  sampleValues: string[]
  columnSource?: 'keyword' | 'ai' | 'none'
}

function MappingRow({
  detectedColumn,
  selectedField,
  onChange,
  isLastRow,
  onHover,
  sampleValues,
  columnSource,
}: MappingRowProps) {
  const isIgnored = selectedField === 'ignore'
  const isMetadata = selectedField === 'metadata'

  return (
    <div
      className={`
        flex flex-col sm:grid sm:grid-cols-[1fr_1fr_160px] items-start sm:items-center
        px-4 py-3 gap-2 sm:gap-4
        ${!isLastRow ? 'border-b border-gray-100' : ''}
        hover:bg-gray-50
      `}
      onMouseEnter={() => onHover(detectedColumn)}
      onMouseLeave={() => onHover(null)}
    >
      {/* Col 1: Detected column name */}
      <div className="flex items-center gap-2 min-w-0 w-full">
        <code className="text-sm text-gray-800 font-mono bg-gray-100 px-2 py-0.5 rounded truncate max-w-full">
          {detectedColumn}
        </code>
        {columnSource === 'ai' && (
          <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 flex-shrink-0">
            AI
          </span>
        )}
        {columnSource === 'keyword' && (
          <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 flex-shrink-0">
            Auto
          </span>
        )}
      </div>

      {/* Col 2: Field dropdown */}
      <div className="w-full">
        <select
          value={selectedField}
          onChange={(e) => onChange(e.target.value as LikhaField)}
          className={`
            w-full px-3 py-2 text-sm border rounded-lg
            focus:ring-2 focus:ring-primary-500 focus:border-transparent
            ${isIgnored
              ? 'border-gray-200 bg-gray-50 text-gray-500'
              : isMetadata
              ? 'border-violet-200 bg-violet-50 text-violet-700'
              : 'border-gray-300 bg-white text-gray-900'
            }
          `}
          aria-label={`Map column "${detectedColumn}" to Likha field`}
        >
          <optgroup label="Royalty Fields">
            <option value="net_sales">Net Sales</option>
            <option value="gross_sales">Gross Sales</option>
            <option value="returns">Returns / Allowances</option>
            <option value="product_category">Product Category</option>
            <option value="licensee_reported_royalty">Licensee Reported Royalty</option>
            <option value="territory">Territory</option>
            <option value="report_period">Report Period</option>
            <option value="licensee_name">Licensee Name</option>
            <option value="royalty_rate">Royalty Rate</option>
          </optgroup>
          <optgroup label="Other">
            <option value="metadata">Keep as additional data</option>
            <option value="ignore">Ignore this column</option>
          </optgroup>
        </select>
      </div>

      {/* Col 3: Sample values — desktop inline, mobile hidden */}
      <div className="hidden sm:flex flex-col gap-0.5 min-w-0">
        {sampleValues.length === 0 ? (
          <span className="text-xs text-gray-400 italic">no data</span>
        ) : (
          sampleValues.map((val, i) => (
            <span
              key={i}
              className="text-xs text-gray-500 truncate max-w-[152px]"
              title={val}
            >
              {val === '' ? <span className="italic text-gray-400">empty</span> : val}
            </span>
          ))
        )}
      </div>
    </div>
  )
}

export default function ColumnMapper({
  detectedColumns,
  suggestedMapping,
  mappingSource,
  mappingSources,
  licenseeName,
  sampleRows,
  totalRows,
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
  const [hoveredColumn, setHoveredColumn] = useState<string | null>(null)
  const [dedupMessage, setDedupMessage] = useState<string>('')

  // Limit preview to at most MAX_PREVIEW_ROWS rows
  const previewRows = sampleRows.slice(0, MAX_PREVIEW_ROWS)

  const hasNetSalesMapped = Object.values(mappings).includes('net_sales')
  const hasMetadataMapped = Object.values(mappings).includes('metadata')

  const handleMappingChange = (column: string, field: LikhaField) => {
    setMappings((prev) => {
      const next = { ...prev }

      // If the field is a unique Likha field (not metadata or ignore),
      // clear any existing column already mapped to that field
      if (UNIQUE_FIELDS.includes(field)) {
        for (const col of Object.keys(next)) {
          if (next[col] === field && col !== column) {
            // Announce dedup to screen readers
            const fieldLabel = FIELD_OPTIONS.find((o) => o.value === field)?.label ?? field
            const message = `${fieldLabel} reassigned from "${col}" to "Ignore"`
            setDedupMessage(message)
            setTimeout(() => setDedupMessage(''), 1000)
            next[col] = 'ignore'
          }
        }
      }

      next[column] = field
      return next
    })
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

      {/* Deduplication announcement — visually hidden, screen-reader only */}
      {dedupMessage && (
        <div role="status" aria-live="polite" className="sr-only">
          {dedupMessage}
        </div>
      )}

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

      {mappingSource === 'ai' && (
        <div className="flex items-center gap-3 px-4 py-3 bg-violet-50 border border-violet-200 rounded-lg mb-6 text-sm text-violet-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>Some columns were matched by AI — review carefully before confirming.</span>
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
        <div className="hidden sm:grid sm:grid-cols-[1fr_1fr_160px] bg-gray-50 border-b border-gray-200 px-4 py-2">
          <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
            Column in your file
          </span>
          <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
            Maps to
          </span>
          <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
            Sample values
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
            onHover={setHoveredColumn}
            sampleValues={sampleRows.slice(0, 3).map((row) => row[col] ?? '')}
            columnSource={mappingSources?.[col]}
          />
        ))}
      </div>

      {/* Metadata callout */}
      {hasMetadataMapped && (
        <div className="flex items-start gap-3 px-4 py-3 bg-violet-50 border border-violet-200
                        rounded-lg mb-6 text-sm text-violet-800">
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-violet-600" />
          <span>
            Columns marked &quot;Keep as additional data&quot; will be saved with this sales
            period. They won&apos;t affect royalty calculations but will be available for reference.
          </span>
        </div>
      )}

      {/* Raw data preview table */}
      <div className="mb-6">
        <p className="text-sm font-medium text-gray-700 mb-2">
          Raw data from your file (showing {previewRows.length} of {totalRows} rows)
        </p>
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {detectedColumns.map((col) => (
                  <th
                    key={col}
                    className={`
                      text-left py-2 px-3 text-xs font-semibold text-gray-600 whitespace-nowrap
                      ${hoveredColumn === col ? 'bg-blue-50' : ''}
                    `}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {previewRows.map((row, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  {detectedColumns.map((col) => (
                    <td
                      key={col}
                      className={`
                        py-2 px-3 text-gray-900 whitespace-nowrap
                        ${hoveredColumn === col ? 'bg-blue-50' : ''}
                      `}
                    >
                      {row[col] ?? '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
