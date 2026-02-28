/**
 * Tests for Contract Upload Page
 */

import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRouter, useSearchParams } from 'next/navigation'
import UploadContractPage from '@/app/(app)/contracts/upload/page'
import { uploadContract, confirmDraft, getContract, ApiError } from '@/lib/api'

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}))

// Mock API — Phase 2: confirmDraft replaces createContract
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
}))

describe('Upload Contract Page', () => {
  const mockPush = jest.fn()
  const mockUploadContract = uploadContract as jest.MockedFunction<typeof uploadContract>
  const mockConfirmDraft = confirmDraft as jest.MockedFunction<typeof confirmDraft>
  const mockGetContract = getContract as jest.MockedFunction<typeof getContract>

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

  // Mock saved contract — reflects actual backend API response field names.
  // The backend Contract Pydantic model uses contract_start_date / contract_end_date
  // and does NOT have a top-level licensor_name column.
  const mockSavedContract = {
    id: 'new-contract-123',
    user_id: 'user-1',
    status: 'active' as const,
    filename: 'contract.pdf',
    licensee_name: 'Test Corp',
    contract_start_date: null,
    contract_end_date: null,
    royalty_rate: 0.10,
    royalty_base: 'net_sales' as const,
    territories: [],
    product_categories: null,
    minimum_guarantee: null,
    minimum_guarantee_period: null,
    advance_payment: null,
    reporting_frequency: 'quarterly' as const,
    pdf_url: 'https://example.com/contract.pdf',
    extracted_terms: {},
    storage_path: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  }

  beforeEach(() => {
    jest.clearAllMocks()
    ;(useRouter as jest.Mock).mockReturnValue({
      push: mockPush,
    })
    // Default: no ?draft= query param
    ;(useSearchParams as jest.Mock).mockReturnValue({
      get: jest.fn().mockReturnValue(null),
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

  it('accepts a PDF with empty file.type (Android file manager behaviour)', async () => {
    // Android Chrome and Samsung Internet often report file.type = '' when a
    // PDF is selected from a content URI / file manager.  The fix accepts the
    // file when the filename ends with .pdf even if the MIME type is blank.
    render(<UploadContractPage />)

    // Simulate a file object whose type is empty but name ends in .pdf
    const file = new File(['%PDF-1.4 fake'], 'contract.pdf', { type: '' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement

    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      // The file name should appear in the dropzone — no error shown
      expect(screen.getByText('contract.pdf')).toBeInTheDocument()
      expect(screen.queryByText(/please upload a pdf file/i)).not.toBeInTheDocument()
    })
  })

  it('accepts a PDF with uppercase .PDF extension and empty type', async () => {
    render(<UploadContractPage />)

    const file = new File(['%PDF-1.4 fake'], 'CONTRACT.PDF', { type: '' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement

    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText('CONTRACT.PDF')).toBeInTheDocument()
      expect(screen.queryByText(/please upload a pdf file/i)).not.toBeInTheDocument()
    })
  })

  it('rejects a non-PDF file even when file.type is empty', async () => {
    render(<UploadContractPage />)

    // A .txt file with empty type should still be rejected
    const file = new File(['hello'], 'notes.txt', { type: '' })
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

  it('sends contract_start_date and contract_end_date (not contract_start/contract_end) to confirmDraft', async () => {
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
      const [, payload] = mockConfirmDraft.mock.calls[0]
      // Backend ContractConfirm model expects contract_start_date / contract_end_date
      expect(payload).toHaveProperty('contract_start_date')
      expect(payload).toHaveProperty('contract_end_date')
      // Must NOT use the old wrong field names
      expect(payload).not.toHaveProperty('contract_start')
      expect(payload).not.toHaveProperty('contract_end')
    })
  })

  it('sends royalty_rate as a string (not a number) to confirmDraft', async () => {
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
      const [, payload] = mockConfirmDraft.mock.calls[0]
      // The backend expects str | list | dict — a plain number causes a 422 error.
      expect(typeof payload.royalty_rate).toBe('string')
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
      expect(mockPush).toHaveBeenCalledWith('/contracts/new-contract-123?success=period_created')
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

    it('shows "Resume review" button for INCOMPLETE_DRAFT', async () => {
      // The "Resume review" control is a <button>, not a <Link>.
      // Using a Link would navigate to the same page without re-mounting, so the
      // ?draft= useEffect would not re-run. A button calls loadDraft() directly.
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
        const btn = screen.getByRole('button', { name: /resume review/i })
        expect(btn).toBeInTheDocument()
      })
    })

    it('clicking "Resume review" calls getContract and shows the review form', async () => {
      // This is the critical end-to-end test for the bug fix.
      // Previously, "Resume review" was a <Link> to the same page. Since the component
      // was already mounted, the navigation would NOT re-trigger the ?draft= useEffect,
      // so nothing happened. Now it's a button that calls loadDraft() directly.
      const MockApiError6b = (jest.requireMock('@/lib/api') as any).ApiError
      const draftError = new MockApiError6b('Conflict', 409, {
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

      // getContract returns a minimal draft with form_values so the review form populates
      const resumedDraft = {
        id: 'draft-contract-id',
        user_id: 'user-1',
        status: 'draft' as const,
        filename: 'nike-contract.pdf',
        licensee_name: null,
        contract_start_date: null,
        contract_end_date: null,
        royalty_rate: null,
        royalty_base: null,
        territories: [],
        product_categories: null,
        minimum_guarantee: null,
        minimum_guarantee_period: null,
        advance_payment: null,
        reporting_frequency: null,
        pdf_url: null,
        extracted_terms: {},
        storage_path: null,
        created_at: '2026-02-19T08:15:00Z',
        updated_at: '2026-02-19T08:15:00Z',
        form_values: {
          licensee_name: 'Nike Inc.',
          licensor_name: 'Brand Owner',
          contract_start_date: '2024-01-01',
          contract_end_date: '2025-12-31',
          royalty_rate: 15,
          royalty_base: 'net_sales' as const,
          territories: ['US'],
          reporting_frequency: 'quarterly' as const,
          minimum_guarantee: null,
          advance_payment: null,
        },
      }
      mockGetContract.mockResolvedValue(resumedDraft)

      render(<UploadContractPage />)

      // Trigger the 409 error by uploading the file
      const file = new File(['test'], 'nike-contract.pdf', { type: 'application/pdf' })
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => expect(screen.getByText(/upload & extract/i)).toBeInTheDocument())
      fireEvent.click(screen.getByText(/upload & extract/i))

      // Wait for the INCOMPLETE_DRAFT error UI
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /resume review/i })).toBeInTheDocument()
      })

      // Click "Resume review" — should load the draft directly (no navigation)
      fireEvent.click(screen.getByRole('button', { name: /resume review/i }))

      // getContract must have been called with the draft ID from the 409 error
      await waitFor(() => {
        expect(mockGetContract).toHaveBeenCalledWith('draft-contract-id')
      })

      // Review form should now be visible with data from the draft
      await waitFor(() => {
        expect(screen.getByText(/review extracted terms/i)).toBeInTheDocument()
        expect(screen.getByDisplayValue('Nike Inc.')).toBeInTheDocument()
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
  // Form validation before submission
  // ============================================================

  describe('form validation', () => {
    // Helper: reach the review step
    const reachReviewStep = async (overrideFormValues?: Partial<typeof baseExtractionResponse['form_values']>) => {
      const response = {
        ...baseExtractionResponse,
        form_values: {
          ...baseExtractionResponse.form_values,
          ...overrideFormValues,
        },
      }
      mockUploadContract.mockResolvedValue(response)

      render(<UploadContractPage />)

      const file = new File(['test'], 'contract.pdf', { type: 'application/pdf' })
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => expect(screen.getByText(/upload & extract/i)).toBeInTheDocument())
      fireEvent.click(screen.getByText(/upload & extract/i))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /confirm and save/i })).toBeInTheDocument()
      })
    }

    it('shows error and does not call confirmDraft when contract_start_date is empty', async () => {
      // Start with an empty contract_start_date so the form initializes with the field blank
      await reachReviewStep({ contract_start_date: '' })

      fireEvent.click(screen.getByRole('button', { name: /confirm and save/i }))

      await waitFor(() => {
        expect(screen.getByText(/contract start date is required/i)).toBeInTheDocument()
      })
      expect(mockConfirmDraft).not.toHaveBeenCalled()
    })

    it('shows error and does not call confirmDraft when contract_end_date is empty', async () => {
      // Provide start date but no end date so the form initializes with end date blank
      await reachReviewStep({ contract_start_date: '2024-01-01', contract_end_date: '' })

      fireEvent.click(screen.getByRole('button', { name: /confirm and save/i }))

      await waitFor(() => {
        expect(screen.getByText(/contract end date is required/i)).toBeInTheDocument()
      })
      expect(mockConfirmDraft).not.toHaveBeenCalled()
    })

    it('shows error and does not call confirmDraft when licensee_name is empty', async () => {
      // Start with an empty licensee_name so the form initializes with the field blank
      await reachReviewStep({ licensee_name: '' })

      // Use fireEvent.submit on the form directly to bypass HTML5 constraint validation
      // (the licensee_name input has `required` which would block the onSubmit handler in jsdom)
      const form = document.querySelector('form') as HTMLFormElement
      fireEvent.submit(form)

      await waitFor(() => {
        expect(screen.getByText(/licensee name is required/i)).toBeInTheDocument()
      })
      expect(mockConfirmDraft).not.toHaveBeenCalled()
    })

    it('does not show a validation error banner before the form is submitted', async () => {
      await reachReviewStep({ contract_start_date: '' })

      // Should not show the specific error message yet — user has not tried to submit
      expect(screen.queryByText(/contract start date is required/i)).not.toBeInTheDocument()
    })

    it('calls confirmDraft when all required fields are present', async () => {
      mockConfirmDraft.mockResolvedValue(mockSavedContract)
      // baseExtractionResponse already has all required fields populated
      await reachReviewStep()

      fireEvent.click(screen.getByRole('button', { name: /confirm and save/i }))

      await waitFor(() => {
        expect(mockConfirmDraft).toHaveBeenCalled()
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
        expect(mockPush).toHaveBeenCalledWith('/contracts/new-contract-123?success=period_created')
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

  // ============================================================
  // ?draft= query param: resume review from URL
  // ============================================================

  describe('?draft= query param loading', () => {
    // Minimal draft contract reflecting real backend API response shape:
    // - dates use contract_start_date / contract_end_date (not contract_start / contract_end)
    // - licensor_name lives in extracted_terms, not as a top-level field
    const draftContract = {
      id: 'draft-contract-id',
      user_id: 'user-1',
      status: 'draft' as const,
      filename: 'nike-contract.pdf',
      licensee_name: null,
      contract_start_date: null,
      contract_end_date: null,
      royalty_rate: null,
      royalty_base: null,
      territories: [],
      product_categories: null,
      minimum_guarantee: null,
      minimum_guarantee_period: null,
      advance_payment: null,
      reporting_frequency: null,
      pdf_url: 'https://example.com/nike-contract.pdf',
      extracted_terms: {
        licensor_name: null,
        licensee_name: null,
      },
      storage_path: null,
      created_at: '2026-02-19T08:15:00Z',
      updated_at: '2026-02-19T08:15:00Z',
    }

    // Populated draft: all reviewable fields present.
    // The backend now returns form_values (normalized values from extracted_terms)
    // on draft contracts from GET /contracts/{id}. The frontend reads form_values
    // directly — the same path as a fresh upload.
    const draftContractWithData = {
      ...draftContract,
      // Top-level columns are still null for drafts (confirmed after PUT /confirm)
      licensee_name: null,
      contract_start_date: null,
      contract_end_date: null,
      royalty_rate: null,
      royalty_base: null,
      territories: [],
      reporting_frequency: null,
      minimum_guarantee: null,
      advance_payment: null,
      extracted_terms: {
        licensor_name: 'Brand Owner',
        licensee_name: 'Nike Inc.',
        contract_start_date: '2024-01-01',
        contract_end_date: '2025-12-31',
        royalty_rate: '15%',
        royalty_base: 'net sales',
        territories: ['US', 'Canada'],
        reporting_frequency: 'quarterly',
        minimum_guarantee: '$5,000',
        advance_payment: '$1,000',
        product_categories: null,
        payment_terms: null,
        exclusivity: null,
        confidence_score: null,
        extraction_notes: null,
      },
      // Backend-normalized form_values (what normalize_extracted_terms produces)
      form_values: {
        licensee_name: 'Nike Inc.',
        licensor_name: 'Brand Owner',
        contract_start_date: '2024-01-01',
        contract_end_date: '2025-12-31',
        royalty_rate: 15,
        royalty_base: 'net_sales' as const,
        territories: ['US', 'Canada'],
        reporting_frequency: 'quarterly' as const,
        minimum_guarantee: 5000,
        advance_payment: 1000,
      },
    }

    it('calls getContract with the draft ID from the URL on mount', async () => {
      mockGetContract.mockResolvedValue(draftContract)
      ;(useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn((key: string) => (key === 'draft' ? 'draft-contract-id' : null)),
      })

      render(<UploadContractPage />)

      await waitFor(() => {
        expect(mockGetContract).toHaveBeenCalledWith('draft-contract-id')
      })
    })

    it('shows loading state while fetching the draft', async () => {
      // Never resolves so we can observe the loading state
      mockGetContract.mockImplementation(() => new Promise(() => {}))
      ;(useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn((key: string) => (key === 'draft' ? 'draft-contract-id' : null)),
      })

      render(<UploadContractPage />)

      await waitFor(() => {
        expect(screen.getByText(/loading draft/i)).toBeInTheDocument()
      })
    })

    it('shows the review form after successfully loading the draft', async () => {
      mockGetContract.mockResolvedValue(draftContract)
      ;(useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn((key: string) => (key === 'draft' ? 'draft-contract-id' : null)),
      })

      render(<UploadContractPage />)

      await waitFor(() => {
        expect(screen.getByText(/review extracted terms/i)).toBeInTheDocument()
      })
    })

    it('populates licensee_name field from contract.form_values.licensee_name', async () => {
      mockGetContract.mockResolvedValue(draftContractWithData)
      ;(useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn((key: string) => (key === 'draft' ? 'draft-contract-id' : null)),
      })

      render(<UploadContractPage />)

      await waitFor(() => {
        expect(screen.getByDisplayValue('Nike Inc.')).toBeInTheDocument()
      })
    })

    it('populates licensor_name field from contract.form_values.licensor_name', async () => {
      mockGetContract.mockResolvedValue(draftContractWithData)
      ;(useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn((key: string) => (key === 'draft' ? 'draft-contract-id' : null)),
      })

      render(<UploadContractPage />)

      await waitFor(() => {
        // licensor_name is sourced from form_values (normalized by the backend)
        expect(screen.getByDisplayValue('Brand Owner')).toBeInTheDocument()
      })
    })

    it('populates territories as comma-separated string', async () => {
      mockGetContract.mockResolvedValue(draftContractWithData)
      ;(useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn((key: string) => (key === 'draft' ? 'draft-contract-id' : null)),
      })

      render(<UploadContractPage />)

      await waitFor(() => {
        expect(screen.getByDisplayValue('US, Canada')).toBeInTheDocument()
      })
    })

    it('populates contract_start_date field from contract.form_values.contract_start_date', async () => {
      mockGetContract.mockResolvedValue(draftContractWithData)
      ;(useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn((key: string) => (key === 'draft' ? 'draft-contract-id' : null)),
      })

      render(<UploadContractPage />)

      await waitFor(() => {
        // The date input for contract start should be populated
        expect(screen.getByDisplayValue('2024-01-01')).toBeInTheDocument()
      })
    })

    it('populates contract_end_date field from contract.form_values.contract_end_date', async () => {
      mockGetContract.mockResolvedValue(draftContractWithData)
      ;(useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn((key: string) => (key === 'draft' ? 'draft-contract-id' : null)),
      })

      render(<UploadContractPage />)

      await waitFor(() => {
        expect(screen.getByDisplayValue('2025-12-31')).toBeInTheDocument()
      })
    })

    it('converts numeric royalty_rate from form_values to string in form field', async () => {
      mockGetContract.mockResolvedValue(draftContractWithData)
      ;(useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn((key: string) => (key === 'draft' ? 'draft-contract-id' : null)),
      })

      render(<UploadContractPage />)

      await waitFor(() => {
        // form_values.royalty_rate = 15 (number) -> "15" string in the input
        expect(screen.getByDisplayValue('15')).toBeInTheDocument()
      })
    })

    it('sets draftContractId so confirmDraft is called with correct ID', async () => {
      mockGetContract.mockResolvedValue(draftContractWithData)
      mockConfirmDraft.mockResolvedValue(mockSavedContract)
      ;(useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn((key: string) => (key === 'draft' ? 'draft-contract-id' : null)),
      })

      render(<UploadContractPage />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /confirm and save/i })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /confirm and save/i }))

      await waitFor(() => {
        expect(mockConfirmDraft).toHaveBeenCalledWith(
          'draft-contract-id',
          expect.any(Object)
        )
      })
    })

    it('sends contract_start_date and contract_end_date after resuming a draft', async () => {
      mockGetContract.mockResolvedValue(draftContractWithData)
      mockConfirmDraft.mockResolvedValue(mockSavedContract)
      ;(useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn((key: string) => (key === 'draft' ? 'draft-contract-id' : null)),
      })

      render(<UploadContractPage />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /confirm and save/i })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /confirm and save/i }))

      await waitFor(() => {
        const [, payload] = mockConfirmDraft.mock.calls[0]
        expect(payload).toHaveProperty('contract_start_date', '2024-01-01')
        expect(payload).toHaveProperty('contract_end_date', '2025-12-31')
        expect(payload).not.toHaveProperty('contract_start')
        expect(payload).not.toHaveProperty('contract_end')
      })
    })

    it('sends royalty_rate as a string after resuming a draft', async () => {
      mockGetContract.mockResolvedValue(draftContractWithData)
      mockConfirmDraft.mockResolvedValue(mockSavedContract)
      ;(useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn((key: string) => (key === 'draft' ? 'draft-contract-id' : null)),
      })

      render(<UploadContractPage />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /confirm and save/i })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /confirm and save/i }))

      await waitFor(() => {
        const [, payload] = mockConfirmDraft.mock.calls[0]
        // The backend expects str | list | dict — a plain number causes a 422 error.
        expect(typeof payload.royalty_rate).toBe('string')
      })
    })

    it('shows an error message if getContract fails', async () => {
      mockGetContract.mockRejectedValue(new Error('Failed to fetch contract'))
      ;(useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn((key: string) => (key === 'draft' ? 'draft-contract-id' : null)),
      })

      render(<UploadContractPage />)

      await waitFor(() => {
        // Use getAllByText since React StrictMode may render the error state twice
        const matches = screen.getAllByText(/could not load draft/i)
        expect(matches.length).toBeGreaterThan(0)
      })
    })

    it('does not call getContract when no draft query param is present', () => {
      // useSearchParams returns null for 'draft' (set in beforeEach)
      render(<UploadContractPage />)

      expect(mockGetContract).not.toHaveBeenCalled()
    })
  })
})
