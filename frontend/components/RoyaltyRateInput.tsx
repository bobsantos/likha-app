/**
 * RoyaltyRateInput component - Structured editor for royalty rate values.
 *
 * Handles three rate structures output by the backend normalizer:
 * - Flat:     a plain percentage string or number (e.g. "8" or "8%")
 * - Tiered:   JSON array of {threshold, rate} objects
 *             e.g. [{"threshold":"$0-$2,000,000","rate":"6%"},{"threshold":"$2,000,000+","rate":"8%"}]
 * - Category: JSON object mapping category name → rate string
 *             e.g. {"Books":"15%","Merchandise":"10%"}
 *
 * The component receives and emits a plain string value to match the
 * existing handleInputChange pattern used in the upload page.
 * Internally it parses JSON to detect the type and manages structured state.
 */

'use client'

import { useState, useEffect, useCallback } from 'react'
import { X, Plus, Info } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type RateMode = 'flat' | 'tiered' | 'category'

interface TierRow {
  id: string
  threshold: string
  rate: string
}

interface CategoryRow {
  id: string
  category: string
  rate: string
}

export interface RoyaltyRateInputProps {
  /** JSON string or flat rate string from formData. */
  value: string
  /** Called whenever the value changes. */
  onChange: (value: string) => void
  /** HTML id forwarded to the flat input (links a <label htmlFor> to the input). */
  id?: string
  /** Additional class names for the wrapping div. */
  className?: string
  /** Whether the field is required. */
  required?: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function newId(): string {
  // crypto.randomUUID is available in modern browsers and Node ≥ 19
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2)
}

function detectMode(value: string): RateMode {
  const trimmed = value.trim()
  if (!trimmed) return 'flat'

  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) return 'tiered'
    if (parsed !== null && typeof parsed === 'object') return 'category'
  } catch {
    // Not valid JSON — flat
  }

  return 'flat'
}

/**
 * Normalize a rate string for display in the rate input fields.
 *
 * Mirrors the Python normalizer's parse_royalty_rate logic for flat strings:
 * extracts the numeric part from strings like "6%" or "6% of net sales",
 * returning just the number (e.g. "6"). Bare numbers like "6.5" are kept
 * as-is. Anything else is returned unchanged so the user still sees something.
 *
 * This keeps the tiered and category rate inputs consistent with the flat
 * input, which receives a pre-stripped numeric string from the backend.
 */
function normalizeRateString(rate: string): string {
  const trimmed = rate.trim()
  if (!trimmed) return trimmed

  // "6%" or "6% of net sales" -> "6"
  const pctMatch = trimmed.match(/^([\d]+(?:\.\d+)?)\s*%/)
  if (pctMatch) return pctMatch[1]

  return trimmed
}

function parseTiers(value: string): TierRow[] {
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) {
      return parsed.map((item: any) => ({
        id: newId(),
        threshold: String(item.threshold ?? ''),
        rate: normalizeRateString(String(item.rate ?? '')),
      }))
    }
  } catch {
    // ignore
  }
  return [{ id: newId(), threshold: '', rate: '' }]
}

function parseCategories(value: string): CategoryRow[] {
  try {
    const parsed = JSON.parse(value)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.entries(parsed).map(([category, rate]) => ({
        id: newId(),
        category,
        rate: normalizeRateString(String(rate)),
      }))
    }
  } catch {
    // ignore
  }
  return [{ id: newId(), category: '', rate: '' }]
}

function serializeTiers(rows: TierRow[]): string {
  return JSON.stringify(rows.map(({ threshold, rate }) => ({ threshold, rate })))
}

