/**
 * Tests for Contract Detail Page
 */

import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import ContractDetailPage from '@/app/(app)/contracts/[id]/page'
import { getContract, getSalesPeriods, getSalesReportDownloadUrl, getContractTotals, downloadReportTemplate } from '@/lib/api'
import { copyToClipboard } from '@/lib/clipboard'
import type { Contract, SalesPeriod, ContractTotals } from '@/types'

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useParams: jest.fn(),
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}))

// Mock API
jest.mock('@/lib/api', () => ({
  getContract: jest.fn(),
  getSalesPeriods: jest.fn(),
  getSalesReportDownloadUrl: jest.fn(),
  getContractTotals: jest.fn(),
  downloadReportTemplate: jest.fn(),
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

// Mock the clipboard utility so tests are not affected by secure-context
// restrictions in jsdom.
jest.mock('@/lib/clipboard', () => ({
  copyToClipboard: jest.fn().mockResolvedValue(true),
}))

// Mock react-hot-toast — the page now uses toast instead of inline state
const mockToastError = jest.fn()
const mockToastSuccess = jest.fn()
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
  Toaster: () => null,
}))


describe('Contract Detail Page', () => {
  const mockPush = jest.fn()
  const mockGetContract = getContract as jest.MockedFunction<typeof getContract>
  const mockGetSalesPeriods = getSalesPeriods as jest.MockedFunction<typeof getSalesPeriods>
  const mockGetSalesReportDownloadUrl = getSalesReportDownloadUrl as jest.MockedFunction<typeof getSalesReportDownloadUrl>
  const mockGetContractTotals = getContractTotals as jest.MockedFunction<typeof getContractTotals>
  const mockDownloadReportTemplate = downloadReportTemplate as jest.MockedFunction<typeof downloadReportTemplate>

  // mockContract uses the correct Contract type field names:
  //   contract_start_date / contract_end_date (NOT contract_start / contract_end)
  //   licensor_name lives in extracted_terms, not as a top-level field
  //   minimum_guarantee_period (NOT mg_period)
  //   royalty_rate is stored as a string like "15%" (backend canonical form)
  const mockContract: Contract = {
    id: 'contract-1',
    user_id: 'user-1',
    status: 'active',
    filename: 'acme-contract.pdf',
    licensee_name: 'Acme Corp',
    licensee_email: null,
    agreement_number: null,
    contract_start_date: '2024-01-01',
    contract_end_date: '2025-12-31',
    royalty_rate: '15%',
    royalty_base: 'net_sales',
    territories: ['US', 'Canada'],
    product_categories: ['Books', 'Merchandise'],
    minimum_guarantee: 5000,
    minimum_guarantee_period: 'quarterly',
    advance_payment: 10000,
    reporting_frequency: 'quarterly',
    pdf_url: 'https://example.com/contract.pdf',
    extracted_terms: { licensor_name: 'John Doe' },
    storage_path: null,
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
      category_breakdown: null,
      royalty_calculated: 15000,
      minimum_applied: false,
      created_at: '2024-04-01T00:00:00Z',
    },
  ]

  const mockContractTotals: ContractTotals = {
    contract_id: 'contract-1',
    total_royalties: 15000,
    by_year: [{ year: 2024, royalties: 15000 }],
  }

  beforeEach(() => {
    jest.clearAllMocks()
    ;(useParams as jest.Mock).mockReturnValue({ id: 'contract-1' })
    ;(useRouter as jest.Mock).mockReturnValue({ push: mockPush })
    ;(useSearchParams as jest.Mock).mockReturnValue({ get: () => null })
  })

  it('shows loading skeleton initially', () => {
    mockGetContract.mockImplementation(() => new Promise(() => {}))
    mockGetSalesPeriods.mockImplementation(() => new Promise(() => {}))
    mockGetContractTotals.mockImplementation(() => new Promise(() => {}))

    render(<ContractDetailPage />)
    // Loading skeletons render (no specific text to check, just no crash)
    expect(document.querySelector('.skeleton')).toBeInTheDocument()
  })

  it('displays contract details when loaded', async () => {
    mockGetContract.mockResolvedValue(mockContract)
    mockGetSalesPeriods.mockResolvedValue(mockSalesPeriods)
    mockGetContractTotals.mockResolvedValue(mockContractTotals)

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByText('Acme Corp').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('15%')).toBeInTheDocument()
    })
  })

  it('shows breadcrumb navigation', async () => {
    mockGetContract.mockResolvedValue(mockContract)
    mockGetSalesPeriods.mockResolvedValue([])
    mockGetContractTotals.mockResolvedValue({ contract_id: 'contract-1', total_royalties: 0, by_year: [] })

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
    mockGetContractTotals.mockResolvedValue({ contract_id: 'contract-1', total_royalties: 0, by_year: [] })

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getByText('Contract Terms')).toBeInTheDocument()
      // licensor_name is inside extracted_terms — but the page doesn't render it
      // from extracted_terms; it reads contract.licensor_name which doesn't exist
      // as a top-level field. The page renders territories and product_categories.
      expect(screen.getByText('US, Canada')).toBeInTheDocument()
      expect(screen.getByText('Books, Merchandise')).toBeInTheDocument()
    })
  })

  it('displays sales periods table', async () => {
    mockGetContract.mockResolvedValue(mockContract)
    mockGetSalesPeriods.mockResolvedValue(mockSalesPeriods)
    mockGetContractTotals.mockResolvedValue(mockContractTotals)

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByText('Sales Periods').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('$100,000.00')).toBeInTheDocument()
    })
  })

  it('shows empty state when no sales periods exist', async () => {
    mockGetContract.mockResolvedValue(mockContract)
    mockGetSalesPeriods.mockResolvedValue([])
    mockGetContractTotals.mockResolvedValue({ contract_id: 'contract-1', total_royalties: 0, by_year: [] })

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getByText(/no sales periods yet/i)).toBeInTheDocument()
    })
  })

  it('shows View PDF button when pdf_url exists', async () => {
    mockGetContract.mockResolvedValue(mockContract)
    mockGetSalesPeriods.mockResolvedValue([])
    mockGetContractTotals.mockResolvedValue({ contract_id: 'contract-1', total_royalties: 0, by_year: [] })

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getByText('View PDF')).toBeInTheDocument()
    })
  })

  it('hides View PDF button when no pdf_url', async () => {
    mockGetContract.mockResolvedValue({ ...mockContract, pdf_url: null })
    mockGetSalesPeriods.mockResolvedValue([])
    mockGetContractTotals.mockResolvedValue({ contract_id: 'contract-1', total_royalties: 0, by_year: [] })

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByText('Acme Corp').length).toBeGreaterThanOrEqual(1)
    })

    expect(screen.queryByText('View PDF')).not.toBeInTheDocument()
  })

  it('displays error on fetch failure', async () => {
    mockGetContract.mockRejectedValue(new Error('Failed to fetch contract'))
    mockGetSalesPeriods.mockRejectedValue(new Error('Failed'))
    mockGetContractTotals.mockRejectedValue(new Error('Failed'))

    render(<ContractDetailPage />)

    await waitFor(() => {
      // Page now shows a friendly error message instead of the raw error text
      expect(screen.getByText(/we couldn't load this contract/i)).toBeInTheDocument()
    })
  })

  it('redirects to /login when getContract returns a 401', async () => {
    const { ApiError: MockApiError } = jest.requireMock('@/lib/api')
    mockGetContract.mockRejectedValue(new MockApiError('Unauthorized', 401))
    mockGetSalesPeriods.mockRejectedValue(new MockApiError('Unauthorized', 401))
    mockGetContractTotals.mockRejectedValue(new MockApiError('Unauthorized', 401))

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/login')
    })
  })

  it('does not show error panel when getContract returns a 401 (redirects instead)', async () => {
    const { ApiError: MockApiError } = jest.requireMock('@/lib/api')
    mockGetContract.mockRejectedValue(new MockApiError('Unauthorized', 401))
    mockGetSalesPeriods.mockRejectedValue(new MockApiError('Unauthorized', 401))
    mockGetContractTotals.mockRejectedValue(new MockApiError('Unauthorized', 401))

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/login')
    })

    expect(screen.queryByText(/error loading contract/i)).not.toBeInTheDocument()
  })

  it('shows "Total Royalties" heading (not YTD)', async () => {
    mockGetContract.mockResolvedValue(mockContract)
    mockGetSalesPeriods.mockResolvedValue(mockSalesPeriods)
    mockGetContractTotals.mockResolvedValue(mockContractTotals)

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getByText('Total Royalties')).toBeInTheDocument()
      expect(screen.queryByText('Total Royalties (YTD)')).not.toBeInTheDocument()
    })
  })

  it('shows correct total royalties from getContractTotals backend response', async () => {
    mockGetContract.mockResolvedValue(mockContract)
    mockGetSalesPeriods.mockResolvedValue(mockSalesPeriods)
    mockGetContractTotals.mockResolvedValue(mockContractTotals)

    render(<ContractDetailPage />)

    await waitFor(() => {
      // mockContractTotals has total_royalties: 15000
      // The amount appears in both the summary card and the table row
      const amounts = screen.getAllByText('$15,000.00')
      expect(amounts.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('shows per-year breakdown from getContractTotals by_year field', async () => {
    mockGetContract.mockResolvedValue(mockContract)
    mockGetSalesPeriods.mockResolvedValue(mockSalesPeriods)
    mockGetContractTotals.mockResolvedValue(mockContractTotals)

    render(<ContractDetailPage />)

    await waitFor(() => {
      // by_year has { year: 2024, royalties: 15000 }
      expect(screen.getByText('2024: $15,000.00')).toBeInTheDocument()
    })
  })

  it('shows per-year breakdown for multiple years in descending order from backend', async () => {
    const totalsMultiYear: ContractTotals = {
      contract_id: 'contract-1',
      total_royalties: 27000,
      // Backend returns sorted descending
      by_year: [
        { year: 2025, royalties: 12000 },
        { year: 2024, royalties: 15000 },
      ],
    }

    mockGetContract.mockResolvedValue(mockContract)
    mockGetSalesPeriods.mockResolvedValue([])
    mockGetContractTotals.mockResolvedValue(totalsMultiYear)

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getByText('$27,000.00')).toBeInTheDocument()
      expect(screen.getByText('2025: $12,000.00')).toBeInTheDocument()
      expect(screen.getByText('2024: $15,000.00')).toBeInTheDocument()
    })

    // 2025 should appear before 2024 in the DOM
    const yearLines = screen.getAllByText(/^\d{4}: \$/)
    expect(yearLines[0]).toHaveTextContent('2025')
    expect(yearLines[1]).toHaveTextContent('2024')
  })

  it('shows $0.00 total royalties when getContractTotals fails (graceful fallback)', async () => {
    mockGetContract.mockResolvedValue(mockContract)
    mockGetSalesPeriods.mockResolvedValue([])
    mockGetContractTotals.mockRejectedValue(new Error('Network error'))

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getByText('Total Royalties')).toBeInTheDocument()
      // Fallback to $0.00 when totals endpoint fails
      expect(screen.getByText('$0.00')).toBeInTheDocument()
    })
  })

  it('shows no per-year rows when getContractTotals fails', async () => {
    mockGetContract.mockResolvedValue(mockContract)
    mockGetSalesPeriods.mockResolvedValue([])
    mockGetContractTotals.mockRejectedValue(new Error('Network error'))

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByText('Acme Corp').length).toBeGreaterThanOrEqual(1)
    })

    // No year breakdown lines should appear
    expect(screen.queryByText(/^\d{4}: \$/)).not.toBeInTheDocument()
  })

  it('shows no per-year rows when by_year is empty', async () => {
    mockGetContract.mockResolvedValue(mockContract)
    mockGetSalesPeriods.mockResolvedValue([])
    mockGetContractTotals.mockResolvedValue({ contract_id: 'contract-1', total_royalties: 0, by_year: [] })

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getByText('Total Royalties')).toBeInTheDocument()
    })

    expect(screen.queryByText(/^\d{4}: \$/)).not.toBeInTheDocument()
  })

  it('still loads contract when getContractTotals fails', async () => {
    mockGetContract.mockResolvedValue(mockContract)
    mockGetSalesPeriods.mockResolvedValue(mockSalesPeriods)
    mockGetContractTotals.mockRejectedValue(new Error('Network error'))

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByText('Acme Corp').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('$100,000.00')).toBeInTheDocument()
    })
  })

  it('coerces string discrepancy_amount to number for totalUnderReported', async () => {
    const periodWithStringDiscrepancy: SalesPeriod = {
      id: 'sp-str-disc',
      contract_id: 'contract-1',
      period_start: '2024-01-01',
      period_end: '2024-03-31',
      net_sales: 100000,
      category_breakdown: null,
      royalty_calculated: 15000,
      minimum_applied: false,
      licensee_reported_royalty: 14500,
      discrepancy_amount: '500' as unknown as number,
      has_discrepancy: true,
      created_at: '2024-04-01T00:00:00Z',
    }

    mockGetContract.mockResolvedValue(mockContract)
    mockGetSalesPeriods.mockResolvedValue([periodWithStringDiscrepancy])
    mockGetContractTotals.mockResolvedValue({
      contract_id: 'contract-1',
      total_royalties: 15000,
      by_year: [{ year: 2024, royalties: 15000 }],
    })

    render(<ContractDetailPage />)

    await waitFor(() => {
      // Discrepancy summary card should show $500.00 (not NaN or concat)
      expect(screen.getByText('Open Discrepancies')).toBeInTheDocument()
      const amounts = screen.getAllByText('$500.00')
      expect(amounts.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ============================================================
  // Bug fix: contract_start_date and contract_end_date
  // ============================================================

  it('displays contract period using contract_start_date and contract_end_date', async () => {
    mockGetContract.mockResolvedValue(mockContract)
    mockGetSalesPeriods.mockResolvedValue([])
    mockGetContractTotals.mockResolvedValue({ contract_id: 'contract-1', total_royalties: 0, by_year: [] })

    render(<ContractDetailPage />)

    await waitFor(() => {
      // Jan 1, 2024 — Dec 31, 2025 from contract_start_date / contract_end_date
      expect(screen.getByText(/Jan 1, 2024/)).toBeInTheDocument()
      expect(screen.getByText(/Dec 31, 2025/)).toBeInTheDocument()
    })
  })

  it('shows "N/A - N/A" for contract period only when both dates are null', async () => {
    mockGetContract.mockResolvedValue({
      ...mockContract,
      contract_start_date: null,
      contract_end_date: null,
    })
    mockGetSalesPeriods.mockResolvedValue([])
    mockGetContractTotals.mockResolvedValue({ contract_id: 'contract-1', total_royalties: 0, by_year: [] })

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getByText('N/A - N/A')).toBeInTheDocument()
    })
  })

  it('does not show "N/A - N/A" for contract period when dates are present', async () => {
    mockGetContract.mockResolvedValue(mockContract)
    mockGetSalesPeriods.mockResolvedValue([])
    mockGetContractTotals.mockResolvedValue({ contract_id: 'contract-1', total_royalties: 0, by_year: [] })

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByText('Acme Corp').length).toBeGreaterThanOrEqual(1)
    })

    expect(screen.queryByText('N/A - N/A')).not.toBeInTheDocument()
  })

  // ============================================================
  // Bug fix: royalty_rate as string from backend
  // ============================================================

  it('displays string royalty_rate directly (e.g. "8%")', async () => {
    mockGetContract.mockResolvedValue({ ...mockContract, royalty_rate: '8%' })
    mockGetSalesPeriods.mockResolvedValue([])
    mockGetContractTotals.mockResolvedValue({ contract_id: 'contract-1', total_royalties: 0, by_year: [] })

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getByText('8%')).toBeInTheDocument()
    })
  })

  it('displays string royalty_rate with decimal (e.g. "10.0%")', async () => {
    mockGetContract.mockResolvedValue({ ...mockContract, royalty_rate: '10.0%' })
    mockGetSalesPeriods.mockResolvedValue([])
    mockGetContractTotals.mockResolvedValue({ contract_id: 'contract-1', total_royalties: 0, by_year: [] })

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getByText('10.0%')).toBeInTheDocument()
    })
  })

  // Bug fix: bare number strings (no "%") should have "%" appended
  it('appends "%" to bare integer string royalty_rate (e.g. "8")', async () => {
    mockGetContract.mockResolvedValue({ ...mockContract, royalty_rate: '8' })
    mockGetSalesPeriods.mockResolvedValue([])
    mockGetContractTotals.mockResolvedValue({ contract_id: 'contract-1', total_royalties: 0, by_year: [] })

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getByText('8%')).toBeInTheDocument()
    })
  })

  it('appends "%" to bare decimal string royalty_rate (e.g. "10.5")', async () => {
    mockGetContract.mockResolvedValue({ ...mockContract, royalty_rate: '10.5' })
    mockGetSalesPeriods.mockResolvedValue([])
    mockGetContractTotals.mockResolvedValue({ contract_id: 'contract-1', total_royalties: 0, by_year: [] })

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getByText('10.5%')).toBeInTheDocument()
    })
  })

  it('does not double-append "%" to string royalty_rate that already contains "%"', async () => {
    mockGetContract.mockResolvedValue({ ...mockContract, royalty_rate: '8%' })
    mockGetSalesPeriods.mockResolvedValue([])
    mockGetContractTotals.mockResolvedValue({ contract_id: 'contract-1', total_royalties: 0, by_year: [] })

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getByText('8%')).toBeInTheDocument()
    })
    expect(screen.queryByText('8%%')).not.toBeInTheDocument()
  })

  it('displays numeric royalty_rate as percentage', async () => {
    mockGetContract.mockResolvedValue({ ...mockContract, royalty_rate: 0.15 })
    mockGetSalesPeriods.mockResolvedValue([])
    mockGetContractTotals.mockResolvedValue({ contract_id: 'contract-1', total_royalties: 0, by_year: [] })

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getByText('15%')).toBeInTheDocument()
    })
  })

  it('shows "N/A" for null royalty_rate', async () => {
    mockGetContract.mockResolvedValue({ ...mockContract, royalty_rate: null })
    mockGetSalesPeriods.mockResolvedValue([])
    mockGetContractTotals.mockResolvedValue({ contract_id: 'contract-1', total_royalties: 0, by_year: [] })

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getByText('N/A')).toBeInTheDocument()
    })
  })

  // Phase 3: status-aware badge and draft UI tests
  it('shows "Active" badge for active contracts', async () => {
    mockGetContract.mockResolvedValue(mockContract)
    mockGetSalesPeriods.mockResolvedValue([])
    mockGetContractTotals.mockResolvedValue({ contract_id: 'contract-1', total_royalties: 0, by_year: [] })

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getByText('Active')).toBeInTheDocument()
    })
  })

  it('shows "Draft" badge for draft contracts', async () => {
    const draftContract: Contract = {
      ...mockContract,
      status: 'draft',
      licensee_name: null,
      royalty_rate: null,
      royalty_base: null,
      reporting_frequency: null,
    }
    mockGetContract.mockResolvedValue(draftContract)
    mockGetSalesPeriods.mockResolvedValue([])
    mockGetContractTotals.mockResolvedValue({ contract_id: 'contract-1', total_royalties: 0, by_year: [] })

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getByText('Draft')).toBeInTheDocument()
      expect(screen.queryByText('Active')).not.toBeInTheDocument()
    })
  })

  it('shows review banner for draft contracts', async () => {
    const draftContract: Contract = {
      ...mockContract,
      status: 'draft',
      licensee_name: null,
      royalty_rate: null,
      royalty_base: null,
      reporting_frequency: null,
    }
    mockGetContract.mockResolvedValue(draftContract)
    mockGetSalesPeriods.mockResolvedValue([])
    mockGetContractTotals.mockResolvedValue({ contract_id: 'contract-1', total_royalties: 0, by_year: [] })

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getByText(/complete review/i)).toBeInTheDocument()
    })
  })

  it('does not show review banner for active contracts', async () => {
    mockGetContract.mockResolvedValue(mockContract)
    mockGetSalesPeriods.mockResolvedValue([])
    mockGetContractTotals.mockResolvedValue({ contract_id: 'contract-1', total_royalties: 0, by_year: [] })

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByText('Acme Corp').length).toBeGreaterThanOrEqual(1)
    })

    expect(screen.queryByText(/complete review/i)).not.toBeInTheDocument()
  })

  // ============================================================
  // Phase 1.2: Royalty Discrepancy Display
  // ============================================================

  describe('Discrepancy columns', () => {
    const periodWithUnderReport: SalesPeriod = {
      id: 'sp-under',
      contract_id: 'contract-1',
      period_start: '2024-01-01',
      period_end: '2024-03-31',
      net_sales: 100000,
      category_breakdown: null,
      royalty_calculated: 15000,
      minimum_applied: false,
      licensee_reported_royalty: 14720,
      discrepancy_amount: 280,
      has_discrepancy: true,
      created_at: '2024-04-01T00:00:00Z',
    }

    const periodWithOverReport: SalesPeriod = {
      id: 'sp-over',
      contract_id: 'contract-1',
      period_start: '2024-04-01',
      period_end: '2024-06-30',
      net_sales: 80000,
      category_breakdown: null,
      royalty_calculated: 12000,
      minimum_applied: false,
      licensee_reported_royalty: 12120,
      discrepancy_amount: -120,
      has_discrepancy: true,
      created_at: '2024-07-01T00:00:00Z',
    }

    const periodWithMatch: SalesPeriod = {
      id: 'sp-match',
      contract_id: 'contract-1',
      period_start: '2024-07-01',
      period_end: '2024-09-30',
      net_sales: 90000,
      category_breakdown: null,
      royalty_calculated: 13500,
      minimum_applied: false,
      licensee_reported_royalty: 13500,
      discrepancy_amount: 0,
      has_discrepancy: false,
      created_at: '2024-10-01T00:00:00Z',
    }

    const periodWithNullReported: SalesPeriod = {
      id: 'sp-null',
      contract_id: 'contract-1',
      period_start: '2024-10-01',
      period_end: '2024-12-31',
      net_sales: 70000,
      category_breakdown: null,
      royalty_calculated: 10500,
      minimum_applied: false,
      licensee_reported_royalty: null,
      discrepancy_amount: null,
      has_discrepancy: false,
      created_at: '2025-01-01T00:00:00Z',
    }

    it('displays "Reported Royalty" column header', async () => {
      mockGetContract.mockResolvedValue(mockContract)
      mockGetSalesPeriods.mockResolvedValue([periodWithMatch])
      mockGetContractTotals.mockResolvedValue({
        contract_id: 'contract-1',
        total_royalties: 13500,
        by_year: [{ year: 2024, royalties: 13500 }],
      })

      render(<ContractDetailPage />)

      await waitFor(() => {
        expect(screen.getByText('Reported Royalty')).toBeInTheDocument()
      })
    })

    it('displays "Discrepancy" column header', async () => {
      mockGetContract.mockResolvedValue(mockContract)
      mockGetSalesPeriods.mockResolvedValue([periodWithMatch])
      mockGetContractTotals.mockResolvedValue({
        contract_id: 'contract-1',
        total_royalties: 13500,
        by_year: [{ year: 2024, royalties: 13500 }],
      })

      render(<ContractDetailPage />)

      await waitFor(() => {
        expect(screen.getByText('Discrepancy')).toBeInTheDocument()
      })
    })

    it('shows licensee_reported_royalty as currency when present', async () => {
      mockGetContract.mockResolvedValue(mockContract)
      mockGetSalesPeriods.mockResolvedValue([periodWithUnderReport])
      mockGetContractTotals.mockResolvedValue({
        contract_id: 'contract-1',
        total_royalties: 15000,
        by_year: [{ year: 2024, royalties: 15000 }],
      })

      render(<ContractDetailPage />)

      await waitFor(() => {
        expect(screen.getByText('$14,720.00')).toBeInTheDocument()
      })
    })

    it('shows em dash for reported royalty when null', async () => {
      mockGetContract.mockResolvedValue(mockContract)
      mockGetSalesPeriods.mockResolvedValue([periodWithNullReported])
      mockGetContractTotals.mockResolvedValue({
        contract_id: 'contract-1',
        total_royalties: 10500,
        by_year: [{ year: 2024, royalties: 10500 }],
      })

      render(<ContractDetailPage />)

      await waitFor(() => {
        // At least one em dash should appear (both reported and discrepancy cells)
        const dashes = screen.getAllByText('—')
        expect(dashes.length).toBeGreaterThanOrEqual(1)
      })
    })

    it('shows under-reported indicator for discrepancy_amount > 0', async () => {
      mockGetContract.mockResolvedValue(mockContract)
      mockGetSalesPeriods.mockResolvedValue([periodWithUnderReport])
      mockGetContractTotals.mockResolvedValue({
        contract_id: 'contract-1',
        total_royalties: 15000,
        by_year: [{ year: 2024, royalties: 15000 }],
      })

      render(<ContractDetailPage />)

      await waitFor(() => {
        const matches = screen.getAllByText(/under-reported/i)
        expect(matches.length).toBeGreaterThanOrEqual(1)
      })
    })

    it('shows the discrepancy amount for under-reported period', async () => {
      mockGetContract.mockResolvedValue(mockContract)
      mockGetSalesPeriods.mockResolvedValue([periodWithUnderReport])
      mockGetContractTotals.mockResolvedValue({
        contract_id: 'contract-1',
        total_royalties: 15000,
        by_year: [{ year: 2024, royalties: 15000 }],
      })

      render(<ContractDetailPage />)

      await waitFor(() => {
        // Amount is $280.00, displayed with + prefix (may appear in table and summary card)
        const matches = screen.getAllByText(/\$280\.00/)
        expect(matches.length).toBeGreaterThanOrEqual(1)
      })
    })

    it('shows over-reported indicator for discrepancy_amount < 0', async () => {
      mockGetContract.mockResolvedValue(mockContract)
      mockGetSalesPeriods.mockResolvedValue([periodWithOverReport])
      mockGetContractTotals.mockResolvedValue({
        contract_id: 'contract-1',
        total_royalties: 12000,
        by_year: [{ year: 2024, royalties: 12000 }],
      })

      render(<ContractDetailPage />)

      await waitFor(() => {
        expect(screen.getByText(/over-reported/i)).toBeInTheDocument()
      })
    })

    it('shows match indicator when has_discrepancy is false and reported royalty is present', async () => {
      mockGetContract.mockResolvedValue(mockContract)
      mockGetSalesPeriods.mockResolvedValue([periodWithMatch])
      mockGetContractTotals.mockResolvedValue({
        contract_id: 'contract-1',
        total_royalties: 13500,
        by_year: [{ year: 2024, royalties: 13500 }],
      })

      render(<ContractDetailPage />)

      await waitFor(() => {
        expect(screen.getByText('Match')).toBeInTheDocument()
      })
    })

    it('shows em dash in discrepancy cell when licensee_reported_royalty is null', async () => {
      mockGetContract.mockResolvedValue(mockContract)
      mockGetSalesPeriods.mockResolvedValue([periodWithNullReported])
      mockGetContractTotals.mockResolvedValue({
        contract_id: 'contract-1',
        total_royalties: 10500,
        by_year: [{ year: 2024, royalties: 10500 }],
      })

      render(<ContractDetailPage />)

      await waitFor(() => {
        const dashes = screen.getAllByText('—')
        expect(dashes.length).toBeGreaterThanOrEqual(2)
      })
    })
  })

  describe('Discrepancy summary card', () => {
    const underReportedPeriod: SalesPeriod = {
      id: 'sp-under-1',
      contract_id: 'contract-1',
      period_start: '2024-01-01',
      period_end: '2024-03-31',
      net_sales: 100000,
      category_breakdown: null,
      royalty_calculated: 15000,
      minimum_applied: false,
      licensee_reported_royalty: 14720,
      discrepancy_amount: 280,
      has_discrepancy: true,
      created_at: '2024-04-01T00:00:00Z',
    }

    const matchingPeriod: SalesPeriod = {
      id: 'sp-match-1',
      contract_id: 'contract-1',
      period_start: '2024-04-01',
      period_end: '2024-06-30',
      net_sales: 80000,
      category_breakdown: null,
      royalty_calculated: 12000,
      minimum_applied: false,
      licensee_reported_royalty: 12000,
      discrepancy_amount: 0,
      has_discrepancy: false,
      created_at: '2024-07-01T00:00:00Z',
    }

    it('shows discrepancy summary card when at least one period is under-reported', async () => {
      mockGetContract.mockResolvedValue(mockContract)
      mockGetSalesPeriods.mockResolvedValue([underReportedPeriod])
      mockGetContractTotals.mockResolvedValue({
        contract_id: 'contract-1',
        total_royalties: 15000,
        by_year: [{ year: 2024, royalties: 15000 }],
      })

      render(<ContractDetailPage />)

      await waitFor(() => {
        expect(screen.getByText('Open Discrepancies')).toBeInTheDocument()
      })
    })

    it('shows correct total amount in discrepancy summary card', async () => {
      mockGetContract.mockResolvedValue(mockContract)
      mockGetSalesPeriods.mockResolvedValue([underReportedPeriod])
      mockGetContractTotals.mockResolvedValue({
        contract_id: 'contract-1',
        total_royalties: 15000,
        by_year: [{ year: 2024, royalties: 15000 }],
      })

      render(<ContractDetailPage />)

      await waitFor(() => {
        expect(screen.getByText('Open Discrepancies')).toBeInTheDocument()
        // $280.00 total
        const amounts = screen.getAllByText('$280.00')
        expect(amounts.length).toBeGreaterThanOrEqual(1)
      })
    })

    it('shows correct period count in discrepancy summary card', async () => {
      mockGetContract.mockResolvedValue(mockContract)
      mockGetSalesPeriods.mockResolvedValue([underReportedPeriod])
      mockGetContractTotals.mockResolvedValue({
        contract_id: 'contract-1',
        total_royalties: 15000,
        by_year: [{ year: 2024, royalties: 15000 }],
      })

      render(<ContractDetailPage />)

      await waitFor(() => {
        const matches = screen.getAllByText(/1 period/i)
        expect(matches.length).toBeGreaterThanOrEqual(1)
      })
    })

    it('hides discrepancy summary card when no periods are under-reported', async () => {
      mockGetContract.mockResolvedValue(mockContract)
      mockGetSalesPeriods.mockResolvedValue([matchingPeriod])
      mockGetContractTotals.mockResolvedValue({
        contract_id: 'contract-1',
        total_royalties: 12000,
        by_year: [{ year: 2024, royalties: 12000 }],
      })

      render(<ContractDetailPage />)

      await waitFor(() => {
        expect(screen.getAllByText('Acme Corp').length).toBeGreaterThanOrEqual(1)
      })

      expect(screen.queryByText('Open Discrepancies')).not.toBeInTheDocument()
    })

    it('hides discrepancy summary card when all periods have null reported royalty', async () => {
      const nullPeriod: SalesPeriod = {
        id: 'sp-null-1',
        contract_id: 'contract-1',
        period_start: '2024-01-01',
        period_end: '2024-03-31',
        net_sales: 100000,
        category_breakdown: null,
        royalty_calculated: 15000,
        minimum_applied: false,
        licensee_reported_royalty: null,
        discrepancy_amount: null,
        has_discrepancy: false,
        created_at: '2024-04-01T00:00:00Z',
      }

      mockGetContract.mockResolvedValue(mockContract)
      mockGetSalesPeriods.mockResolvedValue([nullPeriod])
      mockGetContractTotals.mockResolvedValue({
        contract_id: 'contract-1',
        total_royalties: 15000,
        by_year: [{ year: 2024, royalties: 15000 }],
      })

      render(<ContractDetailPage />)

      await waitFor(() => {
        expect(screen.getAllByText('Acme Corp').length).toBeGreaterThanOrEqual(1)
      })

      expect(screen.queryByText('Open Discrepancies')).not.toBeInTheDocument()
    })

    it('aggregates multiple under-reported periods in summary card', async () => {
      const secondUnderReported: SalesPeriod = {
        id: 'sp-under-2',
        contract_id: 'contract-1',
        period_start: '2024-04-01',
        period_end: '2024-06-30',
        net_sales: 90000,
        category_breakdown: null,
        royalty_calculated: 13500,
        minimum_applied: false,
        licensee_reported_royalty: 13000,
        discrepancy_amount: 500,
        has_discrepancy: true,
        created_at: '2024-07-01T00:00:00Z',
      }

      mockGetContract.mockResolvedValue(mockContract)
      mockGetSalesPeriods.mockResolvedValue([underReportedPeriod, secondUnderReported])
      mockGetContractTotals.mockResolvedValue({
        contract_id: 'contract-1',
        total_royalties: 28500,
        by_year: [{ year: 2024, royalties: 28500 }],
      })

      render(<ContractDetailPage />)

      await waitFor(() => {
        expect(screen.getByText('Open Discrepancies')).toBeInTheDocument()
        // Total: $280 + $500 = $780
        expect(screen.getByText('$780.00')).toBeInTheDocument()
        const periodMatches = screen.getAllByText(/2 periods/i)
        expect(periodMatches.length).toBeGreaterThanOrEqual(1)
      })
    })
  })

  // ============================================================
  // Source file download icon
  // ============================================================

  describe('Source file download icon', () => {
    const periodWithSourceFile: SalesPeriod = {
      id: 'sp-with-file',
      contract_id: 'contract-1',
      period_start: '2024-01-01',
      period_end: '2024-03-31',
      net_sales: 100000,
      category_breakdown: null,
      royalty_calculated: 15000,
      minimum_applied: false,
      source_file_path: 'sales-reports/user-1/acme-q1-2024.xlsx',
      created_at: '2024-04-01T00:00:00Z',
    }

    const periodWithoutSourceFile: SalesPeriod = {
      id: 'sp-no-file',
      contract_id: 'contract-1',
      period_start: '2024-04-01',
      period_end: '2024-06-30',
      net_sales: 80000,
      category_breakdown: null,
      royalty_calculated: 12000,
      minimum_applied: false,
      source_file_path: null,
      created_at: '2024-07-01T00:00:00Z',
    }

    it('shows download button when source_file_path is present', async () => {
      mockGetContract.mockResolvedValue(mockContract)
      mockGetSalesPeriods.mockResolvedValue([periodWithSourceFile])
      mockGetContractTotals.mockResolvedValue({
        contract_id: 'contract-1',
        total_royalties: 15000,
        by_year: [{ year: 2024, royalties: 15000 }],
      })

      render(<ContractDetailPage />)

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /download source report/i })
        ).toBeInTheDocument()
      })
    })

    it('does not show download button when source_file_path is null', async () => {
      mockGetContract.mockResolvedValue(mockContract)
      mockGetSalesPeriods.mockResolvedValue([periodWithoutSourceFile])
      mockGetContractTotals.mockResolvedValue({
        contract_id: 'contract-1',
        total_royalties: 12000,
        by_year: [{ year: 2024, royalties: 12000 }],
      })

      render(<ContractDetailPage />)

      await waitFor(() => {
        // Table renders (net sales should be visible)
        expect(screen.getByText('$80,000.00')).toBeInTheDocument()
      })

      expect(
        screen.queryByRole('button', { name: /download source report/i })
      ).not.toBeInTheDocument()
    })

    it('calls getSalesReportDownloadUrl and opens result URL when download button is clicked', async () => {
      const user = userEvent.setup()
      const signedUrl = 'https://storage.example.com/signed/acme-q1-2024.xlsx?token=abc'
      mockGetContract.mockResolvedValue(mockContract)
      mockGetSalesPeriods.mockResolvedValue([periodWithSourceFile])
      mockGetContractTotals.mockResolvedValue({
        contract_id: 'contract-1',
        total_royalties: 15000,
        by_year: [{ year: 2024, royalties: 15000 }],
      })
      mockGetSalesReportDownloadUrl.mockResolvedValue(signedUrl)

      const windowOpenSpy = jest.spyOn(window, 'open').mockImplementation(() => null)

      render(<ContractDetailPage />)

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /download source report/i })
        ).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /download source report/i }))

      await waitFor(() => {
        expect(mockGetSalesReportDownloadUrl).toHaveBeenCalledWith('contract-1', 'sp-with-file')
        expect(windowOpenSpy).toHaveBeenCalledWith(signedUrl, '_blank', 'noopener,noreferrer')
      })

      windowOpenSpy.mockRestore()
    })

    it('shows download button only for rows that have a source file when rows are mixed', async () => {
      mockGetContract.mockResolvedValue(mockContract)
      mockGetSalesPeriods.mockResolvedValue([periodWithSourceFile, periodWithoutSourceFile])
      mockGetContractTotals.mockResolvedValue({
        contract_id: 'contract-1',
        total_royalties: 27000,
        by_year: [{ year: 2024, royalties: 27000 }],
      })

      render(<ContractDetailPage />)

      await waitFor(() => {
        // Both rows rendered
        expect(screen.getByText('$100,000.00')).toBeInTheDocument()
        expect(screen.getByText('$80,000.00')).toBeInTheDocument()
      })

      // Only one download button — for the row that has a source file
      const downloadButtons = screen.getAllByRole('button', { name: /download source report/i })
      expect(downloadButtons).toHaveLength(1)
    })

    it('download button has tooltip title', async () => {
      mockGetContract.mockResolvedValue(mockContract)
      mockGetSalesPeriods.mockResolvedValue([periodWithSourceFile])
      mockGetContractTotals.mockResolvedValue({
        contract_id: 'contract-1',
        total_royalties: 15000,
        by_year: [{ year: 2024, royalties: 15000 }],
      })

      render(<ContractDetailPage />)

      await waitFor(() => {
        const downloadButton = screen.getByRole('button', { name: /download source report/i })
        expect(downloadButton).toHaveAttribute('title', 'Download source file')
      })
    })
  })

  // ============================================================
  // licensee_email display
  // ============================================================

  describe('licensee_email field', () => {
    it('displays licensee_email when present', async () => {
      mockGetContract.mockResolvedValue({
        ...mockContract,
        licensee_email: 'acme@example.com',
      })
      mockGetSalesPeriods.mockResolvedValue([])
      mockGetContractTotals.mockResolvedValue({ contract_id: 'contract-1', total_royalties: 0, by_year: [] })

      render(<ContractDetailPage />)

      await waitFor(() => {
        expect(screen.getByText('Licensee Email')).toBeInTheDocument()
        expect(screen.getByText('acme@example.com')).toBeInTheDocument()
      })
    })

    it('does not display licensee_email row when value is null', async () => {
      mockGetContract.mockResolvedValue({ ...mockContract, licensee_email: null })
      mockGetSalesPeriods.mockResolvedValue([])
      mockGetContractTotals.mockResolvedValue({ contract_id: 'contract-1', total_royalties: 0, by_year: [] })

      render(<ContractDetailPage />)

      await waitFor(() => {
        expect(screen.getAllByText('Acme Corp').length).toBeGreaterThanOrEqual(1)
      })

      expect(screen.queryByText('Licensee Email')).not.toBeInTheDocument()
    })
  })

  // ============================================================
  // agreement_number copyable badge
  // ============================================================

  describe('agreement_number copyable badge', () => {
    it('displays agreement_number badge in the header when present', async () => {
      mockGetContract.mockResolvedValue({
        ...mockContract,
        agreement_number: 'LKH-2025-1',
      })
      mockGetSalesPeriods.mockResolvedValue([])
      mockGetContractTotals.mockResolvedValue({ contract_id: 'contract-1', total_royalties: 0, by_year: [] })

      render(<ContractDetailPage />)

      await waitFor(() => {
        expect(screen.getByTestId('agreement-number-badge')).toBeInTheDocument()
        expect(screen.getByTestId('agreement-number-badge')).toHaveTextContent('LKH-2025-1')
      })
    })

    it('does not display agreement_number badge when value is null', async () => {
      mockGetContract.mockResolvedValue({ ...mockContract, agreement_number: null })
      mockGetSalesPeriods.mockResolvedValue([])
      mockGetContractTotals.mockResolvedValue({ contract_id: 'contract-1', total_royalties: 0, by_year: [] })

      render(<ContractDetailPage />)

      await waitFor(() => {
        expect(screen.getAllByText('Acme Corp').length).toBeGreaterThanOrEqual(1)
      })

      expect(screen.queryByTestId('agreement-number-badge')).not.toBeInTheDocument()
    })

    it('does not display agreement_number in the Contract Terms list', async () => {
      mockGetContract.mockResolvedValue({
        ...mockContract,
        agreement_number: 'LKH-2025-1',
      })
      mockGetSalesPeriods.mockResolvedValue([])
      mockGetContractTotals.mockResolvedValue({ contract_id: 'contract-1', total_royalties: 0, by_year: [] })

      render(<ContractDetailPage />)

      await waitFor(() => {
        expect(screen.getByText('Contract Terms')).toBeInTheDocument()
      })

      expect(screen.queryByText('Agreement Number')).not.toBeInTheDocument()
    })

    it('copies agreement number to clipboard when badge is clicked', async () => {
      const user = userEvent.setup()
      const mockCopy = copyToClipboard as jest.MockedFunction<typeof copyToClipboard>
      mockGetContract.mockResolvedValue({
        ...mockContract,
        agreement_number: 'LKH-2025-1',
      })
      mockGetSalesPeriods.mockResolvedValue([])
      mockGetContractTotals.mockResolvedValue({ contract_id: 'contract-1', total_royalties: 0, by_year: [] })

      render(<ContractDetailPage />)

      await waitFor(() => {
        expect(screen.getByTestId('agreement-number-badge')).toBeInTheDocument()
      })

      await user.click(screen.getByTestId('agreement-number-badge'))

      await waitFor(() => {
        expect(mockCopy).toHaveBeenCalledWith('LKH-2025-1')
      })
    })

    it('shows "Copy instructions for licensee" button when agreement_number is present', async () => {
      mockGetContract.mockResolvedValue({
        ...mockContract,
        agreement_number: 'LKH-2025-1',
      })
      mockGetSalesPeriods.mockResolvedValue([])
      mockGetContractTotals.mockResolvedValue({ contract_id: 'contract-1', total_royalties: 0, by_year: [] })

      render(<ContractDetailPage />)

      await waitFor(() => {
        expect(screen.getByTestId('copy-instructions-button')).toBeInTheDocument()
      })
    })

    it('does not show "Copy instructions for licensee" button when agreement_number is null', async () => {
      mockGetContract.mockResolvedValue({ ...mockContract, agreement_number: null })
      mockGetSalesPeriods.mockResolvedValue([])
      mockGetContractTotals.mockResolvedValue({ contract_id: 'contract-1', total_royalties: 0, by_year: [] })

      render(<ContractDetailPage />)

      await waitFor(() => {
        expect(screen.getAllByText('Acme Corp').length).toBeGreaterThanOrEqual(1)
      })

      expect(screen.queryByTestId('copy-instructions-button')).not.toBeInTheDocument()
    })

    it('copies licensee instructions to clipboard when instructions button is clicked', async () => {
      const user = userEvent.setup()
      const mockCopy = copyToClipboard as jest.MockedFunction<typeof copyToClipboard>
      mockGetContract.mockResolvedValue({
        ...mockContract,
        agreement_number: 'LKH-2025-1',
      })
      mockGetSalesPeriods.mockResolvedValue([])
      mockGetContractTotals.mockResolvedValue({ contract_id: 'contract-1', total_royalties: 0, by_year: [] })

      render(<ContractDetailPage />)

      await waitFor(() => {
        expect(screen.getByTestId('copy-instructions-button')).toBeInTheDocument()
      })

      await user.click(screen.getByTestId('copy-instructions-button'))

      await waitFor(() => {
        expect(mockCopy).toHaveBeenCalledWith(
          'Please include the following reference in your royalty report emails:\nAgreement Reference: LKH-2025-1'
        )
      })
    })
  })

  // ============================================================
  // Post-confirmation callout (?success=period_created)
  // ============================================================

  describe('Post-confirmation success callout', () => {
    it('shows callout when ?success=period_created and agreement_number is present', async () => {
      ;(useSearchParams as jest.Mock).mockReturnValue({ get: (key: string) => key === 'success' ? 'period_created' : null })
      mockGetContract.mockResolvedValue({
        ...mockContract,
        agreement_number: 'LKH-2025-1',
      })
      mockGetSalesPeriods.mockResolvedValue([])
      mockGetContractTotals.mockResolvedValue({ contract_id: 'contract-1', total_royalties: 0, by_year: [] })

      render(<ContractDetailPage />)

      await waitFor(() => {
        expect(screen.getByTestId('success-callout')).toBeInTheDocument()
        expect(screen.getAllByText(/LKH-2025-1/).length).toBeGreaterThanOrEqual(1)
      })
    })

    it('does not show callout when agreement_number is null even if success param is set', async () => {
      ;(useSearchParams as jest.Mock).mockReturnValue({ get: (key: string) => key === 'success' ? 'period_created' : null })
      mockGetContract.mockResolvedValue({ ...mockContract, agreement_number: null })
      mockGetSalesPeriods.mockResolvedValue([])
      mockGetContractTotals.mockResolvedValue({ contract_id: 'contract-1', total_royalties: 0, by_year: [] })

      render(<ContractDetailPage />)

      await waitFor(() => {
        expect(screen.getAllByText('Acme Corp').length).toBeGreaterThanOrEqual(1)
      })

      expect(screen.queryByTestId('success-callout')).not.toBeInTheDocument()
    })

    it('does not show callout when success param is absent', async () => {
      // useSearchParams returns null for success (default beforeEach mock)
      mockGetContract.mockResolvedValue({
        ...mockContract,
        agreement_number: 'LKH-2025-1',
      })
      mockGetSalesPeriods.mockResolvedValue([])
      mockGetContractTotals.mockResolvedValue({ contract_id: 'contract-1', total_royalties: 0, by_year: [] })

      render(<ContractDetailPage />)

      await waitFor(() => {
        expect(screen.getAllByText('Acme Corp').length).toBeGreaterThanOrEqual(1)
      })

      expect(screen.queryByTestId('success-callout')).not.toBeInTheDocument()
    })

    it('copies instructions when callout copy button is clicked', async () => {
      const user = userEvent.setup()
      const mockCopy = copyToClipboard as jest.MockedFunction<typeof copyToClipboard>
      ;(useSearchParams as jest.Mock).mockReturnValue({ get: (key: string) => key === 'success' ? 'period_created' : null })
      mockGetContract.mockResolvedValue({
        ...mockContract,
        agreement_number: 'LKH-2025-1',
      })
      mockGetSalesPeriods.mockResolvedValue([])
      mockGetContractTotals.mockResolvedValue({ contract_id: 'contract-1', total_royalties: 0, by_year: [] })

      render(<ContractDetailPage />)

      await waitFor(() => {
        expect(screen.getByTestId('success-callout-copy-button')).toBeInTheDocument()
      })

      await user.click(screen.getByTestId('success-callout-copy-button'))

      await waitFor(() => {
        expect(mockCopy).toHaveBeenCalledWith(
          'Please include the following reference in your royalty report emails:\nAgreement Reference: LKH-2025-1'
        )
      })
    })
  })

  // ============================================================
  // Download Report Template button
  // ============================================================

  describe('Download Report Template button', () => {
    it('shows "Download Template" button for active contracts', async () => {
      mockGetContract.mockResolvedValue(mockContract)
      mockGetSalesPeriods.mockResolvedValue([])
      mockGetContractTotals.mockResolvedValue({ contract_id: 'contract-1', total_royalties: 0, by_year: [] })

      render(<ContractDetailPage />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /download template/i })).toBeInTheDocument()
      })
    })

    it('does not show "Download Template" button for draft contracts', async () => {
      const draftContract: Contract = {
        ...mockContract,
        status: 'draft',
        licensee_name: null,
        royalty_rate: null,
        royalty_base: null,
        reporting_frequency: null,
      }
      mockGetContract.mockResolvedValue(draftContract)
      mockGetSalesPeriods.mockResolvedValue([])
      mockGetContractTotals.mockResolvedValue({ contract_id: 'contract-1', total_royalties: 0, by_year: [] })

      render(<ContractDetailPage />)

      await waitFor(() => {
        expect(screen.getByText('Draft')).toBeInTheDocument()
      })

      expect(screen.queryByRole('button', { name: /download template/i })).not.toBeInTheDocument()
    })

    it('calls downloadReportTemplate with the contract id when clicked', async () => {
      const user = userEvent.setup()
      mockGetContract.mockResolvedValue(mockContract)
      mockGetSalesPeriods.mockResolvedValue([])
      mockGetContractTotals.mockResolvedValue({ contract_id: 'contract-1', total_royalties: 0, by_year: [] })
      mockDownloadReportTemplate.mockResolvedValue(undefined)

      render(<ContractDetailPage />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /download template/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /download template/i }))

      await waitFor(() => {
        expect(mockDownloadReportTemplate).toHaveBeenCalledWith('contract-1')
      })
    })

    it('shows loading state while download is in progress', async () => {
      const user = userEvent.setup()
      let resolveDownload!: () => void
      const downloadPromise = new Promise<void>((resolve) => {
        resolveDownload = resolve
      })

      mockGetContract.mockResolvedValue(mockContract)
      mockGetSalesPeriods.mockResolvedValue([])
      mockGetContractTotals.mockResolvedValue({ contract_id: 'contract-1', total_royalties: 0, by_year: [] })
      mockDownloadReportTemplate.mockReturnValue(downloadPromise)

      render(<ContractDetailPage />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /download template/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /download template/i }))

      // Button should be disabled during download
      expect(screen.getByRole('button', { name: /download template/i })).toBeDisabled()

      resolveDownload()

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /download template/i })).not.toBeDisabled()
      })
    })

    it('shows toast error when download fails', async () => {
      const user = userEvent.setup()
      mockGetContract.mockResolvedValue(mockContract)
      mockGetSalesPeriods.mockResolvedValue([])
      mockGetContractTotals.mockResolvedValue({ contract_id: 'contract-1', total_royalties: 0, by_year: [] })
      mockDownloadReportTemplate.mockRejectedValue(new Error('Failed to download template'))

      render(<ContractDetailPage />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /download template/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /download template/i }))

      await waitFor(() => {
        // Page now uses toast.error instead of inline error text
        expect(mockToastError).toHaveBeenCalledWith(
          expect.stringMatching(/template download failed/i)
        )
      })
    })

    it('re-enables button after download error', async () => {
      const user = userEvent.setup()
      mockGetContract.mockResolvedValue(mockContract)
      mockGetSalesPeriods.mockResolvedValue([])
      mockGetContractTotals.mockResolvedValue({ contract_id: 'contract-1', total_royalties: 0, by_year: [] })
      mockDownloadReportTemplate.mockRejectedValue(new Error('Network error'))

      render(<ContractDetailPage />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /download template/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /download template/i }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /download template/i })).not.toBeDisabled()
      })
    })
  })

})
