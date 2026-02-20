/**
 * AuthForm Component
 * Reusable email/password form for login and signup
 */

'use client'

import { useState, FormEvent } from 'react'
import { Mail, Lock, Loader2 } from 'lucide-react'
import { validateEmail, validatePassword } from '@/lib/auth'

interface AuthFormProps {
  mode: 'login' | 'signup'
  onSubmit: (data: { email: string; password: string }) => void | Promise<void>
}

export default function AuthForm({ mode, onSubmit }: AuthFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [emailError, setEmailError] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleEmailBlur = () => {
    if (email && !validateEmail(email)) {
      setEmailError('Please enter a valid email address')
    } else {
      setEmailError('')
    }
  }

  const handlePasswordBlur = () => {
    if (password && !validatePassword(password)) {
      setPasswordError('Password must be at least 8 characters')
    } else {
      setPasswordError('')
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()

    // Validate before submit
    const isEmailValid = validateEmail(email)
    const isPasswordValid = validatePassword(password)

    if (!isEmailValid) {
      setEmailError('Please enter a valid email address')
      return
    }

    if (!isPasswordValid) {
      setPasswordError('Password must be at least 8 characters')
      return
    }

    setLoading(true)
    try {
      await onSubmit({ email, password })
    } finally {
      setLoading(false)
    }
  }

  const buttonText = mode === 'login'
    ? (loading ? 'Signing In...' : 'Sign In')
    : (loading ? 'Signing Up...' : 'Sign Up')

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
          Email
        </label>
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Mail className="h-5 w-5 text-gray-400" />
          </div>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={handleEmailBlur}
            className="input pl-10"
            placeholder="you@example.com"
            required
          />
        </div>
        {emailError && (
          <p className="mt-1 text-sm text-red-600">{emailError}</p>
        )}
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
          Password
        </label>
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Lock className="h-5 w-5 text-gray-400" />
          </div>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={handlePasswordBlur}
            className="input pl-10"
            placeholder={mode === 'signup' ? 'At least 8 characters' : 'Enter your password'}
            required
          />
        </div>
        {passwordError && (
          <p className="mt-1 text-sm text-red-600">{passwordError}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={loading}
        className="btn-primary w-full flex items-center justify-center gap-2"
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {buttonText}
      </button>
    </form>
  )
}
