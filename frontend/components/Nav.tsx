/**
 * Navigation component for authenticated app routes
 */

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { LayoutDashboard, FileText, LogOut, Upload, Settings, Mail } from 'lucide-react'
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
              <h1 className="text-xl font-bold text-primary-600">Likha</h1>
            </Link>

            <div className="flex gap-2">
              <Link
                href="/dashboard"
                className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 ${
                  isActive('/dashboard')
                    ? 'bg-primary-50 text-primary-600'
                    : 'text-gray-700 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                <LayoutDashboard className="w-4 h-4" />
                Dashboard
              </Link>
              <Link
                href="/contracts"
                className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 ${
                  isActive('/contracts')
                    ? 'bg-primary-50 text-primary-600'
                    : 'text-gray-700 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                <FileText className="w-4 h-4" />
                Contracts
              </Link>
              <Link
                href="/inbox"
                className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 ${
                  isActive('/inbox')
                    ? 'bg-primary-50 text-primary-600'
                    : 'text-gray-700 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                <Mail className="w-4 h-4" />
                Inbox
              </Link>
              <Link
                href="/settings"
                className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 ${
                  isActive('/settings')
                    ? 'bg-primary-50 text-primary-600'
                    : 'text-gray-700 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                <Settings className="w-4 h-4" />
                Settings
              </Link>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/contracts/upload"
              className="btn-primary flex items-center gap-2"
            >
              <Upload className="w-4 h-4" />
              Upload Contract
            </Link>
            <span className="text-sm text-gray-600">{userEmail}</span>
            <button
              onClick={handleSignOut}
              className="px-3 py-2 text-sm text-gray-700 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors flex items-center gap-2"
            >
              <LogOut className="w-4 h-4" />
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
