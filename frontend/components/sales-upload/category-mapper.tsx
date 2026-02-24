/**
 * CategoryMapper component — Step 2.5 of the sales upload wizard.
 *
 * Shown when the uploaded report contains category names that differ from
 * the contract's category names. The user maps each report category to a
 * contract category (or excludes it from calculation).
 *
 * Row states:
 *   exact   — green CheckCircle, plain text, no dropdown
 *   ai      — violet "AI" badge, pre-filled dropdown
 *   saved   — blue "Auto" badge, pre-filled dropdown
 *   none    — amber AlertCircle, empty dropdown ("— choose one —")
 */

'use client'

import { useState } from 'react'
import { AlertCircle, CheckCircle, ArrowLeft, ArrowRight, Info } from 'lucide-react'
import type { CategoryMapping } from '@/types'

export interface ContractCategoryOption {
  name: string
  rate: number  // e.g. 0.10 for 10%
}

export interface CategoryMapperProps {
  reportCategories: string[]
  contractCategories: ContractCategoryOption[]
  suggestedMapping: CategoryMapping
  mappingSources: Record<string, 'saved' | 'exact' | 'ai' | 'none'>
  licenseeName: string
  onConfirm: (result: { categoryMapping: CategoryMapping; saveAliases: boolean }) => void
  onBack: () => void
}

/** Format a decimal rate as a percentage string, e.g. 0.1 -> "10%" */
function formatRate(rate: number): string {
  return `${Math.round(rate * 100)}%`
}

/** Sentinel value stored in state for "Exclude from calculation" */
const EXCLUDE_VALUE = '__exclude__'

interface CategoryRowProps {
  reportCategory: string
  source: 'saved' | 'exact' | 'ai' | 'none'
  selectedValue: string  // contract category name, EXCLUDE_VALUE, or ''
  contractCategories: ContractCategoryOption[]
  onChange: (value: string) => void
  isLastRow: boolean
}

function CategoryRow({
  reportCategory,
  source,
  selectedValue,
  contractCategories,
  onChange,
  isLastRow,
}: CategoryRowProps) {
  const isExact = source === 'exact'

  const rowBg = isExact
    ? 'bg-green-50'
    : source === 'ai'
    ? 'bg-violet-50 border-violet-200'
    : source === 'saved'
    ? 'bg-blue-50 border-blue-200'
    : 'bg-amber-50 border-amber-300'

  return (
    <div
      className={`
        flex flex-col sm:grid sm:grid-cols-[1fr_1fr] items-start sm:items-center
        px-4 py-3 gap-2 sm:gap-4
        ${!isLastRow ? 'border-b border-gray-100' : ''}
        ${rowBg}
      `}
    >
      {/* Col 1: Report category name + source badge */}
      <div className="flex items-center gap-2 min-w-0 w-full">
        {isExact ? (
          <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
        ) : source === 'none' ? (
          <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />
        ) : null}

        <span className="text-sm text-gray-800 font-medium truncate">
          {reportCategory}
        </span>

        {source === 'ai' && (
          <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 flex-shrink-0">
            AI
          </span>
        )}
        {source === 'saved' && (
          <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 flex-shrink-0">
            Auto
          </span>
        )}
      </div>

      {/* Col 2: Exact match label OR contract category dropdown */}
      <div className="w-full">
        {isExact ? (
          <span className="text-sm text-green-600 italic">
            {selectedValue} (exact match)
          </span>
        ) : (
          <select
            value={selectedValue === '' ? '' : selectedValue}
            onChange={(e) => onChange(e.target.value)}
            className={`
              w-full px-3 py-2 text-sm border rounded-lg
              focus:ring-2 focus:ring-primary-500 focus:border-transparent
              ${source === 'ai'
                ? 'border-violet-200 bg-violet-50 text-violet-900'
                : source === 'saved'
                ? 'border-blue-200 bg-blue-50 text-blue-900'
                : 'border-amber-300 bg-amber-50 text-gray-900'
              }
            `}
            aria-label={`Map "${reportCategory}" to contract category`}
          >
            <option value="" disabled>
              — choose one —
            </option>
            {contractCategories.map((cat) => (
              <option key={cat.name} value={cat.name}>
                {cat.name} ({formatRate(cat.rate)})
              </option>
            ))}
            <option value={EXCLUDE_VALUE}>Exclude from calculation</option>
          </select>
        )}
      </div>
    </div>
  )
}

