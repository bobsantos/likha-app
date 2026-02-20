/**
 * Auth Layout
 * Simple centered layout for login/signup pages (no navigation)
 */

import type { Metadata } from 'next'
import { Sparkles } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Sign In - Likha',
  description: 'Sign in to your Likha account',
}

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-primary-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Sparkles className="w-8 h-8 text-primary-600" />
          <h1 className="text-center text-3xl font-bold text-primary-600">
            Likha
          </h1>
        </div>
        <p className="text-center text-sm text-gray-600">
          AI-powered royalty tracking
        </p>
      </div>
      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow-xl sm:rounded-2xl sm:px-10">
          {children}
        </div>
      </div>
    </div>
  )
}
