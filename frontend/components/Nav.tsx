/**
 * Navigation component for authenticated app routes.
 * Includes a slide-over drawer for mobile (hamburger menu).
 */

'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  FileText,
  LogOut,
  Upload,
  Settings,
  Mail,
  Menu,
  X,
} from 'lucide-react'
import { signOut } from '@/lib/auth'

interface NavProps {
  userEmail: string
}

const navLinks = [
  { href: '/dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { href: '/contracts', label: 'Contracts', Icon: FileText },
  { href: '/inbox', label: 'Inbox', Icon: Mail },
  { href: '/settings', label: 'Settings', Icon: Settings },
]

export default function Nav({ userEmail }: NavProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [error, setError] = useState<string | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const hamburgerRef = useRef<HTMLButtonElement>(null)

  const isActive = (path: string) => pathname === path

  const handleSignOut = async () => {
    setError(null)
    const { error } = await signOut()

    if (error) {
      setError('Failed to sign out')
      return
    }

    router.push('/login')
  }

  const closeMobileMenu = () => setMobileOpen(false)

  // Close on Escape key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mobileOpen) {
        closeMobileMenu()
        hamburgerRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mobileOpen])

  // Prevent body scroll while drawer is open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileOpen])

  const activeLinkClass = 'bg-primary-50 text-primary-600'
  const inactiveLinkClass = 'text-gray-700 hover:text-gray-900 hover:bg-gray-50'

  return (
    <nav
      aria-label="Main navigation"
      className="bg-white shadow sticky top-0 z-30"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          {/* Logo */}
          <div className="flex items-center gap-8">
            <Link href="/dashboard" className="flex items-center">
              <h1 className="text-xl font-bold text-primary-600">Likha</h1>
            </Link>

            {/* Desktop nav links — hidden below lg */}
            <div
              className="hidden lg:flex gap-2"
              data-testid="desktop-nav-links"
            >
              {navLinks.map(({ href, label, Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 ${
                    isActive(href) ? activeLinkClass : inactiveLinkClass
                  }`}
                >
                  <Icon className="w-4 h-4" aria-hidden="true" />
                  {label}
                </Link>
              ))}
            </div>
          </div>

          {/* Desktop right side */}
          <div className="hidden lg:flex items-center gap-3">
            <Link
              href="/contracts/upload"
              className="btn-primary flex items-center gap-2"
            >
              <Upload className="w-4 h-4" aria-hidden="true" />
              Upload Contract
            </Link>
            <span
              className="text-sm text-gray-600"
              data-testid="desktop-user-email"
            >
              {userEmail}
            </span>
            <button
              onClick={handleSignOut}
              data-testid="desktop-sign-out"
              className="px-3 py-2 text-sm text-gray-700 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors flex items-center gap-2"
            >
              <LogOut className="w-4 h-4" aria-hidden="true" />
              Sign Out
            </button>
          </div>

          {/* Hamburger — visible below lg */}
          <div className="flex lg:hidden items-center">
            <button
              ref={hamburgerRef}
              data-testid="hamburger-button"
              aria-label="Open navigation menu"
              aria-expanded={mobileOpen}
              aria-controls="mobile-menu"
              onClick={() => setMobileOpen(true)}
              className="p-2.5 text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
            >
              <Menu className="w-6 h-6" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {/* Sign-out error (visible in all layouts) */}
      {error && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Mobile drawer backdrop */}
      <div
        data-testid="mobile-menu-backdrop"
        onClick={closeMobileMenu}
        className={`lg:hidden fixed inset-0 bg-black/30 z-40 transition-opacity duration-200 ${
          mobileOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden="true"
      />

      {/* Mobile slide-over drawer */}
      <div
        id="mobile-menu"
        data-testid="mobile-menu"
        role="dialog"
        aria-label="Navigation menu"
        aria-modal="true"
        style={{ visibility: mobileOpen ? 'visible' : 'hidden' }}
        className={`lg:hidden fixed top-0 right-0 h-full w-72 bg-white shadow-xl z-50 flex flex-col transform transition-transform duration-200 ease-in-out ${
          mobileOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Drawer header */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-gray-100">
          <Link
            href="/dashboard"
            onClick={closeMobileMenu}
            className="flex items-center"
          >
            <h2 className="text-xl font-bold text-primary-600">Likha</h2>
          </Link>
          <button
            data-testid="mobile-menu-close"
            aria-label="Close navigation menu"
            onClick={() => {
              closeMobileMenu()
              hamburgerRef.current?.focus()
            }}
            className="p-2.5 text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Drawer nav links */}
        <nav className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
          {navLinks.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={closeMobileMenu}
              className={`flex items-center gap-3 px-3 py-3.5 rounded-lg text-base font-medium transition-colors focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 ${
                isActive(href) ? activeLinkClass : inactiveLinkClass
              }`}
            >
              <Icon className="w-5 h-5" aria-hidden="true" />
              {label}
            </Link>
          ))}
        </nav>

        {/* Drawer bottom section */}
        <div className="border-t border-gray-100 px-4 py-4 space-y-3">
          <Link
            href="/contracts/upload"
            onClick={closeMobileMenu}
            className="btn-primary flex items-center justify-center gap-2 w-full"
          >
            <Upload className="w-4 h-4" aria-hidden="true" />
            Upload Contract
          </Link>
          <p className="text-sm text-gray-600 text-center truncate">{userEmail}</p>
          <button
            onClick={async () => {
              await handleSignOut()
              closeMobileMenu()
            }}
            className="w-full flex items-center justify-center gap-2 px-3 py-3 text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors"
          >
            <LogOut className="w-4 h-4" aria-hidden="true" />
            Sign Out
          </button>
        </div>
      </div>
    </nav>
  )
}
