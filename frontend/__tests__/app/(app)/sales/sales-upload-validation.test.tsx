/**
 * Tests for Sales Upload Wizard form validation improvements
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { useRouter, useSearchParams } from 'next/navigation'
import SalesUploadPage from '@/app/(app)/sales/upload/page'
import { getContract, getSavedMapping, uploadSalesReport, confirmSalesUpload, checkPeriodOverlap } from '@/lib/api'
import type { Contract, UploadPreviewResponse } from '@/types'

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}))

// Mock API
jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  getContract: jest.fn(),
  getSavedMapping: jest.fn(),
  uploadSalesReport: jest.fn(),
  confirmSalesUpload: jest.fn(),
  checkPeriodOverlap: jest.fn(),
}))

// Mock toast
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

// Mock child components
jest.mock('@/components/sales-upload/column-mapper', () => ({
  __esModule: true,
  default: ({
    onMappingConfirm,
  }: {
    onMappingConfirm: (args: { mapping: Record<string, string>; saveMapping: boolean }) => void
  }) => (
    <button onClick={() => onMappingConfirm({ mapping: { 'Net Sales': 'net_sales' }, saveMapping: false })}>
      Complete Mapping
    </button>
  ),
}))

jest.mock('@/components/sales-upload/category-mapper', () => ({
  __esModule: true,
  default: ({
    onConfirm,
  }: {
    onConfirm: (args: { categoryMapping: Record<string, string>; saveAliases: boolean }) => void
  }) => (
    <button onClick={() => onConfirm({ categoryMapping: {}, saveAliases: false })}>
      Complete Category Mapping
    </button>
  ),
}))

jest.mock('@/components/sales-upload/upload-preview', () => ({
  __esModule: true,
  default: ({ onConfirm }: { onConfirm: () => void }) => (
    <button onClick={onConfirm}>Confirm Upload</button>
  ),
  MappedHeader: {},
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
  filename: 'q1-2025.xlsx',
  sheet_name: 'Sales Report',
  total_rows: 5,
  data_rows: 5,
  detected_columns: ['Net Sales'],
  sample_rows: [{ 'Net Sales': '12000.00' }],
  suggested_mapping: { 'Net Sales': 'net_sales' },
  mapping_source: 'suggested',
  period_start: null,
  period_end: null,
}

describe('Sales Upload Wizard Validation', () => {
  const mockPush = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    ;(useRouter as jest.Mock).mockReturnValue({ push: mockPush })
    ;(useSearchParams as jest.Mock).mockReturnValue({
      get: (key: string) => (key === 'contract_id' ? 'contract-1' : null),
    })
    ;(getContract as jest.Mock).mockResolvedValue(mockContract)
    ;(getSavedMapping as jest.Mock).mockResolvedValue(null)
    ;(uploadSalesReport as jest.Mock).mockResolvedValue(mockUploadPreview)
    ;(checkPeriodOverlap as jest.Mock).mockResolvedValue({ status: 'ok', overlapping_records: [] })
  })

  describe('Period date ordering', () => {
    it('shows validation error when period end is before period start and user tries to upload', async () => {
      render(<SalesUploadPage />)

      await waitFor(() => {
        expect(screen.getByLabelText(/period start/i)).toBeInTheDocument()
      })

      // Fill in dates with end before start
      await act(async () => {
        fireEvent.change(screen.getByLabelText(/period start/i), { target: { value: '2025-03-31' } })
        fireEvent.change(screen.getByLabelText(/period end/i), { target: { value: '2025-01-01' } })
      })

      // Select a valid file via the file input
      const fileInput = screen.getByTestId('spreadsheet-file-input')
      const file = new File(['data'], 'report.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [file] } })
      })

      // Click "Upload & Parse" button
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /upload.*parse/i })).toBeInTheDocument()
      })

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /upload.*parse/i }))
      })

      await waitFor(() => {
        expect(screen.getByText(/period end date must be after the start date/i)).toBeInTheDocument()
      })
    })

    it('does not show date error when period end is after period start', async () => {
      render(<SalesUploadPage />)

      await waitFor(() => {
        expect(screen.getByLabelText(/period start/i)).toBeInTheDocument()
      })

      await act(async () => {
        fireEvent.change(screen.getByLabelText(/period start/i), { target: { value: '2025-01-01' } })
        fireEvent.change(screen.getByLabelText(/period end/i), { target: { value: '2025-03-31' } })
      })

      expect(screen.queryByText(/period end date must be after the start date/i)).not.toBeInTheDocument()
    })
  })

  describe('Toast on confirm success', () => {
    it('shows toast.success with "Sales period saved" after successful confirm', async () => {
      ;(confirmSalesUpload as jest.Mock).mockResolvedValue({
        id: 'sp-new-1',
        contract_id: 'contract-1',
        period_start: '2025-01-01',
        period_end: '2025-03-31',
        net_sales: 83300,
        royalty_calculated: 6664,
        minimum_applied: false,
        licensee_reported_royalty: null,
        discrepancy_amount: null,
        has_discrepancy: false,
        created_at: '2025-04-01T00:00:00Z',
        upload_warnings: [],
      })

      render(<SalesUploadPage />)

      await waitFor(() => {
        expect(screen.getByLabelText(/period start/i)).toBeInTheDocument()
      })

      // Set valid dates
      await act(async () => {
        fireEvent.change(screen.getByLabelText(/period start/i), { target: { value: '2025-01-01' } })
        fireEvent.change(screen.getByLabelText(/period end/i), { target: { value: '2025-03-31' } })
      })

      // Select file via file input
      const fileInput = screen.getByTestId('spreadsheet-file-input')
      const file = new File(['data'], 'report.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [file] } })
      })

      // Click "Upload & Parse"
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /upload.*parse/i })).toBeInTheDocument()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /upload.*parse/i }))
      })

      // Complete mapping step
      await waitFor(() => {
        expect(screen.getByText('Complete Mapping')).toBeInTheDocument()
      })
      await act(async () => {
        fireEvent.click(screen.getByText('Complete Mapping'))
      })

      // Confirm upload in preview step
      await waitFor(() => {
        expect(screen.getByText('Confirm Upload')).toBeInTheDocument()
      })
      await act(async () => {
        fireEvent.click(screen.getByText('Confirm Upload'))
      })

      await waitFor(() => {
        expect(mockToastSuccess).toHaveBeenCalledWith('Sales period saved')
      })
    })
  })

  // Note: Zero net sales warning is shown within the UploadPreview component
  // when the aggregated net_sales total is $0.00. This is tested separately
  // in upload-preview.test.tsx where the component receives the preview data.
})