export default function CategoryMapper({
  reportCategories,
  contractCategories,
  suggestedMapping,
  mappingSources,
  licenseeName,
  onConfirm,
  onBack,
}: CategoryMapperProps) {
  // Initialize mapping state from suggestedMapping.
  // Exact matches are included but their rows show no dropdown.
  const [mapping, setMapping] = useState<CategoryMapping>(() => {
    const initial: CategoryMapping = {}
    for (const cat of reportCategories) {
      initial[cat] = suggestedMapping[cat] ?? ''
    }
    return initial
  })
  const [saveAliases, setSaveAliases] = useState(true)

  const handleChange = (reportCategory: string, value: string) => {
    setMapping((prev) => ({ ...prev, [reportCategory]: value }))
  }

  // A non-exact-match category is "mapped" if it has a non-empty, chosen value
  const allMapped = reportCategories.every((cat) => {
    const source = mappingSources[cat] ?? 'none'
    if (source === 'exact') return true
    return mapping[cat] !== '' && mapping[cat] !== undefined
  })

  // Count banner stats
  const exactCount = reportCategories.filter(
    (cat) => (mappingSources[cat] ?? 'none') === 'exact'
  ).length
  const aiCount = reportCategories.filter(
    (cat) => (mappingSources[cat] ?? 'none') === 'ai'
  ).length
  const savedCount = reportCategories.filter(
    (cat) => (mappingSources[cat] ?? 'none') === 'saved'
  ).length
  const unmappedCount = reportCategories.filter((cat) => {
    const source = mappingSources[cat] ?? 'none'
    if (source === 'exact') return false
    return mapping[cat] === '' || mapping[cat] === undefined
  }).length

  const handleContinue = () => {
    // Build final mapping: convert EXCLUDE_VALUE to empty string sentinel for "exclude"
    const finalMapping: CategoryMapping = {}
    for (const cat of reportCategories) {
      const val = mapping[cat] ?? ''
      finalMapping[cat] = val === EXCLUDE_VALUE ? '' : val
    }
    onConfirm({ categoryMapping: finalMapping, saveAliases })
  }

  return (
    <div className="card">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Map Category Names</h2>
        <p className="text-sm text-gray-600">
          Your file uses different category names than the contract. Tell us which contract
          category each one belongs to.
        </p>
      </div>

      {/* Amber warning banner — shown when any category still needs mapping */}
      {unmappedCount > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-300 rounded-lg mb-6 text-sm text-amber-800">
          <AlertCircle className="w-4 h-4 flex-shrink-0 text-amber-500" />
          <span>All categories must be mapped before you can continue.</span>
        </div>
      )}

      {/* Category mapping table */}
      <div className="border border-gray-200 rounded-lg overflow-hidden mb-6">
        {/* Table header */}
        <div className="hidden sm:grid sm:grid-cols-[1fr_1fr] bg-gray-50 border-b border-gray-200 px-4 py-2">
          <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
            In your file
          </span>
          <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
            Contract category
          </span>
        </div>

        {/* Category rows */}
        {reportCategories.map((cat, index) => (
          <CategoryRow
            key={cat}
            reportCategory={cat}
            source={mappingSources[cat] ?? 'none'}
            selectedValue={mapping[cat] ?? ''}
            contractCategories={contractCategories}
            onChange={(value) => handleChange(cat, value)}
            isLastRow={index === reportCategories.length - 1}
          />
        ))}
      </div>

      {/* Info banner — summary counts */}
      <div className="flex items-start gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg mb-6 text-sm text-blue-800">
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-blue-600" />
        <div className="space-y-0.5">
          {exactCount > 0 && (
            <p>
              {exactCount} matched automatically.
            </p>
          )}
          {(aiCount > 0 || savedCount > 0) && (
            <p>
              {aiCount > 0 && `${aiCount} suggested by AI.`}
              {savedCount > 0 && ` ${savedCount} loaded from saved aliases.`}
            </p>
          )}
          {unmappedCount > 0 && (
            <p>{unmappedCount} needs your attention.</p>
          )}
        </div>
      </div>

      {/* Save aliases checkbox */}
      <label className="flex items-start gap-3 cursor-pointer mb-6">
        <input
          type="checkbox"
          checked={saveAliases}
          onChange={(e) => setSaveAliases(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary-600
                     focus:ring-primary-500 focus:ring-offset-0"
        />
        <div>
          <span className="text-sm font-medium text-gray-900">
            Save these category aliases for future uploads from {licenseeName}
          </span>
          <p className="text-xs text-gray-500 mt-0.5">
            Next time these category names will automatically match to the correct contract
            categories.
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
          disabled={!allMapped}
          className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Continue
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
