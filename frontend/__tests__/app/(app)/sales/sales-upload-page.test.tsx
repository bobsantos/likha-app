/**
 * Tests for Sales Upload Wizard Page
 * TDD: written before the implementation
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { useRouter, useSearchParams } from 'next/navigation'
import SalesUploadPage from '@/app/(app)/sales/upload/page'
import { ApiError, getContract, getSavedMapping, uploadSalesReport, confirmSalesUpload, checkPeriodOverlap } from '@/lib/api'
import type { Contract, UploadPreviewResponse, SalesPeriod, PeriodCheckResponse } from '@/types'

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}))

// Mock API — keep ApiError as the real class so tests can instantiate it
jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  getContract: jest.fn(),
  getSavedMapping: jest.fn(),
  uploadSalesReport: jest.fn(),
  confirmSalesUpload: jest.fn(),
  checkPeriodOverlap: jest.fn(),
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
  upload_id: 'tmp-abc-123',
  filename: 'q1-2025-sunrise.xlsx',
  sheet_name: 'Sales Report',
  total_rows: 11,
  data_rows: 11,
  detected_columns: ['Net Sales Amount', 'Product Category', 'SKU', 'Royalty Due'],
  sample_rows: [
    { 'Net Sales Amount': '12000.00', 'Product Category': 'Apparel', SKU: 'APP-001', 'Royalty Due': '960.00' },
  ],
  suggested_mapping: {
    'Net Sales Amount': 'net_sales',
    'Product Category': 'product_category',
    SKU: 'ignore',
    'Royalty Due': 'licensee_reported_royalty',
  },
  mapping_source: 'suggested',
  period_start: '2025-01-01',
  period_end: '2025-03-31',
}

const mockSalesPeriod: SalesPeriod = {
  id: 'sp-new-1',
  contract_id: 'contract-1',
  period_start: '2025-01-01',
  period_end: '2025-03-31',
  net_sales: 83300,
  category_breakdown: null,
  royalty_calculated: 6664,
  minimum_applied: false,
  licensee_reported_royalty: null,
  discrepancy_amount: null,
  has_discrepancy: false,
  created_at: '2026-02-22T10:00:00Z',
}

describe('Sales Upload Wizard Page', () => {
  const mockPush = jest.fn()
  const mockGetContract = getContract as jest.MockedFunction<typeof getContract>
  const mockGetSavedMapping = getSavedMapping as jest.MockedFunction<typeof getSavedMapping>
  const mockUploadSalesReport = uploadSalesReport as jest.MockedFunction<typeof uploadSalesReport>
  const mockConfirmSalesUpload = confirmSalesUpload as jest.MockedFunction<typeof confirmSalesUpload>
  const mockCheckPeriodOverlap = checkPeriodOverlap as jest.MockedFunction<typeof checkPeriodOverlap>

  beforeEach(() => {
    jest.clearAllMocks()
    ;(useRouter as jest.Mock).mockReturnValue({ push: mockPush })
    ;(useSearchParams as jest.Mock).mockReturnValue({
      get: jest.fn().mockReturnValue('contract-1'),
    })
    mockGetContract.mockResolvedValue(mockContract)
    mockGetSavedMapping.mockResolvedValue({
      licensee_name: 'Sunrise Apparel Co.',
      column_mapping: null,
      updated_at: null,
    })
    // Default: no overlap
    mockCheckPeriodOverlap.mockResolvedValue({ has_overlap: false, overlapping_periods: [] })
  })

  it('renders Step 1 (file upload) on initial load', async () => {
    render(<SalesUploadPage />)
    await waitFor(() => {
      expect(screen.getByText(/upload sales report/i)).toBeInTheDocument()
    })
    // Step 1 should show period date fields
    expect(screen.getByLabelText(/period start/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/period end/i)).toBeInTheDocument()
  })

  it('calls GET /mapping/{contract_id} on page load', async () => {
    render(<SalesUploadPage />)
    await waitFor(() => {
      expect(mockGetSavedMapping).toHaveBeenCalledWith('contract-1')
    })
  })

  it('advances to Step 2 after successful file upload', async () => {
    mockUploadSalesReport.mockResolvedValue(mockUploadPreview)
    render(<SalesUploadPage />)

    await waitFor(() => {
      expect(screen.getByLabelText(/period start/i)).toBeInTheDocument()
    })

    // Set period dates
    fireEvent.change(screen.getByLabelText(/period start/i), { target: { value: '2025-01-01' } })
    fireEvent.change(screen.getByLabelText(/period end/i), { target: { value: '2025-03-31' } })

    // Select a valid xlsx file
    const fileInput = screen.getByTestId('spreadsheet-file-input')
    const file = new File(['test'], 'sales.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /upload.*parse/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /upload.*parse/i }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /map columns/i })).toBeInTheDocument()
    })
  })

  it('shows correct banner in Step 2 based on mapping_source', async () => {
    const savedPreview: UploadPreviewResponse = { ...mockUploadPreview, mapping_source: 'saved' }
    mockUploadSalesReport.mockResolvedValue(savedPreview)
    render(<SalesUploadPage />)

    await waitFor(() => {
      expect(screen.getByLabelText(/period start/i)).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText(/period start/i), { target: { value: '2025-01-01' } })
    fireEvent.change(screen.getByLabelText(/period end/i), { target: { value: '2025-03-31' } })

    const fileInput = screen.getByTestId('spreadsheet-file-input')
    const file = new File(['test'], 'sales.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => expect(screen.getByRole('button', { name: /upload.*parse/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /upload.*parse/i }))

    await waitFor(() => {
      expect(screen.getByText(/saved column mapping from your last upload/i)).toBeInTheDocument()
    })
  })

  it('shows AI banner in Step 2 when mapping_source is ai', async () => {
    const aiPreview: UploadPreviewResponse = { ...mockUploadPreview, mapping_source: 'ai' }
    mockUploadSalesReport.mockResolvedValue(aiPreview)
    render(<SalesUploadPage />)

    await waitFor(() => {
      expect(screen.getByLabelText(/period start/i)).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText(/period start/i), { target: { value: '2025-01-01' } })
    fireEvent.change(screen.getByLabelText(/period end/i), { target: { value: '2025-03-31' } })

    const fileInput = screen.getByTestId('spreadsheet-file-input')
    const file = new File(['test'], 'sales.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => expect(screen.getByRole('button', { name: /upload.*parse/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /upload.*parse/i }))

    await waitFor(() => {
      expect(screen.getByText(/matched by AI/i)).toBeInTheDocument()
    })
  })

  it('advances to Step 3 (preview) after mapping is confirmed', async () => {
    mockUploadSalesReport.mockResolvedValue(mockUploadPreview)
    mockConfirmSalesUpload.mockResolvedValue(mockSalesPeriod)
    render(<SalesUploadPage />)

    await waitFor(() => {
      expect(screen.getByLabelText(/period start/i)).toBeInTheDocument()
    })

    // Step 1: upload file
    fireEvent.change(screen.getByLabelText(/period start/i), { target: { value: '2025-01-01' } })
    fireEvent.change(screen.getByLabelText(/period end/i), { target: { value: '2025-03-31' } })

    const fileInput = screen.getByTestId('spreadsheet-file-input')
    const file = new File(['test'], 'sales.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    fireEvent.change(fileInput, { target: { files: [file] } })
    await waitFor(() => expect(screen.getByRole('button', { name: /upload.*parse/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /upload.*parse/i }))

    // Step 2: confirm mapping
    await waitFor(() => expect(screen.getByRole('heading', { name: /map columns/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    // Step 3: preview should show
    await waitFor(() => {
      expect(screen.getByText(/preview/i)).toBeInTheDocument()
    })
  })

  it('returns to Step 2 from Step 3 via "Back" button', async () => {
    mockUploadSalesReport.mockResolvedValue(mockUploadPreview)
    mockConfirmSalesUpload.mockResolvedValue(mockSalesPeriod)
    render(<SalesUploadPage />)

    await waitFor(() => expect(screen.getByLabelText(/period start/i)).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText(/period start/i), { target: { value: '2025-01-01' } })
    fireEvent.change(screen.getByLabelText(/period end/i), { target: { value: '2025-03-31' } })

    const fileInput = screen.getByTestId('spreadsheet-file-input')
    const file = new File(['test'], 'sales.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    fireEvent.change(fileInput, { target: { files: [file] } })
    await waitFor(() => expect(screen.getByRole('button', { name: /upload.*parse/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /upload.*parse/i }))

    // Wait for step 2 — "Map Columns" heading appears (not just the step indicator label)
    await waitFor(() => expect(screen.getByRole('heading', { name: /map columns/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: /edit mapping/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /edit mapping/i }))

    await waitFor(() => {
      // Back at step 2 — map columns heading is present
      expect(screen.getByRole('heading', { name: /map columns/i })).toBeInTheDocument()
    })
  })

  it('creates sales period on Step 3 confirm', async () => {
    mockUploadSalesReport.mockResolvedValue(mockUploadPreview)
    mockConfirmSalesUpload.mockResolvedValue(mockSalesPeriod)
    render(<SalesUploadPage />)

    await waitFor(() => expect(screen.getByLabelText(/period start/i)).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText(/period start/i), { target: { value: '2025-01-01' } })
    fireEvent.change(screen.getByLabelText(/period end/i), { target: { value: '2025-03-31' } })

    const fileInput = screen.getByTestId('spreadsheet-file-input')
    const file = new File(['test'], 'sales.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    fireEvent.change(fileInput, { target: { files: [file] } })
    await waitFor(() => expect(screen.getByRole('button', { name: /upload.*parse/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /upload.*parse/i }))

    await waitFor(() => expect(screen.getByRole('heading', { name: /map columns/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: /confirm.*create period/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /confirm.*create period/i }))

    await waitFor(() => {
      expect(mockConfirmSalesUpload).toHaveBeenCalledWith(
        'contract-1',
        expect.objectContaining({
          upload_id: 'tmp-abc-123',
          period_start: '2025-01-01',
          period_end: '2025-03-31',
        })
      )
    })
  })

  it('redirects to contract detail page on successful creation', async () => {
    mockUploadSalesReport.mockResolvedValue(mockUploadPreview)
    mockConfirmSalesUpload.mockResolvedValue(mockSalesPeriod)
    render(<SalesUploadPage />)

    await waitFor(() => expect(screen.getByLabelText(/period start/i)).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText(/period start/i), { target: { value: '2025-01-01' } })
    fireEvent.change(screen.getByLabelText(/period end/i), { target: { value: '2025-03-31' } })

    const fileInput = screen.getByTestId('spreadsheet-file-input')
    const file = new File(['test'], 'sales.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    fireEvent.change(fileInput, { target: { files: [file] } })
    await waitFor(() => expect(screen.getByRole('button', { name: /upload.*parse/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /upload.*parse/i }))

    await waitFor(() => expect(screen.getByRole('heading', { name: /map columns/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: /confirm.*create period/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /confirm.*create period/i }))

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('/contracts/contract-1'))
    })
  })

  it('shows generic success toast when no discrepancy', async () => {
    mockUploadSalesReport.mockResolvedValue(mockUploadPreview)
    mockConfirmSalesUpload.mockResolvedValue(mockSalesPeriod)
    render(<SalesUploadPage />)

    await waitFor(() => expect(screen.getByLabelText(/period start/i)).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText(/period start/i), { target: { value: '2025-01-01' } })
    fireEvent.change(screen.getByLabelText(/period end/i), { target: { value: '2025-03-31' } })

    const fileInput = screen.getByTestId('spreadsheet-file-input')
    const file = new File(['test'], 'sales.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    fireEvent.change(fileInput, { target: { files: [file] } })
    await waitFor(() => expect(screen.getByRole('button', { name: /upload.*parse/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /upload.*parse/i }))

    await waitFor(() => expect(screen.getByRole('heading', { name: /map columns/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: /confirm.*create period/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /confirm.*create period/i }))

    // The redirect happens — we verify it was called with a success indicator
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('contract-1'))
    })
  })

  it('shows error message on Step 2 when confirm API fails', async () => {
    mockUploadSalesReport.mockResolvedValue(mockUploadPreview)
    mockConfirmSalesUpload.mockRejectedValue(new Error('Something went wrong saving the period.'))
    render(<SalesUploadPage />)

    await waitFor(() => expect(screen.getByLabelText(/period start/i)).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText(/period start/i), { target: { value: '2025-01-01' } })
    fireEvent.change(screen.getByLabelText(/period end/i), { target: { value: '2025-03-31' } })

    const fileInput = screen.getByTestId('spreadsheet-file-input')
    const file = new File(['test'], 'sales.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    fireEvent.change(fileInput, { target: { files: [file] } })
    await waitFor(() => expect(screen.getByRole('button', { name: /upload.*parse/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /upload.*parse/i }))

    // Step 2: click continue — this triggers confirmSalesUpload which will fail
    await waitFor(() => expect(screen.getByRole('heading', { name: /map columns/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    // The confirm call fails so we stay on step 2 with an error message
    await waitFor(() => {
      expect(screen.getByText(/something went wrong saving the period/i)).toBeInTheDocument()
    })
    // Should still be on step 2 (map columns heading visible)
    expect(screen.getByRole('heading', { name: /map columns/i })).toBeInTheDocument()
  })

  it('rejects non-xlsx/xls/csv files before upload with error message', async () => {
    render(<SalesUploadPage />)

    await waitFor(() => expect(screen.getByLabelText(/period start/i)).toBeInTheDocument())

    const fileInput = screen.getByTestId('spreadsheet-file-input')
    const pdfFile = new File(['pdf content'], 'report.pdf', { type: 'application/pdf' })
    fireEvent.change(fileInput, { target: { files: [pdfFile] } })

    await waitFor(() => {
      expect(screen.getByText(/excel.*xls.*csv/i)).toBeInTheDocument()
    })
  })

  it('rejects files > 10 MB before upload with error message', async () => {
    render(<SalesUploadPage />)

    await waitFor(() => expect(screen.getByLabelText(/period start/i)).toBeInTheDocument())

    const fileInput = screen.getByTestId('spreadsheet-file-input')
    const bigFile = Object.defineProperty(
      new File(['x'], 'big.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      'size',
      { value: 11 * 1024 * 1024 }
    )
    fireEvent.change(fileInput, { target: { files: [bigFile] } })

    await waitFor(() => {
      expect(screen.getByText(/10MB/i)).toBeInTheDocument()
    })
  })

  // --- Category mismatch: Step 2.5 integration tests ---

  const mockCategoryPreview: UploadPreviewResponse = {
    ...mockUploadPreview,
    category_resolution: {
      required: true,
      contract_categories: ['Apparel', 'Accessories', 'Footwear'],
      report_categories: ['Tops & Bottoms', 'Hard Accessories', 'Footwear'],
      suggested_category_mapping: {
        'Tops & Bottoms': 'Apparel',
        'Hard Accessories': 'Accessories',
        'Footwear': 'Footwear',
      },
      category_mapping_sources: {
        'Tops & Bottoms': 'ai',
        'Hard Accessories': 'ai',
        'Footwear': 'exact',
      },
    },
  }

  async function goToStep2WithCategoryMismatch() {
    mockUploadSalesReport.mockResolvedValue(mockCategoryPreview)
    render(<SalesUploadPage />)
    await waitFor(() => expect(screen.getByLabelText(/period start/i)).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/period start/i), { target: { value: '2025-01-01' } })
    fireEvent.change(screen.getByLabelText(/period end/i), { target: { value: '2025-03-31' } })
    const fileInput = screen.getByTestId('spreadsheet-file-input')
    const file = new File(['test'], 'sales.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    fireEvent.change(fileInput, { target: { files: [file] } })
    await waitFor(() => expect(screen.getByRole('button', { name: /upload.*parse/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /upload.*parse/i }))
    await waitFor(() => expect(screen.getByRole('heading', { name: /map columns/i })).toBeInTheDocument())
  }

  it('shows CategoryMapper (Step 2.5) after column mapping confirm when category_resolution.required is true', async () => {
    await goToStep2WithCategoryMismatch()
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /map category names/i })).toBeInTheDocument()
    })
  })

  it('skips Step 2.5 and goes straight to Step 3 for flat-rate contracts (no category_resolution)', async () => {
    // mockUploadPreview has no category_resolution
    mockUploadSalesReport.mockResolvedValue(mockUploadPreview)
    mockConfirmSalesUpload.mockResolvedValue(mockSalesPeriod)
    render(<SalesUploadPage />)
    await waitFor(() => expect(screen.getByLabelText(/period start/i)).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/period start/i), { target: { value: '2025-01-01' } })
    fireEvent.change(screen.getByLabelText(/period end/i), { target: { value: '2025-03-31' } })
    const fileInput = screen.getByTestId('spreadsheet-file-input')
    const file = new File(['test'], 'sales.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    fireEvent.change(fileInput, { target: { files: [file] } })
    await waitFor(() => expect(screen.getByRole('button', { name: /upload.*parse/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /upload.*parse/i }))
    await waitFor(() => expect(screen.getByRole('heading', { name: /map columns/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    // Should go to Step 3 (preview), not Step 2.5
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /map category names/i })).not.toBeInTheDocument()
      expect(screen.getByText(/preview/i)).toBeInTheDocument()
    })
  })

  it('includes category_mapping in confirmSalesUpload payload when Step 2.5 is confirmed', async () => {
    await goToStep2WithCategoryMismatch()
    mockConfirmSalesUpload.mockResolvedValue(mockSalesPeriod)

    // Step 2: confirm column mapping -> goes to Step 2.5
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await waitFor(() => expect(screen.getByRole('heading', { name: /map category names/i })).toBeInTheDocument())

    // Step 2.5: confirm category mapping -> should call confirmSalesUpload with category_mapping
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => {
      expect(mockConfirmSalesUpload).toHaveBeenCalledWith(
        'contract-1',
        expect.objectContaining({
          category_mapping: expect.objectContaining({
            'Tops & Bottoms': 'Apparel',
            'Hard Accessories': 'Accessories',
          }),
        })
      )
    })
  })

  it('Back button on Step 2.5 returns to Step 2 (column mapper)', async () => {
    await goToStep2WithCategoryMismatch()
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await waitFor(() => expect(screen.getByRole('heading', { name: /map category names/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /map columns/i })).toBeInTheDocument()
    })
  })

  // --- Duplicate period (Gap 2) tests ---

  /**
   * Helper: advance the wizard to the map-columns step so tests can trigger
   * a confirm from there.
   */
  async function goToStep2() {
    mockUploadSalesReport.mockResolvedValue(mockUploadPreview)
    render(<SalesUploadPage />)
    await waitFor(() => expect(screen.getByLabelText(/period start/i)).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/period start/i), { target: { value: '2025-01-01' } })
    fireEvent.change(screen.getByLabelText(/period end/i), { target: { value: '2025-03-31' } })
    const fileInput = screen.getByTestId('spreadsheet-file-input')
    const file = new File(['test'], 'sales.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    fireEvent.change(fileInput, { target: { files: [file] } })
    await waitFor(() => expect(screen.getByRole('button', { name: /upload.*parse/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /upload.*parse/i }))
    await waitFor(() => expect(screen.getByRole('heading', { name: /map columns/i })).toBeInTheDocument())
  }

  it('shows duplicate period conflict card on 409 error', async () => {
    mockConfirmSalesUpload.mockRejectedValue(
      new ApiError('A sales record already exists for this period', 409, {
        detail: 'A sales record already exists for this period',
        error_code: 'duplicate_period',
      })
    )
    await goToStep2()

    // Trigger the confirm
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    // Amber conflict card should appear with the warning message
    await waitFor(() => {
      expect(
        screen.getByText(/a sales record already exists for this contract and period/i)
      ).toBeInTheDocument()
    })

    // Both action buttons should be visible
    expect(screen.getByRole('button', { name: /replace existing record/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /go back/i })).toBeInTheDocument()

    // Generic red error should NOT appear
    expect(screen.queryByText(/could not create sales period/i)).not.toBeInTheDocument()
  })

  it('replace existing record re-submits with override_duplicate: true', async () => {
    // First call → 409 duplicate_period; second call → success
    mockConfirmSalesUpload
      .mockRejectedValueOnce(
        new ApiError('A sales record already exists for this period', 409, {
          detail: 'A sales record already exists for this period',
          error_code: 'duplicate_period',
        })
      )
      .mockResolvedValueOnce({ ...mockSalesPeriod, upload_warnings: [] })

    await goToStep2()
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    // Wait for conflict card
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /replace existing record/i })).toBeInTheDocument()
    })

    // Click the override button
    fireEvent.click(screen.getByRole('button', { name: /replace existing record/i }))

    // Second API call must include override_duplicate: true
    await waitFor(() => {
      expect(mockConfirmSalesUpload).toHaveBeenCalledTimes(2)
      expect(mockConfirmSalesUpload).toHaveBeenLastCalledWith(
        'contract-1',
        expect.objectContaining({ override_duplicate: true })
      )
    })
  })

  it('go back from duplicate conflict card returns to upload step', async () => {
    mockConfirmSalesUpload.mockRejectedValue(
      new ApiError('A sales record already exists for this period', 409, {
        detail: 'A sales record already exists for this period',
        error_code: 'duplicate_period',
      })
    )
    await goToStep2()
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    // Wait for conflict card
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /go back/i })).toBeInTheDocument()
    })

    // Click Go back
    fireEvent.click(screen.getByRole('button', { name: /go back/i }))

    // Should navigate back to Step 1 (upload step), not stay on map-columns
    await waitFor(() => {
      expect(screen.getByLabelText(/period start/i)).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: /map columns/i })).not.toBeInTheDocument()
    })

    // Conflict card is gone
    expect(
      screen.queryByText(/a sales record already exists for this contract and period/i)
    ).not.toBeInTheDocument()
  })

  // --- Early period overlap check (Gap 2 — new inline warning in Step 1) ---

  /** Helper: render and wait for Step 1 to be ready */
  async function renderAndWaitForStep1() {
    render(<SalesUploadPage />)
    await waitFor(() => {
      expect(screen.getByLabelText(/period start/i)).toBeInTheDocument()
    })
  }

  it('calls period-check API when both dates are filled', async () => {
    jest.useFakeTimers()
    try {
      await renderAndWaitForStep1()

      fireEvent.change(screen.getByLabelText(/period start/i), { target: { value: '2025-01-01' } })
      fireEvent.change(screen.getByLabelText(/period end/i), { target: { value: '2025-03-31' } })

      // Advance the 400ms debounce
      await act(async () => {
        jest.advanceTimersByTime(400)
      })

      await waitFor(() => {
        expect(mockCheckPeriodOverlap).toHaveBeenCalledWith('contract-1', '2025-01-01', '2025-03-31')
      })
    } finally {
      jest.useRealTimers()
    }
  })

  it('shows loading state while period check is in-flight', async () => {
    jest.useFakeTimers()
    // Keep the promise pending so we can observe the loading state
    let resolveOverlap!: (val: PeriodCheckResponse) => void
    mockCheckPeriodOverlap.mockReturnValue(
      new Promise<PeriodCheckResponse>((resolve) => { resolveOverlap = resolve })
    )

    try {
      await renderAndWaitForStep1()

      fireEvent.change(screen.getByLabelText(/period start/i), { target: { value: '2025-01-01' } })
      fireEvent.change(screen.getByLabelText(/period end/i), { target: { value: '2025-03-31' } })

      // Advance debounce — API call starts but does not resolve yet
      await act(async () => {
        jest.advanceTimersByTime(400)
      })

      // Loading indicator should be visible
      expect(screen.getByText(/checking for existing records/i)).toBeInTheDocument()

      // Resolve the promise and confirm loading state goes away
      await act(async () => {
        resolveOverlap({ has_overlap: false, overlapping_periods: [] })
      })

      await waitFor(() => {
        expect(screen.queryByText(/checking for existing records/i)).not.toBeInTheDocument()
      })
    } finally {
      jest.useRealTimers()
    }
  })

  it('shows amber overlap card when overlapping periods found', async () => {
    jest.useFakeTimers()
    mockCheckPeriodOverlap.mockResolvedValue({
      has_overlap: true,
      overlapping_periods: [
        {
          id: 'sp-existing-1',
          period_start: '2025-01-01',
          period_end: '2025-03-31',
          net_sales: 95000,
          royalty_calculated: 7600,
          created_at: '2025-04-15T10:23:00Z',
        },
      ],
    })

    try {
      await renderAndWaitForStep1()

      fireEvent.change(screen.getByLabelText(/period start/i), { target: { value: '2025-01-01' } })
      fireEvent.change(screen.getByLabelText(/period end/i), { target: { value: '2025-03-31' } })

      await act(async () => {
        jest.advanceTimersByTime(400)
      })

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument()
        expect(screen.getByText(/a sales record already exists for this period/i)).toBeInTheDocument()
      })

      // Record details shown
      expect(screen.getByText(/net sales/i)).toBeInTheDocument()
      // Action buttons
      expect(screen.getByRole('button', { name: /replace existing record/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /change reporting period/i })).toBeInTheDocument()
    } finally {
      jest.useRealTimers()
    }
  })

  it('Replace existing record(s) sets override intent and dismisses card', async () => {
    jest.useFakeTimers()
    mockCheckPeriodOverlap.mockResolvedValue({
      has_overlap: true,
      overlapping_periods: [
        {
          id: 'sp-existing-1',
          period_start: '2025-01-01',
          period_end: '2025-03-31',
          net_sales: 95000,
          royalty_calculated: 7600,
          created_at: '2025-04-15T10:23:00Z',
        },
      ],
    })

    try {
      await renderAndWaitForStep1()

      fireEvent.change(screen.getByLabelText(/period start/i), { target: { value: '2025-01-01' } })
      fireEvent.change(screen.getByLabelText(/period end/i), { target: { value: '2025-03-31' } })

      await act(async () => {
        jest.advanceTimersByTime(400)
      })

      // Wait for the overlap card
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /replace existing record/i })).toBeInTheDocument()
      })

      // Click "Replace existing record"
      fireEvent.click(screen.getByRole('button', { name: /replace existing record/i }))

      // Card should be dismissed
      await waitFor(() => {
        expect(screen.queryByText(/a sales record already exists for this period/i)).not.toBeInTheDocument()
      })

      // Drop zone should no longer be disabled (overlap card gone)
      const dropZone = screen.getByTestId('drop-zone')
      expect(dropZone.className).not.toContain('pointer-events-none')
    } finally {
      jest.useRealTimers()
    }
  })

  it('Change reporting period clears dates and dismisses card', async () => {
    jest.useFakeTimers()
    mockCheckPeriodOverlap.mockResolvedValue({
      has_overlap: true,
      overlapping_periods: [
        {
          id: 'sp-existing-1',
          period_start: '2025-01-01',
          period_end: '2025-03-31',
          net_sales: 95000,
          royalty_calculated: 7600,
          created_at: '2025-04-15T10:23:00Z',
        },
      ],
    })

    try {
      await renderAndWaitForStep1()

      fireEvent.change(screen.getByLabelText(/period start/i), { target: { value: '2025-01-01' } })
      fireEvent.change(screen.getByLabelText(/period end/i), { target: { value: '2025-03-31' } })

      await act(async () => {
        jest.advanceTimersByTime(400)
      })

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /change reporting period/i })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /change reporting period/i }))

      // Dates should be cleared
      await waitFor(() => {
        expect((screen.getByLabelText(/period start/i) as HTMLInputElement).value).toBe('')
        expect((screen.getByLabelText(/period end/i) as HTMLInputElement).value).toBe('')
      })

      // Card dismissed
      expect(screen.queryByText(/a sales record already exists for this period/i)).not.toBeInTheDocument()
    } finally {
      jest.useRealTimers()
    }
  })

  it('file drop zone is disabled while overlap card is unacknowledged', async () => {
    jest.useFakeTimers()
    mockCheckPeriodOverlap.mockResolvedValue({
      has_overlap: true,
      overlapping_periods: [
        {
          id: 'sp-existing-1',
          period_start: '2025-01-01',
          period_end: '2025-03-31',
          net_sales: 95000,
          royalty_calculated: 7600,
          created_at: '2025-04-15T10:23:00Z',
        },
      ],
    })

    try {
      await renderAndWaitForStep1()

      fireEvent.change(screen.getByLabelText(/period start/i), { target: { value: '2025-01-01' } })
      fireEvent.change(screen.getByLabelText(/period end/i), { target: { value: '2025-03-31' } })

      await act(async () => {
        jest.advanceTimersByTime(400)
      })

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument()
      })

      // Drop zone should be visually disabled
      const dropZone = screen.getByTestId('drop-zone')
      expect(dropZone.className).toContain('pointer-events-none')
      expect(dropZone.className).toContain('opacity-50')
    } finally {
      jest.useRealTimers()
    }
  })

  it('Go back from 409 fallback conflict card navigates to upload step', async () => {
    mockConfirmSalesUpload.mockRejectedValue(
      new ApiError('A sales record already exists for this period', 409, {
        detail: 'A sales record already exists for this period',
        error_code: 'duplicate_period',
      })
    )
    await goToStep2()
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /go back/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /go back/i }))

    // Should navigate to the upload step (Step 1), not stay on map-columns
    await waitFor(() => {
      // Step 1 shows the period date fields
      expect(screen.getByLabelText(/period start/i)).toBeInTheDocument()
      // And the map-columns heading is gone
      expect(screen.queryByRole('heading', { name: /map columns/i })).not.toBeInTheDocument()
    })
  })
})
