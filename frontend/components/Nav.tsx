/**
 * Navigation component for authenticated app routes
 */

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { signOut } from '@/lib/auth'

interface NavProps {
  userEmail: string
}

export default function Nav({ userEmail }: NavProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [error, setError] = useState<string | null>(null)

  const handleSignOut = async () => {
    setError(null)
    const { error } = await signOut()

    if (error) {
      setError('Failed to sign out')
      return
    }

    router.push('/login')
  }

  const isActive = (path: string) => {
    return pathname === path
  }

  return (
    <nav className="bg-white shadow">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center gap-8">
            <Link href="/dashboard" className="flex items-center">
              <h1 className="text-xl font-bold text-gray-900">Likha</h1>
            </Link>

            <div className="flex gap-6">
              <Link
                href="/dashboard"
                className={`px-3 py-2 text-sm font-medium ${
                  isActive('/dashboard')
                    ? 'text-blue-600 border-b-2 border-blue-600'
                    : 'text-gray-700 hover:text-gray-900'
                }`}
              >
                Dashboard
              </Link>
              <Link
                href="/contracts"
                className={`px-3 py-2 text-sm font-medium ${
                  isActive('/contracts')
                    ? 'text-blue-600 border-b-2 border-blue-600'
                    : 'text-gray-700 hover:text-gray-900'
                }`}
              >
                Contracts
              </Link>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">{userEmail}</span>
            <button
              onClick={handleSignOut}
              className="px-4 py-2 text-sm text-gray-700 hover:text-gray-900"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}
    </nav>
  )
}
