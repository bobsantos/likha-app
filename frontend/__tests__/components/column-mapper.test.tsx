/**
 * Tests for ColumnMapper component
 * TDD: written before the implementation
 */

import { render, screen, fireEvent, act } from '@testing-library/react'
import ColumnMapper from '@/components/sales-upload/column-mapper'
import type { ColumnMapping, MappingSource } from '@/types'

const sampleRows = [
  { 'Net Sales Amount': '12000.00', 'Product Category': 'Apparel', SKU: 'APP-001', 'Royalty Due': '960.00' },
  { 'Net Sales Amount': '8500.00', 'Product Category': 'Accessories', SKU: 'ACC-001', 'Royalty Due': '680.00' },
  { 'Net Sales Amount': '5200.00', 'Product Category': 'Apparel', SKU: 'APP-002', 'Royalty Due': '416.00' },
]

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
  sampleRows,
  totalRows: 42,
  onMappingConfirm: jest.fn(),
  onBack: jest.fn(),
}

describe('ColumnMapper component', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders one row per detected column', () => {
    render(<ColumnMapper {...defaultProps} />)
    // Column names appear both in mapping controls and preview table headers — use getAllByText
    expect(screen.getAllByText('Net Sales Amount').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Product Category').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('SKU').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Royalty Due').length).toBeGreaterThanOrEqual(1)
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

  it('shows "AI matched" banner when mappingSource is "ai"', () => {
    render(<ColumnMapper {...defaultProps} mappingSource="ai" />)
    expect(screen.getByText(/matched by AI/i)).toBeInTheDocument()
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

  // --- New tests for raw data preview table (Change 2) ---

  it('renders raw data preview table below mapping controls', () => {
    render(<ColumnMapper {...defaultProps} />)
    // The label for the preview table should appear
    expect(screen.getByText(/raw data from your file/i)).toBeInTheDocument()
  })

  it('preview table shows detected column names as headers (not Likha field names)', () => {
    render(<ColumnMapper {...defaultProps} />)
    // Raw column names from the file should appear as table headers
    // Use getAllByText since column names may also appear in the mapping controls
    expect(screen.getAllByText('Net Sales Amount').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Product Category').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('SKU').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Royalty Due').length).toBeGreaterThanOrEqual(1)
    // Likha field labels should NOT appear as table headers (they appear only in dropdowns)
    // "Net Sales" is an option label — the table header should be the raw name
    const tableHeaders = screen.getAllByRole('columnheader')
    const headerTexts = tableHeaders.map((th) => th.textContent)
    expect(headerTexts).toContain('Net Sales Amount')
    expect(headerTexts).not.toContain('net_sales')
  })

  it('preview table shows sample row data', () => {
    render(<ColumnMapper {...defaultProps} />)
    // Values appear in both the inline sample strip and the preview table
    expect(screen.getAllByText('12000.00').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('8500.00').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('APP-001').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('960.00').length).toBeGreaterThanOrEqual(1)
  })

  it('preview table shows up to 5 sample rows', () => {
    const sixRows = [
      { 'Net Sales Amount': '1000.00', 'Product Category': 'A', SKU: 'S1', 'Royalty Due': '80.00' },
      { 'Net Sales Amount': '2000.00', 'Product Category': 'B', SKU: 'S2', 'Royalty Due': '160.00' },
      { 'Net Sales Amount': '3000.00', 'Product Category': 'C', SKU: 'S3', 'Royalty Due': '240.00' },
      { 'Net Sales Amount': '4000.00', 'Product Category': 'D', SKU: 'S4', 'Royalty Due': '320.00' },
      { 'Net Sales Amount': '5000.00', 'Product Category': 'E', SKU: 'S5', 'Royalty Due': '400.00' },
      { 'Net Sales Amount': '6000.00', 'Product Category': 'F', SKU: 'S6', 'Royalty Due': '480.00' },
    ]
    render(<ColumnMapper {...defaultProps} sampleRows={sixRows} totalRows={100} />)
    // Should show at most 5 rows — the 6th row value should not appear
    expect(screen.queryByText('6000.00')).not.toBeInTheDocument()
    // First 5 rows should be present
    expect(screen.getByText('5000.00')).toBeInTheDocument()
  })

  it('preview table shows correct row count label "showing N of M rows"', () => {
    render(<ColumnMapper {...defaultProps} sampleRows={sampleRows} totalRows={42} />)
    // Label should say showing 3 of 42 rows (3 sample rows, 42 total)
    expect(screen.getByText(/showing 3 of 42 rows/i)).toBeInTheDocument()
  })

  it('preview table does not update when mapping dropdown values change', () => {
    render(<ColumnMapper {...defaultProps} />)
    // Raw value should be present before any change (may appear in inline strip + preview table)
    expect(screen.getAllByText('12000.00').length).toBeGreaterThanOrEqual(1)

    // Change a dropdown
    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[0], { target: { value: 'gross_sales' } })

    // Raw data should still be present unchanged
    expect(screen.getAllByText('12000.00').length).toBeGreaterThanOrEqual(1)
    // The column header in the raw table should still show the original file column name
    const tableHeaders = screen.getAllByRole('columnheader')
    const headerTexts = tableHeaders.map((th) => th.textContent)
    expect(headerTexts).toContain('Net Sales Amount')
  })

  // --- New tests for new mapping options (Change 1) ---

  it('new mapping options appear in dropdowns: Report Period, Licensee Name, Royalty Rate', () => {
    render(<ColumnMapper {...defaultProps} />)
    const selects = screen.getAllByRole('combobox')
    // All selects should include the three new options
    expect(selects[0]).toContainHTML('Report Period')
    expect(selects[0]).toContainHTML('Licensee Name')
    expect(selects[0]).toContainHTML('Royalty Rate')
  })

  it('can map a column to report_period', () => {
    const onMappingConfirm = jest.fn()
    render(<ColumnMapper {...defaultProps} onMappingConfirm={onMappingConfirm} />)
    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[2], { target: { value: 'report_period' } })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(onMappingConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        mapping: expect.objectContaining({ SKU: 'report_period' }),
      })
    )
  })

  it('can map a column to licensee_name', () => {
    const onMappingConfirm = jest.fn()
    render(<ColumnMapper {...defaultProps} onMappingConfirm={onMappingConfirm} />)
    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[2], { target: { value: 'licensee_name' } })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(onMappingConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        mapping: expect.objectContaining({ SKU: 'licensee_name' }),
      })
    )
  })

  it('can map a column to royalty_rate', () => {
    const onMappingConfirm = jest.fn()
    render(<ColumnMapper {...defaultProps} onMappingConfirm={onMappingConfirm} />)
    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[2], { target: { value: 'royalty_rate' } })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(onMappingConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        mapping: expect.objectContaining({ SKU: 'royalty_rate' }),
      })
    )
  })

  // --- Phase 1.1.1: Inline sample values, metadata option, dedup ---

  it('shows sample values inline in a third column for each mapping row', () => {
    render(<ColumnMapper {...defaultProps} />)
    // First 3 values for 'Net Sales Amount' column should appear in the inline strip
    // They also appear in the preview table, so just check they are present
    expect(screen.getAllByText('12000.00').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('8500.00').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('5200.00').length).toBeGreaterThanOrEqual(1)
  })

  it('shows "Keep as additional data" option in each dropdown', () => {
    render(<ColumnMapper {...defaultProps} />)
    const selects = screen.getAllByRole('combobox')
    expect(selects[0]).toContainHTML('Keep as additional data')
    expect(selects[1]).toContainHTML('Keep as additional data')
  })

  it('dropdown contains optgroup elements for Royalty Fields and Other', () => {
    render(<ColumnMapper {...defaultProps} />)
    // optgroup labels render as text content in the select's HTML
    const selects = screen.getAllByRole('combobox')
    expect(selects[0]).toContainHTML('Royalty Fields')
    expect(selects[0]).toContainHTML('Other')
  })

  it('select element has violet styling classes when mapped to metadata', () => {
    render(<ColumnMapper {...defaultProps} />)
    const selects = screen.getAllByRole('combobox')
    // Change SKU (index 2) to metadata
    fireEvent.change(selects[2], { target: { value: 'metadata' } })
    // After change, the select for SKU should have violet styling
    const updatedSelects = screen.getAllByRole('combobox')
    expect(updatedSelects[2].className).toMatch(/violet/)
  })

  it('metadata callout appears when at least one column is mapped to metadata', () => {
    render(<ColumnMapper {...defaultProps} />)
    // Initially no metadata mapping — callout should not be visible
    expect(
      screen.queryByText(/columns marked "keep as additional data" will be saved/i)
    ).not.toBeInTheDocument()

    // Map SKU to metadata
    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[2], { target: { value: 'metadata' } })

    // Callout should now appear
    expect(
      screen.getByText(/columns marked "keep as additional data" will be saved/i)
    ).toBeInTheDocument()
  })

  it('metadata callout disappears when the last metadata column is re-mapped', () => {
    render(<ColumnMapper {...defaultProps} />)
    const selects = screen.getAllByRole('combobox')

    // Map SKU to metadata
    fireEvent.change(selects[2], { target: { value: 'metadata' } })
    expect(
      screen.getByText(/columns marked "keep as additional data" will be saved/i)
    ).toBeInTheDocument()

    // Re-map SKU back to ignore
    fireEvent.change(selects[2], { target: { value: 'ignore' } })
    expect(
      screen.queryByText(/columns marked "keep as additional data" will be saved/i)
    ).not.toBeInTheDocument()
  })

  it('deduplication: selecting a unique field on a 2nd column clears the 1st column', () => {
    render(<ColumnMapper {...defaultProps} />)
    // Initially: Net Sales Amount = net_sales (index 0), SKU = ignore (index 2)
    const selects = screen.getAllByRole('combobox')
    expect(selects[0]).toHaveValue('net_sales')
    expect(selects[2]).toHaveValue('ignore')

    // Map SKU to net_sales — should clear Net Sales Amount back to ignore
    fireEvent.change(selects[2], { target: { value: 'net_sales' } })

    const updatedSelects = screen.getAllByRole('combobox')
    expect(updatedSelects[2]).toHaveValue('net_sales')
    expect(updatedSelects[0]).toHaveValue('ignore')
  })

  it('metadata is exempt from dedup — multiple columns can be mapped to metadata', () => {
    render(<ColumnMapper {...defaultProps} />)
    const selects = screen.getAllByRole('combobox')

    // Map SKU to metadata
    fireEvent.change(selects[2], { target: { value: 'metadata' } })
    // Map Royalty Due to metadata as well
    fireEvent.change(selects[3], { target: { value: 'metadata' } })

    const updatedSelects = screen.getAllByRole('combobox')
    // Both should remain as metadata without clearing each other
    expect(updatedSelects[2]).toHaveValue('metadata')
    expect(updatedSelects[3]).toHaveValue('metadata')
  })

  it('ignore is exempt from dedup — multiple columns can be mapped to ignore', () => {
    render(
      <ColumnMapper
        {...defaultProps}
        suggestedMapping={{
          'Net Sales Amount': 'net_sales',
          'Product Category': 'ignore',
          SKU: 'ignore',
          'Royalty Due': 'ignore',
        }}
      />
    )
    // Three columns mapped to ignore — all should remain ignored
    const selects = screen.getAllByRole('combobox')
    expect(selects[1]).toHaveValue('ignore')
    expect(selects[2]).toHaveValue('ignore')
    expect(selects[3]).toHaveValue('ignore')
  })

  it('aria-live region announces deduplication when it occurs', async () => {
    render(<ColumnMapper {...defaultProps} />)
    // Initially no dedup message
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    // Trigger dedup: SKU -> net_sales (clears Net Sales Amount)
    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[2], { target: { value: 'net_sales' } })

    // An aria-live status region should appear
    const statusRegion = screen.getByRole('status')
    expect(statusRegion).toBeInTheDocument()
    // Should contain some text describing the dedup
    expect(statusRegion.textContent).toBeTruthy()
  })

  it('can map a column to metadata and submit', () => {
    const onMappingConfirm = jest.fn()
    render(<ColumnMapper {...defaultProps} onMappingConfirm={onMappingConfirm} />)
    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[2], { target: { value: 'metadata' } })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(onMappingConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        mapping: expect.objectContaining({ SKU: 'metadata' }),
      })
    )
  })

  // --- Per-column mapping source badges ---

  describe('per-column mapping source badges', () => {
    const mappingSources: Record<string, 'keyword' | 'ai' | 'none'> = {
      'Net Sales Amount': 'ai',
      'Product Category': 'keyword',
      SKU: 'none',
      'Royalty Due': 'ai',
    }

    it('renders "AI" badge for columns with source "ai"', () => {
      render(<ColumnMapper {...defaultProps} mappingSources={mappingSources} />)
      // Two columns have source "ai" — there should be two "AI" badges
      const badges = screen.getAllByText('AI')
      expect(badges.length).toBe(2)
    })

    it('renders "Auto" badge for columns with source "keyword"', () => {
      render(<ColumnMapper {...defaultProps} mappingSources={mappingSources} />)
      const badge = screen.getByText('Auto')
      expect(badge).toBeInTheDocument()
    })

    it('renders no badge for columns with source "none"', () => {
      // Only one column has source "none" (SKU). Since no badge is rendered for "none",
      // verify by checking the total badge count: 2 "AI" + 1 "Auto" = 3 badges total.
      render(<ColumnMapper {...defaultProps} mappingSources={mappingSources} />)
      const aiBadges = screen.getAllByText('AI')
      const autoBadges = screen.getAllByText('Auto')
      expect(aiBadges.length + autoBadges.length).toBe(3)
    })

    it('works without mappingSources prop (backwards compatible)', () => {
      // No mappingSources passed — no badges should appear, component should not crash
      render(<ColumnMapper {...defaultProps} />)
      expect(screen.queryByText('AI')).not.toBeInTheDocument()
      expect(screen.queryByText('Auto')).not.toBeInTheDocument()
    })
  })
})
