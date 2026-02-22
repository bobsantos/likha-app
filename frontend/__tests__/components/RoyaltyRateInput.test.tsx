/**
 * Tests for RoyaltyRateInput component
 *
 * The component handles three rate types:
 *   Flat     — plain string like "8" or "8%"
 *   Tiered   — JSON array of {threshold, rate} objects
 *   Category — JSON object mapping category → rate string
 */

import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RoyaltyRateInput from '@/components/RoyaltyRateInput'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TIERED_JSON = JSON.stringify([
  { threshold: '$0-$2,000,000', rate: '6%' },
  { threshold: '$2,000,000+', rate: '8%' },
])

const CATEGORY_JSON = JSON.stringify({
  Books: '15%',
  Merchandise: '10%',
})

// ─── Flat mode ─────────────────────────────────────────────────────────────────

describe('Flat rate mode', () => {
  it('renders in flat mode for an empty value', () => {
    render(<RoyaltyRateInput value="" onChange={jest.fn()} />)
    const input = screen.getByTestId('royalty-rate-input')
    expect(input).toHaveAttribute('data-rate-type', 'flat')
  })

  it('renders in flat mode for a plain number string', () => {
    render(<RoyaltyRateInput value="8" onChange={jest.fn()} />)
    expect(screen.getByTestId('royalty-rate-input')).toHaveAttribute('data-rate-type', 'flat')
  })

  it('renders in flat mode for a percentage string', () => {
    render(<RoyaltyRateInput value="10%" onChange={jest.fn()} />)
    expect(screen.getByTestId('royalty-rate-input')).toHaveAttribute('data-rate-type', 'flat')
  })

  it('displays the current flat value in the input', () => {
    render(<RoyaltyRateInput value="10%" onChange={jest.fn()} />)
    expect(screen.getByDisplayValue('10%')).toBeInTheDocument()
  })

  it('shows a placeholder on the flat input', () => {
    render(<RoyaltyRateInput value="" onChange={jest.fn()} />)
    expect(screen.getByTestId('royalty-rate-input')).toHaveAttribute('placeholder')
  })

  it('passes the required attribute to the flat input', () => {
    render(<RoyaltyRateInput value="" onChange={jest.fn()} required />)
    expect(screen.getByTestId('royalty-rate-input')).toBeRequired()
  })

  it('shows a help text explaining the flat format', () => {
    render(<RoyaltyRateInput value="15" onChange={jest.fn()} />)
    expect(screen.getByText(/flat percentage/i)).toBeInTheDocument()
  })

  it('calls onChange with the typed value', () => {
    const onChange = jest.fn()
    render(<RoyaltyRateInput value="10" onChange={onChange} />)
    fireEvent.change(screen.getByTestId('royalty-rate-input'), { target: { value: '15' } })
    expect(onChange).toHaveBeenCalledWith('15')
  })

  it('calls onChange with an empty string when the input is cleared', () => {
    const onChange = jest.fn()
    render(<RoyaltyRateInput value="10" onChange={onChange} />)
    fireEvent.change(screen.getByTestId('royalty-rate-input'), { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith('')
  })
})

// ─── Tiered mode ───────────────────────────────────────────────────────────────

describe('Tiered rate mode', () => {
  it('detects tiered mode from a JSON array value', () => {
    render(<RoyaltyRateInput value={TIERED_JSON} onChange={jest.fn()} />)
    expect(screen.getByTestId('royalty-rate-input')).toHaveAttribute('data-rate-type', 'tiered')
  })

  it('renders one row per tier from the parsed JSON', () => {
    render(<RoyaltyRateInput value={TIERED_JSON} onChange={jest.fn()} />)
    // Two threshold inputs should be present
    const thresholdInputs = screen.getAllByRole('textbox', { name: /sales threshold/i })
    expect(thresholdInputs).toHaveLength(2)
  })

  it('populates threshold and rate inputs from the parsed JSON', () => {
    render(<RoyaltyRateInput value={TIERED_JSON} onChange={jest.fn()} />)
    expect(screen.getByDisplayValue('$0-$2,000,000')).toBeInTheDocument()
    expect(screen.getByDisplayValue('$2,000,000+')).toBeInTheDocument()
    // rate inputs — "%" is stripped on parse to keep display consistent with flat rates
    const rateInputs = screen.getAllByRole('textbox', { name: /^rate$/i })
    expect(rateInputs[0]).toHaveValue('6')
    expect(rateInputs[1]).toHaveValue('8')
  })

  it('shows a "Tiered" badge', () => {
    render(<RoyaltyRateInput value={TIERED_JSON} onChange={jest.fn()} />)
    expect(screen.getByTestId('rate-type-badge')).toHaveTextContent('Tiered')
  })

  it('emits serialized JSON when a threshold input changes', () => {
    const onChange = jest.fn()
    render(<RoyaltyRateInput value={TIERED_JSON} onChange={onChange} />)

    const thresholdInputs = screen.getAllByRole('textbox', { name: /sales threshold/i })
    fireEvent.change(thresholdInputs[0], { target: { value: '$0-$1,000,000' } })

    // The emitted value should be valid JSON with the updated threshold
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0]
    const parsed = JSON.parse(lastCall)
    expect(parsed[0].threshold).toBe('$0-$1,000,000')
  })

  it('emits serialized JSON when a rate input changes', () => {
    const onChange = jest.fn()
    render(<RoyaltyRateInput value={TIERED_JSON} onChange={onChange} />)

    const rateInputs = screen.getAllByRole('textbox', { name: /^rate$/i })
    fireEvent.change(rateInputs[1], { target: { value: '9%' } })

    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0]
    const parsed = JSON.parse(lastCall)
    expect(parsed[1].rate).toBe('9%')
  })

  it('adds a new empty row when "+ Add tier" is clicked', () => {
    render(<RoyaltyRateInput value={TIERED_JSON} onChange={jest.fn()} />)
    const addButton = screen.getByRole('button', { name: /add tier/i })
    fireEvent.click(addButton)

    const thresholdInputs = screen.getAllByRole('textbox', { name: /sales threshold/i })
    expect(thresholdInputs).toHaveLength(3)
  })

  it('emits the new row in the JSON when "+ Add tier" is clicked', () => {
    const onChange = jest.fn()
    render(<RoyaltyRateInput value={TIERED_JSON} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /add tier/i }))

    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0]
    const parsed = JSON.parse(lastCall)
    expect(parsed).toHaveLength(3)
    expect(parsed[2]).toEqual({ threshold: '', rate: '' })
  })

  it('removes a row when the remove button is clicked (2+ rows)', () => {
    render(<RoyaltyRateInput value={TIERED_JSON} onChange={jest.fn()} />)
    const removeButtons = screen.getAllByRole('button', { name: /remove tier/i })
    fireEvent.click(removeButtons[0])

    const thresholdInputs = screen.getAllByRole('textbox', { name: /sales threshold/i })
    expect(thresholdInputs).toHaveLength(1)
  })

  it('emits the remaining tiers after removal', () => {
    const onChange = jest.fn()
    render(<RoyaltyRateInput value={TIERED_JSON} onChange={onChange} />)

    const removeButtons = screen.getAllByRole('button', { name: /remove tier/i })
    fireEvent.click(removeButtons[0])

    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0]
    const parsed = JSON.parse(lastCall)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].threshold).toBe('$2,000,000+')
  })

  it('disables the remove button when only 1 row remains', () => {
    const singleTier = JSON.stringify([{ threshold: '$0+', rate: '10%' }])
    render(<RoyaltyRateInput value={singleTier} onChange={jest.fn()} />)
    const removeButton = screen.getByRole('button', { name: /remove tier/i })
    expect(removeButton).toBeDisabled()
  })

  it('shows help text about tier ordering', () => {
    render(<RoyaltyRateInput value={TIERED_JSON} onChange={jest.fn()} />)
    expect(screen.getByText(/tiers apply in sequence/i)).toBeInTheDocument()
  })
})

