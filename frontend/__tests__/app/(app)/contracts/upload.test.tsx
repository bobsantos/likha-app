/**
 * Tests for Contract Upload Page
 */

import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRouter } from 'next/navigation'
import UploadContractPage from '@/app/(app)/contracts/upload/page'
import { uploadContract, confirmDraft, ApiError } from '@/lib/api'

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}))

// Mock API — Phase 2: confirmDraft replaces createContract
jest.mock('@/lib/api', () => ({
  uploadContract: jest.fn(),
  confirmDraft: jest.fn(),
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
}))

describe('Upload Contract Page', () => {
  const mockPush = jest.fn()
  const mockUploadContract = uploadContract as jest.MockedFunction<typeof uploadContract>
  const mockConfirmDraft = confirmDraft as jest.MockedFunction<typeof confirmDraft>

  // Base extraction response — includes contract_id from Phase 2
  const baseExtractionResponse = {
    contract_id: 'draft-contract-abc',
    extracted_terms: {
      licensee_name: 'Test Corp',
      licensor_name: 'Test Author',
      contract_start_date: '2024-01-01',
      contract_end_date: '2025-12-31',
      royalty_rate: '15% of net sales',
      royalty_base: 'net sales',
      territories: ['US'],
      reporting_frequency: 'quarterly',
      minimum_guarantee: null,
      advance_payment: null,
      product_categories: null,
      payment_terms: null,
      exclusivity: null,
      confidence_score: null,
      extraction_notes: null,
    },
    form_values: {
      licensee_name: 'Test Corp',
      licensor_name: 'Test Author',
      contract_start_date: '2024-01-01',
      contract_end_date: '2025-12-31',
      royalty_rate: 15,
      royalty_base: 'net_sales' as const,
      territories: ['US'],
      reporting_frequency: 'quarterly' as const,
      minimum_guarantee: null,
      advance_payment: null,
    },
    token_usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
    filename: 'contract.pdf',
    storage_path: 'contracts/user-123/contract.pdf',
    pdf_url: 'https://example.com/signed-url',
  }

  const mockSavedContract = {
    id: 'new-contract-123',
    user_id: 'user-1',
    status: 'active' as const,
    filename: 'contract.pdf',
    licensee_name: 'Test Corp',
    licensor_name: null,
    contract_start: null,
    contract_end: null,
    royalty_rate: 0.10,
    royalty_base: 'net_sales' as const,
    territories: [],
    product_categories: null,
    minimum_guarantee: null,
    mg_period: null,
    advance_payment: null,
    reporting_frequency: 'quarterly' as const,
    pdf_url: 'https://example.com/contract.pdf',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  }

  beforeEach(() => {
    jest.clearAllMocks()
    ;(useRouter as jest.Mock).mockReturnValue({
      push: mockPush,
    })
  })

  it('renders upload dropzone', () => {
    render(<UploadContractPage />)
    expect(screen.getByText('Upload Contract')).toBeInTheDocument()
    expect(screen.getByText(/drop your pdf here/i)).toBeInTheDocument()
  })

  it('renders back to contracts link', () => {
    render(<UploadContractPage />)
    expect(screen.getByText('Back to Contracts')).toBeInTheDocument()
  })

  it('shows file name after selection', async () => {
    render(<UploadContractPage />)

    const file = new File(['test'], 'contract.pdf', { type: 'application/pdf' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement

    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText('contract.pdf')).toBeInTheDocument()
    })
  })

  it('shows error for non-PDF files', async () => {
    render(<UploadContractPage />)

    const file = new File(['test'], 'document.txt', { type: 'text/plain' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement

    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText(/please upload a pdf file/i)).toBeInTheDocument()
    })
  })

  it('shows extraction loading state on upload', async () => {
    mockUploadContract.mockImplementation(() => new Promise(() => {}))
    render(<UploadContractPage />)

    const file = new File(['test'], 'contract.pdf', { type: 'application/pdf' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement

    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText(/upload & extract/i)).toBeInTheDocument()
    })

    const uploadButton = screen.getByText(/upload & extract/i)
    fireEvent.click(uploadButton)

    await waitFor(() => {
      expect(screen.getByText(/extracting contract terms/i)).toBeInTheDocument()
    })
  })

  it('shows "Confirm and Save" button (not "Save Contract") on review step', async () => {
    mockUploadContract.mockResolvedValue(baseExtractionResponse)

    render(<UploadContractPage />)

    const file = new File(['test'], 'contract.pdf', { type: 'application/pdf' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText(/upload & extract/i)).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText(/upload & extract/i))

    await waitFor(() => {
      expect(screen.getByText(/review extracted terms/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /confirm and save/i })).toBeInTheDocument()
    })
  })

  it('does not show "Save Contract" label after rename', async () => {
    mockUploadContract.mockResolvedValue(baseExtractionResponse)

    render(<UploadContractPage />)

    const file = new File(['test'], 'contract.pdf', { type: 'application/pdf' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(screen.getByText(/upload & extract/i)).toBeInTheDocument())
    fireEvent.click(screen.getByText(/upload & extract/i))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^save contract$/i })).not.toBeInTheDocument()
    })
  })

  it('calls confirmDraft with draftContractId on save', async () => {
    mockUploadContract.mockResolvedValue(baseExtractionResponse)
    mockConfirmDraft.mockResolvedValue(mockSavedContract)

    render(<UploadContractPage />)

    // Select and upload file
    const file = new File(['test'], 'contract.pdf', { type: 'application/pdf' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(screen.getByText(/upload & extract/i)).toBeInTheDocument())
    fireEvent.click(screen.getByText(/upload & extract/i))

    // Wait for review form with renamed button
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /confirm and save/i })).toBeInTheDocument()
    })

    // Submit the form
    fireEvent.click(screen.getByRole('button', { name: /confirm and save/i }))

    await waitFor(() => {
      expect(mockConfirmDraft).toHaveBeenCalledWith(
        'draft-contract-abc',
        expect.objectContaining({ licensee_name: 'Test Corp' })
      )
    })
  })

  it('does not call confirmDraft if no draftContractId is available', async () => {
    // Extraction response without contract_id (legacy shape or error case)
    mockUploadContract.mockResolvedValue({
      ...baseExtractionResponse,
      contract_id: undefined,
    })

    render(<UploadContractPage />)

    const file = new File(['test'], 'contract.pdf', { type: 'application/pdf' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(screen.getByText(/upload & extract/i)).toBeInTheDocument())
    fireEvent.click(screen.getByText(/upload & extract/i))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /confirm and save/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /confirm and save/i }))

    // Should not call confirmDraft and should show an error
    await waitFor(() => {
      expect(mockConfirmDraft).not.toHaveBeenCalled()
    })
  })

  it('redirects to contract detail page after confirmDraft succeeds', async () => {
    mockUploadContract.mockResolvedValue(baseExtractionResponse)
    mockConfirmDraft.mockResolvedValue(mockSavedContract)

    render(<UploadContractPage />)

    const file = new File(['test'], 'contract.pdf', { type: 'application/pdf' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(screen.getByText(/upload & extract/i)).toBeInTheDocument())
    fireEvent.click(screen.getByText(/upload & extract/i))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /confirm and save/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /confirm and save/i }))

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/contracts/new-contract-123')
    })
  })

  it('shows friendly error message on extraction failure', async () => {
    mockUploadContract.mockRejectedValue(new Error('Failed to upload contract'))

    render(<UploadContractPage />)

    const file = new File(['test'], 'contract.pdf', { type: 'application/pdf' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText(/upload & extract/i)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText(/upload & extract/i))

    await waitFor(() => {
      // The friendly classified message is shown, not the raw error
      expect(
        screen.getByText(/we couldn't store your file/i)
      ).toBeInTheDocument()
    })
  })

  it('shows "Try again" button after upload error', async () => {
    mockUploadContract.mockRejectedValue(new Error('Failed to upload contract'))

    render(<UploadContractPage />)

    const file = new File(['test'], 'contract.pdf', { type: 'application/pdf' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText(/upload & extract/i)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText(/upload & extract/i))

    await waitFor(() => {
      // The "Try again" button specifically (not the text in the error message body)
      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    })
  })

  it('shows "Choose different file" button after upload error', async () => {
    mockUploadContract.mockRejectedValue(new Error('Failed to upload contract'))

    render(<UploadContractPage />)

    const file = new File(['test'], 'contract.pdf', { type: 'application/pdf' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText(/upload & extract/i)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText(/upload & extract/i))

    await waitFor(() => {
      expect(screen.getByText(/choose different file/i)).toBeInTheDocument()
    })
  })

  it('shows file name as context in error state', async () => {
    mockUploadContract.mockRejectedValue(new Error('Failed to upload contract'))

    render(<UploadContractPage />)

    const file = new File(['test'], 'my-contract.pdf', { type: 'application/pdf' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText(/upload & extract/i)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText(/upload & extract/i))

    await waitFor(() => {
      // File name should still be visible in the error state context line
      expect(screen.getByText(/my-contract\.pdf/i)).toBeInTheDocument()
    })
  })

  // ============================================================
  // Phase 3: 409 error handling tests
  // ============================================================

  describe('409 DUPLICATE_FILENAME handling', () => {
    const MockApiError = (jest.requireMock('@/lib/api') as any).ApiError

    it('shows duplicate filename error UI on 409 DUPLICATE_FILENAME', async () => {
      const duplicateError = new MockApiError('Conflict', 409, {
        detail: {
          code: 'DUPLICATE_FILENAME',
          message: 'A contract with this filename already exists.',
          existing_contract: {
            id: 'existing-contract-id',
            filename: 'nike-contract.pdf',
            licensee_name: 'Nike Inc.',
            created_at: '2026-01-15T10:30:00Z',
            status: 'active',
          },
        },
      })
      mockUploadContract.mockRejectedValue(duplicateError)

      render(<UploadContractPage />)

      const file = new File(['test'], 'nike-contract.pdf', { type: 'application/pdf' })
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => expect(screen.getByText(/upload & extract/i)).toBeInTheDocument())
      fireEvent.click(screen.getByText(/upload & extract/i))

      await waitFor(() => {
        expect(
          screen.getByText(/a contract with this filename already exists/i)
        ).toBeInTheDocument()
      })
    })

    it('shows filename in monospace pill for duplicate', async () => {
      const MockApiError2 = (jest.requireMock('@/lib/api') as any).ApiError
      const duplicateError = new MockApiError2('Conflict', 409, {
        detail: {
          code: 'DUPLICATE_FILENAME',
          message: 'A contract with this filename already exists.',
          existing_contract: {
            id: 'existing-contract-id',
            filename: 'nike-contract.pdf',
            licensee_name: 'Nike Inc.',
            created_at: '2026-01-15T10:30:00Z',
            status: 'active',
          },
        },
      })
      mockUploadContract.mockRejectedValue(duplicateError)

      render(<UploadContractPage />)

      const file = new File(['test'], 'nike-contract.pdf', { type: 'application/pdf' })
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => expect(screen.getByText(/upload & extract/i)).toBeInTheDocument())
      fireEvent.click(screen.getByText(/upload & extract/i))

      await waitFor(() => {
        expect(screen.getByText('nike-contract.pdf')).toBeInTheDocument()
      })
    })

    it('shows "View existing contract" link for DUPLICATE_FILENAME', async () => {
      const MockApiError3 = (jest.requireMock('@/lib/api') as any).ApiError
      const duplicateError = new MockApiError3('Conflict', 409, {
        detail: {
          code: 'DUPLICATE_FILENAME',
          message: 'A contract with this filename already exists.',
          existing_contract: {
            id: 'existing-contract-id',
            filename: 'nike-contract.pdf',
            licensee_name: 'Nike Inc.',
            created_at: '2026-01-15T10:30:00Z',
            status: 'active',
          },
        },
      })
      mockUploadContract.mockRejectedValue(duplicateError)

      render(<UploadContractPage />)

      const file = new File(['test'], 'nike-contract.pdf', { type: 'application/pdf' })
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => expect(screen.getByText(/upload & extract/i)).toBeInTheDocument())
      fireEvent.click(screen.getByText(/upload & extract/i))

      await waitFor(() => {
        const link = screen.getByRole('link', { name: /view existing contract/i })
        expect(link).toBeInTheDocument()
        expect(link).toHaveAttribute('href', '/contracts/existing-contract-id')
      })
    })

    it('shows "Choose a different file" button for DUPLICATE_FILENAME', async () => {
      const MockApiError4 = (jest.requireMock('@/lib/api') as any).ApiError
      const duplicateError = new MockApiError4('Conflict', 409, {
        detail: {
          code: 'DUPLICATE_FILENAME',
          message: 'A contract with this filename already exists.',
          existing_contract: {
            id: 'existing-contract-id',
            filename: 'nike-contract.pdf',
            licensee_name: 'Nike Inc.',
            created_at: '2026-01-15T10:30:00Z',
            status: 'active',
          },
        },
      })
      mockUploadContract.mockRejectedValue(duplicateError)

      render(<UploadContractPage />)

      const file = new File(['test'], 'nike-contract.pdf', { type: 'application/pdf' })
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => expect(screen.getByText(/upload & extract/i)).toBeInTheDocument())
      fireEvent.click(screen.getByText(/upload & extract/i))

      await waitFor(() => {
        expect(screen.getByText(/choose a different file/i)).toBeInTheDocument()
      })
    })
  })

  describe('409 INCOMPLETE_DRAFT handling', () => {
    it('shows incomplete draft error UI on 409 INCOMPLETE_DRAFT', async () => {
      const MockApiError5 = (jest.requireMock('@/lib/api') as any).ApiError
      const draftError = new MockApiError5('Conflict', 409, {
        detail: {
          code: 'INCOMPLETE_DRAFT',
          message: 'You have an incomplete upload for this file.',
          existing_contract: {
            id: 'draft-contract-id',
            filename: 'nike-contract.pdf',
            created_at: '2026-02-19T08:15:00Z',
            status: 'draft',
          },
        },
      })
      mockUploadContract.mockRejectedValue(draftError)

      render(<UploadContractPage />)

      const file = new File(['test'], 'nike-contract.pdf', { type: 'application/pdf' })
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => expect(screen.getByText(/upload & extract/i)).toBeInTheDocument())
      fireEvent.click(screen.getByText(/upload & extract/i))

      await waitFor(() => {
        expect(
          screen.getByText(/you have an unfinished upload for this file/i)
        ).toBeInTheDocument()
      })
    })

    it('shows "Resume review" link for INCOMPLETE_DRAFT', async () => {
      const MockApiError6 = (jest.requireMock('@/lib/api') as any).ApiError
      const draftError = new MockApiError6('Conflict', 409, {
        detail: {
          code: 'INCOMPLETE_DRAFT',
          message: 'You have an incomplete upload for this file.',
          existing_contract: {
            id: 'draft-contract-id',
            filename: 'nike-contract.pdf',
            created_at: '2026-02-19T08:15:00Z',
            status: 'draft',
          },
        },
      })
      mockUploadContract.mockRejectedValue(draftError)

      render(<UploadContractPage />)

      const file = new File(['test'], 'nike-contract.pdf', { type: 'application/pdf' })
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => expect(screen.getByText(/upload & extract/i)).toBeInTheDocument())
      fireEvent.click(screen.getByText(/upload & extract/i))

      await waitFor(() => {
        const link = screen.getByRole('link', { name: /resume review/i })
        expect(link).toBeInTheDocument()
        expect(link).toHaveAttribute('href', '/contracts/upload?draft=draft-contract-id')
      })
    })

    it('shows "Choose a different file" button for INCOMPLETE_DRAFT', async () => {
      const MockApiError7 = (jest.requireMock('@/lib/api') as any).ApiError
      const draftError = new MockApiError7('Conflict', 409, {
        detail: {
          code: 'INCOMPLETE_DRAFT',
          message: 'You have an incomplete upload for this file.',
          existing_contract: {
            id: 'draft-contract-id',
            filename: 'nike-contract.pdf',
            created_at: '2026-02-19T08:15:00Z',
            status: 'draft',
          },
        },
      })
      mockUploadContract.mockRejectedValue(draftError)

      render(<UploadContractPage />)

      const file = new File(['test'], 'nike-contract.pdf', { type: 'application/pdf' })
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => expect(screen.getByText(/upload & extract/i)).toBeInTheDocument())
      fireEvent.click(screen.getByText(/upload & extract/i))

      await waitFor(() => {
        expect(screen.getByText(/choose a different file/i)).toBeInTheDocument()
      })
    })
  })

  // ============================================================
  // Phase 3: sessionStorage draft restoration
  // ============================================================

  describe('sessionStorage draft persistence', () => {
    beforeEach(() => {
      sessionStorage.clear()
    })

    afterEach(() => {
      sessionStorage.clear()
    })

    it('saves draft data to sessionStorage on entering review step', async () => {
      mockUploadContract.mockResolvedValue(baseExtractionResponse)

      render(<UploadContractPage />)

      const file = new File(['test'], 'contract.pdf', { type: 'application/pdf' })
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => expect(screen.getByText(/upload & extract/i)).toBeInTheDocument())
      fireEvent.click(screen.getByText(/upload & extract/i))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /confirm and save/i })).toBeInTheDocument()
      })

      // sessionStorage should have draft data after reaching review step
      const stored = sessionStorage.getItem('upload_draft')
      expect(stored).not.toBeNull()

      const parsed = JSON.parse(stored!)
      expect(parsed.draftContractId).toBe('draft-contract-abc')
    })

    it('offers to restore draft when sessionStorage has saved data on mount', async () => {
      // Pre-populate sessionStorage with draft data
      const draftData = {
        draftContractId: 'saved-draft-id',
        formData: {
          licensee_name: 'Saved Corp',
          licensor_name: '',
          contract_start: '',
          contract_end: '',
          royalty_rate: '10',
          royalty_base: 'net_sales',
          territories: '',
          reporting_frequency: 'quarterly',
          minimum_guarantee: '',
          advance_payment: '',
        },
      }
      sessionStorage.setItem('upload_draft', JSON.stringify(draftData))

      render(<UploadContractPage />)

      await waitFor(() => {
        expect(screen.getByText(/resume your previous upload/i)).toBeInTheDocument()
      })
    })

    it('clears sessionStorage after successful save', async () => {
      mockUploadContract.mockResolvedValue(baseExtractionResponse)
      mockConfirmDraft.mockResolvedValue(mockSavedContract)

      // Pre-populate sessionStorage
      sessionStorage.setItem('upload_draft', JSON.stringify({ draftContractId: 'old-id' }))

      render(<UploadContractPage />)

      const file = new File(['test'], 'contract.pdf', { type: 'application/pdf' })
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => expect(screen.getByText(/upload & extract/i)).toBeInTheDocument())
      fireEvent.click(screen.getByText(/upload & extract/i))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /confirm and save/i })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /confirm and save/i }))

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/contracts/new-contract-123')
      })

      expect(sessionStorage.getItem('upload_draft')).toBeNull()
    })

    it('clears sessionStorage on cancel', async () => {
      mockUploadContract.mockResolvedValue(baseExtractionResponse)

      sessionStorage.setItem('upload_draft', JSON.stringify({ draftContractId: 'old-id' }))

      render(<UploadContractPage />)

      const file = new File(['test'], 'contract.pdf', { type: 'application/pdf' })
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => expect(screen.getByText(/upload & extract/i)).toBeInTheDocument())
      fireEvent.click(screen.getByText(/upload & extract/i))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

      expect(sessionStorage.getItem('upload_draft')).toBeNull()
    })
  })
})
