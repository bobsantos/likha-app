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
    licensee_name: 'Acme Corp',
    licensor_name: 'John Doe',
    contract_start: '2024-01-01',
    contract_end: '2025-12-31',
    royalty_rate: 0.15,
    royalty_base: 'net_sales',
    territories: ['US', 'Canada'],
    product_categories: null,
    minimum_guarantee: 5000,
    mg_period: 'quarterly',
    advance_payment: null,
    reporting_frequency: 'quarterly',
    pdf_url: 'https://example.com/contract.pdf',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  }

  it('renders licensee name', () => {
    render(<ContractCard contract={mockContract} />)
    expect(screen.getByText('Acme Corp')).toBeInTheDocument()
  })

  it('displays royalty rate as percentage', () => {
    render(<ContractCard contract={mockContract} />)
    expect(screen.getByText('15%')).toBeInTheDocument()
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

  it('handles tiered royalty rate', () => {
    const tierContract = {
      ...mockContract,
      royalty_rate: {
        type: 'tiered' as const,
        tiers: [
          { min: 0, max: 10000, rate: 0.1 },
          { min: 10000, max: null, rate: 0.15 },
        ],
      },
    }

    render(<ContractCard contract={tierContract} />)
    expect(screen.getByText('10-15%')).toBeInTheDocument()
  })

  it('handles category-specific rates', () => {
    const categoryContract = {
      ...mockContract,
      royalty_rate: {
        type: 'category' as const,
        rates: {
          'Books': 0.15,
          'Merchandise': 0.10,
        },
      },
    }

    render(<ContractCard contract={categoryContract} />)
    expect(screen.getByText('Category Rates')).toBeInTheDocument()
  })

  it('links to contract detail page', () => {
    render(<ContractCard contract={mockContract} />)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/contracts/contract-1')
  })
})
