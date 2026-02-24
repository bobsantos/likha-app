/**
 * Tests for Sales Entry Page
 * TDD: written before the implementation
 */

import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRouter, useSearchParams } from 'next/navigation'
import SalesNewPage from '@/app/(app)/sales/new/page'
import { getContracts, createSalesPeriod } from '@/lib/api'
import type { Contract } from '@/types'

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}))

// Mock API
jest.mock('@/lib/api', () => ({
  getContracts: jest.fn(),
  createSalesPeriod: jest.fn(),
}))

// Sales entry page is hidden from the UI (manual sales entry hidden 2026-02-22).
// The page code is retained for future backfill/forecast features.
describe.skip('Sales Entry Page', () => {
  const mockPush = jest.fn()
  const mockGetContracts = getContracts as jest.MockedFunction<typeof getContracts>
  const mockCreateSalesPeriod = createSalesPeriod as jest.MockedFunction<typeof createSalesPeriod>

  const mockContracts: Contract[] = [
    {
      id: 'contract-1',
      user_id: 'user-1',
      status: 'active',
      filename: 'acme-contract.pdf',
      licensee_name: 'Acme Corp',
      contract_start_date: '2024-01-01',
      contract_end_date: '2025-12-31',
      royalty_rate: 0.15,
      royalty_base: 'net_sales',
      territories: ['US', 'Canada'],
      product_categories: null,
      minimum_guarantee: 5000,
      minimum_guarantee_period: 'quarterly',
      advance_payment: null,
      reporting_frequency: 'quarterly',
      pdf_url: null,
      extracted_terms: {},
      storage_path: null,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
    {
      id: 'contract-2',
      user_id: 'user-1',
      status: 'active',
      filename: 'nike-contract.pdf',
      licensee_name: 'Nike Inc',
      contract_start_date: '2024-06-01',
      contract_end_date: '2026-05-31',
      royalty_rate: {
        type: 'category',
        rates: { Apparel: 0.1, Footwear: 0.12 },
      },
      royalty_base: 'net_sales',
      territories: ['Global'],
      product_categories: ['Apparel', 'Footwear'],
      minimum_guarantee: null,
      minimum_guarantee_period: null,
      advance_payment: null,
      reporting_frequency: 'monthly',
      pdf_url: null,
      extracted_terms: {},
      storage_path: null,
      created_at: '2024-06-01T00:00:00Z',
      updated_at: '2024-06-01T00:00:00Z',
    },
  ]

  const mockSavedPeriod = {
    id: 'sp-new-1',
    contract_id: 'contract-1',
    period_start: '2024-01-01',
    period_end: '2024-03-31',
    net_sales: 100000,
    category_breakdown: null,
    royalty_calculated: 15000,
    minimum_applied: false,
    created_at: '2024-04-01T00:00:00Z',
  }

  beforeEach(() => {
    jest.clearAllMocks()
    ;(useRouter as jest.Mock).mockReturnValue({ push: mockPush })
    ;(useSearchParams as jest.Mock).mockReturnValue({
      get: jest.fn().mockReturnValue(null),
    })
  })

  // ============================================================
  // Rendering and loading
  // ============================================================

  it('shows a loading skeleton while fetching contracts', () => {
    mockGetContracts.mockImplementation(() => new Promise(() => {}))
    render(<SalesNewPage />)
    expect(document.querySelector('.skeleton')).toBeInTheDocument()
  })

  it('renders the page heading', async () => {
    mockGetContracts.mockResolvedValue(mockContracts)
    render(<SalesNewPage />)
    await waitFor(() => {
      expect(screen.getByText('Enter Sales Period')).toBeInTheDocument()
    })
  })

  it('shows a back link to the dashboard', async () => {
    mockGetContracts.mockResolvedValue(mockContracts)
    render(<SalesNewPage />)
    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument()
    })
  })

  it('shows an error when contracts fail to load', async () => {
    mockGetContracts.mockRejectedValue(new Error('Network error'))
    render(<SalesNewPage />)
    await waitFor(() => {
      expect(screen.getByText(/failed to load contracts/i)).toBeInTheDocument()
    })
  })

  // ============================================================
  // Contract selector
  // ============================================================

  it('renders a contract selector dropdown', async () => {
    mockGetContracts.mockResolvedValue(mockContracts)
    render(<SalesNewPage />)
    await waitFor(() => {
      expect(screen.getByLabelText(/contract/i)).toBeInTheDocument()
    })
  })

  it('lists active contracts in the selector', async () => {
    mockGetContracts.mockResolvedValue(mockContracts)
    render(<SalesNewPage />)
    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument()
      expect(screen.getByText('Nike Inc')).toBeInTheDocument()
    })
  })

  it('shows empty state when no active contracts exist', async () => {
    mockGetContracts.mockResolvedValue([])
    render(<SalesNewPage />)
    await waitFor(() => {
      expect(screen.getByText(/no active contracts/i)).toBeInTheDocument()
    })
  })

  // ============================================================
  // Period dates
  // ============================================================

  it('renders period start date input', async () => {
    mockGetContracts.mockResolvedValue(mockContracts)
    render(<SalesNewPage />)
    await waitFor(() => {
      expect(screen.getByLabelText(/period start/i)).toBeInTheDocument()
    })
  })

  it('renders period end date input', async () => {
    mockGetContracts.mockResolvedValue(mockContracts)
    render(<SalesNewPage />)
    await waitFor(() => {
      expect(screen.getByLabelText(/period end/i)).toBeInTheDocument()
    })
  })

  // ============================================================
  // Net sales amount
  // ============================================================

  it('renders net sales amount input', async () => {
    mockGetContracts.mockResolvedValue(mockContracts)
    render(<SalesNewPage />)
    await waitFor(() => {
      expect(screen.getByLabelText(/net sales/i)).toBeInTheDocument()
    })
  })

  // ============================================================
  // Pre-selection via ?contract_id= query param
  // ============================================================

  it('pre-selects contract from ?contract_id= query param', async () => {
    ;(useSearchParams as jest.Mock).mockReturnValue({
      get: jest.fn((key: string) => (key === 'contract_id' ? 'contract-2' : null)),
    })
    mockGetContracts.mockResolvedValue(mockContracts)
    render(<SalesNewPage />)
    await waitFor(() => {
      const select = screen.getByLabelText(/contract/i) as HTMLSelectElement
      expect(select.value).toBe('contract-2')
    })
  })

  // ============================================================
  // Category breakdown (conditional display)
  // ============================================================

  it('does not show category breakdown for flat-rate contracts', async () => {
    mockGetContracts.mockResolvedValue(mockContracts)
    render(<SalesNewPage />)

    await waitFor(() => {
      expect(screen.getByLabelText(/contract/i)).toBeInTheDocument()
    })

    // Select the flat-rate contract (Acme Corp)
    fireEvent.change(screen.getByLabelText(/contract/i), {
      target: { value: 'contract-1' },
    })

    // No category breakdown should be visible
    expect(screen.queryByText(/category breakdown/i)).not.toBeInTheDocument()
  })

  it('shows category breakdown when contract has category-specific rates', async () => {
    mockGetContracts.mockResolvedValue(mockContracts)
    render(<SalesNewPage />)

    await waitFor(() => {
      expect(screen.getByLabelText(/contract/i)).toBeInTheDocument()
    })

    // Select the category-rate contract (Nike Inc)
    fireEvent.change(screen.getByLabelText(/contract/i), {
      target: { value: 'contract-2' },
    })

    await waitFor(() => {
      expect(screen.getByText(/category breakdown/i)).toBeInTheDocument()
    })
  })

  it('shows category inputs for each category in a category-rate contract', async () => {
    mockGetContracts.mockResolvedValue(mockContracts)
    render(<SalesNewPage />)

    await waitFor(() => {
      expect(screen.getByLabelText(/contract/i)).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText(/contract/i), {
      target: { value: 'contract-2' },
    })

    await waitFor(() => {
      // Nike contract has Apparel and Footwear categories
      expect(screen.getByText('Apparel')).toBeInTheDocument()
      expect(screen.getByText('Footwear')).toBeInTheDocument()
    })
  })

  // ============================================================
  // Form submission — flat rate contract
  // ============================================================

  it('calls createSalesPeriod with correct payload for flat rate contract', async () => {
    const user = userEvent.setup()
    mockGetContracts.mockResolvedValue(mockContracts)
    mockCreateSalesPeriod.mockResolvedValue(mockSavedPeriod)
    render(<SalesNewPage />)

    await waitFor(() => {
      expect(screen.getByLabelText(/contract/i)).toBeInTheDocument()
    })

    // Select contract
    fireEvent.change(screen.getByLabelText(/contract/i), {
      target: { value: 'contract-1' },
    })

    // Fill period dates
    const dateInputs = document.querySelectorAll('input[type="date"]')
    fireEvent.change(dateInputs[0], { target: { value: '2024-01-01' } })
    fireEvent.change(dateInputs[1], { target: { value: '2024-03-31' } })

    // Fill net sales
    const netSalesInput = screen.getByLabelText(/net sales/i)
    await user.clear(netSalesInput)
    await user.type(netSalesInput, '100000')

    // Submit
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(mockCreateSalesPeriod).toHaveBeenCalledWith(
        expect.objectContaining({
          contract_id: 'contract-1',
          period_start: '2024-01-01',
          period_end: '2024-03-31',
          net_sales: 100000,
        })
      )
    })
  })

  // ============================================================
  // Royalty result display after submission
  // ============================================================

  it('shows calculated royalty after successful submission', async () => {
    const user = userEvent.setup()
    mockGetContracts.mockResolvedValue(mockContracts)
    mockCreateSalesPeriod.mockResolvedValue(mockSavedPeriod)
    render(<SalesNewPage />)

    await waitFor(() => {
      expect(screen.getByLabelText(/contract/i)).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText(/contract/i), {
      target: { value: 'contract-1' },
    })

    const dateInputs = document.querySelectorAll('input[type="date"]')
    fireEvent.change(dateInputs[0], { target: { value: '2024-01-01' } })
    fireEvent.change(dateInputs[1], { target: { value: '2024-03-31' } })

    const netSalesInput = screen.getByLabelText(/net sales/i)
    await user.clear(netSalesInput)
    await user.type(netSalesInput, '100000')

    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      // Calculated royalty from the mock response is 15000
      expect(screen.getByText('$15,000.00')).toBeInTheDocument()
    })
  })

  it('shows a success message after saving', async () => {
    const user = userEvent.setup()
    mockGetContracts.mockResolvedValue(mockContracts)
    mockCreateSalesPeriod.mockResolvedValue(mockSavedPeriod)
    render(<SalesNewPage />)

    await waitFor(() => {
      expect(screen.getByLabelText(/contract/i)).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText(/contract/i), {
      target: { value: 'contract-1' },
    })

    const dateInputs = document.querySelectorAll('input[type="date"]')
    fireEvent.change(dateInputs[0], { target: { value: '2024-01-01' } })
    fireEvent.change(dateInputs[1], { target: { value: '2024-03-31' } })

    const netSalesInput = screen.getByLabelText(/net sales/i)
    await user.clear(netSalesInput)
    await user.type(netSalesInput, '100000')

    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(screen.getByText(/sales period saved/i)).toBeInTheDocument()
    })
  })

  // ============================================================
  // Error handling
  // ============================================================

  it('shows an error message when save fails', async () => {
    const user = userEvent.setup()
    mockGetContracts.mockResolvedValue(mockContracts)
    mockCreateSalesPeriod.mockRejectedValue(new Error('Failed to create sales period'))
    render(<SalesNewPage />)

    await waitFor(() => {
      expect(screen.getByLabelText(/contract/i)).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText(/contract/i), {
      target: { value: 'contract-1' },
    })

    const dateInputs = document.querySelectorAll('input[type="date"]')
    fireEvent.change(dateInputs[0], { target: { value: '2024-01-01' } })
    fireEvent.change(dateInputs[1], { target: { value: '2024-03-31' } })

    const netSalesInput = screen.getByLabelText(/net sales/i)
    await user.clear(netSalesInput)
    await user.type(netSalesInput, '50000')

    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(screen.getByText(/failed to create sales period/i)).toBeInTheDocument()
    })
  })

  it('shows loading state during save', async () => {
    const user = userEvent.setup()
    mockGetContracts.mockResolvedValue(mockContracts)
    mockCreateSalesPeriod.mockImplementation(() => new Promise(() => {}))
    render(<SalesNewPage />)

    await waitFor(() => {
      expect(screen.getByLabelText(/contract/i)).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText(/contract/i), {
      target: { value: 'contract-1' },
    })

    const dateInputs = document.querySelectorAll('input[type="date"]')
    fireEvent.change(dateInputs[0], { target: { value: '2024-01-01' } })
    fireEvent.change(dateInputs[1], { target: { value: '2024-03-31' } })

    const netSalesInput = screen.getByLabelText(/net sales/i)
    await user.clear(netSalesInput)
    await user.type(netSalesInput, '50000')

    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(screen.getByText(/saving/i)).toBeInTheDocument()
    })
  })

  // ============================================================
  // Post-success actions
  // ============================================================

  it('shows a "View Contract" link after successful save', async () => {
    const user = userEvent.setup()
    mockGetContracts.mockResolvedValue(mockContracts)
    mockCreateSalesPeriod.mockResolvedValue(mockSavedPeriod)
    render(<SalesNewPage />)

    await waitFor(() => {
      expect(screen.getByLabelText(/contract/i)).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText(/contract/i), {
      target: { value: 'contract-1' },
    })

    const dateInputs = document.querySelectorAll('input[type="date"]')
    fireEvent.change(dateInputs[0], { target: { value: '2024-01-01' } })
    fireEvent.change(dateInputs[1], { target: { value: '2024-03-31' } })

    const netSalesInput = screen.getByLabelText(/net sales/i)
    await user.clear(netSalesInput)
    await user.type(netSalesInput, '100000')

    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      const link = screen.getByRole('link', { name: /view contract/i })
      expect(link).toBeInTheDocument()
      expect(link).toHaveAttribute('href', '/contracts/contract-1')
    })
  })

  it('shows an "Enter Another Period" button after successful save', async () => {
    const user = userEvent.setup()
    mockGetContracts.mockResolvedValue(mockContracts)
    mockCreateSalesPeriod.mockResolvedValue(mockSavedPeriod)
    render(<SalesNewPage />)

    await waitFor(() => {
      expect(screen.getByLabelText(/contract/i)).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText(/contract/i), {
      target: { value: 'contract-1' },
    })

    const dateInputs = document.querySelectorAll('input[type="date"]')
    fireEvent.change(dateInputs[0], { target: { value: '2024-01-01' } })
    fireEvent.change(dateInputs[1], { target: { value: '2024-03-31' } })

    const netSalesInput = screen.getByLabelText(/net sales/i)
    await user.clear(netSalesInput)
    await user.type(netSalesInput, '100000')

    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /enter another period/i })).toBeInTheDocument()
    })
  })

  it('resets form when "Enter Another Period" is clicked', async () => {
    const user = userEvent.setup()
    mockGetContracts.mockResolvedValue(mockContracts)
    mockCreateSalesPeriod.mockResolvedValue(mockSavedPeriod)
    render(<SalesNewPage />)

    await waitFor(() => {
      expect(screen.getByLabelText(/contract/i)).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText(/contract/i), {
      target: { value: 'contract-1' },
    })

    const dateInputs = document.querySelectorAll('input[type="date"]')
    fireEvent.change(dateInputs[0], { target: { value: '2024-01-01' } })
    fireEvent.change(dateInputs[1], { target: { value: '2024-03-31' } })

    const netSalesInput = screen.getByLabelText(/net sales/i)
    await user.clear(netSalesInput)
    await user.type(netSalesInput, '100000')

    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /enter another period/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /enter another period/i }))

    // Should be back to the form
    await waitFor(() => {
      expect(screen.getByLabelText(/contract/i)).toBeInTheDocument()
      expect(screen.queryByText(/sales period saved/i)).not.toBeInTheDocument()
    })
  })
})