function serializeCategories(rows: CategoryRow[]): string {
  const obj: Record<string, string> = {}
  for (const { category, rate } of rows) {
    obj[category] = rate
  }
  return JSON.stringify(obj)
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FlatInput({
  id,
  value,
  onChange,
  required,
}: {
  id?: string
  value: string
  onChange: (v: string) => void
  required?: boolean
}) {
  return (
    <div>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        placeholder="e.g. 10 or 10%"
        className="input"
        data-testid="royalty-rate-input"
        data-rate-type="flat"
      />
      <p className="mt-1.5 flex items-start gap-1 text-xs text-gray-500">
        <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" aria-hidden="true" />
        Enter a flat percentage (e.g.{' '}
        <code className="font-mono bg-gray-100 px-1 rounded">10</code> or{' '}
        <code className="font-mono bg-gray-100 px-1 rounded">10%</code>).
      </p>
    </div>
  )
}

function TieredEditor({
  rows,
  onChange,
}: {
  rows: TierRow[]
  onChange: (rows: TierRow[]) => void
}) {
  const canRemove = rows.length > 1

  const updateRow = (id: string, field: 'threshold' | 'rate', val: string) => {
    onChange(rows.map((r) => (r.id === id ? { ...r, [field]: val } : r)))
  }

  const addRow = () => {
    onChange([...rows, { id: newId(), threshold: '', rate: '' }])
  }

  const removeRow = (id: string) => {
    if (!canRemove) return
    onChange(rows.filter((r) => r.id !== id))
  }

  return (
    <div data-testid="royalty-rate-input" data-rate-type="tiered">
      {/* Column headers — visible on sm+ only */}
      <div className="hidden sm:grid sm:grid-cols-[1fr_140px_40px] sm:gap-3 mb-1 px-0">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
          Sales Threshold
        </span>
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Rate (%)</span>
        <span />
      </div>

      <div className="space-y-2">
        {rows.map((row) => (
          <div
            key={row.id}
            className="bg-gray-50 rounded-lg p-3 sm:bg-transparent sm:p-0 sm:grid sm:grid-cols-[1fr_140px_40px] sm:gap-3 sm:items-center"
          >
            {/* Threshold */}
            <div className="mb-2 sm:mb-0">
              <label className="block text-xs text-gray-500 mb-1 sm:hidden">
                Sales Threshold
              </label>
              <input
                type="text"
                value={row.threshold}
                onChange={(e) => updateRow(row.id, 'threshold', e.target.value)}
                placeholder="e.g. $0-$2,000,000"
                className="input text-sm"
                aria-label="Sales threshold"
              />
            </div>

            {/* Rate */}
            <div className="mb-2 sm:mb-0">
              <label className="block text-xs text-gray-500 mb-1 sm:hidden">Rate (%)</label>
              <input
                type="text"
                value={row.rate}
                onChange={(e) => updateRow(row.id, 'rate', e.target.value)}
                placeholder="e.g. 6"
                className="input text-sm"
                aria-label="Rate"
              />
            </div>

            {/* Remove button */}
            <div className="flex justify-end sm:justify-center">
              <button
                type="button"
                onClick={() => removeRow(row.id)}
                disabled={!canRemove}
                aria-label="Remove tier"
                className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addRow}
        className="mt-3 flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 transition-colors"
      >
        <Plus className="w-4 h-4" />
        Add tier
      </button>

      <p className="mt-2 flex items-start gap-1 text-xs text-gray-500">
        <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" aria-hidden="true" />
        Tiers apply in sequence — the first matching threshold determines the rate.
      </p>
    </div>
  )
}

function CategoryEditor({
  rows,
  onChange,
}: {
  rows: CategoryRow[]
  onChange: (rows: CategoryRow[]) => void
}) {
  const canRemove = rows.length > 1

  const updateRow = (id: string, field: 'category' | 'rate', val: string) => {
    onChange(rows.map((r) => (r.id === id ? { ...r, [field]: val } : r)))
  }

  const addRow = () => {
    onChange([...rows, { id: newId(), category: '', rate: '' }])
  }

  const removeRow = (id: string) => {
    if (!canRemove) return
    onChange(rows.filter((r) => r.id !== id))
  }

  return (
    <div data-testid="royalty-rate-input" data-rate-type="category">
      {/* Column headers — visible on sm+ only */}
      <div className="hidden sm:grid sm:grid-cols-[1fr_140px_40px] sm:gap-3 mb-1">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Category</span>
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Rate (%)</span>
        <span />
      </div>

      <div className="space-y-2">
        {rows.map((row) => (
          <div
            key={row.id}
            className="bg-gray-50 rounded-lg p-3 sm:bg-transparent sm:p-0 sm:grid sm:grid-cols-[1fr_140px_40px] sm:gap-3 sm:items-center"
          >
            {/* Category name */}
            <div className="mb-2 sm:mb-0">
              <label className="block text-xs text-gray-500 mb-1 sm:hidden">Category</label>
              <input
                type="text"
                value={row.category}
                onChange={(e) => updateRow(row.id, 'category', e.target.value)}
                placeholder="e.g. Books"
                className="input text-sm"
                aria-label="Category name"
              />
            </div>

            {/* Rate */}
            <div className="mb-2 sm:mb-0">
              <label className="block text-xs text-gray-500 mb-1 sm:hidden">Rate (%)</label>
              <input
                type="text"
                value={row.rate}
                onChange={(e) => updateRow(row.id, 'rate', e.target.value)}
                placeholder="e.g. 15"
                className="input text-sm"
                aria-label="Rate"
              />
            </div>

            {/* Remove button */}
            <div className="flex justify-end sm:justify-center">
              <button
                type="button"
                onClick={() => removeRow(row.id)}
                disabled={!canRemove}
                aria-label="Remove category"
                className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addRow}
        className="mt-3 flex items-center gap-1.5 text-sm text-purple-600 hover:text-purple-800 transition-colors"
      >
        <Plus className="w-4 h-4" />
        Add category
      </button>

      <p className="mt-2 flex items-start gap-1 text-xs text-gray-500">
        <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" aria-hidden="true" />
        Specify a different royalty rate for each product category.
      </p>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function RoyaltyRateInput({
  value,
  onChange,
  id,
  className = '',
  required = false,
}: RoyaltyRateInputProps) {
  const [mode, setMode] = useState<RateMode>(() => detectMode(value))
  const [tierRows, setTierRows] = useState<TierRow[]>(() =>
    mode === 'tiered' ? parseTiers(value) : [{ id: newId(), threshold: '', rate: '' }]
  )
  const [categoryRows, setCategoryRows] = useState<CategoryRow[]>(() =>
    mode === 'category' ? parseCategories(value) : [{ id: newId(), category: '', rate: '' }]
  )

  // Sync internal structured state when the external value changes (e.g. on mount
  // after the extraction response populates formData).  Only re-parse when the
  // detected mode actually matches — avoids clobbering user edits.
  useEffect(() => {
    const detected = detectMode(value)
    if (detected !== mode) {
      // External value switched type — re-initialise everything
      setMode(detected)
      if (detected === 'tiered') {
        setTierRows(parseTiers(value))
      } else if (detected === 'category') {
        setCategoryRows(parseCategories(value))
      }
    } else if (detected === 'tiered') {
      setTierRows(parseTiers(value))
    } else if (detected === 'category') {
      setCategoryRows(parseCategories(value))
    }
    // Intentionally omit `mode` from deps — we compare it against `detected` inline
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  // ── Tier/category change propagation ───────────────────────────────────────

  const handleTiersChange = useCallback(
    (rows: TierRow[]) => {
      setTierRows(rows)
      onChange(serializeTiers(rows))
    },
    [onChange]
  )

  const handleCategoriesChange = useCallback(
    (rows: CategoryRow[]) => {
      setCategoryRows(rows)
      onChange(serializeCategories(rows))
    },
    [onChange]
  )

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className={className}>
      {/* Rate type badge — read-only, auto-detected from the extracted data */}
      {mode !== 'flat' && (
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            Rate type
          </span>
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              mode === 'tiered'
                ? 'bg-blue-100 text-blue-700'
                : 'bg-purple-100 text-purple-700'
            }`}
            data-testid="rate-type-badge"
          >
            {mode === 'tiered' ? 'Tiered' : 'Category-specific'}
          </span>
        </div>
      )}

      {/* Mode-specific editor */}
      {mode === 'flat' && (
        <FlatInput id={id} value={value} onChange={onChange} required={required} />
      )}
      {mode === 'tiered' && (
        <TieredEditor rows={tierRows} onChange={handleTiersChange} />
      )}
      {mode === 'category' && (
        <CategoryEditor rows={categoryRows} onChange={handleCategoriesChange} />
      )}
    </div>
  )
}
