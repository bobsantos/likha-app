/**
 * Tests for UploadPreview component
 * TDD: written before the implementation
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import UploadPreview from '@/components/sales-upload/upload-preview'
import type { SalesPeriod } from '@/types'

const sampleRows = [
  { 'Net Sales Amount': '12000.00', 'Product Category': 'Apparel', 'Royalty Due': '960.00' },
  { 'Net Sales Amount': '17850.00', 'Product Category': 'Accessories', 'Royalty Due': '1428.00' },
]

const mappedHeaders = [
  { originalColumn: 'Net Sales Amount', field: 'net_sales', label: 'Net Sales' },
  { originalColumn: 'Product Category', field: 'product_category', label: 'Product Category' },
  { originalColumn: 'Royalty Due', field: 'licensee_reported_royalty', label: 'Licensee Reported Royalty' },
]

const defaultSalesPeriod: SalesPeriod = {
  id: 'sp-1',
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

const defaultProps = {
  sampleRows,
  mappedHeaders,
  totalRows: 11,
  salesPeriod: defaultSalesPeriod,
  onConfirm: jest.fn(),
  onBack: jest.fn(),
  confirming: false,
  confirmError: null,
}

describe('UploadPreview component', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders sample rows with mapped column labels as headers', () => {
    render(<UploadPreview {...defaultProps} />)
    // Mapped headers should appear as column headers — use getAllByText since labels may appear multiple times
    expect(screen.getAllByText('Net Sales').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Product Category').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Licensee Reported Royalty').length).toBeGreaterThanOrEqual(1)
    // Sample row data
    expect(screen.getByText('12000.00')).toBeInTheDocument()
    expect(screen.getAllByText('Apparel').length).toBeGreaterThanOrEqual(1)
  })

  it('renders aggregated net sales total', () => {
    render(<UploadPreview {...defaultProps} />)
    // $83,300.00 as the total net sales — use getAllByText since the value appears in multiple places
    expect(screen.getAllByText(/83,300/).length).toBeGreaterThanOrEqual(1)
  })

  it('renders calculated royalty card for flat rate contract', () => {
    render(<UploadPreview {...defaultProps} />)
    expect(screen.getByText(/royalty calculation/i)).toBeInTheDocument()
    expect(screen.getByText(/6,664/)).toBeInTheDocument()
  })

  it('renders per-category breakdown for category-rate contract', () => {
    const periodWithCategories: SalesPeriod = {
      ...defaultSalesPeriod,
      category_breakdown: { Apparel: 61800, Accessories: 29450 },
    }
    render(<UploadPreview {...defaultProps} salesPeriod={periodWithCategories} />)
    // Category names may appear multiple times (in both table and breakdown)
    expect(screen.getAllByText('Apparel').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/61,800/)).toBeInTheDocument()
    expect(screen.getAllByText('Accessories').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/29,450/)).toBeInTheDocument()
  })

  it('renders discrepancy card when has_discrepancy is true', () => {
    const periodWithDiscrepancy: SalesPeriod = {
      ...defaultSalesPeriod,
      licensee_reported_royalty: 6384,
      discrepancy_amount: 280,
      has_discrepancy: true,
    }
    render(<UploadPreview {...defaultProps} salesPeriod={periodWithDiscrepancy} />)
    expect(screen.getByText(/under-reported/i)).toBeInTheDocument()
    expect(screen.getByText(/280/)).toBeInTheDocument()
  })

  it('renders no discrepancy card when has_discrepancy is false', () => {
    render(<UploadPreview {...defaultProps} />)
    expect(screen.queryByText(/under-reported/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/over-reported/i)).not.toBeInTheDocument()
  })

  it('renders no discrepancy card when licensee_reported_royalty is null', () => {
    render(<UploadPreview {...defaultProps} />)
    // The royalty calculation card's "Licensee Reported" row should not appear
    // (the table header "Licensee Reported Royalty" may still appear from mapped columns)
    expect(screen.queryByText(/under-reported/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/over-reported/i)).not.toBeInTheDocument()
  })

  it('"Confirm" button is present and enabled', () => {
    render(<UploadPreview {...defaultProps} />)
    const confirmBtn = screen.getByRole('button', { name: /confirm/i })
    expect(confirmBtn).toBeInTheDocument()
    expect(confirmBtn).not.toBeDisabled()
  })

  it('"Back to Column Mapping" link/button is present', () => {
    render(<UploadPreview {...defaultProps} />)
    expect(screen.getByRole('button', { name: /edit mapping/i })).toBeInTheDocument()
  })

  it('calls onConfirm when Confirm is clicked', () => {
    const onConfirm = jest.fn()
    render(<UploadPreview {...defaultProps} onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('shows loading state while confirm request is in flight', () => {
    render(<UploadPreview {...defaultProps} confirming={true} />)
    expect(screen.getByText(/creating period/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /creating period/i })).toBeDisabled()
  })

  it('shows error message inline when confirm returns an error', () => {
    render(
      <UploadPreview
        {...defaultProps}
        confirmError="Something went wrong saving the period."
      />
    )
    expect(screen.getByText(/something went wrong saving the period/i)).toBeInTheDocument()
  })

  it('calls onBack when Edit Mapping button is clicked', () => {
    const onBack = jest.fn()
    render(<UploadPreview {...defaultProps} onBack={onBack} />)
    fireEvent.click(screen.getByRole('button', { name: /edit mapping/i }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('shows row count when total rows exceed sample size', () => {
    render(<UploadPreview {...defaultProps} totalRows={50} />)
    expect(screen.getByText(/50 rows total/i)).toBeInTheDocument()
  })

  it('shows over-reported discrepancy message when licensee over-reported', () => {
    const periodOverReported: SalesPeriod = {
      ...defaultSalesPeriod,
      licensee_reported_royalty: 7000,
      discrepancy_amount: -336,
      has_discrepancy: true,
    }
    render(<UploadPreview {...defaultProps} salesPeriod={periodOverReported} />)
    expect(screen.getByText(/over-reported/i)).toBeInTheDocument()
  })
})
