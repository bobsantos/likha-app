/**
 * Tests for mobile responsiveness, accessibility improvements, and complete user flow.
 * Covers: skip link, ARIA labels on tables, dropzone mobile text variant,
 * contract detail header, and inbox table column visibility.
 */

import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import { useRouter, usePathname, useParams, useSearchParams } from 'next/navigation'

// --- Mocks ---

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  usePathname: jest.fn(),
  useParams: jest.fn(),
  useSearchParams: jest.fn(),
}))

jest.mock('@/lib/auth', () => ({
  signOut: jest.fn().mockResolvedValue({ error: null }),
  getSession: jest.fn().mockResolvedValue({
    session: { user: { email: 'test@example.com' } },
    error: null,
  }),
}))

jest.mock('@/lib/api', () => ({
  getContract: jest.fn(),
  getSalesPeriods: jest.fn(),
  getSalesReportDownloadUrl: jest.fn(),
  getContractTotals: jest.fn(),
  downloadReportTemplate: jest.fn(),
  isUnauthorizedError: jest.fn().mockReturnValue(false),
  getInboundReports: jest.fn(),
  uploadContract: jest.fn(),
}))

jest.mock('@/lib/clipboard', () => ({
  copyToClipboard: jest.fn().mockResolvedValue(true),
}))

jest.mock('@/lib/url-utils', () => ({
  resolveUrl: jest.fn((url: string) => url),
}))

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: {
    success: jest.fn(),
    error: jest.fn(),
  },
  Toaster: () => null,
}))

jest.mock('@/components/skeletons/ContractDetailSkeleton', () => ({
  __esModule: true,
  default: () => <div data-testid="contract-detail-skeleton">Loading skeleton</div>,
}))

// ---

const mockActiveContract = {
  id: 'contract-123',
  status: 'active',
  licensee_name: 'Acme Corp',
  filename: 'acme-contract.pdf',
  pdf_url: 'https://example.com/contract.pdf',
  agreement_number: 'AGR-001',
  licensor_name: 'Brand Owner LLC',
  licensee_email: 'acme@example.com',
  royalty_rate: '8%',
  royalty_base: 'net_sales',
  contract_start_date: '2024-01-01',
  contract_end_date: '2025-12-31',
  territories: ['USA', 'Canada'],
  product_categories: ['Apparel'],
  minimum_guarantee: 50000,
  advance_payment: 10000,
  reporting_frequency: 'quarterly',
  created_at: '2024-01-01T00:00:00Z',
  mg_period: null,
  is_expired: false,
  days_until_report_due: 30,
  form_values: null,
}

const mockSalesPeriods = [
  {
    id: 'period-1',
    contract_id: 'contract-123',
    period_start: '2024-01-01',
    period_end: '2024-03-31',
    net_sales: 100000,
    royalty_calculated: 8000,
    licensee_reported_royalty: 7500,
    discrepancy_amount: 500,
    has_discrepancy: true,
    source_file_path: 'contracts/user/report.xlsx',
    created_at: '2024-04-01T00:00:00Z',
  },
  {
    id: 'period-2',
    contract_id: 'contract-123',
    period_start: '2024-04-01',
    period_end: '2024-06-30',
    net_sales: 80000,
    royalty_calculated: 6400,
    licensee_reported_royalty: null,
    discrepancy_amount: null,
    has_discrepancy: false,
    source_file_path: null,
    created_at: '2024-07-01T00:00:00Z',
  },
]

const mockInboundReports = [
  {
    id: 'report-1',
    sender_email: 'acme@example.com',
    subject: 'Q1 Royalty Report',
    received_at: '2024-04-01T10:00:00Z',
    status: 'pending' as const,
    contract_id: 'contract-123',
    contract_name: 'Acme Corp',
    match_confidence: 'high',
    attachment_count: 1,
  },
]

// ============================================================================
// Skip link test (in app layout)
// ============================================================================

