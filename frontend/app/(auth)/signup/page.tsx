/**
 * Signup Page
 */

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle2 } from 'lucide-react'
import AuthForm from '@/components/AuthForm'
import AuthError from '@/components/AuthError'
import { signUp } from '@/lib/auth'

export default function SignupPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async ({ email, password }: { email: string; password: string }) => {
    setError(null)
    setSuccess(false)

    const { user, error: signUpError } = await signUp(email, password)

    if (signUpError) {
      setError(signUpError.message || 'Failed to create account')
      return
    }

    if (user) {
      setSuccess(true)
      // Redirect to dashboard after a short delay
      setTimeout(() => {
        router.push('/dashboard')
      }, 1500)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Create your account</h2>
        <p className="mt-2 text-sm text-gray-600">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-primary-600 hover:text-primary-500">
            Sign in
          </Link>
        </p>
      </div>

      {error && <AuthError error={error} />}

      {success && (
        <div className="rounded-lg bg-green-50 p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-green-600">
              Account created successfully! Redirecting...
            </p>
          </div>
        </div>
      )}

      <AuthForm mode="signup" onSubmit={handleSubmit} />

      <p className="text-xs text-gray-500 text-center">
        By creating an account, you agree to our Terms of Service and Privacy Policy.
      </p>
    </div>
  )
}
