/**
 * Tests for ContractCard component
 */

import { render, screen } from '@testing-library/react'
import ContractCard from '@/components/ContractCard'
import type { Contract } from '@/types'

describe('ContractCard Component', () => {
  const mockContract: Contract = {
    id: 'contract-1',
    user_id: 'user-1',
    status: 'active',
    filename: 'acme-contract.pdf',
    licensee_name: 'Acme Corp',
    contract_start_date: '2024-01-01',
    contract_end_date: '2025-12-31',
    royalty_rate: 0.15,
    royalty_base: 'net_sales',
    territories: ['US', 'Canada'],
    product_categories: null,
    minimum_guarantee: 5000,
    minimum_guarantee_period: 'quarterly',
    advance_payment: null,
    reporting_frequency: 'quarterly',
    pdf_url: 'https://example.com/contract.pdf',
    extracted_terms: null,
    storage_path: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  }

  it('renders licensee name', () => {
    render(<ContractCard contract={mockContract} />)
    expect(screen.getByText('Acme Corp')).toBeInTheDocument()
  })

  it('displays royalty rate as percentage when numeric, with base context', () => {
    render(<ContractCard contract={mockContract} />)
    // mockContract has royalty_rate: 0.15, royalty_base: 'net_sales'
    expect(screen.getByText('15% of Net Sales')).toBeInTheDocument()
    expect(screen.getByText('Royalty Rate:')).toBeInTheDocument()
  })

  // Bug fix: royalty_rate is stored as a string in the DB (e.g. "8%", "10.0%")
  // and the backend returns it as-is. formatRoyaltyRate must handle strings directly.
  it('displays string royalty_rate directly (e.g. "8%"), with base context', () => {
    render(<ContractCard contract={{ ...mockContract, royalty_rate: '8%' }} />)
    // royalty_base is 'net_sales' from mockContract
    expect(screen.getByText('8% of Net Sales')).toBeInTheDocument()
  })

  it('displays string royalty_rate with descriptor (e.g. "15% of net sales") without appending base when base is null', () => {
    render(<ContractCard contract={{ ...mockContract, royalty_rate: '15% of net sales', royalty_base: null }} />)
    expect(screen.getByText('15% of net sales')).toBeInTheDocument()
  })

  it('displays string royalty_rate with decimal (e.g. "10.0%"), with base context', () => {
    render(<ContractCard contract={{ ...mockContract, royalty_rate: '10.0%' }} />)
    // royalty_base is 'net_sales' from mockContract
    expect(screen.getByText('10.0% of Net Sales')).toBeInTheDocument()
  })

  // Bug fix: bare number strings (no "%") should have "%" appended
  it('appends "%" to bare integer string royalty_rate (e.g. "8"), with base context', () => {
    render(<ContractCard contract={{ ...mockContract, royalty_rate: '8' }} />)
    // royalty_base is 'net_sales' from mockContract
    expect(screen.getByText('8% of Net Sales')).toBeInTheDocument()
  })

  it('appends "%" to bare decimal string royalty_rate (e.g. "10.5"), with base context', () => {
    render(<ContractCard contract={{ ...mockContract, royalty_rate: '10.5' }} />)
    // royalty_base is 'net_sales' from mockContract
    expect(screen.getByText('10.5% of Net Sales')).toBeInTheDocument()
  })

  it('does not double-append "%" to string royalty_rate that already contains "%"', () => {
    render(<ContractCard contract={{ ...mockContract, royalty_rate: '8%' }} />)
    expect(screen.getByText('8% of Net Sales')).toBeInTheDocument()
    expect(screen.queryByText('8%% of Net Sales')).not.toBeInTheDocument()
  })

  it('shows contract period dates', () => {
    render(<ContractCard contract={mockContract} />)
    expect(screen.getByText(/Jan 1, 2024/)).toBeInTheDocument()
    expect(screen.getByText(/Dec 31, 2025/)).toBeInTheDocument()
  })

  it('displays territories', () => {
    render(<ContractCard contract={mockContract} />)
    expect(screen.getByText('US, Canada')).toBeInTheDocument()
  })

  it('shows minimum guarantee when present', () => {
    render(<ContractCard contract={mockContract} />)
    expect(screen.getByText('$5,000')).toBeInTheDocument()
  })

  it('handles tiered royalty rate, with base context', () => {
    const tierContract = {
      ...mockContract,
      royalty_rate: {
        type: 'tiered' as const,
        tiers: [
          { min: 0, max: 10000, rate: 0.1 },
          { min: 10000, max: null, rate: 0.15 },
        ],
      },
      // royalty_base: 'net_sales' from mockContract
    }

    render(<ContractCard contract={tierContract} />)
    expect(screen.getByText('10-15% of Net Sales')).toBeInTheDocument()
  })

  it('handles category-specific rates (typed CategoryRate shape), shows min-max range without base suffix', () => {
    const categoryContract = {
      ...mockContract,
      royalty_rate: {
        type: 'category' as const,
        rates: {
          'Books': 0.15,
          'Merchandise': 0.10,
        },
      },
      // royalty_base: 'net_sales' from mockContract — suppressed for category rates
    }

    render(<ContractCard contract={categoryContract} />)
    // Shows the range from the rates values; base suffix is intentionally omitted
    expect(screen.getByText('10-15% (Per Category)')).toBeInTheDocument()
  })

  it('handles plain dict category rates from the backend, shows min-max range without base suffix', () => {
    const plainDictContract = {
      ...mockContract,
      royalty_rate: { Apparel: '10%', Accessories: '12%', Footwear: '8%' } as unknown as import('@/types').RoyaltyRate,
      // royalty_base: 'net_sales' from mockContract — suppressed for category rates
    }

    render(<ContractCard contract={plainDictContract} />)
    expect(screen.getByText('8-12% (Per Category)')).toBeInTheDocument()
  })

  it('links to contract detail page', () => {
    render(<ContractCard contract={mockContract} />)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/contracts/contract-1')
  })

  // Phase 3: status-aware badge tests
  it('shows "Active" badge for active contracts', () => {
    render(<ContractCard contract={mockContract} />)
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('shows "Draft" badge for draft contracts', () => {
    const draftContract: Contract = {
      ...mockContract,
      id: 'draft-1',
      status: 'draft',
      licensee_name: null,
      royalty_rate: null,
      royalty_base: null,
      reporting_frequency: null,
      contract_start_date: null,
      contract_end_date: null,
    }
    render(<ContractCard contract={draftContract} />)
    expect(screen.getByText('Draft')).toBeInTheDocument()
    expect(screen.queryByText('Active')).not.toBeInTheDocument()
  })

  it('shows "Resume review" CTA for draft contracts', () => {
    const draftContract: Contract = {
      ...mockContract,
      id: 'draft-1',
      status: 'draft',
      licensee_name: null,
      royalty_rate: null,
      royalty_base: null,
      reporting_frequency: null,
      contract_start_date: null,
      contract_end_date: null,
    }
    render(<ContractCard contract={draftContract} />)
    expect(screen.getByText(/resume review/i)).toBeInTheDocument()
    expect(screen.queryByText(/view details/i)).not.toBeInTheDocument()
  })

  it('shows "View details" CTA for active contracts', () => {
    render(<ContractCard contract={mockContract} />)
    expect(screen.getByText(/view details/i)).toBeInTheDocument()
    expect(screen.queryByText(/resume review/i)).not.toBeInTheDocument()
  })

  it('draft card links to upload resume URL', () => {
    const draftContract: Contract = {
      ...mockContract,
      id: 'draft-1',
      status: 'draft',
      licensee_name: null,
      royalty_rate: null,
      royalty_base: null,
      reporting_frequency: null,
      contract_start_date: null,
      contract_end_date: null,
    }
    render(<ContractCard contract={draftContract} />)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/contracts/upload?draft=draft-1')
  })

  // extracted_terms fallback for draft title
  it('falls back to extracted_terms.licensee_name when licensee_name is null', () => {
    const draftContract: Contract = {
      ...mockContract,
      id: 'draft-1',
      status: 'draft',
      licensee_name: null,
      royalty_rate: null,
      royalty_base: null,
      reporting_frequency: null,
      contract_start_date: null,
      contract_end_date: null,
      extracted_terms: { licensee_name: 'Extracted Corp' },
    }
    render(<ContractCard contract={draftContract} />)
    expect(screen.getByText('Extracted Corp')).toBeInTheDocument()
  })

  it('falls back to filename when both licensee_name and extracted_terms.licensee_name are null', () => {
    const draftContract: Contract = {
      ...mockContract,
      id: 'draft-1',
      status: 'draft',
      licensee_name: null,
      royalty_rate: null,
      royalty_base: null,
      reporting_frequency: null,
      contract_start_date: null,
      contract_end_date: null,
      extracted_terms: { licensee_name: null },
      filename: 'my-draft.pdf',
    }
    render(<ContractCard contract={draftContract} />)
    expect(screen.getByText('my-draft.pdf')).toBeInTheDocument()
  })

  it('shows "Untitled Draft" when licensee_name, extracted_terms.licensee_name, and filename are all null', () => {
    const draftContract: Contract = {
      ...mockContract,
      id: 'draft-1',
      status: 'draft',
      licensee_name: null,
      royalty_rate: null,
      royalty_base: null,
      reporting_frequency: null,
      contract_start_date: null,
      contract_end_date: null,
      extracted_terms: null,
      filename: null,
    }
    render(<ContractCard contract={draftContract} />)
    expect(screen.getByText('Untitled Draft')).toBeInTheDocument()
  })

  it('active contract licensee_name takes precedence over extracted_terms.licensee_name', () => {
    const contractWithBoth: Contract = {
      ...mockContract,
      licensee_name: 'Acme Corp',
      extracted_terms: { licensee_name: 'Should Not Show' },
    }
    render(<ContractCard contract={contractWithBoth} />)
    expect(screen.getByText('Acme Corp')).toBeInTheDocument()
    expect(screen.queryByText('Should Not Show')).not.toBeInTheDocument()
  })

  // "Uploaded on" date shown for draft contracts
  it('shows "Uploaded on" date for draft contracts', () => {
    const draftContract: Contract = {
      ...mockContract,
      id: 'draft-1',
      status: 'draft',
      licensee_name: null,
      royalty_rate: null,
      royalty_base: null,
      reporting_frequency: null,
      contract_start_date: null,
      contract_end_date: null,
      created_at: '2026-02-15T10:30:00Z',
    }
    render(<ContractCard contract={draftContract} />)
    expect(screen.getByText(/Uploaded on/i)).toBeInTheDocument()
    expect(screen.getByText(/Feb 15, 2026/)).toBeInTheDocument()
  })

  it('does not show "Uploaded on" for active contracts', () => {
    render(<ContractCard contract={mockContract} />)
    expect(screen.queryByText(/Uploaded on/i)).not.toBeInTheDocument()
  })

  // Draft card metadata suppression
  describe('draft card hides metadata fields', () => {
    const draftContract: Contract = {
      ...mockContract,
      id: 'draft-1',
      status: 'draft',
      licensee_name: 'Draft Licensee',
      royalty_rate: 0.15,
      royalty_base: null,
      reporting_frequency: 'quarterly',
      contract_start_date: '2023-03-15',
      contract_end_date: '2026-06-30',
      territories: ['US'],
      minimum_guarantee: 5000,
      created_at: '2024-01-01T00:00:00Z',
    }

    it('does not show royalty rate row on draft cards', () => {
      render(<ContractCard contract={draftContract} />)
      expect(screen.queryByText('Royalty Rate:')).not.toBeInTheDocument()
      // The draft contract has royalty_rate 0.15 but the row is suppressed entirely
      expect(screen.queryByText('15%')).not.toBeInTheDocument()
    })

    it('does not show contract period row on draft cards', () => {
      render(<ContractCard contract={draftContract} />)
      expect(screen.queryByText('Contract Period:')).not.toBeInTheDocument()
      expect(screen.queryByText(/Mar 15, 2023/)).not.toBeInTheDocument()
      expect(screen.queryByText(/Jun 30, 2026/)).not.toBeInTheDocument()
    })

    it('does not show territories row on draft cards', () => {
      render(<ContractCard contract={draftContract} />)
      expect(screen.queryByText('Territories:')).not.toBeInTheDocument()
      expect(screen.queryByText('US')).not.toBeInTheDocument()
    })

    it('does not show minimum guarantee row on draft cards', () => {
      render(<ContractCard contract={draftContract} />)
      expect(screen.queryByText('Minimum Guarantee:')).not.toBeInTheDocument()
      expect(screen.queryByText('$5,000')).not.toBeInTheDocument()
    })

    it('does not show reporting frequency row on draft cards', () => {
      render(<ContractCard contract={draftContract} />)
      expect(screen.queryByText('Reporting:')).not.toBeInTheDocument()
      expect(screen.queryByText(/quarterly/i)).not.toBeInTheDocument()
    })

    it('still shows licensee name, Draft badge, and Resume review CTA', () => {
      render(<ContractCard contract={draftContract} />)
      expect(screen.getByText('Draft Licensee')).toBeInTheDocument()
      expect(screen.getByText('Draft')).toBeInTheDocument()
      expect(screen.getByText(/resume review/i)).toBeInTheDocument()
    })
  })

  // Active card metadata presence
  describe('active card shows all metadata fields', () => {
    it('shows royalty rate row on active cards', () => {
      render(<ContractCard contract={mockContract} />)
      expect(screen.getByText('Royalty Rate:')).toBeInTheDocument()
      // mockContract: royalty_rate 0.15, royalty_base 'net_sales' → "15% of Net Sales"
      expect(screen.getByText('15% of Net Sales')).toBeInTheDocument()
    })

    it('shows contract period row on active cards', () => {
      render(<ContractCard contract={mockContract} />)
      expect(screen.getByText('Contract Period:')).toBeInTheDocument()
    })

    it('shows territories row on active cards', () => {
      render(<ContractCard contract={mockContract} />)
      expect(screen.getByText('Territories:')).toBeInTheDocument()
    })

    it('shows minimum guarantee row on active cards', () => {
      render(<ContractCard contract={mockContract} />)
      expect(screen.getByText('Minimum Guarantee:')).toBeInTheDocument()
    })

    it('shows reporting frequency row on active cards', () => {
      render(<ContractCard contract={mockContract} />)
      expect(screen.getByText('Reporting:')).toBeInTheDocument()
    })
  })
})
