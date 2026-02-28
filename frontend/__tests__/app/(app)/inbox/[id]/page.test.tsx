/**
 * Tests for Inbox Review Page (redesigned)
 *
 * Covers three contract-match states, confidence pill styles, "matched on" tags,
 * attachment preview strip, detected period row, action button states, and
 * post-confirm redirect behaviour.
 */

import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { useParams, useRouter } from 'next/navigation'
import InboxReviewPage from '@/app/(app)/inbox/[id]/page'
import {
  getInboundReports,
  getContracts,
  confirmReport,
  rejectReport,
  ApiError,
} from '@/lib/api'
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

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

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
  candidate_contract_ids: null,
  suggested_period_start: null,
  suggested_period_end: null,
  sales_period_id: null,
  ...overrides,
})

const makeContract = (id: string, name: string, licenseeOverride?: string): Contract => ({
  id,
  user_id: 'user-1',
  status: 'active',
  filename: 'contract.pdf',
  licensee_name: licenseeOverride ?? name,
  licensee_email: null,
  agreement_number: 'BC-2024-0042',
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

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

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
    mockConfirmReport.mockResolvedValue({ redirect_url: null })
    mockRejectReport.mockResolvedValue(undefined)
  })

  // =========================================================================
  // Loading / error states
  // =========================================================================

  it('shows loading state initially', () => {
    mockGetInboundReports.mockImplementation(() => new Promise(() => {}))
    render(<InboxReviewPage />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
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

  // =========================================================================
  // 1. Auto-matched (high confidence)
  // =========================================================================

  describe('Auto-matched state (high confidence)', () => {
    it('renders green card with matched contract name', async () => {
      mockGetInboundReports.mockResolvedValue([
        makeReport({ contract_id: 'contract-1', contract_name: 'Sunrise Apparel License', match_confidence: 'high' }),
      ])
      render(<InboxReviewPage />)
      await waitFor(() => {
        expect(screen.getByText('Sunrise Apparel License')).toBeInTheDocument()
      })
      // The matched contract card should be green
      const matchedText = screen.getByText('Sunrise Apparel License')
      const card = matchedText.closest('[class*="green"]') ?? matchedText.closest('[data-testid="auto-match-card"]')
      expect(card).toBeTruthy()
    })

    it('shows "Not the right contract?" toggle', async () => {
      mockGetInboundReports.mockResolvedValue([
        makeReport({ contract_id: 'contract-1', contract_name: 'Sunrise Apparel License', match_confidence: 'high' }),
      ])
      render(<InboxReviewPage />)
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /not the right contract/i })).toBeInTheDocument()
      })
    })

    it('clicking "Not the right contract?" reveals contract search/select state', async () => {
      mockGetInboundReports.mockResolvedValue([
        makeReport({ contract_id: 'contract-1', contract_name: 'Sunrise Apparel License', match_confidence: 'high' }),
      ])
      render(<InboxReviewPage />)
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /not the right contract/i })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /not the right contract/i }))

      await waitFor(() => {
        // Should reveal a select/combobox to choose a different contract
        expect(screen.getByRole('combobox')).toBeInTheDocument()
      })
    })
  })

  // =========================================================================
  // 2. Suggestions (medium confidence)
  // =========================================================================

  describe('Suggestions state (medium confidence)', () => {
    it('renders amber header indicating suggestions', async () => {
      mockGetInboundReports.mockResolvedValue([
        makeReport({
          contract_id: null,
          contract_name: null,
          match_confidence: 'medium',
          candidate_contract_ids: ['contract-1', 'contract-2'],
        }),
      ])
      mockGetContracts.mockResolvedValue([
        makeContract('contract-1', 'Sunrise Apparel License'),
        makeContract('contract-2', 'Blue River Textiles'),
      ])
      render(<InboxReviewPage />)
      await waitFor(() => {
        expect(screen.getByText(/suggested match/i)).toBeInTheDocument()
      })
    })

    it('renders candidate suggestion cards with contract names', async () => {
      mockGetInboundReports.mockResolvedValue([
        makeReport({
          contract_id: null,
          contract_name: null,
          match_confidence: 'medium',
          candidate_contract_ids: ['contract-1', 'contract-2'],
        }),
      ])
      mockGetContracts.mockResolvedValue([
        makeContract('contract-1', 'Sunrise Apparel License'),
        makeContract('contract-2', 'Blue River Textiles'),
      ])
      render(<InboxReviewPage />)
      await waitFor(() => {
        expect(screen.getByText('Sunrise Apparel License')).toBeInTheDocument()
        expect(screen.getByText('Blue River Textiles')).toBeInTheDocument()
      })
    })

    it('renders confidence pill with green style on the auto-match card (high confidence)', async () => {
      // The high-confidence auto-match card itself renders a green confidence pill
      mockGetInboundReports.mockResolvedValue([
        makeReport({
          contract_id: 'contract-1',
          contract_name: 'Sunrise Apparel License',
          match_confidence: 'high',
        }),
      ])
      mockGetContracts.mockResolvedValue([makeContract('contract-1', 'Sunrise Apparel License')])
      render(<InboxReviewPage />)
      await waitFor(() => {
        // Auto-matched state renders a green confidence pill (score >= 80)
        const greenPill = document.querySelector('.bg-green-100.text-green-700')
        expect(greenPill).toBeTruthy()
      })
    })

    it('renders confidence pill with amber style for score 50-79', async () => {
      mockGetInboundReports.mockResolvedValue([
        makeReport({
          contract_id: null,
          contract_name: null,
          match_confidence: 'medium',
          candidate_contract_ids: ['contract-1'],
        }),
      ])
      mockGetContracts.mockResolvedValue([makeContract('contract-1', 'Sunrise Apparel License')])
      render(<InboxReviewPage />)
      await waitFor(() => {
        // At medium confidence, amber pill should be present
        const amberPill = document.querySelector('.bg-amber-100.text-amber-700')
        expect(amberPill).toBeTruthy()
      })
    })

    it('clicking a suggestion card selects that contract', async () => {
      mockGetInboundReports.mockResolvedValue([
        makeReport({
          contract_id: null,
          contract_name: null,
          match_confidence: 'medium',
          candidate_contract_ids: ['contract-1'],
        }),
      ])
      mockGetContracts.mockResolvedValue([makeContract('contract-1', 'Sunrise Apparel License')])
      render(<InboxReviewPage />)
      await waitFor(() => {
        expect(screen.getByText('Sunrise Apparel License')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Sunrise Apparel License'))

      await waitFor(() => {
        // After selection, "Confirm & Open Upload Wizard" should be enabled
        const confirmWizardBtn = screen.getByRole('button', { name: /confirm.*open.*wizard/i })
        expect(confirmWizardBtn).not.toBeDisabled()
      })
    })
  })

  // =========================================================================
  // 3. No match
  // =========================================================================

  describe('No match state', () => {
    it('renders amber header indicating no match', async () => {
      mockGetInboundReports.mockResolvedValue([
        makeReport({ contract_id: null, contract_name: null, match_confidence: 'none', candidate_contract_ids: null }),
      ])
      mockGetContracts.mockResolvedValue([makeContract('contract-1', 'Sunrise Apparel License')])
      render(<InboxReviewPage />)
      await waitFor(() => {
        expect(screen.getByText(/no contract matched/i)).toBeInTheDocument()
      })
    })

    it('renders searchable select for all active contracts', async () => {
      mockGetInboundReports.mockResolvedValue([
        makeReport({ contract_id: null, contract_name: null, match_confidence: 'none', candidate_contract_ids: null }),
      ])
      mockGetContracts.mockResolvedValue([makeContract('contract-1', 'Sunrise Apparel License')])
      render(<InboxReviewPage />)
      await waitFor(() => {
        expect(screen.getByRole('combobox')).toBeInTheDocument()
      })
    })

    it('lists all active contracts in the select', async () => {
      mockGetInboundReports.mockResolvedValue([
        makeReport({ contract_id: null, contract_name: null, match_confidence: 'none', candidate_contract_ids: null }),
      ])
      mockGetContracts.mockResolvedValue([
        makeContract('contract-1', 'Sunrise Apparel License'),
        makeContract('contract-2', 'Blue River Textiles'),
      ])
      render(<InboxReviewPage />)
      await waitFor(() => {
        expect(screen.getByText('Sunrise Apparel License')).toBeInTheDocument()
        expect(screen.getByText('Blue River Textiles')).toBeInTheDocument()
      })
    })
  })

  // =========================================================================
  // 4. Attachment preview strip
  // =========================================================================

  describe('Attachment preview strip', () => {
    it('shows filename in preview strip', async () => {
      mockGetInboundReports.mockResolvedValue([makeReport({ attachment_filename: 'q4-report.xlsx' })])
      render(<InboxReviewPage />)
      await waitFor(() => {
        expect(screen.getByText('q4-report.xlsx')).toBeInTheDocument()
      })
    })

    it('shows "No attachment" badge when attachment is absent', async () => {
      mockGetInboundReports.mockResolvedValue([
        makeReport({ attachment_filename: null, attachment_path: null }),
      ])
      render(<InboxReviewPage />)
      await waitFor(() => {
        expect(screen.getByText(/no attachment/i)).toBeInTheDocument()
      })
    })
  })

  // =========================================================================
  // 5. Detected period row
  // =========================================================================

  describe('Detected period row', () => {
    it('displays detected period when suggested dates are present', async () => {
      mockGetInboundReports.mockResolvedValue([
        makeReport({
          suggested_period_start: '2025-07-01',
          suggested_period_end: '2025-09-30',
        }),
      ])
      render(<InboxReviewPage />)
      await waitFor(() => {
        expect(screen.getByText(/detected period/i)).toBeInTheDocument()
      })
    })

    it('shows a provenance badge next to the detected period', async () => {
      mockGetInboundReports.mockResolvedValue([
        makeReport({
          suggested_period_start: '2025-07-01',
          suggested_period_end: '2025-09-30',
        }),
      ])
      render(<InboxReviewPage />)
      await waitFor(() => {
        expect(screen.getByText(/from attachment/i)).toBeInTheDocument()
      })
    })

    it('hides period row when no period detected', async () => {
      mockGetInboundReports.mockResolvedValue([
        makeReport({ suggested_period_start: null, suggested_period_end: null }),
      ])
      render(<InboxReviewPage />)
      await waitFor(() => {
        expect(screen.queryByText(/detected period/i)).not.toBeInTheDocument()
      })
    })
  })

  // =========================================================================
  // 6. Action buttons
  // =========================================================================

  describe('Action buttons', () => {
    it('"Confirm & Open Upload Wizard" is disabled when no contract is selected', async () => {
      mockGetInboundReports.mockResolvedValue([
        makeReport({ contract_id: null, contract_name: null, match_confidence: 'none', candidate_contract_ids: null }),
      ])
      render(<InboxReviewPage />)
      await waitFor(() => {
        const btn = screen.getByRole('button', { name: /confirm.*open.*wizard/i })
        expect(btn).toBeDisabled()
      })
    })

    it('"Confirm & Open Upload Wizard" is enabled when a contract is matched', async () => {
      mockGetInboundReports.mockResolvedValue([
        makeReport({ contract_id: 'contract-1', contract_name: 'Sunrise Apparel License', match_confidence: 'high' }),
      ])
      render(<InboxReviewPage />)
      await waitFor(() => {
        const btn = screen.getByRole('button', { name: /confirm.*open.*wizard/i })
        expect(btn).not.toBeDisabled()
      })
    })

    it('"Confirm & Open Upload Wizard" calls confirm with open_wizard=true and redirects', async () => {
      const redirectUrl = '/sales/upload?contract_id=contract-1&report_id=report-1&source=inbox'
      mockGetInboundReports.mockResolvedValue([
        makeReport({ contract_id: 'contract-1', contract_name: 'Sunrise Apparel License', match_confidence: 'high' }),
      ])
      mockConfirmReport.mockResolvedValue({ redirect_url: redirectUrl })
      render(<InboxReviewPage />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /confirm.*open.*wizard/i })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /confirm.*open.*wizard/i }))

      await waitFor(() => {
        expect(mockConfirmReport).toHaveBeenCalledWith(
          'report-1',
          'contract-1',
          true
        )
        expect(mockPush).toHaveBeenCalledWith(
          expect.stringContaining(redirectUrl)
        )
      })
    })

    it('"Confirm Only" calls confirm with open_wizard=false and redirects to /inbox', async () => {
      mockGetInboundReports.mockResolvedValue([
        makeReport({ contract_id: 'contract-1', contract_name: 'Sunrise Apparel License', match_confidence: 'high' }),
      ])
      mockConfirmReport.mockResolvedValue({ redirect_url: null })
      render(<InboxReviewPage />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /confirm only/i })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /confirm only/i }))

      await waitFor(() => {
        expect(mockConfirmReport).toHaveBeenCalledWith(
          'report-1',
          'contract-1',
          false
        )
        expect(mockPush).toHaveBeenCalledWith('/inbox?confirmed=report-1')
      })
    })

    it('"Reject Report" calls rejectReport and redirects to /inbox', async () => {
      mockGetInboundReports.mockResolvedValue([makeReport()])
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

    it('disables all action buttons for confirmed report', async () => {
      mockGetInboundReports.mockResolvedValue([makeReport({ status: 'confirmed' })])
      render(<InboxReviewPage />)
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /confirm.*open.*wizard/i })).toBeDisabled()
        expect(screen.getByRole('button', { name: /confirm only/i })).toBeDisabled()
        expect(screen.getByRole('button', { name: /reject/i })).toBeDisabled()
      })
    })

    it('disables all action buttons for rejected report', async () => {
      mockGetInboundReports.mockResolvedValue([makeReport({ status: 'rejected' })])
      render(<InboxReviewPage />)
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /confirm.*open.*wizard/i })).toBeDisabled()
        expect(screen.getByRole('button', { name: /confirm only/i })).toBeDisabled()
        expect(screen.getByRole('button', { name: /reject/i })).toBeDisabled()
      })
    })

    it('shows action error when confirmReport throws', async () => {
      mockGetInboundReports.mockResolvedValue([
        makeReport({ contract_id: 'contract-1', contract_name: 'Sunrise Apparel License', match_confidence: 'high' }),
      ])
      mockConfirmReport.mockRejectedValue(new Error('Server error'))
      render(<InboxReviewPage />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /confirm only/i })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /confirm only/i }))

      await waitFor(() => {
        expect(screen.getByText(/server error/i)).toBeInTheDocument()
      })
    })
  })

  // =========================================================================
  // 7. Multi-contract callout
  // =========================================================================

  describe('Multi-contract callout', () => {
    it('shows informational callout when licensee has multiple active contracts', async () => {
      mockGetInboundReports.mockResolvedValue([
        makeReport({
          contract_id: 'contract-1',
          contract_name: 'Sunrise Apparel License',
          match_confidence: 'high',
        }),
      ])
      // Same licensee_name, different contracts
      mockGetContracts.mockResolvedValue([
        makeContract('contract-1', 'Sunrise Apparel License', 'Sunrise Apparel Co.'),
        makeContract('contract-2', 'Sunrise Apparel License 2', 'Sunrise Apparel Co.'),
        makeContract('contract-3', 'Sunrise Apparel License 3', 'Sunrise Apparel Co.'),
      ])
      render(<InboxReviewPage />)
      await waitFor(() => {
        expect(screen.getByText(/multiple.*contract/i)).toBeInTheDocument()
      })
    })

    it('does not show multi-contract callout when licensee has one contract', async () => {
      mockGetInboundReports.mockResolvedValue([
        makeReport({ contract_id: 'contract-1', contract_name: 'Sunrise Apparel License', match_confidence: 'high' }),
      ])
      mockGetContracts.mockResolvedValue([
        makeContract('contract-1', 'Sunrise Apparel License', 'Sunrise Apparel Co.'),
      ])
      render(<InboxReviewPage />)
      await waitFor(() => {
        expect(screen.queryByText(/multiple.*contract/i)).not.toBeInTheDocument()
      })
    })
  })

  // =========================================================================
  // 8. Contract details grid (Zone B)
  // =========================================================================

  describe('Contract details grid', () => {
    it('renders agreement number, contract period, and royalty rate for auto-matched state', async () => {
      mockGetInboundReports.mockResolvedValue([
        makeReport({ contract_id: 'contract-1', contract_name: 'Sunrise Apparel License', match_confidence: 'high' }),
      ])
      mockGetContracts.mockResolvedValue([
        makeContract('contract-1', 'Sunrise Apparel License'),
      ])
      render(<InboxReviewPage />)
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /view details/i })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /view details/i }))

      await waitFor(() => {
        expect(screen.getByText('BC-2024-0042')).toBeInTheDocument()
        expect(screen.getByText('Jan 1, 2026 \u2013 Dec 31, 2026')).toBeInTheDocument()
        expect(screen.getByText('10% flat')).toBeInTheDocument()
      })
    })

    it('renders reporting frequency for auto-matched state', async () => {
      mockGetInboundReports.mockResolvedValue([
        makeReport({ contract_id: 'contract-1', contract_name: 'Sunrise Apparel License', match_confidence: 'high' }),
      ])
      mockGetContracts.mockResolvedValue([
        makeContract('contract-1', 'Sunrise Apparel License'),
      ])
      render(<InboxReviewPage />)
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /view details/i })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /view details/i }))

      await waitFor(() => {
        expect(screen.getByText(/quarterly/i)).toBeInTheDocument()
      })
    })

    it('shows "None" for missing agreement number', async () => {
      mockGetInboundReports.mockResolvedValue([
        makeReport({ contract_id: 'contract-1', contract_name: 'Sunrise Apparel License', match_confidence: 'high' }),
      ])
      const contractNoRef = { ...makeContract('contract-1', 'Sunrise Apparel License'), agreement_number: null }
      mockGetContracts.mockResolvedValue([contractNoRef])
      render(<InboxReviewPage />)
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /view details/i })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /view details/i }))

      await waitFor(() => {
        expect(screen.getByText('None')).toBeInTheDocument()
      })
    })

    it('shows contract details collapsed by default for high confidence match', async () => {
      mockGetInboundReports.mockResolvedValue([
        makeReport({ contract_id: 'contract-1', contract_name: 'Sunrise Apparel License', match_confidence: 'high' }),
      ])
      mockGetContracts.mockResolvedValue([
        makeContract('contract-1', 'Sunrise Apparel License'),
      ])
      render(<InboxReviewPage />)
      await waitFor(() => {
        // Toggle button should be present
        expect(screen.getByRole('button', { name: /view details/i })).toBeInTheDocument()
      })
      // The agreement number should NOT be visible before expanding
      expect(screen.queryByText('BC-2024-0042')).not.toBeInTheDocument()
    })

    it('expands contract details when toggle is clicked for high confidence match', async () => {
      mockGetInboundReports.mockResolvedValue([
        makeReport({ contract_id: 'contract-1', contract_name: 'Sunrise Apparel License', match_confidence: 'high' }),
      ])
      mockGetContracts.mockResolvedValue([
        makeContract('contract-1', 'Sunrise Apparel License'),
      ])
      render(<InboxReviewPage />)
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /view details/i })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /view details/i }))

      await waitFor(() => {
        expect(screen.getByText('BC-2024-0042')).toBeInTheDocument()
        expect(screen.getByText(/10% flat/i)).toBeInTheDocument()
      })
    })

    it('renders contract details expanded for medium confidence suggestions', async () => {
      mockGetInboundReports.mockResolvedValue([
        makeReport({
          contract_id: null,
          contract_name: null,
          match_confidence: 'medium',
          candidate_contract_ids: ['contract-1'],
        }),
      ])
      mockGetContracts.mockResolvedValue([
        makeContract('contract-1', 'Sunrise Apparel License'),
      ])
      render(<InboxReviewPage />)
      await waitFor(() => {
        // For medium confidence, contract details shown after clicking suggestion card
        expect(screen.getByText('Sunrise Apparel License')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Sunrise Apparel License'))

      await waitFor(() => {
        expect(screen.getByText('BC-2024-0042')).toBeInTheDocument()
      })
    })

    it('renders contract details after selecting from dropdown in no-match state', async () => {
      mockGetInboundReports.mockResolvedValue([
        makeReport({ contract_id: null, contract_name: null, match_confidence: 'none', candidate_contract_ids: null }),
      ])
      mockGetContracts.mockResolvedValue([
        makeContract('contract-1', 'Sunrise Apparel License'),
      ])
      render(<InboxReviewPage />)
      await waitFor(() => {
        expect(screen.getByRole('combobox')).toBeInTheDocument()
      })

      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'contract-1' } })

      await waitFor(() => {
        expect(screen.getByText('BC-2024-0042')).toBeInTheDocument()
      })
    })

    it('renders optional product categories when present', async () => {
      mockGetInboundReports.mockResolvedValue([
        makeReport({ contract_id: 'contract-1', contract_name: 'Sunrise Apparel License', match_confidence: 'high' }),
      ])
      const contractWithCategories = {
        ...makeContract('contract-1', 'Sunrise Apparel License'),
        product_categories: ['Apparel', 'Footwear'],
      }
      mockGetContracts.mockResolvedValue([contractWithCategories])
      render(<InboxReviewPage />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /view details/i })).toBeInTheDocument()
      })
      fireEvent.click(screen.getByRole('button', { name: /view details/i }))

      await waitFor(() => {
        expect(screen.getByText('Apparel, Footwear')).toBeInTheDocument()
      })
    })

    it('renders tiered royalty rate summary correctly', async () => {
      mockGetInboundReports.mockResolvedValue([
        makeReport({ contract_id: 'contract-1', contract_name: 'Sunrise Apparel License', match_confidence: 'high' }),
      ])
      const contractWithTiered = {
        ...makeContract('contract-1', 'Sunrise Apparel License'),
        royalty_rate: {
          type: 'tiered' as const,
          tiers: [
            { min: 0, max: 100000, rate: 0.08 },
            { min: 100000, max: 500000, rate: 0.10 },
            { min: 500000, max: null, rate: 0.12 },
          ],
        },
      }
      mockGetContracts.mockResolvedValue([contractWithTiered])
      render(<InboxReviewPage />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /view details/i })).toBeInTheDocument()
      })
      fireEvent.click(screen.getByRole('button', { name: /view details/i }))

      await waitFor(() => {
        expect(screen.getByText('Tiered (3 tiers)')).toBeInTheDocument()
      })
    })
  })

  // =========================================================================
  // 9. Attachment preview (Zone C)
  // =========================================================================

  describe('Attachment preview (Zone C)', () => {
    it('renders attachment metadata rows as a definition list', async () => {
      mockGetInboundReports.mockResolvedValue([
        makeReport({
          contract_id: 'contract-1',
          contract_name: 'Sunrise Apparel License',
          match_confidence: 'high',
          attachment_metadata_rows: [
            { key: 'Licensee Name', value: 'Sunrise Apparel Co.' },
            { key: 'Contract Number', value: 'BC-2024-0042' },
            { key: 'Territory', value: 'United States' },
          ],
        }),
      ])
      mockGetContracts.mockResolvedValue([makeContract('contract-1', 'Sunrise Apparel License')])
      render(<InboxReviewPage />)
      await waitFor(() => {
        expect(screen.getByText('Licensee Name')).toBeInTheDocument()
        expect(screen.getByText('Sunrise Apparel Co.')).toBeInTheDocument()
        expect(screen.getByText('Contract Number')).toBeInTheDocument()
        expect(screen.getByText('Territory')).toBeInTheDocument()
        expect(screen.getByText('United States')).toBeInTheDocument()
      })
    })

    it('renders attachment sample rows as a table with correct headers', async () => {
      mockGetInboundReports.mockResolvedValue([
        makeReport({
          contract_id: 'contract-1',
          contract_name: 'Sunrise Apparel License',
          match_confidence: 'high',
          attachment_sample_rows: {
            headers: ['Product', 'Net Sales', 'Royalty'],
            rows: [
              ['Licensed Apparel', '83300.00', '6664.00'],
              ['Footwear', '45000.00', '3600.00'],
            ],
          },
        }),
      ])
      mockGetContracts.mockResolvedValue([makeContract('contract-1', 'Sunrise Apparel License')])
      render(<InboxReviewPage />)
      await waitFor(() => {
        expect(screen.getByRole('columnheader', { name: 'Product' })).toBeInTheDocument()
        expect(screen.getByRole('columnheader', { name: 'Net Sales' })).toBeInTheDocument()
        expect(screen.getByRole('columnheader', { name: 'Royalty' })).toBeInTheDocument()
        expect(screen.getByText('Licensed Apparel')).toBeInTheDocument()
        expect(screen.getByText('83300.00')).toBeInTheDocument()
      })
    })

    it('shows "2 of N rows shown" note below sample data table', async () => {
      mockGetInboundReports.mockResolvedValue([
        makeReport({
          contract_id: 'contract-1',
          contract_name: 'Sunrise Apparel License',
          match_confidence: 'high',
          attachment_sample_rows: {
            headers: ['Product', 'Net Sales'],
            rows: [
              ['Licensed Apparel', '83300.00'],
              ['Footwear', '45000.00'],
              ['Accessories', '12000.00'],
              ['Other', '5000.00'],
            ],
          },
        }),
      ])
      mockGetContracts.mockResolvedValue([makeContract('contract-1', 'Sunrise Apparel License')])
      render(<InboxReviewPage />)
      await waitFor(() => {
        expect(screen.getByText(/2 of 4 rows shown/i)).toBeInTheDocument()
      })
    })

    it('gracefully hides attachment preview sections when fields are null', async () => {
      mockGetInboundReports.mockResolvedValue([
        makeReport({
          contract_id: 'contract-1',
          contract_name: 'Sunrise Apparel License',
          match_confidence: 'high',
          attachment_metadata_rows: null,
          attachment_sample_rows: null,
        }),
      ])
      mockGetContracts.mockResolvedValue([makeContract('contract-1', 'Sunrise Apparel License')])
      render(<InboxReviewPage />)
      await waitFor(() => {
        // The Attachment Preview section heading should not render when both are null
        expect(screen.queryByText('Attachment Preview')).not.toBeInTheDocument()
      })
    })

    it('renders attachment preview section heading when metadata rows are present', async () => {
      mockGetInboundReports.mockResolvedValue([
        makeReport({
          contract_id: 'contract-1',
          contract_name: 'Sunrise Apparel License',
          match_confidence: 'high',
          attachment_metadata_rows: [
            { key: 'Licensee Name', value: 'Sunrise Apparel Co.' },
          ],
          attachment_sample_rows: null,
        }),
      ])
      mockGetContracts.mockResolvedValue([makeContract('contract-1', 'Sunrise Apparel License')])
      render(<InboxReviewPage />)
      await waitFor(() => {
        expect(screen.getByText('Attachment Preview')).toBeInTheDocument()
      })
    })
  })

  // =========================================================================
  // Legacy tests updated for new API
  // =========================================================================

  it('displays report sender, subject, and attachment filename', async () => {
    mockGetInboundReports.mockResolvedValue([makeReport()])
    render(<InboxReviewPage />)
    await waitFor(() => {
      expect(screen.getByText('licensee@example.com')).toBeInTheDocument()
      expect(screen.getByText('Q4 Royalty Report')).toBeInTheDocument()
      expect(screen.getByText('report.xlsx')).toBeInTheDocument()
    })
  })
})
