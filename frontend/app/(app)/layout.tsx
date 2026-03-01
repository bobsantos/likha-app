/**
 * Layout for authenticated app routes
 * Checks auth and redirects to login if not authenticated
 */

'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { getSession } from '@/lib/auth'
import Nav from '@/components/Nav'
import ErrorBoundary from '@/components/ErrorBoundary'
import { Toaster } from 'react-hot-toast'

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  // null = not yet resolved, string = authenticated email, false = unauthenticated
  const [userEmail, setUserEmail] = useState<string | null | false>(null)
  // Only show the full-screen spinner on the very first mount.
  // Subsequent re-renders (navigating between pages) skip the loading gate.
  const isFirstCheck = useRef(true)

  useEffect(() => {
    // Already resolved on a previous render — skip the network gate entirely.
    if (!isFirstCheck.current) return
    isFirstCheck.current = false

    async function checkAuth() {
      try {
        const { session, error } = await getSession()

        if (!session || error) {
          router.push('/login')
          return
        }

        setUserEmail(session.user.email ?? '')
      } catch {
        // Unexpected error — treat as unauthenticated
        router.push('/login')
      }
    }

    checkAuth()
  }, [router])

  // Still resolving session on the initial load — show full-screen spinner
  if (userEmail === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-primary-600 animate-spin" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  // Unauthenticated — render nothing while the redirect fires
  if (userEmail === false) {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Skip to main content — first focusable element for keyboard users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 z-50 px-4 py-2 bg-primary-600 text-white font-medium rounded-lg focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-primary-600"
      >
        Skip to main content
      </a>
      <Nav userEmail={userEmail} />
      <Toaster
        position="top-right"
        containerStyle={{ top: 72 }}
        toastOptions={{
          style: {
            fontFamily: 'Inter, sans-serif',
            fontSize: '14px',
            fontWeight: 500,
            borderRadius: '10px',
            padding: '12px 16px',
            maxWidth: '380px',
          },
          success: {
            duration: 3500,
            style: {
              background: '#f0fdf4',
              color: '#15803d',
              border: '1px solid #bbf7d0',
            },
          },
          error: {
            duration: 5000,
            style: {
              background: '#fef2f2',
              color: '#b91c1c',
              border: '1px solid #fecaca',
            },
          },
        }}
      />
      <main
        id="main-content"
        className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8 animate-fade-in"
        aria-live="polite"
      >
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
      </main>
    </div>
  )
}
