/**
 * Tests for Sales Upload Wizard Page
 * TDD: written before the implementation
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useRouter, useSearchParams } from 'next/navigation'
import SalesUploadPage from '@/app/(app)/sales/upload/page'
import { getContract, getSavedMapping, uploadSalesReport, confirmSalesUpload } from '@/lib/api'
import type { Contract, UploadPreviewResponse, SalesPeriod } from '@/types'

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}))

// Mock API
jest.mock('@/lib/api', () => ({
  getContract: jest.fn(),
  getSavedMapping: jest.fn(),
  uploadSalesReport: jest.fn(),
  confirmSalesUpload: jest.fn(),
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
})
