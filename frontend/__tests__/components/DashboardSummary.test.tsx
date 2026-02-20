/**
 * Tests for DashboardSummary component
 */

import { render, screen } from '@testing-library/react'
import DashboardSummary from '@/components/DashboardSummary'

describe('DashboardSummary Component', () => {
  it('displays total contracts count', () => {
    render(<DashboardSummary totalContracts={5} ytdRoyalties={12500} />)
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('Active Contracts')).toBeInTheDocument()
  })

  it('displays YTD royalties formatted as currency', () => {
    render(<DashboardSummary totalContracts={5} ytdRoyalties={12500.50} />)
    expect(screen.getByText('$12,500.50')).toBeInTheDocument()
    expect(screen.getByText('YTD Royalties')).toBeInTheDocument()
  })

  it('handles zero values', () => {
    render(<DashboardSummary totalContracts={0} ytdRoyalties={0} />)
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('$0.00')).toBeInTheDocument()
  })

  it('formats large numbers correctly', () => {
    render(<DashboardSummary totalContracts={125} ytdRoyalties={1234567.89} />)
    expect(screen.getByText('125')).toBeInTheDocument()
    expect(screen.getByText('$1,234,567.89')).toBeInTheDocument()
  })
})
