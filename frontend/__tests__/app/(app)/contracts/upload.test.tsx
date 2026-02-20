/**
 * Tests for Contract Upload Page
 */

import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRouter } from 'next/navigation'
import UploadContractPage from '@/app/(app)/contracts/upload/page'
import { uploadContract, createContract, ApiError } from '@/lib/api'

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}))

// Mock API
jest.mock('@/lib/api', () => ({
  uploadContract: jest.fn(),
  createContract: jest.fn(),
  ApiError: class ApiError extends Error {
    status: number
    constructor(message: string, status: number) {
      super(message)
      this.name = 'ApiError'
      this.status = status
    }
  },
}))

describe('Upload Contract Page', () => {
  const mockPush = jest.fn()
  const mockUploadContract = uploadContract as jest.MockedFunction<typeof uploadContract>
  const mockCreateContract = createContract as jest.MockedFunction<typeof createContract>

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

  it('shows review form after extraction', async () => {
    mockUploadContract.mockResolvedValue({
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
      },
      form_values: {
        licensee_name: 'Test Corp',
        licensor_name: 'Test Author',
        contract_start_date: '2024-01-01',
        contract_end_date: '2025-12-31',
        royalty_rate: 15,
        royalty_base: 'net_sales',
        territories: ['US'],
        reporting_frequency: 'quarterly',
        minimum_guarantee: null,
        advance_payment: null,
      },
      token_usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
      filename: 'contract.pdf',
      storage_path: 'contracts/user-123/abc_contract.pdf',
      pdf_url: 'https://example.com/signed-url',
    })

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
      expect(screen.getByText('Save Contract')).toBeInTheDocument()
    })
  })

  it('redirects to contract detail after save', async () => {
    mockUploadContract.mockResolvedValue({
      extracted_terms: {
        licensee_name: 'Test Corp',
        licensor_name: null,
        contract_start_date: null,
        contract_end_date: null,
        royalty_rate: '10%',
        royalty_base: null,
        territories: null,
        reporting_frequency: 'quarterly',
        minimum_guarantee: null,
        advance_payment: null,
        product_categories: null,
        payment_terms: null,
      },
      form_values: {
        licensee_name: 'Test Corp',
        licensor_name: '',
        contract_start_date: '',
        contract_end_date: '',
        royalty_rate: 10,
        royalty_base: 'net_sales',
        territories: [],
        reporting_frequency: 'quarterly',
        minimum_guarantee: null,
        advance_payment: null,
      },
      token_usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
      filename: 'contract.pdf',
      storage_path: 'contracts/user-123/abc_contract.pdf',
      pdf_url: 'https://example.com/signed-url',
    })

    mockCreateContract.mockResolvedValue({ id: 'new-contract-123' })

    render(<UploadContractPage />)

    // Select file
    const file = new File(['test'], 'contract.pdf', { type: 'application/pdf' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    // Click upload
    await waitFor(() => {
      expect(screen.getByText(/upload & extract/i)).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText(/upload & extract/i))

    // Wait for review form
    await waitFor(() => {
      expect(screen.getByText('Save Contract')).toBeInTheDocument()
    })

    // Click save
    fireEvent.click(screen.getByText('Save Contract'))

    await waitFor(() => {
      expect(mockCreateContract).toHaveBeenCalled()
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
})
