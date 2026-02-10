/**
 * Tests for Contract Upload Page
 */

import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRouter } from 'next/navigation'
import UploadContractPage from '@/app/(app)/contracts/upload/page'
import { uploadContract, createContract } from '@/lib/api'

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}))

// Mock API
jest.mock('@/lib/api', () => ({
  uploadContract: jest.fn(),
  createContract: jest.fn(),
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
        contract_start: '2024-01-01',
        contract_end: '2025-12-31',
        royalty_rate: '15%',
        royalty_base: 'net_sales',
        territories: ['US'],
        reporting_frequency: 'quarterly',
        minimum_guarantee: null,
        advance_payment: null,
        product_categories: null,
        mg_period: null,
        payment_terms: null,
      },
      raw_text: 'Test contract text',
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
        contract_start: null,
        contract_end: null,
        royalty_rate: '10',
        royalty_base: 'net_sales',
        territories: null,
        reporting_frequency: 'quarterly',
        minimum_guarantee: null,
        advance_payment: null,
        product_categories: null,
        mg_period: null,
        payment_terms: null,
      },
      raw_text: '',
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

  it('shows error on extraction failure', async () => {
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
      expect(screen.getByText(/failed to upload contract/i)).toBeInTheDocument()
    })
  })
})
