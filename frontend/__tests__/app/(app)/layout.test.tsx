/**
 * Tests for App Layout (protected routes)
 */

import { render, screen, waitFor } from '@testing-library/react'
import { useRouter } from 'next/navigation'
import AppLayout from '@/app/(app)/layout'
import { getCurrentUser } from '@/lib/auth'

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  usePathname: jest.fn(() => '/dashboard'),
}))

// Mock auth
jest.mock('@/lib/auth', () => ({
  getCurrentUser: jest.fn(),
  signOut: jest.fn(),
}))

// Mock Nav component
jest.mock('@/components/Nav', () => {
  return function MockNav({ userEmail }: { userEmail: string }) {
    return <div data-testid="mock-nav">Nav: {userEmail}</div>
  }
})

describe('App Layout', () => {
  const mockPush = jest.fn()
  const mockGetCurrentUser = getCurrentUser as jest.MockedFunction<typeof getCurrentUser>

  beforeEach(() => {
    jest.clearAllMocks()
    ;(useRouter as jest.Mock).mockReturnValue({
      push: mockPush,
    })
  })

  it('shows loading state initially', () => {
    mockGetCurrentUser.mockImplementation(() => new Promise(() => {}))

    render(
      <AppLayout>
        <div>Test Content</div>
      </AppLayout>
    )

    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('redirects to login if not authenticated', async () => {
    mockGetCurrentUser.mockResolvedValue({ user: null, error: null })

    render(
      <AppLayout>
        <div>Test Content</div>
      </AppLayout>
    )

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/login')
    })
  })

  it('redirects to login when getCurrentUser returns an error', async () => {
    mockGetCurrentUser.mockResolvedValue({
      user: null,
      error: { message: 'JWT expired', status: 401 } as unknown as import('@supabase/supabase-js').AuthError,
    })

    render(
      <AppLayout>
        <div>Test Content</div>
      </AppLayout>
    )

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/login')
    })
  })

  it('redirects to login when getCurrentUser throws unexpectedly', async () => {
    mockGetCurrentUser.mockRejectedValue(new Error('Network error'))

    render(
      <AppLayout>
        <div>Test Content</div>
      </AppLayout>
    )

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/login')
    })
  })

  it('renders children with nav when authenticated', async () => {
    mockGetCurrentUser.mockResolvedValue({
      user: { id: 'user-1', email: 'test@example.com' },
      error: null,
    })

    render(
      <AppLayout>
        <div>Test Content</div>
      </AppLayout>
    )

    await waitFor(() => {
      expect(screen.getByTestId('mock-nav')).toBeInTheDocument()
      expect(screen.getByText('Test Content')).toBeInTheDocument()
    })
  })

  it('passes user email to Nav component', async () => {
    mockGetCurrentUser.mockResolvedValue({
      user: { id: 'user-1', email: 'user@example.com' },
      error: null,
    })

    render(
      <AppLayout>
        <div>Test Content</div>
      </AppLayout>
    )

    await waitFor(() => {
      expect(screen.getByText('Nav: user@example.com')).toBeInTheDocument()
    })
  })
})