describe('App Layout — skip to main content link', () => {
  it('renders a skip link as first focusable element', async () => {
    const { getSession } = require('@/lib/auth')
    getSession.mockResolvedValueOnce({
      session: { user: { email: 'user@test.com' } },
      error: null,
    })

    ;(useRouter as jest.Mock).mockReturnValue({ push: jest.fn() })

    const AppLayout = (await import('@/app/(app)/layout')).default
    render(
      <AppLayout>
        <div id="main-content">Main content</div>
      </AppLayout>
    )

    await waitFor(() => {
      expect(screen.getByText('Skip to main content')).toBeInTheDocument()
    })

    const skipLink = screen.getByText('Skip to main content').closest('a')
    expect(skipLink).toHaveAttribute('href', '#main-content')
  })
})

// ============================================================================
// Contract Detail — header responsive layout and table accessibility
// ============================================================================

describe('Contract Detail Page — responsive header and table', () => {
  beforeEach(() => {
    ;(useRouter as jest.Mock).mockReturnValue({ push: jest.fn() })
    ;(useParams as jest.Mock).mockReturnValue({ id: 'contract-123' })
    ;(useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams())

    const { getContract, getSalesPeriods, getContractTotals } = require('@/lib/api')
    getContract.mockResolvedValue(mockActiveContract)
    getSalesPeriods.mockResolvedValue(mockSalesPeriods)
    getContractTotals.mockResolvedValue({
      total_royalties: 14400,
      by_year: [{ year: 2024, royalties: 14400 }],
    })
  })

  it('sales periods table has aria-label', async () => {
    const ContractDetailPage = (await import('@/app/(app)/contracts/[id]/page')).default
    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.queryByTestId('contract-detail-skeleton')).not.toBeInTheDocument()
    })

    const table = screen.getByRole('table', { name: /sales periods/i })
    expect(table).toBeInTheDocument()
  })

  it('contract detail header uses flex layout that allows column wrapping', async () => {
    const ContractDetailPage = (await import('@/app/(app)/contracts/[id]/page')).default
    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.queryByTestId('contract-detail-skeleton')).not.toBeInTheDocument()
    })

    const header = screen.getByTestId('contract-detail-header')
    expect(header).toHaveClass('flex-col')
  })

  it('contract action buttons are in a flex-wrap container', async () => {
    const ContractDetailPage = (await import('@/app/(app)/contracts/[id]/page')).default
    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.queryByTestId('contract-detail-skeleton')).not.toBeInTheDocument()
    })

    const buttonsContainer = screen.getByTestId('contract-action-buttons')
    expect(buttonsContainer).toHaveClass('flex-wrap')
  })

  it('copy instructions text has sm:inline class for mobile hiding', async () => {
    const ContractDetailPage = (await import('@/app/(app)/contracts/[id]/page')).default
    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.queryByTestId('contract-detail-skeleton')).not.toBeInTheDocument()
    })

    // The text "Copy instructions for licensee" should have a span that hides on mobile
    const copyInstructionsText = screen.getByTestId('copy-instructions-text')
    expect(copyInstructionsText).toHaveClass('hidden')
    expect(copyInstructionsText).toHaveClass('sm:inline')
  })

  it('Net Sales column header has hidden sm:table-cell class', async () => {
    const ContractDetailPage = (await import('@/app/(app)/contracts/[id]/page')).default
    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.queryByTestId('contract-detail-skeleton')).not.toBeInTheDocument()
    })

    const netSalesHeader = screen.getByTestId('col-net-sales')
    expect(netSalesHeader).toHaveClass('hidden')
    expect(netSalesHeader).toHaveClass('sm:table-cell')
  })

  it('Reported Royalty column header has hidden sm:table-cell class', async () => {
    const ContractDetailPage = (await import('@/app/(app)/contracts/[id]/page')).default
    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.queryByTestId('contract-detail-skeleton')).not.toBeInTheDocument()
    })

    const reportedHeader = screen.getByTestId('col-reported-royalty')
    expect(reportedHeader).toHaveClass('hidden')
    expect(reportedHeader).toHaveClass('sm:table-cell')
  })

  it('Discrepancy column header has hidden md:table-cell class', async () => {
    const ContractDetailPage = (await import('@/app/(app)/contracts/[id]/page')).default
    render(<ContractDetailPage />)

    await waitFor(() => {
      expect(screen.queryByTestId('contract-detail-skeleton')).not.toBeInTheDocument()
    })

    const discrepancyHeader = screen.getByTestId('col-discrepancy')
    expect(discrepancyHeader).toHaveClass('hidden')
    expect(discrepancyHeader).toHaveClass('md:table-cell')
  })
})