// ─── Category mode ─────────────────────────────────────────────────────────────

describe('Category rate mode', () => {
  it('detects category mode from a JSON object value', () => {
    render(<RoyaltyRateInput value={CATEGORY_JSON} onChange={jest.fn()} />)
    expect(screen.getByTestId('royalty-rate-input')).toHaveAttribute('data-rate-type', 'category')
  })

  it('renders one row per category from the parsed JSON', () => {
    render(<RoyaltyRateInput value={CATEGORY_JSON} onChange={jest.fn()} />)
    const categoryInputs = screen.getAllByRole('textbox', { name: /category name/i })
    expect(categoryInputs).toHaveLength(2)
  })

  it('populates category and rate inputs from the parsed JSON', () => {
    render(<RoyaltyRateInput value={CATEGORY_JSON} onChange={jest.fn()} />)
    expect(screen.getByDisplayValue('Books')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Merchandise')).toBeInTheDocument()
    // "%" is stripped on parse to keep display consistent with flat rates
    const rateInputs = screen.getAllByRole('textbox', { name: /^rate$/i })
    expect(rateInputs[0]).toHaveValue('15')
    expect(rateInputs[1]).toHaveValue('10')
  })

  it('shows a "Category-specific" badge', () => {
    render(<RoyaltyRateInput value={CATEGORY_JSON} onChange={jest.fn()} />)
    expect(screen.getByTestId('rate-type-badge')).toHaveTextContent('Category-specific')
  })

  it('emits serialized JSON when a category name input changes', () => {
    const onChange = jest.fn()
    render(<RoyaltyRateInput value={CATEGORY_JSON} onChange={onChange} />)

    const categoryInputs = screen.getAllByRole('textbox', { name: /category name/i })
    fireEvent.change(categoryInputs[0], { target: { value: 'eBooks' } })

    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0]
    const parsed = JSON.parse(lastCall)
    // Rate was parsed as '15' (stripped of '%') so the emitted value reflects that
    expect(parsed).toHaveProperty('eBooks', '15')
    expect(parsed).not.toHaveProperty('Books')
  })

  it('emits serialized JSON when a rate input changes', () => {
    const onChange = jest.fn()
    render(<RoyaltyRateInput value={CATEGORY_JSON} onChange={onChange} />)

    const rateInputs = screen.getAllByRole('textbox', { name: /^rate$/i })
    fireEvent.change(rateInputs[1], { target: { value: '12%' } })

    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0]
    const parsed = JSON.parse(lastCall)
    expect(parsed.Merchandise).toBe('12%')
  })

  it('adds a new empty row when "+ Add category" is clicked', () => {
    render(<RoyaltyRateInput value={CATEGORY_JSON} onChange={jest.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /add category/i }))

    const categoryInputs = screen.getAllByRole('textbox', { name: /category name/i })
    expect(categoryInputs).toHaveLength(3)
  })

  it('emits the new entry in the JSON when "+ Add category" is clicked', () => {
    const onChange = jest.fn()
    render(<RoyaltyRateInput value={CATEGORY_JSON} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /add category/i }))

    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0]
    const parsed = JSON.parse(lastCall)
    // The new empty key maps to ''
    expect(parsed).toHaveProperty('')
    expect(Object.keys(parsed)).toHaveLength(3)
  })

  it('removes a row when the remove button is clicked (2+ rows)', () => {
    render(<RoyaltyRateInput value={CATEGORY_JSON} onChange={jest.fn()} />)
    const removeButtons = screen.getAllByRole('button', { name: /remove category/i })
    fireEvent.click(removeButtons[0])

    const categoryInputs = screen.getAllByRole('textbox', { name: /category name/i })
    expect(categoryInputs).toHaveLength(1)
  })

  it('emits the remaining categories after removal', () => {
    const onChange = jest.fn()
    render(<RoyaltyRateInput value={CATEGORY_JSON} onChange={onChange} />)

    const removeButtons = screen.getAllByRole('button', { name: /remove category/i })
    fireEvent.click(removeButtons[0])

    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0]
    const parsed = JSON.parse(lastCall)
    expect(Object.keys(parsed)).toHaveLength(1)
    // Rate was parsed as '10' (stripped of '%') so the emitted value reflects that
    expect(parsed).toHaveProperty('Merchandise', '10')
  })

  it('disables the remove button when only 1 row remains', () => {
    const singleCategory = JSON.stringify({ Books: '15%' })
    render(<RoyaltyRateInput value={singleCategory} onChange={jest.fn()} />)
    const removeButton = screen.getByRole('button', { name: /remove category/i })
    expect(removeButton).toBeDisabled()
  })

  it('shows help text about category rates', () => {
    render(<RoyaltyRateInput value={CATEGORY_JSON} onChange={jest.fn()} />)
    expect(screen.getByText(/different royalty rate for each product category/i)).toBeInTheDocument()
  })
})

