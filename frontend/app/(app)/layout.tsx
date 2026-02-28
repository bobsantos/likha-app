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
      <Nav userEmail={userEmail} />
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8 animate-fade-in">
        {children}
      </main>
    </div>
  )
}
