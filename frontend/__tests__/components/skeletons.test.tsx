/**
 * Tests for Skeleton loader components
 */

import { render, screen } from '@testing-library/react'
import DashboardSkeleton from '@/components/skeletons/DashboardSkeleton'
import ContractDetailSkeleton from '@/components/skeletons/ContractDetailSkeleton'
import TableSkeleton from '@/components/skeletons/TableSkeleton'

describe('DashboardSkeleton', () => {
  it('renders without errors', () => {
    const { container } = render(<DashboardSkeleton />)
    expect(container).toBeInTheDocument()
  })

  it('has aria-busy="true"', () => {
    render(<DashboardSkeleton />)
    const busy = screen.getByRole('status')
    expect(busy).toHaveAttribute('aria-busy', 'true')
  })

  it('has aria-label "Loading dashboard"', () => {
    render(<DashboardSkeleton />)
    expect(screen.getByLabelText('Loading dashboard')).toBeInTheDocument()
  })

  it('renders 2 summary card skeletons', () => {
    const { container } = render(<DashboardSkeleton />)
    // Two summary cards in a grid
    const summaryCards = container.querySelectorAll('[data-testid="summary-card-skeleton"]')
    expect(summaryCards).toHaveLength(2)
  })

  it('renders 3 contract card skeletons', () => {
    const { container } = render(<DashboardSkeleton />)
    const contractCards = container.querySelectorAll('[data-testid="contract-card-skeleton"]')
    expect(contractCards).toHaveLength(3)
  })

  it('uses skeleton class on elements', () => {
    const { container } = render(<DashboardSkeleton />)
    const skeletons = container.querySelectorAll('.skeleton')
    expect(skeletons.length).toBeGreaterThan(0)
  })
})

describe('ContractDetailSkeleton', () => {
  it('renders without errors', () => {
    const { container } = render(<ContractDetailSkeleton />)
    expect(container).toBeInTheDocument()
  })

  it('has aria-busy="true"', () => {
    render(<ContractDetailSkeleton />)
    const busy = screen.getByRole('status')
    expect(busy).toHaveAttribute('aria-busy', 'true')
  })

  it('uses skeleton class on elements', () => {
    const { container } = render(<ContractDetailSkeleton />)
    const skeletons = container.querySelectorAll('.skeleton')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it('renders a breadcrumb skeleton', () => {
    const { container } = render(<ContractDetailSkeleton />)
    expect(container.querySelector('[data-testid="breadcrumb-skeleton"]')).toBeInTheDocument()
  })

  it('renders a header card skeleton', () => {
    const { container } = render(<ContractDetailSkeleton />)
    expect(container.querySelector('[data-testid="header-skeleton"]')).toBeInTheDocument()
  })

  it('renders a sales table area', () => {
    const { container } = render(<ContractDetailSkeleton />)
    expect(container.querySelector('[data-testid="table-skeleton-container"]')).toBeInTheDocument()
  })
})

describe('TableSkeleton', () => {
  it('renders without errors', () => {
    const { container } = render(<TableSkeleton />)
    expect(container).toBeInTheDocument()
  })

  it('renders default 4 data rows', () => {
    const { container } = render(<TableSkeleton />)
    const rows = container.querySelectorAll('[data-testid="table-skeleton-row"]')
    expect(rows).toHaveLength(4)
  })

  it('renders custom number of rows via rows prop', () => {
    const { container } = render(<TableSkeleton rows={6} />)
    const rows = container.querySelectorAll('[data-testid="table-skeleton-row"]')
    expect(rows).toHaveLength(6)
  })

  it('renders default 5 columns per row', () => {
    const { container } = render(<TableSkeleton />)
    const firstRow = container.querySelector('[data-testid="table-skeleton-row"]')
    const cells = firstRow?.querySelectorAll('[data-testid="table-skeleton-cell"]')
    expect(cells).toHaveLength(5)
  })

  it('renders custom number of cols via cols prop', () => {
    const { container } = render(<TableSkeleton cols={3} />)
    const firstRow = container.querySelector('[data-testid="table-skeleton-row"]')
    const cells = firstRow?.querySelectorAll('[data-testid="table-skeleton-cell"]')
    expect(cells).toHaveLength(3)
  })

  it('renders a header row', () => {
    const { container } = render(<TableSkeleton />)
    expect(container.querySelector('[data-testid="table-skeleton-header"]')).toBeInTheDocument()
  })

  it('applies decreasing opacity to rows', () => {
    const { container } = render(<TableSkeleton rows={3} />)
    const rows = container.querySelectorAll<HTMLElement>('[data-testid="table-skeleton-row"]')
    // First row should have opacity 1, subsequent rows should decrease
    const firstOpacity = parseFloat(rows[0].style.opacity || '1')
    const secondOpacity = parseFloat(rows[1].style.opacity || '1')
    expect(firstOpacity).toBeGreaterThan(secondOpacity)
  })
})
