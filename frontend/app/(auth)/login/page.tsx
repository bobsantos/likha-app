/**
 * Login Page
 */

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import AuthForm from '@/components/AuthForm'
import AuthError from '@/components/AuthError'
import { signIn } from '@/lib/auth'

export default function LoginPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async ({ email, password }: { email: string; password: string }) => {
    setError(null)

    const { user, error: signInError } = await signIn(email, password)

    if (signInError) {
      setError(signInError.message || 'Failed to sign in')
      return
    }

    if (user) {
      // Redirect to dashboard on success
      router.push('/dashboard')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Sign in to your account</h2>
        <p className="mt-2 text-sm text-gray-600">
          Or{' '}
          <Link href="/signup" className="font-medium text-primary-600 hover:text-primary-500">
            create a new account
          </Link>
        </p>
      </div>

      {error && <AuthError error={error} />}

      <AuthForm mode="login" onSubmit={handleSubmit} />
    </div>
  )
}