// ============================================================================
// Inbox Page — table accessibility and responsive column hiding
// ============================================================================

describe('Inbox Page — responsive table', () => {
  beforeEach(() => {
    ;(useRouter as jest.Mock).mockReturnValue({ push: jest.fn() })
    ;(useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams())

    const { getInboundReports } = require('@/lib/api')
    getInboundReports.mockResolvedValue(mockInboundReports)
  })

  it('inbox table has aria-label', async () => {
    const InboxPage = (await import('@/app/(app)/inbox/page')).default
    render(<InboxPage />)

    await waitFor(() => {
      expect(screen.queryByText('Loading inbox...')).not.toBeInTheDocument()
    })

    const table = screen.getByRole('table', { name: /inbox/i })
    expect(table).toBeInTheDocument()
  })

  it('Subject column header has hidden sm:table-cell class', async () => {
    const InboxPage = (await import('@/app/(app)/inbox/page')).default
    render(<InboxPage />)

    await waitFor(() => {
      expect(screen.queryByText('Loading inbox...')).not.toBeInTheDocument()
    })

    const subjectHeader = screen.getByTestId('inbox-col-subject')
    expect(subjectHeader).toHaveClass('hidden')
    expect(subjectHeader).toHaveClass('sm:table-cell')
  })

  it('Received column header has hidden sm:table-cell class', async () => {
    const InboxPage = (await import('@/app/(app)/inbox/page')).default
    render(<InboxPage />)

    await waitFor(() => {
      expect(screen.queryByText('Loading inbox...')).not.toBeInTheDocument()
    })

    const receivedHeader = screen.getByTestId('inbox-col-received')
    expect(receivedHeader).toHaveClass('hidden')
    expect(receivedHeader).toHaveClass('sm:table-cell')
  })
})

// ============================================================================
// Upload Dropzone — mobile text variant
// ============================================================================

describe('Upload page — dropzone mobile text', () => {
  beforeEach(() => {
    ;(useRouter as jest.Mock).mockReturnValue({ push: jest.fn() })
    ;(useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams())
  })

  it('shows mobile-only "Tap to choose" text on upload dropzone', async () => {
    const UploadPage = (await import('@/app/(app)/contracts/upload/page')).default
    render(<UploadPage />)

    const mobileText = screen.getByTestId('dropzone-mobile-text')
    expect(mobileText).toBeInTheDocument()
    expect(mobileText).toHaveTextContent(/tap to choose/i)
    // Should be visible on mobile (md:hidden)
    expect(mobileText).toHaveClass('md:hidden')
  })

  it('shows desktop-only "Drop your PDF here" text on upload dropzone', async () => {
    const UploadPage = (await import('@/app/(app)/contracts/upload/page')).default
    render(<UploadPage />)

    const desktopText = screen.getByTestId('dropzone-desktop-text')
    expect(desktopText).toBeInTheDocument()
    expect(desktopText).toHaveTextContent(/drop your pdf here/i)
    // Should be hidden on mobile (hidden md:block)
    expect(desktopText).toHaveClass('hidden')
    expect(desktopText).toHaveClass('md:block')
  })
})
