/**
 * Tests for Inbox List Page
 */

import { render, screen, waitFor } from '@testing-library/react'
import { useRouter } from 'next/navigation'
import InboxPage from '@/app/(app)/inbox/page'
import { getInboundReports, isUnauthorizedError, ApiError } from '@/lib/api'
import type { InboundReport } from '@/types'

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}))

jest.mock('@/lib/api', () => ({
  getInboundReports: jest.fn(),
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

describe('Inbox Page', () => {
  const mockPush = jest.fn()
  const mockGetInboundReports = getInboundReports as jest.MockedFunction<typeof getInboundReports>

  beforeEach(() => {
    jest.clearAllMocks()
    ;(useRouter as jest.Mock).mockReturnValue({ push: mockPush })
  })

  it('shows loading state initially', () => {
    mockGetInboundReports.mockImplementation(() => new Promise(() => {}))
    render(<InboxPage />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('renders page heading', async () => {
    mockGetInboundReports.mockResolvedValue([])
    render(<InboxPage />)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /inbox/i })).toBeInTheDocument()
    })
  })

  it('shows empty state when no reports', async () => {
    mockGetInboundReports.mockResolvedValue([])
    render(<InboxPage />)
    await waitFor(() => {
      expect(screen.getByText(/no reports received yet/i)).toBeInTheDocument()
    })
  })

  it('displays report rows when loaded', async () => {
    mockGetInboundReports.mockResolvedValue([makeReport()])
    render(<InboxPage />)
    await waitFor(() => {
      expect(screen.getByText('licensee@example.com')).toBeInTheDocument()
      expect(screen.getByText('Q4 Royalty Report')).toBeInTheDocument()
    })
  })

  it('displays contract name for matched report', async () => {
    mockGetInboundReports.mockResolvedValue([makeReport({ contract_name: 'Sunrise Apparel License' })])
    render(<InboxPage />)
    await waitFor(() => {
      expect(screen.getByText('Sunrise Apparel License')).toBeInTheDocument()
    })
  })

  it('displays Unmatched label for report with no contract', async () => {
    mockGetInboundReports.mockResolvedValue([
      makeReport({ contract_id: null, contract_name: null, match_confidence: 'none' }),
    ])
    render(<InboxPage />)
    await waitFor(() => {
      expect(screen.getByText(/unmatched/i)).toBeInTheDocument()
    })
  })

  it('shows Pending status badge for pending report', async () => {
    mockGetInboundReports.mockResolvedValue([makeReport({ status: 'pending' })])
    render(<InboxPage />)
    await waitFor(() => {
      expect(screen.getByText('Pending')).toBeInTheDocument()
    })
  })

  it('shows Confirmed status badge for confirmed report', async () => {
    mockGetInboundReports.mockResolvedValue([makeReport({ status: 'confirmed' })])
    render(<InboxPage />)
    await waitFor(() => {
      expect(screen.getByText('Confirmed')).toBeInTheDocument()
    })
  })

  it('shows Rejected status badge for rejected report', async () => {
    mockGetInboundReports.mockResolvedValue([makeReport({ status: 'rejected' })])
    render(<InboxPage />)
    await waitFor(() => {
      expect(screen.getByText('Rejected')).toBeInTheDocument()
    })
  })

  it('shows error message on fetch failure', async () => {
    mockGetInboundReports.mockRejectedValue(new Error('Network error'))
    render(<InboxPage />)
    await waitFor(() => {
      expect(screen.getByText(/failed to load/i)).toBeInTheDocument()
    })
  })

  it('redirects to /login on 401', async () => {
    const { ApiError: MockApiError } = jest.requireMock('@/lib/api')
    mockGetInboundReports.mockRejectedValue(new MockApiError('Unauthorized', 401))
    render(<InboxPage />)
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/login')
    })
  })

  it('does not show error panel on 401', async () => {
    const { ApiError: MockApiError } = jest.requireMock('@/lib/api')
    mockGetInboundReports.mockRejectedValue(new MockApiError('Unauthorized', 401))
    render(<InboxPage />)
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/login')
    })
    expect(screen.queryByText(/failed to load/i)).not.toBeInTheDocument()
  })

  it('navigates to review page when row is clicked', async () => {
    mockGetInboundReports.mockResolvedValue([makeReport({ id: 'report-abc' })])
    render(<InboxPage />)
    await waitFor(() => {
      expect(screen.getByText('licensee@example.com')).toBeInTheDocument()
    })
    const row = screen.getByRole('row', { name: /licensee@example\.com/i })
    expect(row.closest('a') ?? row).toBeTruthy()
  })

  it('displays multiple reports', async () => {
    mockGetInboundReports.mockResolvedValue([
      makeReport({ id: 'r1', sender_email: 'alice@example.com', subject: 'Q1 Report' }),
      makeReport({ id: 'r2', sender_email: 'bob@example.com', subject: 'Q2 Report' }),
    ])
    render(<InboxPage />)
    await waitFor(() => {
      expect(screen.getByText('alice@example.com')).toBeInTheDocument()
      expect(screen.getByText('bob@example.com')).toBeInTheDocument()
    })
  })
})
