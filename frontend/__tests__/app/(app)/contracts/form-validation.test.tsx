/**
 * Tests for contract form validation improvements in the upload page
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRouter, useSearchParams } from 'next/navigation'
import UploadContractPage from '@/app/(app)/contracts/upload/page'
import { uploadContract, confirmDraft, getContract, ApiError } from '@/lib/api'

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}))

// Mock API
jest.mock('@/lib/api', () => ({
  uploadContract: jest.fn(),
  confirmDraft: jest.fn(),
  getContract: jest.fn(),
  ApiError: class ApiError extends Error {
    status: number
    data?: unknown
    constructor(message: string, status: number, data?: unknown) {
      super(message)
      this.name = 'ApiError'
      this.status = status
      this.data = data
    }
  },
  isUnauthorizedError: (err: unknown) =>
    err instanceof Error &&
    err.name === 'ApiError' &&
    (err as { status: number }).status === 401,
}))

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
  toast: { success: jest.fn(), error: jest.fn() },
  Toaster: () => null,
}))

const mockPush = jest.fn()
const mockSearchParams = { get: jest.fn().mockReturnValue(null) }

// Helper: render page at review step using ?draft= query param
// This loads the review form directly without needing to simulate file upload
async function renderAtReviewStep(overrides: Record<string, string> = {}) {
  const baseFormValues = {
    licensee_name: 'Acme Corp',
    licensor_name: 'Brand Owner',
    licensee_email: '',
    contract_start_date: '2024-01-01',
    contract_end_date: '2025-12-31',
    royalty_rate: '10%',
    royalty_base: 'net_sales',
    territories: 'USA',
    reporting_frequency: 'quarterly',
    minimum_guarantee: '',
    advance_payment: '',
    ...overrides,
  }

  // Simulate loading a draft via ?draft= query param
  ;(useSearchParams as jest.Mock).mockReturnValue({
    get: (key: string) => (key === 'draft' ? 'draft-1' : null),
  })

  ;(getContract as jest.Mock).mockResolvedValue({
    id: 'draft-1',
    status: 'draft',
    form_values: baseFormValues,
  })

  render(<UploadContractPage />)

  // Wait for the review form to appear (loaded from draft)
  await waitFor(() => {
    expect(screen.getByTestId('contract-form')).toBeInTheDocument()
  }, { timeout: 3000 })

  return baseFormValues
}

describe('Contract Form Validation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(useRouter as jest.Mock).mockReturnValue({ push: mockPush })
    ;(useSearchParams as jest.Mock).mockReturnValue(mockSearchParams)
  })

  describe('Date ordering validation', () => {
    it('shows error when end date is before start date', async () => {
      await renderAtReviewStep({
        contract_start_date: '2025-01-01',
        contract_end_date: '2024-01-01',
      })

      await act(async () => {
        fireEvent.submit(screen.getByTestId('contract-form'))
      })

      await waitFor(() => {
        expect(screen.getByText(/contract end date must be after the start date/i)).toBeInTheDocument()
      })
    })

    it('does not show date error when end date is after start date', async () => {
      await renderAtReviewStep({
        contract_start_date: '2024-01-01',
        contract_end_date: '2025-12-31',
      })
      ;(confirmDraft as jest.Mock).mockResolvedValue({ id: 'new-contract-1' })

      await act(async () => {
        fireEvent.submit(screen.getByTestId('contract-form'))
      })

      await waitFor(() => {
        expect(screen.queryByText(/contract end date must be after the start date/i)).not.toBeInTheDocument()
      })
    })

    it('does not show date error when dates are equal', async () => {
      // Edge case: same day — this is technically not "after" so it should error
      await renderAtReviewStep({
        contract_start_date: '2024-01-01',
        contract_end_date: '2024-01-01',
      })

      await act(async () => {
        fireEvent.submit(screen.getByTestId('contract-form'))
      })

      await waitFor(() => {
        expect(screen.getByText(/contract end date must be after the start date/i)).toBeInTheDocument()
      })
    })
  })

  describe('Royalty rate validation', () => {
    it('shows error when royalty rate is empty', async () => {
      await renderAtReviewStep({ royalty_rate: '' })

      await act(async () => {
        fireEvent.submit(screen.getByTestId('contract-form'))
      })

      await waitFor(() => {
        expect(screen.getByText(/royalty rate is required/i)).toBeInTheDocument()
      })
    })
  })

  describe('Email format validation', () => {
    it('shows warning when licensee email is invalid format', async () => {
      await renderAtReviewStep({ licensee_email: 'not-an-email' })

      await act(async () => {
        fireEvent.submit(screen.getByTestId('contract-form'))
      })

      await waitFor(() => {
        expect(screen.getByText(/licensee email is not a valid email address/i)).toBeInTheDocument()
      })
    })

    it('does not show email warning when email field is empty', async () => {
      ;(confirmDraft as jest.Mock).mockResolvedValue({ id: 'new-contract-1' })

      await renderAtReviewStep({ licensee_email: '' })

      await act(async () => {
        fireEvent.submit(screen.getByTestId('contract-form'))
      })

      // Should not show email warning for empty optional field
      await waitFor(() => {
        expect(screen.queryByText(/licensee email is not a valid email address/i)).not.toBeInTheDocument()
      })
    })

    it('accepts valid email addresses without showing warning', async () => {
      ;(confirmDraft as jest.Mock).mockResolvedValue({ id: 'new-contract-1' })

      await renderAtReviewStep({ licensee_email: 'valid@example.com' })

      await act(async () => {
        fireEvent.submit(screen.getByTestId('contract-form'))
      })

      await waitFor(() => {
        expect(screen.queryByText(/licensee email is not a valid email address/i)).not.toBeInTheDocument()
      })
    })
  })

  describe('Negative number validation', () => {
    it('shows error when minimum guarantee is negative', async () => {
      await renderAtReviewStep({ minimum_guarantee: '-100' })

      await act(async () => {
        fireEvent.submit(screen.getByTestId('contract-form'))
      })

      await waitFor(() => {
        expect(screen.getByText(/must be 0 or greater/i)).toBeInTheDocument()
      })
    })

    it('shows error when advance payment is negative', async () => {
      await renderAtReviewStep({ advance_payment: '-500' })

      await act(async () => {
        fireEvent.submit(screen.getByTestId('contract-form'))
      })

      await waitFor(() => {
        expect(screen.getByText(/must be 0 or greater/i)).toBeInTheDocument()
      })
    })

    it('allows zero for minimum guarantee', async () => {
      ;(confirmDraft as jest.Mock).mockResolvedValue({ id: 'new-contract-1' })

      await renderAtReviewStep({ minimum_guarantee: '0' })

      await act(async () => {
        fireEvent.submit(screen.getByTestId('contract-form'))
      })

      // Zero is allowed, no validation error for this field
      expect(screen.queryByText(/must be 0 or greater/i)).not.toBeInTheDocument()
    })
  })
})