// ─── No type switching (rate type is read-only) ─────────────────────────────────

describe('Rate type is read-only', () => {
  it('does not render a rate type dropdown/combobox', () => {
    render(<RoyaltyRateInput value="10%" onChange={jest.fn()} />)
    expect(screen.queryByRole('combobox', { name: /rate type/i })).not.toBeInTheDocument()
  })

  it('does not show a rate type badge for flat rates', () => {
    render(<RoyaltyRateInput value="10%" onChange={jest.fn()} />)
    expect(screen.queryByTestId('rate-type-badge')).not.toBeInTheDocument()
  })

  it('shows a "Tiered" badge for tiered rates', () => {
    render(<RoyaltyRateInput value={TIERED_JSON} onChange={jest.fn()} />)
    const badge = screen.getByTestId('rate-type-badge')
    expect(badge).toHaveTextContent('Tiered')
  })

  it('shows a "Category-specific" badge for category rates', () => {
    render(<RoyaltyRateInput value={CATEGORY_JSON} onChange={jest.fn()} />)
    const badge = screen.getByTestId('rate-type-badge')
    expect(badge).toHaveTextContent('Category-specific')
  })
})

// ─── Serialization output format ───────────────────────────────────────────────

describe('Serialization output format', () => {
  it('flat: emits the raw string, not JSON', () => {
    const onChange = jest.fn()
    render(<RoyaltyRateInput value="10" onChange={onChange} />)
    fireEvent.change(screen.getByTestId('royalty-rate-input'), { target: { value: '12%' } })
    expect(onChange).toHaveBeenCalledWith('12%')
    // Should NOT be JSON-wrapped
    expect(() => JSON.parse('12%')).toThrow()
  })

  it('tiered: emits a JSON array with {threshold, rate} objects only (no id fields)', () => {
    const onChange = jest.fn()
    render(<RoyaltyRateInput value={TIERED_JSON} onChange={onChange} />)

    // Trigger a change to get an emission
    const thresholdInputs = screen.getAllByRole('textbox', { name: /sales threshold/i })
    fireEvent.change(thresholdInputs[0], { target: { value: '$0-$1,000,000' } })

    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0]
    const parsed = JSON.parse(lastCall)
    expect(Array.isArray(parsed)).toBe(true)
    parsed.forEach((item: any) => {
      expect(Object.keys(item).sort()).toEqual(['rate', 'threshold'])
    })
  })

  it('category: emits a JSON object (not an array)', () => {
    const onChange = jest.fn()
    render(<RoyaltyRateInput value={CATEGORY_JSON} onChange={onChange} />)

    const rateInputs = screen.getAllByRole('textbox', { name: /^rate$/i })
    fireEvent.change(rateInputs[0], { target: { value: '20%' } })

    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0]
    const parsed = JSON.parse(lastCall)
    expect(Array.isArray(parsed)).toBe(false)
    expect(typeof parsed).toBe('object')
  })

  it('category: the emitted object maps category names to rate strings', () => {
    const onChange = jest.fn()
    render(<RoyaltyRateInput value={CATEGORY_JSON} onChange={onChange} />)

    const rateInputs = screen.getAllByRole('textbox', { name: /^rate$/i })
    fireEvent.change(rateInputs[0], { target: { value: '20%' } })

    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0]
    const parsed = JSON.parse(lastCall)
    expect(parsed).toHaveProperty('Books', '20%')
    // Merchandise rate was parsed as '10' (stripped of '%') since it was not edited
    expect(parsed).toHaveProperty('Merchandise', '10')
  })
})

// ─── Rate type auto-detection ─────────────────────────────────────────────────

describe('Rate type auto-detection', () => {
  it('detects flat mode for an empty value', () => {
    render(<RoyaltyRateInput value="" onChange={jest.fn()} />)
    expect(screen.getByTestId('royalty-rate-input')).toHaveAttribute('data-rate-type', 'flat')
  })

  it('detects tiered mode for a JSON array', () => {
    render(<RoyaltyRateInput value={TIERED_JSON} onChange={jest.fn()} />)
    expect(screen.getByTestId('royalty-rate-input')).toHaveAttribute('data-rate-type', 'tiered')
  })

  it('detects category mode for a JSON object', () => {
    render(<RoyaltyRateInput value={CATEGORY_JSON} onChange={jest.fn()} />)
    expect(screen.getByTestId('royalty-rate-input')).toHaveAttribute('data-rate-type', 'category')
  })

  it('falls back to flat mode for invalid JSON', () => {
    render(<RoyaltyRateInput value="not json {" onChange={jest.fn()} />)
    expect(screen.getByTestId('royalty-rate-input')).toHaveAttribute('data-rate-type', 'flat')
  })
})
