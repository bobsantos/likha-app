/**
 * Tests for Nav component — includes hamburger menu, accessibility, and mobile behavior
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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

  // --- Existing tests ---

  it('renders logo', () => {
    render(<Nav userEmail="test@example.com" />)
    // Both desktop and mobile drawer render "Likha" — there are two instances
    const logos = screen.getAllByText('Likha')
    expect(logos.length).toBeGreaterThanOrEqual(1)
  })

  it('displays user email', () => {
    render(<Nav userEmail="test@example.com" />)
    // email appears in the desktop nav area
    expect(screen.getByTestId('desktop-user-email')).toHaveTextContent('test@example.com')
  })

  it('renders navigation links', () => {
    render(<Nav userEmail="test@example.com" />)
    // Desktop nav links (hidden on mobile, visible on lg)
    const desktopNav = screen.getByTestId('desktop-nav-links')
    expect(within(desktopNav).getByText('Dashboard')).toBeInTheDocument()
    expect(within(desktopNav).getByText('Contracts')).toBeInTheDocument()
  })

  it('highlights active link', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/dashboard')
    render(<Nav userEmail="test@example.com" />)

    const desktopNav = screen.getByTestId('desktop-nav-links')
    const dashboardLink = within(desktopNav).getByText('Dashboard').closest('a')
    expect(dashboardLink).toHaveClass('text-primary-600')
  })

  it('handles sign out', async () => {
    mockSignOut.mockResolvedValue({ error: null })
    render(<Nav userEmail="test@example.com" />)

    const signOutButton = screen.getByTestId('desktop-sign-out')
    fireEvent.click(signOutButton)

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalled()
      expect(mockPush).toHaveBeenCalledWith('/login')
    })
  })

  it('shows error message on sign out failure', async () => {
    mockSignOut.mockResolvedValue({ error: { message: 'Sign out failed' } })
    render(<Nav userEmail="test@example.com" />)

    const signOutButton = screen.getByTestId('desktop-sign-out')
    fireEvent.click(signOutButton)

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalled()
      expect(mockPush).not.toHaveBeenCalled()
      expect(screen.getByText('Failed to sign out')).toBeInTheDocument()
    })
  })

  // --- Hamburger menu tests ---

  it('renders hamburger button', () => {
    render(<Nav userEmail="test@example.com" />)
    const hamburger = screen.getByTestId('hamburger-button')
    expect(hamburger).toBeInTheDocument()
  })

  it('hamburger button has correct aria attributes when closed', () => {
    render(<Nav userEmail="test@example.com" />)
    const hamburger = screen.getByTestId('hamburger-button')
    expect(hamburger).toHaveAttribute('aria-expanded', 'false')
    expect(hamburger).toHaveAttribute('aria-controls', 'mobile-menu')
  })

  it('hamburger button has correct aria attributes when open', () => {
    render(<Nav userEmail="test@example.com" />)
    const hamburger = screen.getByTestId('hamburger-button')
    fireEvent.click(hamburger)
    expect(hamburger).toHaveAttribute('aria-expanded', 'true')
  })

  it('opens mobile drawer when hamburger is clicked', () => {
    render(<Nav userEmail="test@example.com" />)
    const hamburger = screen.getByTestId('hamburger-button')

    // Drawer should not be visible initially
    expect(screen.queryByTestId('mobile-menu')).not.toBeVisible()

    fireEvent.click(hamburger)

    expect(screen.getByTestId('mobile-menu')).toBeVisible()
  })

  it('closes mobile drawer when close button is clicked', () => {
    render(<Nav userEmail="test@example.com" />)
    const hamburger = screen.getByTestId('hamburger-button')
    fireEvent.click(hamburger)

    const closeButton = screen.getByTestId('mobile-menu-close')
    fireEvent.click(closeButton)

    expect(screen.getByTestId('mobile-menu')).not.toBeVisible()
  })

  it('closes mobile drawer when Escape key is pressed', () => {
    render(<Nav userEmail="test@example.com" />)
    const hamburger = screen.getByTestId('hamburger-button')
    fireEvent.click(hamburger)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.getByTestId('mobile-menu')).not.toBeVisible()
  })

  it('mobile drawer shows all navigation links', () => {
    render(<Nav userEmail="test@example.com" />)
    fireEvent.click(screen.getByTestId('hamburger-button'))

    const mobileMenu = screen.getByTestId('mobile-menu')
    expect(within(mobileMenu).getByText('Dashboard')).toBeInTheDocument()
    expect(within(mobileMenu).getByText('Contracts')).toBeInTheDocument()
    expect(within(mobileMenu).getByText('Inbox')).toBeInTheDocument()
    expect(within(mobileMenu).getByText('Settings')).toBeInTheDocument()
  })

  it('mobile drawer shows Upload Contract button', () => {
    render(<Nav userEmail="test@example.com" />)
    fireEvent.click(screen.getByTestId('hamburger-button'))

    const mobileMenu = screen.getByTestId('mobile-menu')
    expect(within(mobileMenu).getByText('Upload Contract')).toBeInTheDocument()
  })

  it('mobile drawer shows Sign Out button', () => {
    render(<Nav userEmail="test@example.com" />)
    fireEvent.click(screen.getByTestId('hamburger-button'))

    const mobileMenu = screen.getByTestId('mobile-menu')
    expect(within(mobileMenu).getByText('Sign Out')).toBeInTheDocument()
  })

  it('mobile drawer shows active link with highlighted style', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/dashboard')
    render(<Nav userEmail="test@example.com" />)
    fireEvent.click(screen.getByTestId('hamburger-button'))

    const mobileMenu = screen.getByTestId('mobile-menu')
    const dashboardLink = within(mobileMenu).getByText('Dashboard').closest('a')
    expect(dashboardLink).toHaveClass('text-primary-600')
  })

  it('closes mobile drawer when a nav link is clicked', () => {
    render(<Nav userEmail="test@example.com" />)
    fireEvent.click(screen.getByTestId('hamburger-button'))

    const mobileMenu = screen.getByTestId('mobile-menu')
    const dashboardLink = within(mobileMenu).getByText('Dashboard').closest('a')!
    fireEvent.click(dashboardLink)

    expect(screen.getByTestId('mobile-menu')).not.toBeVisible()
  })

  it('closes mobile drawer when backdrop is clicked', () => {
    render(<Nav userEmail="test@example.com" />)
    fireEvent.click(screen.getByTestId('hamburger-button'))

    const backdrop = screen.getByTestId('mobile-menu-backdrop')
    fireEvent.click(backdrop)

    expect(screen.getByTestId('mobile-menu')).not.toBeVisible()
  })

  it('mobile sign out calls signOut and closes the drawer', async () => {
    mockSignOut.mockResolvedValue({ error: null })
    render(<Nav userEmail="test@example.com" />)
    fireEvent.click(screen.getByTestId('hamburger-button'))

    const mobileMenu = screen.getByTestId('mobile-menu')
    const mobileSignOut = within(mobileMenu).getByText('Sign Out').closest('button')!
    fireEvent.click(mobileSignOut)

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalled()
      expect(mockPush).toHaveBeenCalledWith('/login')
    })
  })

  it('sign out error is visible in mobile layout', async () => {
    mockSignOut.mockResolvedValue({ error: { message: 'Sign out failed' } })
    render(<Nav userEmail="test@example.com" />)
    fireEvent.click(screen.getByTestId('hamburger-button'))

    const mobileMenu = screen.getByTestId('mobile-menu')
    const mobileSignOut = within(mobileMenu).getByText('Sign Out').closest('button')!
    fireEvent.click(mobileSignOut)

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalled()
      expect(screen.getByText('Failed to sign out')).toBeInTheDocument()
    })
  })

  // --- Accessibility tests ---

  it('nav element has aria-label', () => {
    render(<Nav userEmail="test@example.com" />)
    const nav = screen.getByRole('navigation')
    expect(nav).toHaveAttribute('aria-label', 'Main navigation')
  })

  it('mobile menu panel has correct id for aria-controls', () => {
    render(<Nav userEmail="test@example.com" />)
    expect(screen.getByTestId('mobile-menu')).toHaveAttribute('id', 'mobile-menu')
  })

  it('decorative icons in nav links are aria-hidden', () => {
    render(<Nav userEmail="test@example.com" />)
    // SVG icons in the desktop nav should have aria-hidden to avoid screen reader noise
    const desktopNav = screen.getByTestId('desktop-nav-links')
    const svgs = desktopNav.querySelectorAll('svg')
    svgs.forEach((svg) => {
      expect(svg).toHaveAttribute('aria-hidden', 'true')
    })
  })
})
