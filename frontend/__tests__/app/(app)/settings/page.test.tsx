/**
 * Tests for Settings Page
 */

import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { useRouter } from 'next/navigation'
import SettingsPage from '@/app/(app)/settings/page'
import { getInboundAddress, ApiError, isUnauthorizedError } from '@/lib/api'
import { copyToClipboard } from '@/lib/clipboard'

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}))

// Mock API
jest.mock('@/lib/api', () => ({
  getInboundAddress: jest.fn(),
  ApiError: class ApiError extends Error {
    status: number
    data?: unknown
    constructor(message: string, status: number, data?: unknown) {
      super(message)
      this.name = 'ApiError'
      this.status = status
      this.data = data
    }
  },
  isUnauthorizedError: (err: unknown) =>
    err instanceof Error &&
    err.name === 'ApiError' &&
    (err as { status: number }).status === 401,
}))

// Mock the clipboard utility so tests are not affected by secure-context
// restrictions in jsdom.
jest.mock('@/lib/clipboard', () => ({
  copyToClipboard: jest.fn().mockResolvedValue(true),
}))

describe('Settings Page', () => {
  const mockPush = jest.fn()
  const mockGetInboundAddress = getInboundAddress as jest.MockedFunction<typeof getInboundAddress>

  beforeEach(() => {
    jest.clearAllMocks()
    ;(useRouter as jest.Mock).mockReturnValue({ push: mockPush })
  })

  it('shows loading state initially', () => {
    mockGetInboundAddress.mockImplementation(() => new Promise(() => {}))
    render(<SettingsPage />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('displays the inbound email address after loading', async () => {
    mockGetInboundAddress.mockResolvedValue({
      inbound_address: 'reports-abc123@inbound.likha.app',
    })
    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('reports-abc123@inbound.likha.app')).toBeInTheDocument()
    })
  })

  it('displays the section heading', async () => {
    mockGetInboundAddress.mockResolvedValue({
      inbound_address: 'reports-abc123@inbound.likha.app',
    })
    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('Inbound Email Address')).toBeInTheDocument()
    })
  })

  it('displays explanatory text', async () => {
    mockGetInboundAddress.mockResolvedValue({
      inbound_address: 'reports-abc123@inbound.likha.app',
    })
    render(<SettingsPage />)

    await waitFor(() => {
      expect(
        screen.getByText(/forward licensee royalty reports to this address/i)
      ).toBeInTheDocument()
    })
  })

  it('renders a copy button', async () => {
    mockGetInboundAddress.mockResolvedValue({
      inbound_address: 'reports-abc123@inbound.likha.app',
    })
    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument()
    })
  })

  it('copies the email address to clipboard when copy button is clicked', async () => {
    mockGetInboundAddress.mockResolvedValue({
      inbound_address: 'reports-abc123@inbound.likha.app',
    })
    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /copy/i }))

    await waitFor(() => {
      expect(copyToClipboard).toHaveBeenCalledWith(
        'reports-abc123@inbound.likha.app'
      )
    })
  })

  it('shows "Copied!" feedback after clicking the copy button', async () => {
    mockGetInboundAddress.mockResolvedValue({
      inbound_address: 'reports-abc123@inbound.likha.app',
    })
    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /copy/i }))

    await waitFor(() => {
      expect(screen.getByText(/copied/i)).toBeInTheDocument()
    })
  })

  it('shows error state when fetch fails', async () => {
    mockGetInboundAddress.mockRejectedValue(new Error('Network error'))
    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText(/failed to load/i)).toBeInTheDocument()
    })
  })

  it('redirects to /login when fetch returns a 401', async () => {
    const { ApiError: MockApiError } = jest.requireMock('@/lib/api')
    mockGetInboundAddress.mockRejectedValue(new MockApiError('Unauthorized', 401))
    render(<SettingsPage />)

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/login')
    })
  })

  it('does not show error panel when fetch returns a 401', async () => {
    const { ApiError: MockApiError } = jest.requireMock('@/lib/api')
    mockGetInboundAddress.mockRejectedValue(new MockApiError('Unauthorized', 401))
    render(<SettingsPage />)

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/login')
    })

    expect(screen.queryByText(/failed to load/i)).not.toBeInTheDocument()
  })

  it('displays Settings as the page heading', async () => {
    mockGetInboundAddress.mockResolvedValue({
      inbound_address: 'reports-abc123@inbound.likha.app',
    })
    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    })
  })
})
