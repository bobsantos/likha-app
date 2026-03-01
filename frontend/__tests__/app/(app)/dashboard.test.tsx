/**
 * Tests for Dashboard Page
 */

import { render, screen, waitFor } from '@testing-library/react'
import { useRouter } from 'next/navigation'
import DashboardPage from '@/app/(app)/dashboard/page'
import { getContracts, getDashboardSummary, ApiError } from '@/lib/api'
import type { Contract } from '@/types'

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}))

// Mock API
jest.mock('@/lib/api', () => ({
  getContracts: jest.fn(),
  getDashboardSummary: jest.fn(),
  ApiError: class ApiError extends Error {
    status: number
    data?: unknown
    constructor(message: string, status: number, data?: unknown) {
      super(message)
      this.name = 'ApiError'
      this.status = status
      this.data = data
    }
  },
  isUnauthorizedError: (err: unknown) =>
    err instanceof Error &&
    err.name === 'ApiError' &&
    (err as { status: number }).status === 401,
}))

// Mock components
jest.mock('@/components/DashboardSummary', () => {
  return function MockDashboardSummary({
    totalContracts,
    ytdRoyalties,
    currentYear,
  }: {
    totalContracts: number
    ytdRoyalties: number
    currentYear: number
  }) {
    return (
      <div data-testid="dashboard-summary">
        Contracts: {totalContracts}, YTD: ${ytdRoyalties}, Year: {currentYear}
      </div>
    )
  }
})

jest.mock('@/components/ContractCard', () => {
  return function MockContractCard({ contract }: { contract: Contract }) {
    return <div data-testid="contract-card">{contract.licensee_name}</div>
  }
})

jest.mock('@/components/EmptyState', () => {
  return function MockEmptyState({ title }: { title: string }) {
    return <div data-testid="empty-state">{title}</div>
  }
})

