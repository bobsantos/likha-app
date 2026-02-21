/**
 * RoyaltyRateInput component - Smart input for royalty rate values.
 *
 * Handles three rate structures:
 * - Flat rate: a plain percentage string (e.g. "10" or "10%")
 * - Tiered rate: JSON object with type "tiered" and a tiers array
 * - Category rate: JSON object with type "category" and a rates map
 *
 * The component shows a plain text input for all modes since the backend
 * accepts str | list | dict. For flat rates users type "10" or "10%".
 * For structured rates the raw JSON is displayed and can be edited.
 *
 * A helper below the input explains the expected format.
 */

'use client'

import { useMemo } from 'react'

export interface RoyaltyRateInputProps {
  /** Current string value bound to the form field. */
  value: string
  /** Called whenever the value changes. */
  onChange: (value: string) => void
  /** HTML id for the input (used to link a <label>). */
  id?: string
  /** Additional class names for the wrapping div. */
  className?: string
  /** Whether the field is required. */
  required?: boolean
}

type RateType = 'flat' | 'tiered' | 'category' | 'unknown'

function detectRateType(value: string): RateType {
  const trimmed = value.trim()
  if (!trimmed) return 'flat'

  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      if (parsed.type === 'tiered') return 'tiered'
      if (parsed.type === 'category') return 'category'
    }
  } catch {
    // Not valid JSON — treat as flat
  }

  return 'flat'
}

function RateHint({ type }: { type: RateType }) {
  if (type === 'tiered') {
    return (
      <p className="mt-1.5 text-xs text-blue-600">
        Tiered rate detected. Format:{' '}
        <code className="font-mono bg-blue-50 px-1 rounded">
          {'{"type":"tiered","tiers":[{"min":0,"max":10000,"rate":0.1},{"min":10000,"max":null,"rate":0.15}]}'}
        </code>
      </p>
    )
  }

  if (type === 'category') {
    return (
      <p className="mt-1.5 text-xs text-purple-600">
        Category rate detected. Format:{' '}
        <code className="font-mono bg-purple-50 px-1 rounded">
          {'{"type":"category","rates":{"Books":0.15,"Merchandise":0.10}}'}
        </code>
      </p>
    )
  }

  return (
    <p className="mt-1.5 text-xs text-gray-500">
      Enter a flat percentage (e.g. <code className="font-mono bg-gray-100 px-1 rounded">10</code>{' '}
      or <code className="font-mono bg-gray-100 px-1 rounded">10%</code>). For tiered or
      category-specific rates, paste the JSON structure.
    </p>
  )
}

export default function RoyaltyRateInput({
  value,
  onChange,
  id,
  className = '',
  required = false,
}: RoyaltyRateInputProps) {
  const rateType = useMemo(() => detectRateType(value), [value])

  const inputClass = [
    'input font-mono text-sm',
    rateType === 'tiered' ? 'border-blue-300 focus:border-blue-500 focus:ring-blue-200' : '',
    rateType === 'category' ? 'border-purple-300 focus:border-purple-500 focus:ring-purple-200' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div>
      <div className="relative">
        <input
          id={id}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          placeholder='e.g. 10 or 10% or {"type":"tiered",...}'
          className={inputClass}
          data-testid="royalty-rate-input"
          data-rate-type={rateType}
          aria-describedby={id ? `${id}-hint` : undefined}
        />
        {rateType !== 'flat' && (
          <span
            className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium px-2 py-0.5 rounded-full ${
              rateType === 'tiered'
                ? 'bg-blue-100 text-blue-700'
                : 'bg-purple-100 text-purple-700'
            }`}
          >
            {rateType}
          </span>
        )}
      </div>
      <div id={id ? `${id}-hint` : undefined}>
        <RateHint type={rateType} />
      </div>
    </div>
  )
}
