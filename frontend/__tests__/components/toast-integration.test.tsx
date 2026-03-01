/**
 * Tests for toast notification integrations
 * Tests that toast.success / toast.error are called at the right moments.
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import ContractDetailPage from '@/app/(app)/contracts/[id]/page'
import { getContract, getSalesPeriods, getSalesReportDownloadUrl, getContractTotals, downloadReportTemplate, isUnauthorizedError } from '@/lib/api'
import { copyToClipboard } from '@/lib/clipboard'
import type { Contract, SalesPeriod, ContractTotals } from '@/types'

// Mock react-hot-toast
const mockToastSuccess = jest.fn()
const mockToastError = jest.fn()
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

jest.mock('@/lib/clipboard', () => ({
  copyToClipboard: jest.fn().mockResolvedValue(true),
}))

const mockContract: Contract = {
  id: 'contract-1',
  user_id: 'user-1',
  status: 'active',
  filename: 'acme-contract.pdf',
  licensee_name: 'Acme Corp',
  licensee_email: null,
  agreement_number: 'AGR-001',
  contract_start_date: '2024-01-01',
  contract_end_date: '2025-12-31',
  royalty_rate: '15%',
  royalty_base: 'net_sales',
  territories: ['US'],
  product_categories: [],
  minimum_guarantee: null,
  minimum_guarantee_period: null,
  advance_payment: null,
  reporting_frequency: 'quarterly',
  pdf_url: null,
  extracted_terms: null,
  storage_path: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

const mockContractTotals: ContractTotals = {
  contract_id: 'contract-1',
  total_royalties: 0,
  by_year: [],
}

const setupContractPage = () => {
  ;(useParams as jest.Mock).mockReturnValue({ id: 'contract-1' })
  ;(useRouter as jest.Mock).mockReturnValue({ push: jest.fn() })
  ;(useSearchParams as jest.Mock).mockReturnValue({ get: () => null })
  ;(getContract as jest.Mock).mockResolvedValue(mockContract)
  ;(getSalesPeriods as jest.Mock).mockResolvedValue([])
  ;(getContractTotals as jest.Mock).mockResolvedValue(mockContractTotals)
}

describe('Toast notifications — Contract Detail Page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    setupContractPage()
  })

  it('shows toast.error when template download fails', async () => {
    ;(downloadReportTemplate as jest.Mock).mockRejectedValue(new Error('Network error'))

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByText('Acme Corp').length).toBeGreaterThanOrEqual(1)
    })

    const downloadBtn = screen.getByRole('button', { name: /download template/i })
    await act(async () => {
      fireEvent.click(downloadBtn)
    })

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        expect.stringMatching(/template download failed/i)
      )
    })
  })

  it('shows toast.success when agreement number is copied to clipboard', async () => {
    ;(copyToClipboard as jest.Mock).mockResolvedValue(true)

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getByTestId('agreement-number-badge')).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('agreement-number-badge'))
    })

    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith(
        expect.stringMatching(/copied to clipboard/i)
      )
    })
  })

  it('shows toast.error when agreement number copy fails', async () => {
    ;(copyToClipboard as jest.Mock).mockResolvedValue(false)

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getByTestId('agreement-number-badge')).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('agreement-number-badge'))
    })

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        expect.stringMatching(/could not copy/i)
      )
    })
  })

  it('shows toast.success when instructions copy succeeds', async () => {
    ;(copyToClipboard as jest.Mock).mockResolvedValue(true)

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getByTestId('copy-instructions-button')).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('copy-instructions-button'))
    })

    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith(
        expect.stringMatching(/copied to clipboard/i)
      )
    })
  })

  it('shows toast.error when source file download fails', async () => {
    const mockContractWithPeriod: SalesPeriod = {
      id: 'sp-1',
      contract_id: 'contract-1',
      period_start: '2024-01-01',
      period_end: '2024-03-31',
      net_sales: 10000,
      category_breakdown: null,
      royalty_calculated: 1500,
      minimum_applied: false,
      created_at: '2024-04-01T00:00:00Z',
      source_file_path: 'some/path.xlsx',
    }
    ;(getSalesPeriods as jest.Mock).mockResolvedValue([mockContractWithPeriod])
    ;(getSalesReportDownloadUrl as jest.Mock).mockRejectedValue(new Error('Download failed'))

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /download source report/i })).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /download source report/i }))
    })

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        expect.stringMatching(/could not download file/i)
      )
    })
  })

  it('does not show inline "Copied!" text — toast replaces the old boolean state pattern', async () => {
    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByText('Acme Corp').length).toBeGreaterThanOrEqual(1)
    })

    // The old "Copied!" text state should not appear in the DOM since toast replaces it
    expect(screen.queryByText('Copied!')).not.toBeInTheDocument()
  })

  it('shows "We couldn\'t load this contract" error message instead of raw error', async () => {
    ;(getContract as jest.Mock).mockRejectedValue(new Error('Internal server error'))

    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.getByText(/we couldn't load this contract/i)).toBeInTheDocument()
    })
  })
})
