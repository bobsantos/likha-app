/**
 * Tests for ColumnMapper component
 * TDD: written before the implementation
 */

import { render, screen, fireEvent } from '@testing-library/react'
import ColumnMapper from '@/components/sales-upload/column-mapper'
import type { ColumnMapping, MappingSource } from '@/types'

const defaultProps = {
  detectedColumns: ['Net Sales Amount', 'Product Category', 'SKU', 'Royalty Due'],
  suggestedMapping: {
    'Net Sales Amount': 'net_sales',
    'Product Category': 'product_category',
    SKU: 'ignore',
    'Royalty Due': 'licensee_reported_royalty',
  } as ColumnMapping,
  mappingSource: 'suggested' as MappingSource,
  licenseeName: 'Sunrise Apparel Co.',
  onMappingConfirm: jest.fn(),
  onBack: jest.fn(),
}

describe('ColumnMapper component', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders one row per detected column', () => {
    render(<ColumnMapper {...defaultProps} />)
    // Each column should be shown as a code element
    // Use getAllByText for columns that may also appear in dropdown options
    expect(screen.getByText('Net Sales Amount')).toBeInTheDocument()
    expect(screen.getAllByText('Product Category').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('SKU')).toBeInTheDocument()
    expect(screen.getByText('Royalty Due')).toBeInTheDocument()
    // Verify there are exactly 4 dropdowns (one per column)
    expect(screen.getAllByRole('combobox')).toHaveLength(4)
  })

  it('shows dropdown with all Likha field options', () => {
    render(<ColumnMapper {...defaultProps} />)
    // Check that one of the selects has the correct options
    const selects = screen.getAllByRole('combobox')
    expect(selects.length).toBe(4)

    // All selects should have Net Sales option
    expect(selects[0]).toContainHTML('Net Sales')
    expect(selects[0]).toContainHTML('Gross Sales')
    expect(selects[0]).toContainHTML('Returns')
    expect(selects[0]).toContainHTML('Product Category')
    expect(selects[0]).toContainHTML('Licensee Reported Royalty')
    expect(selects[0]).toContainHTML('Territory')
    expect(selects[0]).toContainHTML('Ignore')
  })

  it('pre-selects suggested mapping values', () => {
    render(<ColumnMapper {...defaultProps} />)
    const selects = screen.getAllByRole('combobox')
    // Net Sales Amount -> net_sales
    expect(selects[0]).toHaveValue('net_sales')
    // Product Category -> product_category
    expect(selects[1]).toHaveValue('product_category')
    // SKU -> ignore
    expect(selects[2]).toHaveValue('ignore')
    // Royalty Due -> licensee_reported_royalty
    expect(selects[3]).toHaveValue('licensee_reported_royalty')
  })

  it('shows "saved mapping" banner when mappingSource is "saved"', () => {
    render(<ColumnMapper {...defaultProps} mappingSource="saved" />)
    expect(screen.getByText(/saved column mapping from your last upload/i)).toBeInTheDocument()
  })

  it('shows "keyword matched" banner when mappingSource is "suggested"', () => {
    render(<ColumnMapper {...defaultProps} mappingSource="suggested" />)
    expect(screen.getByText(/columns matched by keyword/i)).toBeInTheDocument()
  })

  it('shows "no suggestions" banner when mappingSource is "none"', () => {
    render(
      <ColumnMapper
        {...defaultProps}
        mappingSource="none"
        suggestedMapping={{ 'Net Sales Amount': 'ignore', 'Product Category': 'ignore', SKU: 'ignore', 'Royalty Due': 'ignore' }}
      />
    )
    expect(screen.getByText(/no automatic suggestions/i)).toBeInTheDocument()
  })

  it('disables "Next" button when net_sales column is not mapped', () => {
    render(
      <ColumnMapper
        {...defaultProps}
        suggestedMapping={{
          'Net Sales Amount': 'ignore',
          'Product Category': 'product_category',
          SKU: 'ignore',
          'Royalty Due': 'licensee_reported_royalty',
        }}
      />
    )
    const continueBtn = screen.getByRole('button', { name: /continue/i })
    expect(continueBtn).toBeDisabled()
  })

  it('enables "Next" button when net_sales column is mapped', () => {
    render(<ColumnMapper {...defaultProps} />)
    const continueBtn = screen.getByRole('button', { name: /continue/i })
    expect(continueBtn).not.toBeDisabled()
  })

  it('shows amber highlight on net_sales row when unmapped', () => {
    render(
      <ColumnMapper
        {...defaultProps}
        suggestedMapping={{
          'Net Sales Amount': 'ignore',
          'Product Category': 'product_category',
          SKU: 'ignore',
          'Royalty Due': 'ignore',
        }}
      />
    )
    // The required field notice should appear
    expect(screen.getByText(/net sales must be mapped to continue/i)).toBeInTheDocument()
  })

  it('"Save mapping" checkbox is rendered and checked by default', () => {
    render(<ColumnMapper {...defaultProps} />)
    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).toBeInTheDocument()
    expect(checkbox).toBeChecked()
  })

  it('calls onMappingConfirm with correct mapping object on Next click', () => {
    const onMappingConfirm = jest.fn()
    render(<ColumnMapper {...defaultProps} onMappingConfirm={onMappingConfirm} />)
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(onMappingConfirm).toHaveBeenCalledTimes(1)
    expect(onMappingConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        mapping: expect.objectContaining({ 'Net Sales Amount': 'net_sales' }),
        saveMapping: true,
      })
    )
  })

  it('"save_mapping" value is passed correctly from checkbox state', () => {
    const onMappingConfirm = jest.fn()
    render(<ColumnMapper {...defaultProps} onMappingConfirm={onMappingConfirm} />)

    // Uncheck the save mapping checkbox
    const checkbox = screen.getByRole('checkbox')
    fireEvent.click(checkbox)

    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(onMappingConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ saveMapping: false })
    )
  })

  it('allows changing a mapping via the dropdown', () => {
    const onMappingConfirm = jest.fn()
    render(<ColumnMapper {...defaultProps} onMappingConfirm={onMappingConfirm} />)

    // Change SKU from 'ignore' to 'territory'
    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[2], { target: { value: 'territory' } })

    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(onMappingConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        mapping: expect.objectContaining({ SKU: 'territory' }),
      })
    )
  })

  it('calls onBack when Back button is clicked', () => {
    const onBack = jest.fn()
    render(<ColumnMapper {...defaultProps} onBack={onBack} />)
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
