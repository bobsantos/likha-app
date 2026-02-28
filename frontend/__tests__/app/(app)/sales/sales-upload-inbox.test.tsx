/**
 * Tests for Sales Upload Wizard — inbox source integration
 *
 * When the upload wizard is launched from the inbox confirm flow (source=inbox),
 * period dates should be pre-filled and a provenance hint shown.
 * After confirmation, the sales_period_id is linked back to the inbound report.
 */

import { render, screen, waitFor } from '@testing-library/react'
import { useRouter, useSearchParams } from 'next/navigation'
import SalesUploadPage from '@/app/(app)/sales/upload/page'
import { getContract, getSavedMapping, checkPeriodOverlap } from '@/lib/api'
import type { Contract } from '@/types'

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}))

jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  getContract: jest.fn(),
  getSavedMapping: jest.fn(),
  uploadSalesReport: jest.fn(),
  confirmSalesUpload: jest.fn(),
  checkPeriodOverlap: jest.fn(),
  linkSalesPeriodToReport: jest.fn(),
}))

const mockContract: Contract = {
  id: 'contract-1',
  user_id: 'user-1',
  status: 'active',
  filename: 'sunrise-apparel.pdf',
  licensee_name: 'Sunrise Apparel Co.',
  contract_start_date: '2024-01-01',
  contract_end_date: '2025-12-31',
  royalty_rate: 0.08,
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
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

describe('Sales Upload Wizard — inbox source integration', () => {
  const mockPush = jest.fn()
  const mockGetContract = getContract as jest.MockedFunction<typeof getContract>
  const mockGetSavedMapping = getSavedMapping as jest.MockedFunction<typeof getSavedMapping>
  const mockCheckPeriodOverlap = checkPeriodOverlap as jest.MockedFunction<typeof checkPeriodOverlap>

  /** Build a mock useSearchParams that returns given key/value pairs */
  function mockSearchParams(params: Record<string, string | null>) {
    ;(useSearchParams as jest.Mock).mockReturnValue({
      get: jest.fn((key: string) => params[key] ?? null),
    })
  }

  beforeEach(() => {
    jest.clearAllMocks()
    ;(useRouter as jest.Mock).mockReturnValue({ push: mockPush })
    mockGetContract.mockResolvedValue(mockContract)
    mockGetSavedMapping.mockResolvedValue({
      licensee_name: 'Sunrise Apparel Co.',
      column_mapping: null,
      updated_at: null,
    })
    mockCheckPeriodOverlap.mockResolvedValue({
      has_overlap: false,
      overlapping_periods: [],
      out_of_range: false,
      contract_start_date: null,
      contract_end_date: null,
      frequency_warning: null,
      suggested_end_date: null,
    })
  })

  it('pre-fills period start when period_start param is present', async () => {
    mockSearchParams({
      contract_id: 'contract-1',
      report_id: 'report-1',
      period_start: '2025-07-01',
      period_end: '2025-09-30',
      source: 'inbox',
    })

    render(<SalesUploadPage />)

    await waitFor(() => {
      const startInput = screen.getByLabelText(/period start/i) as HTMLInputElement
      expect(startInput.value).toBe('2025-07-01')
    })
  })

  it('pre-fills period end when period_end param is present', async () => {
    mockSearchParams({
      contract_id: 'contract-1',
      report_id: 'report-1',
      period_start: '2025-07-01',
      period_end: '2025-09-30',
      source: 'inbox',
    })

    render(<SalesUploadPage />)

    await waitFor(() => {
      const endInput = screen.getByLabelText(/period end/i) as HTMLInputElement
      expect(endInput.value).toBe('2025-09-30')
    })
  })

  it('shows provenance hint when source=inbox', async () => {
    mockSearchParams({
      contract_id: 'contract-1',
      report_id: 'report-1',
      period_start: '2025-07-01',
      period_end: '2025-09-30',
      source: 'inbox',
    })

    render(<SalesUploadPage />)

    await waitFor(() => {
      expect(screen.getByText(/detected from email/i)).toBeInTheDocument()
    })
  })

  it('updates page subtitle when source=inbox', async () => {
    mockSearchParams({
      contract_id: 'contract-1',
      report_id: 'report-1',
      period_start: '2025-07-01',
      period_end: '2025-09-30',
      source: 'inbox',
    })

    render(<SalesUploadPage />)

    await waitFor(() => {
      expect(screen.getByText(/processing emailed report/i)).toBeInTheDocument()
    })
  })

  it('does not show provenance hint when source is not inbox', async () => {
    mockSearchParams({
      contract_id: 'contract-1',
      period_start: '2025-07-01',
      period_end: '2025-09-30',
    })

    render(<SalesUploadPage />)

    await waitFor(() => {
      // Normal subtitle should appear
      expect(screen.getByText(/upload a spreadsheet/i)).toBeInTheDocument()
    })
    expect(screen.queryByText(/detected from email/i)).not.toBeInTheDocument()
  })

  it('does not pre-fill dates when source is not inbox', async () => {
    mockSearchParams({
      contract_id: 'contract-1',
    })

    render(<SalesUploadPage />)

    await waitFor(() => {
      expect(screen.getByLabelText(/period start/i)).toBeInTheDocument()
    })

    const startInput = screen.getByLabelText(/period start/i) as HTMLInputElement
    expect(startInput.value).toBe('')
  })
})
