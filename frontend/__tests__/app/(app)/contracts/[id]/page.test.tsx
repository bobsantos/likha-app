/**
 * Tests for Contract Detail Page
 */

import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { useParams } from 'next/navigation'
import ContractDetailPage from '@/app/(app)/contracts/[id]/page'
import { getContract, getSalesPeriods } from '@/lib/api'
import type { Contract, SalesPeriod } from '@/types'

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useParams: jest.fn(),
}))

// Mock API
jest.mock('@/lib/api', () => ({
  getContract: jest.fn(),
  getSalesPeriods: jest.fn(),
  createSalesPeriod: jest.fn(),
}))

// Mock SalesPeriodModal
jest.mock('@/components/SalesPeriodModal', () => {
  return function MockSalesPeriodModal({ isOpen, onClose, onSaved }: any) {
    if (!isOpen) return null
    return (
      <div data-testid="sales-modal">
        <button onClick={onClose}>Close Modal</button>
        <button onClick={onSaved}>Save Period</button>
      </div>
    )
  }
})

describe('Contract Detail Page', () => {
  const mockGetContract = getContract as jest.MockedFunction<typeof getContract>
  const mockGetSalesPeriods = getSalesPeriods as jest.MockedFunction<typeof getSalesPeriods>

  const mockContract: Contract = {
    id: 'contract-1',
    user_id: 'user-1',
    licensee_name: 'Acme Corp',
    licensor_name: 'John Doe',
    contract_start: '2024-01-01',
    contract_end: '2025-12-31',
    royalty_rate: 0.15,
    royalty_base: 'net_sales',
    territories: ['US', 'Canada'],
    product_categories: ['Books', 'Merchandise'],
    minimum_guarantee: 5000,
    mg_period: 'quarterly',
    advance_payment: 10000,
    reporting_frequency: 'quarterly',
    pdf_url: 'https://example.com/contract.pdf',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  }

  const mockSalesPeriods: SalesPeriod[] = [
    {
      id: 'sp-1',
      contract_id: 'contract-1',
      period_start: '2024-01-01',
      period_end: '2024-03-31',
      net_sales: 100000,
      category_sales: null,
      calculated_royalty: 15000,
      minimum_applied: false,
      created_at: '2024-04-01T00:00:00Z',
    },
  ]

  beforeEach(() => {
    jest.clearAllMocks()
    ;(useParams as jest.Mock).mockReturnValue({ id: 'contract-1' })
  })

  it('shows loading skeleton initially', () => {
    mockGetContract.mockImplementation(() => new Promise(() => {}))
    mockGetSalesPeriods.mockImplementation(() => new Promise(() => {}))

    render(<ContractDetailPage />)
    // Loading skeletons render (no specific text to check, just no crash)
    expect(document.querySelector('.skeleton')).toBeInTheDocument()
  })

  it('displays contract details when loaded', async () => {
    mockGetContract.mockResolvedValue(mockContract)
    mockGetSalesPeriods.mockResolvedValue(mockSalesPeriods)

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByText('Acme Corp').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('15%')).toBeInTheDocument()
    })
  })

  it('shows breadcrumb navigation', async () => {
    mockGetContract.mockResolvedValue(mockContract)
    mockGetSalesPeriods.mockResolvedValue([])

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument()
      // Breadcrumb shows contract name
      const breadcrumbItems = screen.getAllByText('Acme Corp')
      expect(breadcrumbItems.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('displays contract terms', async () => {
    mockGetContract.mockResolvedValue(mockContract)
    mockGetSalesPeriods.mockResolvedValue([])

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getByText('Contract Terms')).toBeInTheDocument()
      expect(screen.getByText('John Doe')).toBeInTheDocument()
      expect(screen.getByText('US, Canada')).toBeInTheDocument()
      expect(screen.getByText('Books, Merchandise')).toBeInTheDocument()
    })
  })

  it('displays sales periods table', async () => {
    mockGetContract.mockResolvedValue(mockContract)
    mockGetSalesPeriods.mockResolvedValue(mockSalesPeriods)

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByText('Sales Periods').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('$100,000.00')).toBeInTheDocument()
    })
  })

  it('shows empty state for sales periods', async () => {
    mockGetContract.mockResolvedValue(mockContract)
    mockGetSalesPeriods.mockResolvedValue([])

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getByText(/no sales periods yet/i)).toBeInTheDocument()
    })
  })

  it('shows View PDF button when pdf_url exists', async () => {
    mockGetContract.mockResolvedValue(mockContract)
    mockGetSalesPeriods.mockResolvedValue([])

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getByText('View PDF')).toBeInTheDocument()
    })
  })

  it('hides View PDF button when no pdf_url', async () => {
    mockGetContract.mockResolvedValue({ ...mockContract, pdf_url: null })
    mockGetSalesPeriods.mockResolvedValue([])

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByText('Acme Corp').length).toBeGreaterThanOrEqual(1)
    })

    expect(screen.queryByText('View PDF')).not.toBeInTheDocument()
  })

  it('opens sales period modal on button click', async () => {
    mockGetContract.mockResolvedValue(mockContract)
    mockGetSalesPeriods.mockResolvedValue([])

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByText('Acme Corp').length).toBeGreaterThanOrEqual(1)
    })

    // Click "Enter Sales Period" button
    const enterButton = screen.getAllByText('Enter Sales Period')[0]
    fireEvent.click(enterButton)

    await waitFor(() => {
      expect(screen.getByTestId('sales-modal')).toBeInTheDocument()
    })
  })

  it('displays error on fetch failure', async () => {
    mockGetContract.mockRejectedValue(new Error('Failed to fetch contract'))
    mockGetSalesPeriods.mockRejectedValue(new Error('Failed'))

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getByText(/failed to fetch contract/i)).toBeInTheDocument()
    })
  })

  it('shows total royalties summary', async () => {
    mockGetContract.mockResolvedValue(mockContract)
    mockGetSalesPeriods.mockResolvedValue(mockSalesPeriods)

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getByText('Total Royalties (YTD)')).toBeInTheDocument()
    })
  })
})
