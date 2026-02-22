/**
 * Tests for SalesPeriodModal component
 */

import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SalesPeriodModal from '@/components/SalesPeriodModal'
import { createSalesPeriod } from '@/lib/api'
import type { Contract } from '@/types'

// Mock API
jest.mock('@/lib/api', () => ({
  createSalesPeriod: jest.fn(),
}))

// SalesPeriodModal is not rendered in the UI (manual sales entry hidden 2026-02-22).
// The component code is retained for future backfill/forecast features.
describe.skip('SalesPeriodModal Component', () => {
  const mockCreateSalesPeriod = createSalesPeriod as jest.MockedFunction<typeof createSalesPeriod>
  const mockOnClose = jest.fn()
  const mockOnSaved = jest.fn()

  const mockContract: Contract = {
    id: 'contract-1',
    user_id: 'user-1',
    status: 'active',
    filename: 'acme-contract.pdf',
    licensee_name: 'Acme Corp',
    licensor_name: 'John Doe',
    contract_start: '2024-01-01',
    contract_end: '2025-12-31',
    royalty_rate: 0.15,
    royalty_base: 'net_sales',
    territories: ['US'],
    product_categories: null,
    minimum_guarantee: null,
    mg_period: null,
    advance_payment: null,
    reporting_frequency: 'quarterly',
    pdf_url: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('does not render when closed', () => {
    const { container } = render(
      <SalesPeriodModal
        contract={mockContract}
        isOpen={false}
        onClose={mockOnClose}
        onSaved={mockOnSaved}
      />
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('renders modal when open', () => {
    render(
      <SalesPeriodModal
        contract={mockContract}
        isOpen={true}
        onClose={mockOnClose}
        onSaved={mockOnSaved}
      />
    )

    expect(screen.getByText('Enter Sales Period')).toBeInTheDocument()
    expect(screen.getByText('Save')).toBeInTheDocument()
    expect(screen.getByText('Cancel')).toBeInTheDocument()
  })

  it('calls onClose when cancel is clicked', () => {
    render(
      <SalesPeriodModal
        contract={mockContract}
        isOpen={true}
        onClose={mockOnClose}
        onSaved={mockOnSaved}
      />
    )

    fireEvent.click(screen.getByText('Cancel'))
    expect(mockOnClose).toHaveBeenCalled()
  })

  it('shows royalty calculation preview for simple rate', async () => {
    const user = userEvent.setup()

    render(
      <SalesPeriodModal
        contract={mockContract}
        isOpen={true}
        onClose={mockOnClose}
        onSaved={mockOnSaved}
      />
    )

    const salesInput = screen.getByPlaceholderText('0.00')
    await user.type(salesInput, '100000')

    await waitFor(() => {
      expect(screen.getByText('Estimated Royalty')).toBeInTheDocument()
      expect(screen.getByText('$15,000.00')).toBeInTheDocument()
    })
  })

  it('shows category rate message for category contracts', async () => {
    const user = userEvent.setup()
    const categoryContract = {
      ...mockContract,
      royalty_rate: {
        type: 'category' as const,
        rates: { Books: 0.15, Merchandise: 0.1 },
      },
    }

    render(
      <SalesPeriodModal
        contract={categoryContract}
        isOpen={true}
        onClose={mockOnClose}
        onSaved={mockOnSaved}
      />
    )

    const salesInput = screen.getByPlaceholderText('0.00')
    await user.type(salesInput, '50000')

    await waitFor(() => {
      expect(screen.getByText(/category-specific rates/i)).toBeInTheDocument()
    })
  })

  it('submits sales period data', async () => {
    const user = userEvent.setup()
    mockCreateSalesPeriod.mockResolvedValue({ id: 'sp-1' })

    render(
      <SalesPeriodModal
        contract={mockContract}
        isOpen={true}
        onClose={mockOnClose}
        onSaved={mockOnSaved}
      />
    )

    // Use querySelectorAll for date inputs (they don't have textbox role)
    const [startInput, endInput] = Array.from(
      document.querySelectorAll('input[type="date"]')
    )

    fireEvent.change(startInput, { target: { value: '2024-01-01' } })
    fireEvent.change(endInput, { target: { value: '2024-03-31' } })

    const salesInput = screen.getByPlaceholderText('0.00')
    await user.type(salesInput, '100000')

    // Submit
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => {
      expect(mockCreateSalesPeriod).toHaveBeenCalledWith({
        contract_id: 'contract-1',
        period_start: '2024-01-01',
        period_end: '2024-03-31',
        net_sales: 100000,
      })
      expect(mockOnSaved).toHaveBeenCalled()
    })
  })

  it('shows error on save failure', async () => {
    const user = userEvent.setup()
    mockCreateSalesPeriod.mockRejectedValue(new Error('Failed to save sales period'))

    render(
      <SalesPeriodModal
        contract={mockContract}
        isOpen={true}
        onClose={mockOnClose}
        onSaved={mockOnSaved}
      />
    )

    const [startInput, endInput] = Array.from(
      document.querySelectorAll('input[type="date"]')
    )

    fireEvent.change(startInput, { target: { value: '2024-01-01' } })
    fireEvent.change(endInput, { target: { value: '2024-03-31' } })

    const salesInput = screen.getByPlaceholderText('0.00')
    await user.type(salesInput, '50000')

    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => {
      expect(screen.getByText(/failed to save sales period/i)).toBeInTheDocument()
    })
  })

  it('shows loading state during save', async () => {
    const user = userEvent.setup()
    mockCreateSalesPeriod.mockImplementation(() => new Promise(() => {}))

    render(
      <SalesPeriodModal
        contract={mockContract}
        isOpen={true}
        onClose={mockOnClose}
        onSaved={mockOnSaved}
      />
    )

    const [startInput, endInput] = Array.from(
      document.querySelectorAll('input[type="date"]')
    )

    fireEvent.change(startInput, { target: { value: '2024-01-01' } })
    fireEvent.change(endInput, { target: { value: '2024-03-31' } })

    const salesInput = screen.getByPlaceholderText('0.00')
    await user.type(salesInput, '50000')

    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => {
      expect(screen.getByText('Saving...')).toBeInTheDocument()
    })
  })
})
