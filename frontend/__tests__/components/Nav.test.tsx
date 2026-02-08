/**
 * Tests for Nav component
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useRouter, usePathname } from 'next/navigation'
import Nav from '@/components/Nav'
import { signOut } from '@/lib/auth'

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  usePathname: jest.fn(),
}))

// Mock auth
jest.mock('@/lib/auth', () => ({
  signOut: jest.fn(),
}))

describe('Nav Component', () => {
  const mockPush = jest.fn()
  const mockSignOut = signOut as jest.MockedFunction<typeof signOut>

  beforeEach(() => {
    jest.clearAllMocks()
    ;(useRouter as jest.Mock).mockReturnValue({
      push: mockPush,
    })
    ;(usePathname as jest.Mock).mockReturnValue('/dashboard')
  })

  it('renders logo', () => {
    render(<Nav userEmail="test@example.com" />)
    expect(screen.getByText('Likha')).toBeInTheDocument()
  })

  it('displays user email', () => {
    render(<Nav userEmail="test@example.com" />)
    expect(screen.getByText('test@example.com')).toBeInTheDocument()
  })

  it('renders navigation links', () => {
    render(<Nav userEmail="test@example.com" />)
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText('Contracts')).toBeInTheDocument()
  })

  it('highlights active link', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/dashboard')
    render(<Nav userEmail="test@example.com" />)

    const dashboardLink = screen.getByText('Dashboard').closest('a')
    expect(dashboardLink).toHaveClass('text-blue-600')
  })

  it('handles sign out', async () => {
    mockSignOut.mockResolvedValue({ error: null })
    render(<Nav userEmail="test@example.com" />)

    const signOutButton = screen.getByText('Sign Out')
    fireEvent.click(signOutButton)

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalled()
      expect(mockPush).toHaveBeenCalledWith('/login')
    })
  })

  it('shows error message on sign out failure', async () => {
    mockSignOut.mockResolvedValue({ error: { message: 'Sign out failed' } })
    render(<Nav userEmail="test@example.com" />)

    const signOutButton = screen.getByText('Sign Out')
    fireEvent.click(signOutButton)

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalled()
      expect(mockPush).not.toHaveBeenCalled()
    })
  })
})