describe('Dashboard Page', () => {
  const mockPush = jest.fn()
  const mockGetContracts = getContracts as jest.MockedFunction<typeof getContracts>
  const mockGetDashboardSummary = getDashboardSummary as jest.MockedFunction<typeof getDashboardSummary>

  const currentYear = new Date().getFullYear()

  const makeContract = (id: string, name: string): Contract => ({
    id,
    user_id: 'user-1',
    status: 'active',
    filename: `${name.toLowerCase().replace(' ', '-')}-contract.pdf`,
    licensee_name: name,
    contract_start_date: `${currentYear}-01-01`,
    contract_end_date: `${currentYear}-12-31`,
    royalty_rate: 0.15,
    royalty_base: 'net_sales',
    territories: ['US'],
    product_categories: null,
    minimum_guarantee: null,
    minimum_guarantee_period: null,
    advance_payment: null,
    reporting_frequency: 'quarterly',
    pdf_url: null,
    extracted_terms: null,
    storage_path: null,
    created_at: `${currentYear}-01-01T00:00:00Z`,
    updated_at: `${currentYear}-01-01T00:00:00Z`,
  })

  beforeEach(() => {
    jest.clearAllMocks()
    ;(useRouter as jest.Mock).mockReturnValue({ push: mockPush })
  })

  it('shows loading skeleton initially', () => {
    mockGetContracts.mockImplementation(() => new Promise(() => {}))
    mockGetDashboardSummary.mockImplementation(() => new Promise(() => {}))
    render(<DashboardPage />)
    // DashboardSkeleton uses aria-busy and aria-label instead of "Loading..." text
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByLabelText(/loading dashboard/i)).toBeInTheDocument()
  })

  it('displays contracts when loaded', async () => {
    const mockContracts = [makeContract('contract-1', 'Acme Corp'), makeContract('contract-2', 'Beta Inc')]
    mockGetContracts.mockResolvedValue(mockContracts)
    mockGetDashboardSummary.mockResolvedValue({ ytd_royalties: 0, current_year: currentYear })

    render(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-summary')).toBeInTheDocument()
      expect(screen.getByText('Acme Corp')).toBeInTheDocument()
      expect(screen.getByText('Beta Inc')).toBeInTheDocument()
    })
  })

  it('displays empty state when no contracts', async () => {
    mockGetContracts.mockResolvedValue([])
    mockGetDashboardSummary.mockResolvedValue({ ytd_royalties: 0, current_year: currentYear })

    render(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument()
      expect(screen.getByText('No contracts yet')).toBeInTheDocument()
    })
  })

  it('displays error message on non-auth fetch failure', async () => {
    mockGetContracts.mockRejectedValue(new Error('Failed to fetch'))
    mockGetDashboardSummary.mockResolvedValue({ ytd_royalties: 0, current_year: currentYear })

    render(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByText(/failed to load contracts/i)).toBeInTheDocument()
    })
  })

  it('redirects to /login when getContracts returns a 401', async () => {
    const { ApiError: MockApiError } = jest.requireMock('@/lib/api')
    mockGetContracts.mockRejectedValue(new MockApiError('Unauthorized', 401))
    mockGetDashboardSummary.mockResolvedValue({ ytd_royalties: 0, current_year: currentYear })

    render(<DashboardPage />)

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/login')
    })
  })

  it('does not show error panel when getContracts returns a 401 (redirects instead)', async () => {
    const { ApiError: MockApiError } = jest.requireMock('@/lib/api')
    mockGetContracts.mockRejectedValue(new MockApiError('Unauthorized', 401))
    mockGetDashboardSummary.mockResolvedValue({ ytd_royalties: 0, current_year: currentYear })

    render(<DashboardPage />)

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/login')
    })

    expect(screen.queryByText(/failed to load contracts/i)).not.toBeInTheDocument()
  })

  it('passes ytd_royalties from getDashboardSummary to DashboardSummary component', async () => {
    const mockContracts = [makeContract('c1', 'Acme Corp'), makeContract('c2', 'Beta Inc')]
    mockGetContracts.mockResolvedValue(mockContracts)
    mockGetDashboardSummary.mockResolvedValue({ ytd_royalties: 7000, current_year: currentYear })

    render(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByText(`Contracts: 2, YTD: $7000, Year: ${currentYear}`)).toBeInTheDocument()
    })
  })

  it('passes current_year from getDashboardSummary to DashboardSummary component', async () => {
    const mockContracts = [makeContract('c1', 'Acme Corp')]
    mockGetContracts.mockResolvedValue(mockContracts)
    mockGetDashboardSummary.mockResolvedValue({ ytd_royalties: 5000, current_year: 2026 })

    render(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByText('Contracts: 1, YTD: $5000, Year: 2026')).toBeInTheDocument()
    })
  })

  it('defaults to $0 ytdRoyalties when getDashboardSummary fails', async () => {
    const mockContracts = [makeContract('c1', 'Acme Corp')]
    mockGetContracts.mockResolvedValue(mockContracts)
    mockGetDashboardSummary.mockRejectedValue(new Error('Network error'))

    render(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-summary')).toBeInTheDocument()
      // YTD should be 0 due to fallback
      expect(screen.getByText(/YTD: \$0/)).toBeInTheDocument()
    })
  })

  it('still shows contracts when getDashboardSummary fails', async () => {
    const mockContracts = [makeContract('c1', 'Acme Corp')]
    mockGetContracts.mockResolvedValue(mockContracts)
    mockGetDashboardSummary.mockRejectedValue(new Error('Network error'))

    render(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument()
    })
  })

  it('passes 0 as ytdRoyalties when there are no YTD periods', async () => {
    const mockContracts = [makeContract('c1', 'Acme Corp')]
    mockGetContracts.mockResolvedValue(mockContracts)
    mockGetDashboardSummary.mockResolvedValue({ ytd_royalties: 0, current_year: currentYear })

    render(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByText(/YTD: \$0/)).toBeInTheDocument()
    })
  })

  it('calls getDashboardSummary once (not once per contract)', async () => {
    const mockContracts = [makeContract('c1', 'Acme'), makeContract('c2', 'Beta'), makeContract('c3', 'Gamma')]
    mockGetContracts.mockResolvedValue(mockContracts)
    mockGetDashboardSummary.mockResolvedValue({ ytd_royalties: 0, current_year: currentYear })

    render(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-summary')).toBeInTheDocument()
    })

    expect(mockGetDashboardSummary).toHaveBeenCalledTimes(1)
  })
})
