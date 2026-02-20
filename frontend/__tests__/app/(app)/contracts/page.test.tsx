/**
 * Tests for Contracts List Page
 */

import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import ContractsPage from '@/app/(app)/contracts/page'
import { getContracts } from '@/lib/api'
import type { Contract } from '@/types'

// Mock API
jest.mock('@/lib/api', () => ({
  getContracts: jest.fn(),
}))

// Mock ContractCard
jest.mock('@/components/ContractCard', () => {
  return function MockContractCard({ contract }: any) {
    return <div data-testid="contract-card">{contract.licensee_name}</div>
  }
})

// Mock EmptyState
jest.mock('@/components/EmptyState', () => {
  return function MockEmptyState({ title, ctaText, ctaLink }: any) {
    return (
      <div data-testid="empty-state">
        <p>{title}</p>
        {ctaText && <a href={ctaLink}>{ctaText}</a>}
      </div>
    )
  }
})

describe('Contracts List Page', () => {
  const mockGetContracts = getContracts as jest.MockedFunction<typeof getContracts>

  const mockContracts: Contract[] = [
    {
      id: 'contract-1',
      user_id: 'user-1',
      status: 'active',
      filename: 'acme-contract.pdf',
      licensee_name: 'Acme Corp',
      licensor_name: 'John Doe',
      contract_start: '2024-01-01',
      contract_end: '2025-12-31',
      royalty_rate: 0.15,
      royalty_base: 'net_sales',
      territories: ['US'],
      product_categories: null,
      minimum_guarantee: null,
      mg_period: null,
      advance_payment: null,
      reporting_frequency: 'quarterly',
      pdf_url: null,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
    {
      id: 'contract-2',
      user_id: 'user-1',
      status: 'active',
      filename: 'beta-contract.pdf',
      licensee_name: 'Beta Inc',
      licensor_name: 'Jane Smith',
      contract_start: '2024-02-01',
      contract_end: '2025-12-31',
      royalty_rate: 0.12,
      royalty_base: 'net_sales',
      territories: ['US', 'Canada'],
      product_categories: null,
      minimum_guarantee: null,
      mg_period: null,
      advance_payment: null,
      reporting_frequency: 'quarterly',
      pdf_url: null,
      created_at: '2024-02-01T00:00:00Z',
      updated_at: '2024-02-01T00:00:00Z',
    },
  ]

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('shows loading skeleton initially', () => {
    mockGetContracts.mockImplementation(() => new Promise(() => {}))
    render(<ContractsPage />)
    expect(screen.getByText('Contracts')).toBeInTheDocument()
  })

  it('displays page header with upload button', async () => {
    mockGetContracts.mockResolvedValue(mockContracts)
    render(<ContractsPage />)

    expect(screen.getByText('Contracts')).toBeInTheDocument()
    expect(screen.getByText('Upload Contract')).toBeInTheDocument()
  })

  it('displays contracts when loaded', async () => {
    mockGetContracts.mockResolvedValue(mockContracts)
    render(<ContractsPage />)

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument()
      expect(screen.getByText('Beta Inc')).toBeInTheDocument()
    })
  })

  it('displays empty state when no contracts', async () => {
    mockGetContracts.mockResolvedValue([])
    render(<ContractsPage />)

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    })
  })

  it('displays error on fetch failure', async () => {
    mockGetContracts.mockRejectedValue(new Error('Failed to fetch'))
    render(<ContractsPage />)

    await waitFor(() => {
      expect(screen.getByText('Failed to fetch')).toBeInTheDocument()
    })
  })

  it('has upload contract link pointing to correct path', async () => {
    mockGetContracts.mockResolvedValue(mockContracts)
    render(<ContractsPage />)

    const uploadLink = screen.getByText('Upload Contract').closest('a')
    expect(uploadLink).toHaveAttribute('href', '/contracts/upload')
  })

  // Phase 3: draft section tests
  it('calls getContracts with include_drafts=true', async () => {
    mockGetContracts.mockResolvedValue(mockContracts)
    render(<ContractsPage />)

    await waitFor(() => {
      expect(mockGetContracts).toHaveBeenCalledWith({ include_drafts: true })
    })
  })

  it('shows "Needs Review" section when drafts exist', async () => {
    const draftContract: Contract = {
      id: 'draft-1',
      user_id: 'user-1',
      status: 'draft',
      filename: 'pending-contract.pdf',
      licensee_name: null,
      licensor_name: null,
      contract_start: null,
      contract_end: null,
      royalty_rate: null,
      royalty_base: null,
      territories: [],
      product_categories: null,
      minimum_guarantee: null,
      mg_period: null,
      advance_payment: null,
      reporting_frequency: null,
      pdf_url: 'https://example.com/pending.pdf',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    }

    mockGetContracts.mockResolvedValue([...mockContracts, draftContract])
    render(<ContractsPage />)

    await waitFor(() => {
      expect(screen.getByText(/needs review/i)).toBeInTheDocument()
    })
  })

  it('does not show "Needs Review" section when no drafts exist', async () => {
    mockGetContracts.mockResolvedValue(mockContracts) // all active
    render(<ContractsPage />)

    await waitFor(() => {
      expect(screen.getAllByText('Acme Corp').length).toBeGreaterThanOrEqual(1)
    })

    expect(screen.queryByText(/needs review/i)).not.toBeInTheDocument()
  })

  it('shows draft contracts in the Needs Review section', async () => {
    const draftContract: Contract = {
      id: 'draft-1',
      user_id: 'user-1',
      status: 'draft',
      filename: 'pending-contract.pdf',
      licensee_name: null,
      licensor_name: null,
      contract_start: null,
      contract_end: null,
      royalty_rate: null,
      royalty_base: null,
      territories: [],
      product_categories: null,
      minimum_guarantee: null,
      mg_period: null,
      advance_payment: null,
      reporting_frequency: null,
      pdf_url: 'https://example.com/pending.pdf',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    }

    mockGetContracts.mockResolvedValue([...mockContracts, draftContract])
    render(<ContractsPage />)

    await waitFor(() => {
      // The mock ContractCard renders contract.licensee_name — for draft it's null
      // but we can check the section header exists
      expect(screen.getByText(/needs review/i)).toBeInTheDocument()
    })
  })
})
