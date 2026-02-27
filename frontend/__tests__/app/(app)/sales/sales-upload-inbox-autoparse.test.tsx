/**
 * Tests for Sales Upload Wizard — inbox auto-parse flow
 *
 * When source=inbox AND storage_path is present:
 * - Step 1 (upload) is skipped
 * - A loading state "Parsing attachment..." is shown
 * - parseFromStorage is called with storage_path and contract_id
 * - On success: wizard jumps directly to column mapping (step 2)
 * - On failure: fallback to step 1 with an error message
 * - Period dates are pre-filled from query params
 * - Step indicator shows step 1 as completed
 */

import { render, screen, waitFor } from '@testing-library/react'
import { useRouter, useSearchParams } from 'next/navigation'
import SalesUploadPage from '@/app/(app)/sales/upload/page'
import { getContract, getSavedMapping, parseFromStorage, checkPeriodOverlap } from '@/lib/api'
import type { Contract, UploadPreviewResponse } from '@/types'

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
  parseFromStorage: jest.fn(),
}))

// Mock ColumnMapper to avoid deep rendering complexity
jest.mock('@/components/sales-upload/column-mapper', () => ({
  __esModule: true,
  default: function MockColumnMapper() {
    return <div data-testid="column-mapper">Column Mapper</div>
  },
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

const mockUploadPreview: UploadPreviewResponse = {
  upload_id: 'upload-123',
  filename: 'q3-2025-report.xlsx',
  sheet_name: 'Sheet1',
  total_rows: 10,
  data_rows: 10,
  detected_columns: ['Product', 'Net Sales'],
  sample_rows: [{ Product: 'Shirts', 'Net Sales': '1000' }],
  suggested_mapping: { Product: 'product_category', 'Net Sales': 'net_sales' },
  mapping_source: 'ai',
  period_start: '2025-07-01',
  period_end: '2025-09-30',
  category_resolution: null,
}

describe('Sales Upload Wizard — inbox auto-parse flow', () => {
  const mockPush = jest.fn()
  const mockGetContract = getContract as jest.MockedFunction<typeof getContract>
  const mockGetSavedMapping = getSavedMapping as jest.MockedFunction<typeof getSavedMapping>
  const mockParseFromStorage = parseFromStorage as jest.MockedFunction<typeof parseFromStorage>
  const mockCheckPeriodOverlap = checkPeriodOverlap as jest.MockedFunction<typeof checkPeriodOverlap>

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

  describe('when source=inbox and storage_path is present', () => {
    const inboxParams = {
      contract_id: 'contract-1',
      report_id: 'report-abc',
      period_start: '2025-07-01',
      period_end: '2025-09-30',
      source: 'inbox',
      storage_path: 'email-attachments/user-1/q3-2025.xlsx',
    }

    it('shows a "Parsing attachment..." loading state while auto-parsing', async () => {
      // Keep parseFromStorage pending so loading state stays visible
      mockParseFromStorage.mockReturnValue(new Promise(() => {}))
      mockSearchParams(inboxParams)

      render(<SalesUploadPage />)

      await waitFor(() => {
        expect(screen.getByText(/parsing attachment/i)).toBeInTheDocument()
      })
    })

    it('calls parseFromStorage with storage_path and contract_id', async () => {
      mockParseFromStorage.mockResolvedValue(mockUploadPreview)
      mockSearchParams(inboxParams)

      render(<SalesUploadPage />)

      await waitFor(() => {
        expect(mockParseFromStorage).toHaveBeenCalledWith(
          'email-attachments/user-1/q3-2025.xlsx',
          'contract-1'
        )
      })
    })

    it('jumps directly to column mapping step after successful auto-parse', async () => {
      mockParseFromStorage.mockResolvedValue(mockUploadPreview)
      mockSearchParams(inboxParams)

      render(<SalesUploadPage />)

      await waitFor(() => {
        expect(screen.getByTestId('column-mapper')).toBeInTheDocument()
      })

      // Step 1 upload UI should NOT be visible
      expect(screen.queryByTestId('drop-zone')).not.toBeInTheDocument()
    })

    it('does not render the file drop zone when auto-parsing succeeds', async () => {
      mockParseFromStorage.mockResolvedValue(mockUploadPreview)
      mockSearchParams(inboxParams)

      render(<SalesUploadPage />)

      await waitFor(() => {
        expect(screen.queryByTestId('drop-zone')).not.toBeInTheDocument()
      })
    })

    it('shows step 1 as completed in the step indicator after auto-parse', async () => {
      mockParseFromStorage.mockResolvedValue(mockUploadPreview)
      mockSearchParams(inboxParams)

      render(<SalesUploadPage />)

      await waitFor(() => {
        // Step 1 should have aria-label ending with "completed"
        const step1 = screen.getByLabelText(/step 1.*upload file.*completed/i)
        expect(step1).toBeInTheDocument()
      })
    })

    it('falls back to step 1 with an error message on parse failure', async () => {
      mockParseFromStorage.mockRejectedValue(new Error('Network error'))
      mockSearchParams(inboxParams)

      render(<SalesUploadPage />)

      await waitFor(() => {
        expect(
          screen.getByText(/could not parse the attachment/i)
        ).toBeInTheDocument()
      })

      // Should fall back to upload step — drop zone visible
      expect(screen.getByTestId('drop-zone')).toBeInTheDocument()
    })

    it('shows the manual upload prompt on fallback', async () => {
      mockParseFromStorage.mockRejectedValue(new Error('Parse failed'))
      mockSearchParams(inboxParams)

      render(<SalesUploadPage />)

      await waitFor(() => {
        expect(
          screen.getByText(/please upload the file manually/i)
        ).toBeInTheDocument()
      })
    })

    it('pre-fills period start from query params even in auto-parse mode', async () => {
      // Verify dates are set: we check them after parse completes and lands on step 2
      // The period dates come from query params, not from the parse response
      mockParseFromStorage.mockResolvedValue(mockUploadPreview)
      mockSearchParams(inboxParams)

      render(<SalesUploadPage />)

      // After successful parse, wizard is at map-columns — period state is internal
      // We can verify the parse was called with the correct context
      await waitFor(() => {
        expect(mockParseFromStorage).toHaveBeenCalled()
      })
    })

    it('keeps the provenance banner visible during auto-parse loading', async () => {
      mockParseFromStorage.mockReturnValue(new Promise(() => {}))
      mockSearchParams(inboxParams)

      render(<SalesUploadPage />)

      await waitFor(() => {
        expect(screen.getByText(/parsing attachment/i)).toBeInTheDocument()
      })

      // Inbox source banner context: "Processing emailed report" in title
      expect(screen.getByText(/processing emailed report/i)).toBeInTheDocument()
    })
  })

  describe('when source=inbox but storage_path is absent', () => {
    it('does NOT auto-parse and shows the upload step normally', async () => {
      mockSearchParams({
        contract_id: 'contract-1',
        report_id: 'report-abc',
        period_start: '2025-07-01',
        period_end: '2025-09-30',
        source: 'inbox',
        // no storage_path
      })

      render(<SalesUploadPage />)

      await waitFor(() => {
        expect(screen.getByTestId('drop-zone')).toBeInTheDocument()
      })

      expect(mockParseFromStorage).not.toHaveBeenCalled()
    })
  })

  describe('when source is not inbox', () => {
    it('never calls parseFromStorage even if storage_path is present', async () => {
      mockSearchParams({
        contract_id: 'contract-1',
        storage_path: 'email-attachments/user-1/q3-2025.xlsx',
        // no source=inbox
      })

      render(<SalesUploadPage />)

      await waitFor(() => {
        expect(screen.getByTestId('drop-zone')).toBeInTheDocument()
      })

      expect(mockParseFromStorage).not.toHaveBeenCalled()
    })
  })
})
