/**
 * Tests for DashboardSummary component
 */

import { render, screen } from '@testing-library/react'
import DashboardSummary from '@/components/DashboardSummary'

describe('DashboardSummary Component', () => {
  const currentYear = new Date().getFullYear()

  it('displays total contracts count', () => {
    render(<DashboardSummary totalContracts={5} ytdRoyalties={12500} currentYear={currentYear} />)
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('Active Contracts')).toBeInTheDocument()
  })

  it('displays YTD royalties formatted as currency', () => {
    render(<DashboardSummary totalContracts={5} ytdRoyalties={12500.50} currentYear={currentYear} />)
    expect(screen.getByText('$12,500.50')).toBeInTheDocument()
  })

  it('shows current year in YTD label from prop', () => {
    render(<DashboardSummary totalContracts={5} ytdRoyalties={12500} currentYear={2026} />)
    expect(screen.getByText('YTD Royalties (2026)')).toBeInTheDocument()
  })

  it('shows current year in YTD label when passing current year', () => {
    render(<DashboardSummary totalContracts={5} ytdRoyalties={12500} currentYear={currentYear} />)
    expect(screen.getByText(`YTD Royalties (${currentYear})`)).toBeInTheDocument()
  })

  it('shows "Across all active contracts" sub-text when ytdRoyalties > 0', () => {
    render(<DashboardSummary totalContracts={3} ytdRoyalties={5000} currentYear={currentYear} />)
    expect(screen.getByText('Across all active contracts')).toBeInTheDocument()
  })

  it('shows "No royalties recorded in {year}" when ytdRoyalties is 0', () => {
    render(<DashboardSummary totalContracts={2} ytdRoyalties={0} currentYear={2026} />)
    expect(screen.getByText('No royalties recorded in 2026')).toBeInTheDocument()
  })

  it('shows "No royalties recorded in {year}" with prop year, not derived year', () => {
    render(<DashboardSummary totalContracts={2} ytdRoyalties={0} currentYear={2024} />)
    expect(screen.getByText('No royalties recorded in 2024')).toBeInTheDocument()
  })

  it('handles zero values', () => {
    render(<DashboardSummary totalContracts={0} ytdRoyalties={0} currentYear={currentYear} />)
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('$0.00')).toBeInTheDocument()
  })

  it('formats large numbers correctly', () => {
    render(<DashboardSummary totalContracts={125} ytdRoyalties={1234567.89} currentYear={currentYear} />)
    expect(screen.getByText('125')).toBeInTheDocument()
    expect(screen.getByText('$1,234,567.89')).toBeInTheDocument()
  })
})
