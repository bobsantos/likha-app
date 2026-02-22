/**
 * Tests for Dashboard Page
 */

import { render, screen, waitFor } from '@testing-library/react'
import DashboardPage from '@/app/(app)/dashboard/page'
import { getContracts } from '@/lib/api'
import type { Contract } from '@/types'

// Mock API
jest.mock('@/lib/api', () => ({
  getContracts: jest.fn(),
}))

// Mock components
jest.mock('@/components/DashboardSummary', () => {
  return function MockDashboardSummary({ totalContracts, ytdRoyalties }: any) {
    return (
      <div data-testid="dashboard-summary">
        Contracts: {totalContracts}, YTD: ${ytdRoyalties}
      </div>
    )
  }
})

jest.mock('@/components/ContractCard', () => {
  return function MockContractCard({ contract }: any) {
    return <div data-testid="contract-card">{contract.licensee_name}</div>
  }
})

jest.mock('@/components/EmptyState', () => {
  return function MockEmptyState({ title }: any) {
    return <div data-testid="empty-state">{title}</div>
  }
})

describe('Dashboard Page', () => {
  const mockGetContracts = getContracts as jest.MockedFunction<typeof getContracts>

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('shows loading skeleton initially', () => {
    mockGetContracts.mockImplementation(() => new Promise(() => {}))
    render(<DashboardPage />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('displays contracts when loaded', async () => {
    const mockContracts: Contract[] = [
      {
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
      },
      {
        id: 'contract-2',
        user_id: 'user-1',
        status: 'active',
        filename: 'beta-contract.pdf',
        licensee_name: 'Beta Inc',
        licensor_name: 'Jane Smith',
        contract_start: '2024-02-01',
        contract_end: '2025-12-31',
        royalty_rate: 0.12,
        royalty_base: 'net_sales',
        territories: ['US', 'Canada'],
        product_categories: null,
        minimum_guarantee: null,
        mg_period: null,
        advance_payment: null,
        reporting_frequency: 'quarterly',
        pdf_url: null,
        created_at: '2024-02-01T00:00:00Z',
        updated_at: '2024-02-01T00:00:00Z',
      },
    ]

    mockGetContracts.mockResolvedValue(mockContracts)

    render(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-summary')).toBeInTheDocument()
      expect(screen.getByText('Acme Corp')).toBeInTheDocument()
      expect(screen.getByText('Beta Inc')).toBeInTheDocument()
    })
  })

  it('displays empty state when no contracts', async () => {
    mockGetContracts.mockResolvedValue([])

    render(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument()
      expect(screen.getByText('No contracts yet')).toBeInTheDocument()
    })
  })

  it('displays error message on fetch failure', async () => {
    mockGetContracts.mockRejectedValue(new Error('Failed to fetch'))

    render(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByText(/failed to load contracts/i)).toBeInTheDocument()
    })
  })

  it('calculates YTD royalties correctly', async () => {
    const mockContracts: Contract[] = [
      {
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
      },
    ]

    mockGetContracts.mockResolvedValue(mockContracts)

    render(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByText(/Contracts: 1, YTD: \$0/)).toBeInTheDocument()
    })
  })
})
