/**
 * Authentication tests (TDD approach - tests written first)
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { signIn, signUp, signOut, validateEmail, validatePassword } from '@/lib/auth'
import AuthForm from '@/components/AuthForm'
import AuthError from '@/components/AuthError'

// Mock Supabase
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: jest.fn(),
      signUp: jest.fn(),
      signOut: jest.fn(),
    },
  },
}))

const { supabase } = require('@/lib/supabase')

describe('Auth Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('validateEmail', () => {
    it('should validate correct email format', () => {
      expect(validateEmail('test@example.com')).toBe(true)
      expect(validateEmail('user.name+tag@example.co.uk')).toBe(true)
    })

    it('should reject invalid email format', () => {
      expect(validateEmail('')).toBe(false)
      expect(validateEmail('invalid')).toBe(false)
      expect(validateEmail('invalid@')).toBe(false)
      expect(validateEmail('@example.com')).toBe(false)
      expect(validateEmail('invalid@example')).toBe(false)
    })
  })

  describe('validatePassword', () => {
    it('should accept password with minimum 8 characters', () => {
      expect(validatePassword('password123')).toBe(true)
      expect(validatePassword('12345678')).toBe(true)
    })

    it('should reject password with less than 8 characters', () => {
      expect(validatePassword('')).toBe(false)
      expect(validatePassword('pass')).toBe(false)
      expect(validatePassword('1234567')).toBe(false)
    })
  })

  describe('signIn', () => {
    it('should call supabase.auth.signInWithPassword with correct params', async () => {
      const mockUser = { id: '123', email: 'test@example.com' }
      supabase.auth.signInWithPassword.mockResolvedValue({
        data: { user: mockUser },
        error: null,
      })

      const result = await signIn('test@example.com', 'password123')

      expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
      })
      expect(result.user).toEqual(mockUser)
      expect(result.error).toBeNull()
    })

    it('should return error on failed sign in', async () => {
      const mockError = { message: 'Invalid credentials' }
      supabase.auth.signInWithPassword.mockResolvedValue({
        data: { user: null },
        error: mockError,
      })

      const result = await signIn('test@example.com', 'wrongpassword')

      expect(result.user).toBeNull()
      expect(result.error).toEqual(mockError)
    })
  })

  describe('signUp', () => {
    it('should call supabase.auth.signUp with correct params', async () => {
      const mockUser = { id: '123', email: 'test@example.com' }
      supabase.auth.signUp.mockResolvedValue({
        data: { user: mockUser },
        error: null,
      })

      const result = await signUp('test@example.com', 'password123')

      expect(supabase.auth.signUp).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
      })
      expect(result.user).toEqual(mockUser)
      expect(result.error).toBeNull()
    })

    it('should return error on failed sign up', async () => {
      const mockError = { message: 'Email already registered' }
      supabase.auth.signUp.mockResolvedValue({
        data: { user: null },
        error: mockError,
      })

      const result = await signUp('test@example.com', 'password123')

      expect(result.user).toBeNull()
      expect(result.error).toEqual(mockError)
    })
  })

  describe('signOut', () => {
    it('should call supabase.auth.signOut', async () => {
      supabase.auth.signOut.mockResolvedValue({ error: null })

      await signOut()

      expect(supabase.auth.signOut).toHaveBeenCalled()
    })
  })
})

describe('AuthForm Component', () => {
  it('should render login form with email and password fields', () => {
    render(<AuthForm mode="login" onSubmit={jest.fn()} />)

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('should render signup form with email and password fields', () => {
    render(<AuthForm mode="signup" onSubmit={jest.fn()} />)

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign up/i })).toBeInTheDocument()
  })

  it('should display email validation error for invalid email', async () => {
    const user = userEvent.setup()
    render(<AuthForm mode="login" onSubmit={jest.fn()} />)

    const emailInput = screen.getByLabelText(/email/i)
    await user.type(emailInput, 'invalid-email')
    await user.tab() // Trigger blur event

    await waitFor(() => {
      expect(screen.getByText(/valid email/i)).toBeInTheDocument()
    })
  })

  it('should display password validation error for short password', async () => {
    const user = userEvent.setup()
    render(<AuthForm mode="login" onSubmit={jest.fn()} />)

    const passwordInput = screen.getByLabelText(/password/i)
    await user.type(passwordInput, 'short')
    await user.tab() // Trigger blur event

    await waitFor(() => {
      expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument()
    })
  })

  it('should call onSubmit with email and password when form is valid', async () => {
    const user = userEvent.setup()
    const mockOnSubmit = jest.fn()
    render(<AuthForm mode="login" onSubmit={mockOnSubmit} />)

    const emailInput = screen.getByLabelText(/email/i)
    const passwordInput = screen.getByLabelText(/password/i)
    const submitButton = screen.getByRole('button', { name: /sign in/i })

    await user.type(emailInput, 'test@example.com')
    await user.type(passwordInput, 'password123')
    await user.click(submitButton)

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
      })
    })
  })

  it('should not submit form when email is invalid', async () => {
    const user = userEvent.setup()
    const mockOnSubmit = jest.fn()
    render(<AuthForm mode="login" onSubmit={mockOnSubmit} />)

    const emailInput = screen.getByLabelText(/email/i)
    const passwordInput = screen.getByLabelText(/password/i)
    const submitButton = screen.getByRole('button', { name: /sign in/i })

    await user.type(emailInput, 'invalid-email')
    await user.type(passwordInput, 'password123')
    await user.click(submitButton)

    expect(mockOnSubmit).not.toHaveBeenCalled()
  })

  it('should not submit form when password is too short', async () => {
    const user = userEvent.setup()
    const mockOnSubmit = jest.fn()
    render(<AuthForm mode="login" onSubmit={mockOnSubmit} />)

    const emailInput = screen.getByLabelText(/email/i)
    const passwordInput = screen.getByLabelText(/password/i)
    const submitButton = screen.getByRole('button', { name: /sign in/i })

    await user.type(emailInput, 'test@example.com')
    await user.type(passwordInput, 'short')
    await user.click(submitButton)

    expect(mockOnSubmit).not.toHaveBeenCalled()
  })

  it('should show loading state during submission', async () => {
    const user = userEvent.setup()
    const mockOnSubmit = jest.fn(() => new Promise(resolve => setTimeout(resolve, 1000)))
    render(<AuthForm mode="login" onSubmit={mockOnSubmit} />)

    const emailInput = screen.getByLabelText(/email/i)
    const passwordInput = screen.getByLabelText(/password/i)
    const submitButton = screen.getByRole('button', { name: /sign in/i })

    await user.type(emailInput, 'test@example.com')
    await user.type(passwordInput, 'password123')
    await user.click(submitButton)

    expect(submitButton).toBeDisabled()
    expect(screen.getByText(/signing in/i)).toBeInTheDocument()
  })
})

describe('AuthError Component', () => {
  it('should not render when no error is provided', () => {
    const { container } = render(<AuthError error={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('should render error message when error is provided', () => {
    render(<AuthError error="Invalid credentials" />)
    expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument()
  })

  it('should have error styling', () => {
    render(<AuthError error="Test error" />)
    const errorElement = screen.getByText(/test error/i)
    expect(errorElement).toHaveClass('text-red-600')
  })
})
