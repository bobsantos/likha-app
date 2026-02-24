/**
 * Tests for Inbox Review Page
 */

import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { useParams, useRouter } from 'next/navigation'
import InboxReviewPage from '@/app/(app)/inbox/[id]/page'
import { getInboundReports, getContracts, confirmReport, rejectReport, ApiError } from '@/lib/api'
import type { InboundReport, Contract } from '@/types'

jest.mock('next/navigation', () => ({
  useParams: jest.fn(),
  useRouter: jest.fn(),
}))

jest.mock('@/lib/api', () => ({
  getInboundReports: jest.fn(),
  getContracts: jest.fn(),
  confirmReport: jest.fn(),
  rejectReport: jest.fn(),
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

const makeReport = (overrides: Partial<InboundReport> = {}): InboundReport => ({
  id: 'report-1',
  user_id: 'user-1',
  contract_id: 'contract-1',
  sender_email: 'licensee@example.com',
  subject: 'Q4 Royalty Report',
  received_at: '2026-02-24T10:00:00Z',
  attachment_filename: 'report.xlsx',
  attachment_path: 'inbound/user-1/report-1/report.xlsx',
  match_confidence: 'high',
  status: 'pending',
  contract_name: 'Sunrise Apparel License',
  ...overrides,
})

const makeContract = (id: string, name: string): Contract => ({
  id,
  user_id: 'user-1',
  status: 'active',
  filename: 'contract.pdf',
  licensee_name: name,
  contract_start_date: '2026-01-01',
  contract_end_date: '2026-12-31',
  royalty_rate: 0.1,
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
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
})

describe('Inbox Review Page', () => {
  const mockPush = jest.fn()
  const mockGetInboundReports = getInboundReports as jest.MockedFunction<typeof getInboundReports>
  const mockGetContracts = getContracts as jest.MockedFunction<typeof getContracts>
  const mockConfirmReport = confirmReport as jest.MockedFunction<typeof confirmReport>
  const mockRejectReport = rejectReport as jest.MockedFunction<typeof rejectReport>

  beforeEach(() => {
    jest.clearAllMocks()
    ;(useRouter as jest.Mock).mockReturnValue({ push: mockPush })
    ;(useParams as jest.Mock).mockReturnValue({ id: 'report-1' })
    mockGetContracts.mockResolvedValue([makeContract('contract-1', 'Sunrise Apparel License')])
  })

  it('shows loading state initially', () => {
    mockGetInboundReports.mockImplementation(() => new Promise(() => {}))
    render(<InboxReviewPage />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('displays report details after loading', async () => {
    mockGetInboundReports.mockResolvedValue([makeReport()])
    render(<InboxReviewPage />)
    await waitFor(() => {
      expect(screen.getByText('licensee@example.com')).toBeInTheDocument()
      expect(screen.getByText('Q4 Royalty Report')).toBeInTheDocument()
      expect(screen.getByText('report.xlsx')).toBeInTheDocument()
    })
  })

  it('displays matched contract name', async () => {
    mockGetInboundReports.mockResolvedValue([makeReport({ contract_name: 'Sunrise Apparel License' })])
    render(<InboxReviewPage />)
    await waitFor(() => {
      expect(screen.getByText('Sunrise Apparel License')).toBeInTheDocument()
    })
  })

  it('shows contract selector dropdown for unmatched report', async () => {
    mockGetInboundReports.mockResolvedValue([
      makeReport({ contract_id: null, contract_name: null, match_confidence: 'none' }),
    ])
    render(<InboxReviewPage />)
    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument()
    })
  })

  it('renders Confirm & Process button', async () => {
    mockGetInboundReports.mockResolvedValue([makeReport()])
    render(<InboxReviewPage />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument()
    })
  })

  it('renders Reject button', async () => {
    mockGetInboundReports.mockResolvedValue([makeReport()])
    render(<InboxReviewPage />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument()
    })
  })

  it('calls confirmReport and navigates to inbox on confirm', async () => {
    mockGetInboundReports.mockResolvedValue([makeReport()])
    mockConfirmReport.mockResolvedValue(undefined)
    render(<InboxReviewPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))

    await waitFor(() => {
      expect(mockConfirmReport).toHaveBeenCalledWith('report-1', undefined)
      expect(mockPush).toHaveBeenCalledWith('/inbox')
    })
  })

  it('calls rejectReport and navigates to inbox on reject', async () => {
    mockGetInboundReports.mockResolvedValue([makeReport()])
    mockRejectReport.mockResolvedValue(undefined)
    render(<InboxReviewPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /reject/i }))

    await waitFor(() => {
      expect(mockRejectReport).toHaveBeenCalledWith('report-1')
      expect(mockPush).toHaveBeenCalledWith('/inbox')
    })
  })

  it('shows error when report not found', async () => {
    mockGetInboundReports.mockResolvedValue([])
    render(<InboxReviewPage />)
    await waitFor(() => {
      expect(screen.getByText(/not found/i)).toBeInTheDocument()
    })
  })

  it('shows error message on fetch failure', async () => {
    mockGetInboundReports.mockRejectedValue(new Error('Network error'))
    render(<InboxReviewPage />)
    await waitFor(() => {
      expect(screen.getByText(/failed to load/i)).toBeInTheDocument()
    })
  })

  it('redirects to /login on 401', async () => {
    const { ApiError: MockApiError } = jest.requireMock('@/lib/api')
    mockGetInboundReports.mockRejectedValue(new MockApiError('Unauthorized', 401))
    render(<InboxReviewPage />)
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/login')
    })
  })

  it('has a back link to inbox', async () => {
    mockGetInboundReports.mockResolvedValue([makeReport()])
    render(<InboxReviewPage />)
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /back/i })).toBeInTheDocument()
    })
  })

  it('disables action buttons for already confirmed report', async () => {
    mockGetInboundReports.mockResolvedValue([makeReport({ status: 'confirmed' })])
    render(<InboxReviewPage />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled()
      expect(screen.getByRole('button', { name: /reject/i })).toBeDisabled()
    })
  })

  it('disables action buttons for already rejected report', async () => {
    mockGetInboundReports.mockResolvedValue([makeReport({ status: 'rejected' })])
    render(<InboxReviewPage />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled()
      expect(screen.getByRole('button', { name: /reject/i })).toBeDisabled()
    })
  })
})
