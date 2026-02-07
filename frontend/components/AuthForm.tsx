/**
 * AuthForm Component
 * Reusable email/password form for login and signup
 */

'use client'

import { useState, FormEvent } from 'react'
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
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={handleEmailBlur}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="you@example.com"
          required
        />
        {emailError && (
          <p className="mt-1 text-sm text-red-600">{emailError}</p>
        )}
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onBlur={handlePasswordBlur}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder={mode === 'signup' ? 'At least 8 characters' : 'Enter your password'}
          required
        />
        {passwordError && (
          <p className="mt-1 text-sm text-red-600">{passwordError}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {buttonText}
      </button>
    </form>
  )
}
