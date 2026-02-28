/**
 * Tests for App Layout (protected routes)
 */

import { render, screen, waitFor } from '@testing-library/react'
import { useRouter } from 'next/navigation'
import AppLayout from '@/app/(app)/layout'
import { getSession } from '@/lib/auth'

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  usePathname: jest.fn(() => '/dashboard'),
}))

// Mock auth
jest.mock('@/lib/auth', () => ({
  getSession: jest.fn(),
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
  const mockGetSession = getSession as jest.MockedFunction<typeof getSession>

  beforeEach(() => {
    jest.clearAllMocks()
    ;(useRouter as jest.Mock).mockReturnValue({
      push: mockPush,
    })
  })

  it('shows loading state initially', () => {
    mockGetSession.mockImplementation(() => new Promise(() => {}))

    render(
      <AppLayout>
        <div>Test Content</div>
      </AppLayout>
    )

    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('redirects to login if not authenticated', async () => {
    mockGetSession.mockResolvedValue({ session: null, error: null })

    render(
      <AppLayout>
        <div>Test Content</div>
      </AppLayout>
    )

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/login')
    })
  })

  it('redirects to login when getSession returns an error', async () => {
    mockGetSession.mockResolvedValue({
      session: null,
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

  it('redirects to login when getSession throws unexpectedly', async () => {
    mockGetSession.mockRejectedValue(new Error('Network error'))

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
    mockGetSession.mockResolvedValue({
      session: { user: { id: 'user-1', email: 'test@example.com' } } as import('@supabase/supabase-js').Session,
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
    mockGetSession.mockResolvedValue({
      session: { user: { id: 'user-1', email: 'user@example.com' } } as import('@supabase/supabase-js').Session,
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
