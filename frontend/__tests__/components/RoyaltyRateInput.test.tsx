/**
 * Tests for RoyaltyRateInput component
 */

import { render, screen, fireEvent } from '@testing-library/react'
import RoyaltyRateInput from '@/components/RoyaltyRateInput'

describe('RoyaltyRateInput component', () => {
  describe('rendering', () => {
    it('renders a text input', () => {
      render(<RoyaltyRateInput value="" onChange={jest.fn()} />)
      expect(screen.getByTestId('royalty-rate-input')).toBeInTheDocument()
    })

    it('displays the current value', () => {
      render(<RoyaltyRateInput value="10%" onChange={jest.fn()} />)
      expect(screen.getByDisplayValue('10%')).toBeInTheDocument()
    })

    it('renders a placeholder for flat rates', () => {
      render(<RoyaltyRateInput value="" onChange={jest.fn()} />)
      const input = screen.getByTestId('royalty-rate-input')
      expect(input).toHaveAttribute('placeholder')
    })

    it('passes required attribute through', () => {
      render(<RoyaltyRateInput value="" onChange={jest.fn()} required={true} />)
      expect(screen.getByTestId('royalty-rate-input')).toBeRequired()
    })

    it('links the input to its hint via aria-describedby when id is provided', () => {
      render(<RoyaltyRateInput id="royalty_rate" value="" onChange={jest.fn()} />)
      const input = screen.getByTestId('royalty-rate-input')
      expect(input).toHaveAttribute('aria-describedby', 'royalty_rate-hint')
    })
  })

  describe('flat rate detection', () => {
    it('sets data-rate-type to "flat" for a plain number string', () => {
      render(<RoyaltyRateInput value="10" onChange={jest.fn()} />)
      expect(screen.getByTestId('royalty-rate-input')).toHaveAttribute('data-rate-type', 'flat')
    })

    it('sets data-rate-type to "flat" for a percentage string', () => {
      render(<RoyaltyRateInput value="10%" onChange={jest.fn()} />)
      expect(screen.getByTestId('royalty-rate-input')).toHaveAttribute('data-rate-type', 'flat')
    })

    it('sets data-rate-type to "flat" for an empty string', () => {
      render(<RoyaltyRateInput value="" onChange={jest.fn()} />)
      expect(screen.getByTestId('royalty-rate-input')).toHaveAttribute('data-rate-type', 'flat')
    })

    it('shows flat rate hint text for a plain percentage', () => {
      render(<RoyaltyRateInput value="15" onChange={jest.fn()} />)
      expect(screen.getByText(/flat percentage/i)).toBeInTheDocument()
    })

    it('does not show a type badge for flat rates', () => {
      render(<RoyaltyRateInput value="10%" onChange={jest.fn()} />)
      expect(screen.queryByText('tiered')).not.toBeInTheDocument()
      expect(screen.queryByText('category')).not.toBeInTheDocument()
    })
  })

  describe('tiered rate detection', () => {
    const tieredJson = JSON.stringify({
      type: 'tiered',
      tiers: [
        { min: 0, max: 10000, rate: 0.1 },
        { min: 10000, max: null, rate: 0.15 },
      ],
    })

    it('sets data-rate-type to "tiered" for a tiered rate JSON value', () => {
      render(<RoyaltyRateInput value={tieredJson} onChange={jest.fn()} />)
      expect(screen.getByTestId('royalty-rate-input')).toHaveAttribute('data-rate-type', 'tiered')
    })

    it('shows a "tiered" badge for tiered rate JSON', () => {
      render(<RoyaltyRateInput value={tieredJson} onChange={jest.fn()} />)
      expect(screen.getByText('tiered')).toBeInTheDocument()
    })

    it('shows tiered hint text for tiered rate JSON', () => {
      render(<RoyaltyRateInput value={tieredJson} onChange={jest.fn()} />)
      expect(screen.getByText(/tiered rate detected/i)).toBeInTheDocument()
    })
  })

  describe('category rate detection', () => {
    const categoryJson = JSON.stringify({
      type: 'category',
      rates: { Books: 0.15, Merchandise: 0.1 },
    })

    it('sets data-rate-type to "category" for a category rate JSON value', () => {
      render(<RoyaltyRateInput value={categoryJson} onChange={jest.fn()} />)
      expect(screen.getByTestId('royalty-rate-input')).toHaveAttribute(
        'data-rate-type',
        'category'
      )
    })

    it('shows a "category" badge for category rate JSON', () => {
      render(<RoyaltyRateInput value={categoryJson} onChange={jest.fn()} />)
      expect(screen.getByText('category')).toBeInTheDocument()
    })

    it('shows category hint text for category rate JSON', () => {
      render(<RoyaltyRateInput value={categoryJson} onChange={jest.fn()} />)
      expect(screen.getByText(/category rate detected/i)).toBeInTheDocument()
    })
  })

  describe('unknown / malformed JSON', () => {
    it('sets data-rate-type to "flat" for partial JSON', () => {
      render(<RoyaltyRateInput value='{"type": "tiered"' onChange={jest.fn()} />)
      expect(screen.getByTestId('royalty-rate-input')).toHaveAttribute('data-rate-type', 'flat')
    })

    it('sets data-rate-type to "flat" for plain text', () => {
      render(<RoyaltyRateInput value="10% of net sales" onChange={jest.fn()} />)
      expect(screen.getByTestId('royalty-rate-input')).toHaveAttribute('data-rate-type', 'flat')
    })
  })

  describe('onChange callback', () => {
    it('calls onChange with the new value when the user types', () => {
      const onChange = jest.fn()
      render(<RoyaltyRateInput value="10" onChange={onChange} />)

      const input = screen.getByTestId('royalty-rate-input')
      fireEvent.change(input, { target: { value: '15' } })

      expect(onChange).toHaveBeenCalledWith('15')
    })

    it('calls onChange with an empty string when the user clears the input', () => {
      const onChange = jest.fn()
      render(<RoyaltyRateInput value="10" onChange={onChange} />)

      const input = screen.getByTestId('royalty-rate-input')
      fireEvent.change(input, { target: { value: '' } })

      expect(onChange).toHaveBeenCalledWith('')
    })
  })
})
